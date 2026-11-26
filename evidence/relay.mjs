import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { forTurn, inside, localText, readTranscript } from './index.mjs';
import { collectVerification, executionEvidence, sandboxMode } from './transcript.mjs';
import { readArtifacts, safeName } from '../cli/artifacts.mjs';
import { turnTools } from '../lib/turn-tools.mjs';
import { oarTurnEndHead } from '../daemon/turn-heads.mjs';

function launchSandbox(provider, argv = []) {
  if (!Array.isArray(argv)) return null;
  if (provider === 'agy') return argv.includes('--sandbox') ? true : null;
  if (provider !== 'codex') return null;
  if (argv.includes('--dangerously-bypass-approvals-and-sandbox')) return false;
  const mode = argv.indexOf('--sandbox');
  return sandboxMode(mode >= 0 ? argv[mode + 1] : argv.find(arg => arg.startsWith('--sandbox='))?.slice(10));
}

function belongs(project, worker, input, session) {
  return session && session.addr === worker.addr && (!session.task || session.task === worker.id) &&
    (!session.cli || session.cli === worker.provider) && inside(project, session.cwd) &&
    (!input.cwd || input.cwd === session.cwd) &&
    (!input.sessionId || !session.sessionId || input.sessionId === session.sessionId);
}

async function relaySession(project, worker, input, oar, index) {
  let projected;
  if (oar) {
    try {
      const text = await localText(join(project, '.project/relay/oar', `${worker.addr}.json`));
      const row = text && JSON.parse(text);
      if (belongs(project, worker, input, row)) projected = row;
    } catch { /* The index can still have the binding. */ }
  }
  if (projected?.baseCommit && projected.transcriptPath) return projected;
  try {
    index ??= (await import('../index/index.mjs')).index;
    const row = index.query({ addr: worker.addr }).find(session => belongs(project, worker, input, session));
    if (row && (!projected || row.sessionId === projected.sessionId)) {
      return { ...row, ...projected, baseCommit: projected?.baseCommit ?? row.baseCommit,
        transcriptPath: projected?.transcriptPath ?? row.transcriptPath };
    }
  } catch { /* An absent or unavailable index leaves project configuration as a fallback. */ }
  return projected;
}

export async function observeRelayTurn(project, worker, reply, input = {}, index) {
  const session = await relaySession(project, worker, input, reply.source === 'OAR turn-end', index);
  let cwd = input.cwd ?? session?.cwd ?? null;
  if (cwd) {
    cwd = await realpath(cwd).catch(() => null);
    if (!cwd || !inside(project, cwd)) cwd = null;
  }
  const hasNativeReply = reply.source !== 'fallback: hc read' && !reply.unconfirmed;
  let gitObservation = { status: 'missing-boundary' };
  let projected;
  if (safeName.test(worker.addr)) {
    const artifacts = readArtifacts(project);
    if (reply.source === 'OAR turn-end') {
      const journal = artifacts.journal(worker.addr);
      const end = journal.find(row => row.type === 'turn-end' && row.at === reply.at &&
        (input.streamId == null || row.streamId === input.streamId) &&
        (input.nativeTurnIndex == null || row.turn === input.nativeTurnIndex));
      if (end) {
        const rows = journal.filter(row => row.streamId === end.streamId && row.turnId === end.turnId).map(row => ({ row }));
        const calls = Map.groupBy(rows.filter(({ row }) => row.callId != null), ({ row }) => row.callId);
        const executions = executionEvidence([...calls.values()].flatMap(call => {
          const start = call.find(({ row }) => row.type === 'tool_call_started')?.row;
          const finish = call.findLast(({ row }) => row.type === 'tool_call_ended')?.row;
          if (!finish) return [];
          const durationMs = start && finish.at >= start.at ? finish.at - start.at : null;
          return turnTools('opencode', {}, call).map(tool => ({ ...tool, durationMs }));
        }));
        projected = { turnId: end.nativeTurnId ?? end.turnId, turnStatus: end.outcome?.kind, turnIndex: end.turn,
          tools: turnTools('opencode', {}, rows), executions };
        const start = rows.find(({ row }) => row.type === 'turn-start')?.row;
        const head = oarTurnEndHead(project, { cwd, task: worker.id }, start, end);
        gitObservation = { ...(head?.git ?? gitObservation), ...(end.head && { head: end.head }) };
      }
    } else {
      const exact = artifacts.turnHeads(worker.addr).find(row => row.endedAt === reply.at);
      gitObservation = { ...(exact?.end?.git ?? gitObservation), ...(exact?.end?.head && { head: exact.end.head }) };
    }
  }
  let transcript;
  if ((hasNativeReply || projected) && cwd) {
    try {
      const path = input.transcriptPath?.() ?? session?.transcriptPath;
      transcript = await readTranscript(worker.provider, cwd, path);
    } catch { /* Preserve Git evidence when a bound transcript disappears or is unreadable. */ }
  }
  return {
    project, cwd, task: worker.id, addr: worker.addr, provider: worker.provider,
    baseCommit: session?.baseCommit, gitObservation, projected, transcript, endedAt: reply.at, expectRed: input.expectRed,
    finalReply: hasNativeReply ? reply.body : null, failed: reply.failed,
    nativeTurnId: input.nativeTurnId, nativeTurnIndex: input.nativeTurnIndex,
    sandboxed: launchSandbox(worker.provider, input.argv),
  };
}

export const turnExecutions = observation => {
  const native = collectVerification(observation).executions ?? [];
  const projected = observation.projected?.executions ?? [];
  return native.some(execution => Number.isFinite(execution.durationMs)) || !projected.length ? native : projected;
};

export async function captureRelayTurn(project, worker, reply, turn, input = {}, index) {
  return forTurn({ ...await observeRelayTurn(project, worker, reply, input, index), turn, facts: input.facts });
}
