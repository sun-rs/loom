import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { adapterFor } from '../cli/sessions.mjs';
import { readArtifacts } from '../cli/artifacts.mjs';
import { timestamp } from '../cli/turns.mjs';
import { driftDefaults, readPolicy } from '../cli/policy.mjs';
import { runtimeDirectory } from '../cli/project.mjs';
import { checkFacts, plannedCardPaths } from '../evidence/facts.mjs';
import { unrecordedVerification } from '../evidence/claims.mjs';
import { evidenceConfig, evidenceTaskSettings, forTurn, readTranscript } from '../evidence/index.mjs';
import { observeRelayTurn, turnExecutions } from '../evidence/relay.mjs';
import { isBlockedReply } from '../inbox/message.mjs';
import { cardTexts, observeExecutions, sampleCard } from '../watch/drift.mjs';
import { readText, writeState } from './io.mjs';
import { workerCardId } from './worker-retention.mjs';

const orgPath = project => join(runtimeDirectory(project), 'org.json');
export const readOrg = project => JSON.parse(readText(orgPath(project), '{"seen":{},"cards":{},"timings":{},"notices":{},"samples":{}}'));
export const activeOrgNotices = state => Object.values(state.notices).filter(notice =>
  notice.type !== 'fact-miss' || Array.isArray(notice.misses));
export const workerCardFindings = (state, cardId) => Object.values(state.workerFindings?.[cardId] ?? {});
const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 20);
const failedReply = body => /^\**FAILED(?:\s|$)/i.test(body?.trimStart() ?? '');

function addFinding(state, cardId, finding) {
  if (!cardId) return;
  const cards = state.workerFindings ??= {};
  const findings = cards[cardId] ??= {};
  findings[finding.turn ? `${finding.turn}:${finding.kind}` : `${finding.reporter}:${finding.kind}`] ??= finding;
}

