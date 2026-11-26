import { createHmac, randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { accountMetadata, accountTime } from '../adapters/accounts/passive.mjs';
import { accountTranscript } from '../adapters/accounts/transcript.mjs';
import { runtimeDirectory } from '../cli/project.mjs';
import { jsonlTail } from '../runtimes/tui/read-jsonl.mjs';
import { checkedTranscript } from './oar.mjs';

export function statuslinePath(project, generation) {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(generation)) throw new Error('Invalid statusline generation');
  return join(runtimeDirectory(project), 'account-statusline', `${generation}.jsonl`);
}

export function accountCollector(project, { jobs, save, report, events, accountBinding,
  observeAccounts, observeAccountDiagnostics, observeAccountIncidents }) {
  const accountReaders = new Map();
  const collectAccounts = Boolean(observeAccounts || observeAccountDiagnostics || observeAccountIncidents);
  function accountOptions(row) {
    const job = jobs.get(row.addr);
    if (job?.boundAccount && job.boundAccount.sessionId === row.sessionId) return job.boundAccount.metadata;
    const { accountRef = job?.accountRef ?? job?.account_ref, secret, ...input } = accountBinding?.(row) ?? {};
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : null;
    const values = accountMetadata(input);
    const ref = typeof accountRef === 'string' && /^[a-z0-9_.:-]{1,128}$/i.test(accountRef) ? accountRef :
      secret && email && values.masked_account ? createHmac('sha256', secret).update(email).digest('hex') : undefined;
    const metadata = { accountRef: ref, maskedAccount: values.masked_account, plan: values.plan,
      active: values.active, expiresAt: values.expires_at };
    // Bind only when the native session is known. A later active login must
    // not turn evidence from an existing launch into another account's data.
    if (job && row.sessionId && (accountBinding || ref)) {
      job.boundAccount = { sessionId: row.sessionId, metadata };
      try { save(job); }
      catch { report(`${row.addr}: could not persist passive account binding`); }
    }
    return metadata;
  }
  const accountCallbacks = { observeAccounts, observeAccountDiagnostics, observeAccountIncidents };

  async function refreshAccounts(job, row, { transcript, runtime, hooks } = {}) {
    if (!collectAccounts || !row.sessionId || !['agy', 'claude', 'codex'].includes(row.cli)) return;
    try {
      transcript = transcript && checkedTranscript(transcript, row);
      const generation = job.accountStatusline?.generation ?? job.host?.incarnation ?? row.addr;
      const identity = JSON.stringify([row.sessionId, generation, transcript]);
      let reader = accountReaders.get(row.addr);
      if (reader?.identity !== identity) {
        reader = { identity, transcript: accountTranscript(row.cli, row.sessionId), statusline: jsonlTail(), seen: new Set() };
        accountReaders.set(row.addr, reader);
      }
      const binding = accountOptions(row);
      const { accountRef } = binding;
      const observe = batch => {
        if (batch?.length) observeAccounts?.(batch.map(item => ({ ...item,
          ...accountMetadata({ maskedAccount: item.masked_account, active: item.active, expiresAt: item.expires_at, ...binding }, item.plan),
          session_id: item.session_id ?? row.sessionId, ...(accountRef && { account_ref: accountRef }),
        })));
      };
      const diagnose = batch => {
        if (batch?.length) observeAccountDiagnostics?.(batch.map(item => ({ ...item, sessionId: item.sessionId ?? row.sessionId, ...(accountRef && { accountRef }) })));
      };
      const rows = runtime?.rows ?? (job.host ? events(row.addr) : []);
      for (const event of rows) {
        if (!['account-evidence', 'account-incident'].includes(event.type) || !job.host ||
            event.addr !== row.addr || event.incarnation !== generation ||
            event.sessionId && event.sessionId !== row.sessionId || reader.seen.has(event.eventId)) continue;
        observe(event.observations);
        diagnose(event.diagnostics);
        if (accountRef && event.incident) {
          observeAccountIncidents?.([{ cli: row.cli, account_ref: accountRef, session_id: row.addr, ...event.incident }]);
        }
        reader.seen.add(event.eventId);
      }
      if (transcript && ['claude', 'codex'].includes(row.cli)) {
        const stream = rows.findLast(event => event.type === 'stream-opened' && event.sessionId === row.sessionId &&
          event.incarnation === job.host?.incarnation);
        observe(await reader.transcript(transcript, { ...binding, cwd: row.cwd, generation, startedAt: row.startedAt,
          cliVersion: runtime?.session?.cliVersion ?? stream?.cliVersion, observeAccountDiagnostics: diagnose }));
      }
      if (job.accountStatusline && hooks) {
        const launch = job.accountStatusline;
        const ids = new Set(hooks.filter(event => event.receivedAt >= launch.startedAt && event.cwd === row.cwd && !event.agent_id &&
          !event.parent_tool_use_id && !event.isSidechain)
          .map(event => event.session_id ?? event.conversationId).filter(Boolean));
        if (ids.size > 1 || row.cli === 'agy' && !ids.has(row.sessionId)) return;
        const sessionId = row.cli === 'claude' ? row.sessionId : row.addr;
        const sink = statuslinePath(project, generation);
        const stat = lstatSync(sink, { throwIfNoEntry: false });
        if (!stat?.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600 ||
            realpathSync(dirname(sink)) !== dirname(sink)) return;
        for (const entry of await reader.statusline(sink)) {
          if (entry.cli !== row.cli || entry.generation !== generation || entry.sessionId !== sessionId ||
              entry.nativeSessionId !== row.sessionId || !accountTime(entry.observedAt) || Date.parse(entry.observedAt) < launch.startedAt) continue;
          const source = `${row.cli}-statusline`;
          observe(entry.observations?.filter(item => item.cli === row.cli && item.source === source &&
            item.generation === generation && item.session_id === row.sessionId && item.observed_at === entry.observedAt));
          diagnose(entry.diagnostics?.filter(item => item.cli === row.cli && item.source === source &&
            item.generation === generation && item.sessionId === row.sessionId && item.observedAt === entry.observedAt));
        }
      }
    } catch {
      report(`${row.addr}: could not collect passive account evidence`);
    }
  }

  function reserveStatusline(job, row) {
    if (!collectAccounts || !['agy', 'claude'].includes(row.cli)) return;
    delete job.accountStatusline;
    const generation = randomUUID();
    const sink = statuslinePath(project, generation);
    try {
      const parent = dirname(sink);
      mkdirSync(parent, { recursive: true, mode: 0o700 });
      if (realpathSync(parent) !== parent || (statSync(parent).mode & 0o777) !== 0o700) return;
      job.accountStatusline = { generation, startedAt: Date.now() };
      save(job);
    } catch {
      delete job.accountStatusline;
      report(`${row.addr}: could not reserve statusline account evidence`);
    }
  }

  return { accountOptions, accountCallbacks, refreshAccounts, reserveStatusline, clear: addr => accountReaders.delete(addr) };
}
