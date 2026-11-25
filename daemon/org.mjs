import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { adapterFor } from '../cli/sessions.mjs';
import { timestamp } from '../cli/turns.mjs';
import { driftDefaults, readPolicy } from '../cli/policy.mjs';
import { runtimeDirectory } from '../cli/project.mjs';
import { checkFacts } from '../evidence/facts.mjs';
import { forTurn, readTranscript } from '../evidence/index.mjs';
import { observeRelayTurn, turnExecutions } from '../evidence/relay.mjs';
import { isBlockedReply } from '../inbox/message.mjs';
import { observeExecutions, sampleCard } from '../watch/drift.mjs';
import { readText, writeState } from './io.mjs';

const orgPath = project => join(runtimeDirectory(project), 'org.json');
export const readOrg = project => JSON.parse(readText(orgPath(project), '{"seen":{},"cards":{},"timings":{},"notices":{},"samples":{}}'));
const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 20);
const failedReply = body => /^\**FAILED(?:\s|$)/i.test(body?.trimStart() ?? '');

export function organization(project, index, sessions, mail, now, report) {
  let state = readOrg(project);
  const parsed = new Map();

  async function nativeTurns(row) {
    if (!row.transcriptPath) return [];
    try {
      const stat = statSync(row.transcriptPath);
      const signature = JSON.stringify([row.sessionId, row.transcriptPath, stat.size, stat.mtimeMs]);
      const previous = parsed.get(row.addr);
      if (previous?.signature === signature) return previous.turns;
      const text = await readTranscript(row.cli, row.cwd, row.transcriptPath);
      const turns = text ? adapterFor(row).transcript.parse(text).turns : [];
      parsed.set(row.addr, { signature, turns });
      return turns;
    } catch { return []; }
  }

  async function observations(row, messages) {
    const output = [];
    const endEvents = row.backend === 'headless' ? sessions.events(row.addr).filter(event => event.type === 'turn-end') : [];
    let native;
    for (const end of endEvents) {
      const { at, streamId, turnId, nativeTurnId, inputIds, outcome } = end;
      let body = end.finalReply;
      if (end.unconfirmed && end.unconfirmedBody) {
        native ??= await nativeTurns(row);
        const observed = native.find(turn => turn.id === nativeTurnId) ?? native[end.turn - 1];
        if (observed?.status === 'completed' && observed.reply?.trim() === end.unconfirmedBody.trim()) body = observed.reply;
      }
      output.push({ key: JSON.stringify([row.addr, streamId, turnId]), at, body, streamId, turnId, nativeTurnId,
        inputIds, outcome, nativeTurnIndex: end.turn, source: 'OAR turn-end',
        corroborated: Boolean(end.unconfirmed && body), waiting: end.unconfirmed && !body });
    }
    for (const { id, completion } of messages) {
      if (!completion || output.some(turn => turn.inputIds?.includes(id) || turn.streamId &&
          turn.streamId === completion.streamId && turn.turnId === completion.turnId)) continue;
      output.push({ ...completion, key: JSON.stringify([row.addr, completion.nativeTurnId ?? completion.turnId ?? id]),
        inputIds: [id] });
    }
    if (row.backend === 'tui') {
      native ??= await nativeTurns(row);
      for (const turn of native) {
        const at = timestamp(turn.endedAt);
        if (!Number.isFinite(at) || at < row.startedAt || !['completed', 'failed'].includes(turn.status) ||
            output.some(item => (item.nativeTurnId ?? item.turnId) === turn.id ||
              item.at === at || item.body && item.body === turn.reply && Math.abs(item.at - at) <= 1000)) continue;
        output.push({ key: JSON.stringify([row.addr, turn.id ?? turn.index]), at, body: turn.reply, source: 'native transcript',
          nativeTurnId: turn.id, nativeTurnIndex: turn.index, outcome: { kind: turn.status } });
      }
    }
    return output.sort((a, b) => a.at - b.at);
  }

  async function collect(rows) {
    let settings;
    try { settings = { ...driftDefaults, ...readPolicy(project, { optional: true }).drift }; }
    catch (error) { report(error.message); settings = driftDefaults; }
    const next = structuredClone(state);
    const at = now();
    const recordings = [];
    const executions = [];
    const pending = new Map(index.rotations().filter(item => !item.verifiedAt && !item.failedAt).map(item => [item.successor, item]));
    const byAddr = Map.groupBy(mail.messages.filter(message => !message.combinedInto), message => message.target.addr);
    const owned = rows.filter(row => row.role !== 'reviewer' && sessions.jobs.has(row.addr));
    const latestCards = new Map(owned.filter(row => row.role === 'worker').map(row => [JSON.stringify([row.project, row.task]), row]));

    for (const row of owned) {
      const job = sessions.jobs.get(row.addr);
      const taskKey = JSON.stringify([row.project, row.task]);
      const scope = row.task && row.role === 'worker' ? taskKey : JSON.stringify([row.project, row.role, row.addr]);
      const card = next.cards[scope] ??= {};
      const add = (type, key, detail, audience = 'auditor') => {
        const id = digest(JSON.stringify([scope, audience, type, key]));
        next.notices[id] ??= { id, type, audience, project: row.project, addr: row.addr, task: row.task, at, ...detail };
      };
      const turns = await observations(row, byAddr.get(row.addr) ?? []);
      const fresh = turns.filter(turn => !next.seen[turn.key] && !turn.waiting);
      const rotation = pending.get(row.addr);
      const handoverTurn = rotation && turns.find(turn => turn.inputIds?.includes(job.handoverReportId ?? job.firstId));
      if (latestCards.get(taskKey) === row && (row.endedAt == null || fresh.length) &&
          (fresh.length || at >= (next.samples[scope] ?? 0) + settings.sampleIntervalMs)) {
        sampleCard(row, project, job.cardStart, settings, card, add);
        next.samples[scope] = at;
      }
      for (const turn of fresh) {
        const { key, body, inputIds, at: endedAt, outcome } = turn;
        const facts = body ? checkFacts(body, row.cwd, project) : { checked: 0, misses: [] };
        for (const miss of facts.misses) {
          const factKey = JSON.stringify(miss);
          if (settings.factMiss || row.role === 'leader') add('fact-miss', factKey, miss);
          if (row.role === 'auditor') add('fact-miss', factKey, miss, 'leader');
        }
        if (rotation?.boundAt != null && body && (turn === handoverTurn ||
            endedAt >= (rotation.firstReportAt ?? handoverTurn?.at ?? Infinity))) {
          const verified = !facts.misses.length && !failedReply(body) && !isBlockedReply(body) &&
            (!outcome || outcome.kind === 'completed');
          recordings.push([row.addr, { at: endedAt, turn: key, misses: facts.misses.length, verified }]);
        }
        const worker = { id: row.task ?? row.role, addr: row.addr, provider: row.cli };
        const observation = await observeRelayTurn(project, worker, { ...turn, body, failed: outcome?.kind === 'failed' }, {
          cwd: row.cwd, sessionId: row.sessionId, nativeTurnIndex: turn.nativeTurnIndex,
          nativeTurnId: turn.nativeTurnId ?? turn.turnId, streamId: turn.streamId,
          transcriptPath: () => row.transcriptPath,
        }, index);
        const timing = next.timings[JSON.stringify(row.project)] ??= {};
        const failure = outcome?.failure ?? (outcome?.kind === 'failed' || failedReply(body) ? 'turn-failed' : undefined);
        executions.push({ card, timing, observations: turnExecutions(observation), failure, add, endedAt });
        if (row.role === 'worker' && body && row.task) {
          const first = inputIds?.includes(job.firstId) && !turn.corroborated;
          const hash = first ? digest(row.task + '/' + row.addr + '/' + job.firstId) : digest(key);
          await forTurn({ ...observation, turn: hash, facts });
        }
        next.seen[key] = true;
      }
      if (row.endedAt != null && pending.has(row.addr)) {
        for (const [addr, record] of recordings.filter(([addr]) => addr === row.addr)) index.reportRotation(addr, record);
        index.failRotation(row.addr, row.endedAt, job.error ?? 'Successor exited before report verification');
      }
    }
    for (const item of executions.sort((a, b) => a.endedAt - b.endedAt)) {
      observeExecutions(item.card, item.timing, item.observations, item.failure, settings, item.add);
    }
    // If verification is recorded before this checkpoint, replaying the turn is harmless.
    for (const [addr, record] of recordings) index.reportRotation(addr, record);
    if (JSON.stringify(next) !== JSON.stringify(state)) {
      writeState(orgPath(project), JSON.stringify(next) + '\n');
      state = next;
    }
  }

  return { collect, notices: () => Object.values(state.notices) };
}