function recordTurnFindings(state, cardId, turn, git, facts, claims) {
  const paths = [...new Set([...(git?.protectedHits ?? []).map(hit => hit.path), ...git?.scopeHits ?? []])];
  if (paths.length) addFinding(state, cardId,
    { kind: 'overreach', at: turn.at, turn: turn.key, evidence: paths.slice(0, 5).join(', ') });
  // Missing check output is an evidence gap. Only contradictory recorded facts disqualify reuse.
  const mismatches = claims?.filter(claim => claim.status === 'MISMATCH' && claim.reason !== unrecordedVerification).length ?? 0;
  const count = (facts?.misses?.length ?? 0) + mismatches;
  if (count) addFinding(state, cardId, { kind: 'fact-error', at: turn.at, turn: turn.key, count });
}

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
      const receipt = messages.find(message => inputIds?.includes(message.id) && message.completion?.body)?.completion;
      let body = end.finalReply ?? receipt?.body;
      if (!body && end.unconfirmed && end.unconfirmedBody) {
        native ??= await nativeTurns(row);
        const observed = native.find(turn => turn.id === nativeTurnId) ?? native[end.turn - 1];
        if (observed?.status === 'completed' && observed.reply?.trim() === end.unconfirmedBody.trim()) body = observed.reply;
      }
      output.push({ key: JSON.stringify([row.addr, streamId, turnId]), at, body, streamId, turnId, nativeTurnId,
        inputIds, outcome, nativeTurnIndex: end.turn, source: 'OAR turn-end',
        corroborated: Boolean(end.unconfirmed && body && !receipt), waiting: end.unconfirmed && !body });
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
    const noticeIds = new Set([...Object.keys(next.notices), ...mail.messages.map(message => message.id)]
      .flatMap(id => [id, id.slice(0, 8)]));
    const legacy = readArtifacts(project);
    const backfilled = next.workerFindingBackfills ??= {};
    const owned = rows.filter(row => row.role !== 'reviewer' && sessions.jobs.has(row.addr));
    const latestCards = new Map(owned.filter(row => row.role === 'worker').map(row => [JSON.stringify([row.project, row.task]), row]));
    const activePlans = new Map();
    let evidenceSettings;
    function plannedFor(name) {
      if (!activePlans.has(name)) {
        const paths = new Set();
        for (const worker of latestCards.values()) {
          if (worker.project !== name || worker.endedAt !== null) continue;
          const job = sessions.jobs.get(worker.addr);
          const first = byAddr.get(worker.addr)?.find(message => message.id === job.firstId);
          if (!first || first.completion || ['corrupted', 'refused'].includes(first.phase)) continue;
          for (const path of plannedCardPaths([job.prompt, ...cardTexts(worker, project)].join('\n'))) paths.add(path);
        }
        activePlans.set(name, paths);
      }
      return activePlans.get(name);
    }

    for (const row of owned) {
      const job = sessions.jobs.get(row.addr);
      if (job.firstReportCheck?.status === 'mismatch') continue;
      const taskKey = JSON.stringify([row.project, row.task]);
      const scope = row.task && row.role === 'worker' ? taskKey : JSON.stringify([row.project, row.role, row.addr]);
      const card = next.cards[scope] ??= {};
      const add = (type, key, detail) => {
        // Keep IDs emitted by prior versions so restoring a queue cannot repeat a signal.
        const priorAudience = type === 'fact-miss' && row.role === 'auditor' ? 'leader' : 'auditor';
        const id = digest(JSON.stringify([scope, priorAudience, type, key]));
        next.notices[id] ??= { id, type, audience: 'leader', project: row.project, addr: row.addr, task: row.task, at, ...detail };
      };
      const incoming = byAddr.get(row.addr) ?? [];
      const turns = await observations(row, incoming);
      const evidenceId = turn => digest(turn.inputIds?.includes(job.firstId) && !turn.corroborated ?
        row.task + '/' + row.addr + '/' + job.firstId : turn.key);
      if (row.role === 'worker' && !backfilled[row.addr]) {
        const settled = turns.filter(turn => next.seen[turn.key]);
        if (settled.length) {
          const cards = new Map(legacy.cards(row.addr).map(({ data }) => [data.turn, data]));
          for (const turn of settled) {
            const { git, facts, claims } = cards.get(evidenceId(turn)) ?? {};
            recordTurnFindings(next, workerCardId(incoming, job.firstId, turn), turn, git, facts, claims);
          }
        }
        backfilled[row.addr] = true;
      }
      const fresh = turns.filter(turn => !next.seen[turn.key] && !turn.waiting);
      if (row.role === 'worker' && fresh.length && job.expectRed === undefined) evidenceSettings ??= await evidenceConfig(project);
      const expectRed = row.role === 'worker' &&
        (job.expectRed ?? evidenceTaskSettings(evidenceSettings ?? {}, row.task).expectRed) === true;
      const rotation = pending.get(row.addr);
      const handoverTurn = rotation && turns.find(turn => turn.inputIds?.includes(job.handoverReportId ?? job.firstId));
      if (latestCards.get(taskKey) === row && (row.endedAt == null || fresh.length) &&
          (fresh.length || at >= (next.samples[scope] ?? 0) + settings.sampleIntervalMs)) {
        sampleCard(row, project, job.cardStart, settings, card, add);
        next.samples[scope] = at;
      }
      for (const turn of fresh) {
        const { key, body, inputIds, at: endedAt, outcome } = turn;
        const cardId = row.role === 'worker' ? workerCardId(incoming, job.firstId, turn) : undefined;
        const worker = { id: row.task ?? row.role, addr: row.addr, provider: row.cli };
        const observation = await observeRelayTurn(project, worker, { ...turn, body, failed: outcome?.kind === 'failed' }, {
          cwd: row.cwd, sessionId: row.sessionId, expectRed: job.expectRed, nativeTurnIndex: turn.nativeTurnIndex,
          nativeTurnId: turn.nativeTurnId ?? turn.turnId, streamId: turn.streamId,
          nextCard: cardId != null && cardId !== job.firstId,
          transcriptPath: () => row.transcriptPath,
        }, index);
        const quotedMisses = (byAddr.get(row.addr) ?? []).filter(message => inputIds?.includes(message.id))
          .flatMap(message => (message.orgEvents ?? []).flatMap(id => next.notices[id]?.misses ?? []));
        const plannedPaths = body && ['leader', 'auditor'].includes(row.role) ? plannedFor(row.project) : undefined;
        const facts = body ? checkFacts(body, row.cwd, project, observation.gitObservation, { quotedMisses, noticeIds, plannedPaths }) :
          { checked: 0, misses: [] };
        if (facts.misses.length && (settings.factMiss || ['leader', 'auditor'].includes(row.role))) {
          add('fact-miss', key, { turn: key, misses: facts.misses.slice(0, 5), count: facts.misses.length });
        }
        if (rotation?.boundAt != null && body && (turn === handoverTurn ||
            endedAt >= (rotation.firstReportAt ?? handoverTurn?.at ?? Infinity))) {
          const verified = !facts.misses.length && !failedReply(body) && !isBlockedReply(body) &&
            (!outcome || outcome.kind === 'completed');
          recordings.push([row.addr, { at: endedAt, turn: key, misses: facts.misses.length, verified }]);
        }
        const timing = next.timings[JSON.stringify(row.project)] ??= {};
        const failure = outcome?.failure ?? (outcome?.kind === 'failed' || failedReply(body) ? 'turn-failed' : undefined);
        executions.push({ card, timing, observations: turnExecutions(observation), failure, add, endedAt, expectRed });
        if (row.role === 'worker') {
          const git = observation.gitObservation;
          const card = row.task && (body || git.protectedHits?.length || git.scopeHits?.length) ?
            await forTurn({ ...observation, turn: evidenceId(turn), facts }) : undefined;
          recordTurnFindings(next, cardId, turn, git, facts, card?.data.claims);
        }
        next.seen[key] = true;
      }
      if (row.endedAt != null && pending.has(row.addr)) {
        for (const [addr, record] of recordings.filter(([addr]) => addr === row.addr)) index.reportRotation(addr, record);
        index.failRotation(row.addr, row.endedAt, job.error ?? 'Successor exited before report verification');
      }
    }
    for (const item of executions.sort((a, b) => a.endedAt - b.endedAt)) {
      observeExecutions(item.card, item.timing, item.observations, item.failure, settings, item.add, { expectRed: item.expectRed });
    }
    // If verification is recorded before this checkpoint, replaying the turn is harmless.
    for (const [addr, record] of recordings) index.reportRotation(addr, record);
    if (JSON.stringify(next) !== JSON.stringify(state)) {
      writeState(orgPath(project), JSON.stringify(next) + '\n');
      state = next;
    }
  }

  return {
    collect, notices: () => activeOrgNotices(state), workerFindings: cardId => workerCardFindings(state, cardId),
    confirmWorkerFinding(cardId, finding) {
      const next = structuredClone(state);
      addFinding(next, cardId, finding);
      writeState(orgPath(project), JSON.stringify(next) + '\n');
      state = next;
    },
  };
}
