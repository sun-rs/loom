import { approval, choice } from '../adapters/prompt-state.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { CommandError } from '../cli/sessions.mjs';
import { projectIndex } from '../cli/project.mjs';
import { defaultStallMs, inbox, pendingWork, receipt, stalledDeliveries, stallText, suppressedReplies, suppressedReplyText } from '../inbox/engine.mjs';
import { conclusoryReply, deliveryFailed, isBlockedReply, messageIdPattern } from '../inbox/message.mjs';
import { relay } from '../relay/project.mjs';
import { withClaudeTranscriptStops } from '../relay/sources.mjs';
import { createWatcher } from '../watch/index.mjs';
import { createLiveness, returnedToShell } from '../watch/liveness.mjs';
import { opencodeExportFailureLimit, ownedSessions, validInput } from './sessions.mjs';
import { jsonRows, prepareJournal, readText } from './io.mjs';
import { desktopEnabled, notifyExternal, projectNotifications } from './notifications.mjs';
import { organization } from './org.mjs';
import { clip } from '../evidence/checks.mjs';
import { defaultCoalesceMs, readPolicy, setWorkerProfile, workerLimit } from '../cli/policy.mjs';
import { isStartupBlocker } from '../tui/agent-status.mjs';
import { gateId, saveGatePacket } from './gate-packet.mjs';
import { gateBoundary, roleBudget } from './role-budget.mjs';
import { leaderHandoverState } from '../handover/brief.mjs';
import { authorizeSeniorTool, seniorToolEvents } from './senior-tools.mjs';
import { replyForDelivery } from '../inbox/reply-file.mjs';
import { auditorWakeFiltered, auditorWakeSource, redReasons } from './routing.mjs';
import { readLayout } from './herdr-layout.mjs';
import { deliveryBoard, gateBoard } from './status-board.mjs';
import { activeRelease, managedCliPath, releaseId, releaseRoot } from './release.mjs';
import { rotatingRoles } from '../index/index.mjs';
import { createProjectMemory } from './memory.mjs';
import { createMemoryInjection, sessionMemoryBinding } from './memory-injection.mjs';
import { codexMemoryArgs, memoryIsolationCoverage } from '../memory/launch-config.mjs';

function batchDeliveryId(batch, dest) {
  const bytes = createHash('sha256').update(`${batch}\0${dest}`).digest('hex').slice(0, 32);
  return [bytes.slice(0, 8), bytes.slice(8, 12), bytes.slice(12, 16), bytes.slice(16, 20), bytes.slice(20)].join('-');
}

const reviewerDeliveryId = job => batchDeliveryId(job.firstId, 'reviewer');
const continuationGroup = message => message.batchId ?? message.implicitBatch;
const packetDeliveryId = (project, gate, round) => batchDeliveryId('gate-packet:' + project, round === undefined ? gate : `${gate}\0${round}`);
const matchesGate = (message, project, gate) => message.gatePacket &&
  (message.gateId === gate && message.gateProject === project || message.id === packetDeliveryId(project, gate));
const auditEscalations = new Set(['blocking-disagreement', 'three-failed-rounds', 'major-risk', 'overreach']);
const terminalText = text => text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');

function codexHandoff(row) {
  if (row.cli !== 'codex' || !row.sessionId) return;
  return { cwd: row.cwd, argv: ['codex', '--no-daemon', ...codexMemoryArgs(), '-c',
    'check_for_update_on_startup=false', '-c', `projects.${JSON.stringify(row.cwd)}.trust_level="trusted"`, 'resume', row.sessionId] };
}

export function createSupervisor(project, {
  report = console.log, window = 900_000, sealWindow = window, partialWindow = Math.min(window, 120_000),
  uncertainWindow, blockedWindow = 60_000, sessionOptions, now = Date.now, watchOptions,
  externalNotification = notifyExternal, memoryOptions,
} = {}) {
  if (![window, sealWindow, partialWindow, uncertainWindow ?? defaultStallMs, blockedWindow].every(value => Number.isSafeInteger(value) && value >= 0)) {
    throw new RangeError('Invalid loomd timeout in milliseconds');
  }
  const index = projectIndex(project);
  index.initialize();
  let injection;
  const sessions = ownedSessions(project, index, report, { ...sessionOptions, memoryInjection: () => injection });
  const memory = createProjectMemory(project, { sessions, now, options: memoryOptions, report });
  injection = createMemoryInjection(project, sessionOptions?.memoryStore?.access ?? memory.access);
  const policyForTick = () => {
    try { return readPolicy(project, { optional: true }); }
    catch { return {}; }
  };
  let policy = policyForTick();
  const mail = inbox(project, sessions.transport, report, { replyLimit: () => policy.delivery?.replyBytes,
    isSeniorSender: addr => ['super', 'leader', 'auditor'].includes(sessions.rowFor(addr)?.role) });
  const org = organization(project, index, sessions, mail, now, report);
  const watchJournal = join(project, '.project', 'watch', 'events.jsonl');
  const recordedLiveness = new Map(jsonRows(prepareJournal(watchJournal)).filter(event => event.liveness).map(event => [event.addr, event]));
  const notifications = projectNotifications(project, now);
  const deliveries = addr => mail.messages.filter(message => message.target.addr === addr);
  const receiptFor = message => ({ ...receipt(message, now()), deliveryId: message.id, phase: message.phase,
    ...(message.issue === auditorWakeFiltered && { reason: auditorWakeFiltered, nextWakeDigest: Boolean(message.from) }) });
  const saved = (target, text, fields = {}) => mail.enqueue({
    id: randomUUID(), createdAt: now(), target, text, requestedMode: 'queue', mode: 'queue', phase: 'queued', ...fields,
  });
  const budget = roleBudget(project, { now, sessions, notifications, batchDeliveryId, report });
  const parentFor = addr => sessions.routeParent(addr)?.addr ?? addr;
  const targetEnded = addr => sessions.rowFor(addr)?.endedAt != null;
  const senior = row => row.role === 'leader' || row.role === 'auditor';
  const liveRole = (name, role) => sessions.rows().findLast(row => {
    const job = sessions.jobs.get(row.addr);
    return row.project === name && row.role === role && row.endedAt === null && job && !job.stopping &&
      (!job.handoverAck || job.handoverBound);
  });
  let health = new Map();
  const liveness = createLiveness({ now, hangMs: watchOptions?.busyMs });
  const progress = new Map();
  const observations = new Map();
  const startupBlockers = new Map();
  const failedWorkerLaunches = new Map();
  const desktop = externalNotification !== notifyExternal || desktopEnabled() ? async (name, batch) => {
    try { await externalNotification(name, batch); }
    catch (error) { report(`macOS project notification: ${error.message}`); return false; }
  } : undefined;

  async function pushNotifications() {
    await notifications.push(async batch => {
      const { project: name, pushBatch } = batch[0];
      const id = batchDeliveryId(pushBatch, 'super');
      const existing = mail.messages.find(message => message.id === id);
      if (existing) return existing.target.addr;
      if (batch[0].auditor) {
        const auditor = liveRole(name, 'auditor');
        if (auditor) {
          const details = batch.map(event => event.text).join('\n');
          const deliveryEscalations = batch.map(event => event.deliveryId).filter(Boolean);
          saved(sessions.targetBinding(auditor), `Loom delivery infrastructure exception

${details}`, {
            id, ...(deliveryEscalations.length && { deliveryEscalations }), projectEvents: batch.map(event => event.id),
          });
          return auditor.addr;
        }
        return;
      }
      const rows = sessions.rows();
      const superSession = rows.findLast(row => row.role === 'super' &&
        row.project === name && row.endedAt === null && sessions.jobs.has(row.addr));
      if (superSession && !batch[0].externalOnly) {
        const details = [...new Set(batch.map(event => event.phase !== undefined ? `[${event.phase}] ${event.text}` :
          event.text ?? `${event.type} ${event.addr ?? ''} ${event.reason ?? ''}`.trim()))];
        const heading = `Loom 项目通知：${[...new Set(batch.map(event => event.type))].join(', ')}`;
        saved(sessions.targetBinding(superSession), [heading, ...details].join('\n\n'),
          { id, projectEvents: batch.map(event => event.id),
            ...(batch.some(event => event.type === 'needs-decision') && { superPriority: true }) });
        return superSession.addr;
      }
    }, desktop);
  }

  const watcher = createWatcher({
    listSessions: () => sessions.rows().filter(row => row.backend === 'headless' || row.pane),
    readHooks(row) {
      const events = sessions.events(row.addr);
      return row.cli === 'claude' && row.backend === 'tui' ? withClaudeTranscriptStops(row, events, row.sessionId) : events;
    },
    eventFile: watchJournal,
    hc: sessions.managedHc, report, now, ...watchOptions, managedLiveness: true,
    async inspectRuntime(row) {
      const snapshot = await sessions.transport.inspect(sessions.targetBinding(row));
      const last = snapshot.events.findLast(event => ['stuck', 'recovered'].includes(event.type));
      return { state: progress.get(row.addr)?.health?.status === 'waiting-poll' ? 'waiting-poll' : snapshot.state,
        reason: snapshot.reason ?? (last?.type === 'stuck' ? last.reason : undefined),
        lastEventAt: snapshot.runtimeStatus?.lastEventAt ?? snapshot.active?.since ?? row.startedAt };
    },
    enqueue: async ({ addr, message, eventId }) => receiptFor(saved(sessions.targetBinding(sessions.rowFor(addr)), message,
      { id: eventId, watchResume: true })),
  });

  const workers = () => sessions.rows().filter(row => row.role === 'worker' && sessions.jobs.has(row.addr));
  const superseded = (worker, rows) => rows.some(row => row.project === worker.project && row.task === worker.task &&
    row.startedAt > worker.startedAt);
  const workPending = message => !deliveryFailed(message) && !message?.completion?.body && !message?.completion?.noReply;
  const messagesForWorker = (row, job) => deliveries(row.addr).filter(message => message.id !== job.firstId && workPending(message));
  function occupied(row) {
    const job = sessions.jobs.get(row.addr);
    return !job || workPending(mail.messages.find(message => message.id === job.firstId)) || messagesForWorker(row, job).length > 0;
  }

  function safeLeader(name, rows) {
    const leader = liveRole(name, 'leader');
    if (!leader || rows.some(row => row.endedAt === null && ['worker', 'reviewer'].includes(row.role) &&
        sessions.jobs.has(row.addr) && occupied(row))) return;
    if (index.rotations().some(item => item.project === name && item.verifiedAt === null && item.failedAt === null)) return;
    return leader;
  }

  function handoverState(old) {
    const active = workers().filter(row => row.project === old.project && parentFor(row.parent) === old.addr);
    const latest = [...new Map(active.map(row => [row.task, row])).values()];
    const pending = pendingWork(mail.messages, old.addr, parentFor, targetEnded);
    const ids = new Set(pending.pendingDeliveries.map(item => item.id));
    const resultWorkers = new Set(mail.messages.filter(message => ids.has(message.id)).flatMap(message => [
      ...(message.resultWorkers ?? []), ...(message.continuationMembers ?? []).map(id =>
        mail.messages.find(item => item.id === id)?.target.addr),
    ]));
    const cards = latest.flatMap(row => {
      const result = deliveries(row.addr).findLast(message => message.completion?.body)?.completion.body;
      const work = row.endedAt === null && occupied(row);
      return work || isBlockedReply(result) || resultWorkers.has(row.addr) ? [{ row, work, result }] : [];
    });
    const packets = mail.messages.filter(message => message.gatePacket && message.completion?.body &&
      sessions.rowFor(message.target.addr)?.project === old.project)
      .sort((a, b) => b.completion.at - a.completion.at).slice(0, 4);
    const gates = notifications.list(old.project, false, true).filter(gateBoundary).slice(-4);
    return leaderHandoverState(project, { cards, pending, packets, gates });
  }

  async function settleHandovers() {
    for (const rotation of index.rotations().filter(item => item.failedAt == null)) {
      const job = sessions.jobs.get(rotation.successor);
      if (!job?.handoverAck) continue;
      if (job.handoverBound) {
        if (job.herdr && sessions.rowFor(rotation.successor)?.endedAt === null &&
            (!job.herdrPublished || sessions.rowFor(rotation.predecessor)?.endedAt === null)) {
          await sessions.retirePredecessor(job).catch(error => report(`handover retirement: ${error.message}`));
        }
        continue;
      }
      const row = sessions.rowFor(rotation.successor);
      if (!row) continue;
      const message = mail.messages.find(item => item.id === job.firstId);
      const done = message?.completion;
      if (row.endedAt === null && !job.stopping && message?.received && done?.body && !done.unconfirmed &&
          (!done.outcome || done.outcome.kind === 'completed') && done.body.trimStart().split(/\r?\n/, 1)[0] === job.handoverAck) {
        sessions.bindSuccessor(sessions.rowFor(job.handoverFrom), row);
        await sessions.retirePredecessor(job).catch(error => report(`handover retirement: ${error.message}`));
        continue;
      }
      const reason = job.error ?? (row.endedAt !== null ? 'successor-exited' : deliveryFailed(message) ? message.issue :
        done && !done.unconfirmed && (done.body || done.noReply) ? 'first-turn-missing-acknowledgement' : undefined);
      if (!reason) continue;
      const type = `${row.role}-handover-failed`;
      const title = row.role === 'leader' ? 'Leader' : 'Auditor';
      notifications.add({ id: `${type}:${job.firstId}`, project: row.project, type,
        addr: row.addr, deliveryId: job.firstId, reason, at: now(), text: `${title} ${row.addr} 交接失败（${reason}）。` });
      await sessions.failSpawn(job, new Error(reason));
    }
  }

  function workerSeats(limit) {
    const assigned = new Set();
    const scopes = Map.groupBy(workers().filter(row => row.endedAt === null),
      row => JSON.stringify([row.project, parentFor(row.parent)]));
    for (const scope of scopes.values()) {
      const active = scope.filter(row => {
        const job = sessions.jobs.get(row.addr);
        return workPending(mail.messages.find(message => message.id === job.firstId)) ||
          messagesForWorker(row, job).some(message => message.phase !== 'queued');
      });
      for (const row of active) assigned.add(row.addr);
      const waiting = new Set(scope.filter(row => !assigned.has(row.addr)).map(row => row.addr));
      const next = new Set(mail.messages.filter(message => message.phase === 'queued' && waiting.has(message.target.addr))
        .map(message => message.target.addr));
      for (const addr of [...next].slice(0, Math.max(0, limit - active.length))) assigned.add(addr);
    }
    return assigned;
  }
  const stepRelay = relay(project, [], window, undefined, report, undefined, {
    withEvidence: true, index, sealWindow, partialWindow, blockedWindow,
    parentFor,
    onBatch: batch => {
      const fields = { text: batch.message, batch: batch.id };
      notifications.add(...[
        batch.timeout && { id: batch.id, type: 'wave-timeout', ...batch.timeout, ...fields },
        batch.blocked && { id: `${batch.id}:blocked`, type: 'blocked-escalation', at: now(), ...batch.blocked, ...fields },
      ].filter(Boolean));
    },
    async managedWorkers() {
      const rows = workers();
      const byId = new Map(mail.messages.map(message => [message.id, message]));
      return Promise.all(rows.map(async row => {
        const job = sessions.jobs.get(row.addr);
        const message = byId.get(job.firstId);
        const completion = message?.completion;
        const settled = completion?.body || completion?.noReply || row.endedAt !== null || deliveryFailed(message);
        const unconfirmed = completion?.unconfirmed;
        const reply = settled ? {
          key: job.firstId, at: completion?.at ?? row.endedAt ?? now(),
          body: completion?.body ?? (unconfirmed ? `UNCONFIRMED ${row.task} 未确认正文\n${completion.unconfirmedBody ?? ''}` :
            `FAILED ${row.task}\n${job.error ?? message?.issue ?? '无原生最终回复'}`),
          source: completion?.source ?? 'loom inbox', failed: !unconfirmed && !completion?.body,
          unconfirmed, sessionId: row.sessionId,
          evidenceInput: { cwd: row.cwd, sessionId: row.sessionId, expectRed: job.expectRed, nativeTurnIndex: completion?.nativeTurnIndex ?? 1,
            nativeTurnId: completion?.nativeTurnId ?? (row.backend === 'tui' ? completion?.turnId : undefined),
            transcriptPath: () => row.transcriptPath },
        } : undefined;
        const last = sessions.events(row.addr).at(-1);
        const activityAt = sessions.lastActivity(row, last);
        const sealed = job.deliver !== 'stream' && (stepRelay.isSealed(row.parent, row.project, job.barrier ?? row.wave, job.deliver) ||
          await sessions.sealed(row.parent, job.gate));
        return { id: row.task, addr: row.addr, provider: row.cli, wave: row.wave, managed: {
          parent: row.parent ?? liveRole(row.project, 'leader')?.addr, project: row.project, startedAt: row.startedAt, activityAt, reply,
          superseded: superseded(row, rows), sealed,
          deliver: job.deliver, barrier: job.barrier,
        } };
      }));
    },
    async deliver(addr, batch) {
      const parent = sessions.routeParent(addr);
      if (!parent) throw new Error(`No wave recipient ${addr}`);
      // Old outboxes may still contain a copy to the Auditor.
      if (parent.role === 'auditor' && !batch.waveKey?.split('/', 1)[0].endsWith(':' + addr)) return;
      const row = parent.role === 'leader' ? parent : liveRole(parent.project, 'leader');
      if (!row) return;
      const late = batch.lateWorker && sessions.rowFor(batch.lateWorker);
      if (late && superseded(late, workers())) return;
      saved(sessions.targetBinding(row), batch.message, { id: batchDeliveryId(batch.id, addr), waveBatch: batch.id, waveKey: batch.waveKey, waveKind: batch.waveKind,
        ...(batch.resultWorkers?.length && { resultWorkers: batch.resultWorkers }),
        ...(batch.streamAt != null && { streamAt: batch.streamAt }),
        ...(late && { lateWorker: late.addr }), ...(batch.forcedSeal && { allowIdleWithoutEnd: true }) });
    },
  });

  function checkBarrier(parent, name, barrier, gate) {
    const prior = [...sessions.jobs.values()].filter(job => job.row.role === 'worker' && job.row.parent === parent &&
      job.row.project === name && job.barrier === barrier);
    if (stepRelay.isSealed(parent, name, barrier, 'barrier') || prior.some(job => now() >= job.row.startedAt + sealWindow ||
        (Boolean(gate) !== Boolean(job.gate) || (gate && !sessions.transport.sameTurn(job.gate, gate))))) {
      throw new CommandError('wave-sealed', 'Use a new barrier set for later dispatch');
    }
  }

  async function inspectSession(row) {
    const snapshot = await Promise.resolve().then(() => sessions.transport.inspect(sessions.targetBinding(row))).catch(() => undefined);
    const userPrompt = sessions.rememberUserPrompt(row.addr, snapshot, now());
    return { snapshot, userPrompt };
  }

  async function observeSessions(stallMs) {
    await Promise.all(sessions.rows().filter(row => sessions.jobs.has(row.addr)).map(async row => {
      const job = sessions.jobs.get(row.addr);
      if (row.endedAt !== null) {
        progress.delete(row.addr);
        observations.delete(row.addr);
        liveness.remove(row.addr);
        if (job.exit && !sessions.successorOf(row.addr)) {
          const hint = ['super', 'leader', 'auditor'].includes(row.role) ? ` Relaunch with loom spawn ${row.role} --cwd ${JSON.stringify(row.cwd)} --handover-from ${row.addr} and a startup prompt.` : '';
          notifications.add({ id: `${row.addr}:exit`, type: row.role === 'leader' ? 'leader-exited' : 'session-exited',
            project: row.project, addr: row.addr, role: row.role, at: job.exit.since, reason: 'exited',
            text: `Loom ${row.role} ${row.addr} · ${job.exit.reason}.${hint}`,
            ...(row.role === 'super' && { externalOnly: true }) });
        }
        return;
      }
      const { snapshot, userPrompt } = await inspectSession(row);
      if (!job.stopping && (snapshot?.exit || snapshot?.livenessScreen?.kind === 'unknown' &&
          (row.transcriptPath || snapshot.events.length) &&
          await returnedToShell(snapshot.terminal, snapshot.livenessScreen.text).catch(() => false))) {
        await sessions.finishObserved(row, snapshot.exit ?? snapshot.terminal, now());
        return;
      }
      const recorded = recordedLiveness.get(row.addr);
      const durable = recorded?.at > (job.liveness?.observedAt ?? -Infinity) ? recorded.liveness : job.liveness;
      const result = await liveness.observe(row, snapshot, durable).catch(error => {
        report(`${row.addr} liveness: ${error.message}`);
      });
      const incident = result?.health;
      if ((senior(row) || row.role === 'super') && ['quota-wait', 'auth-expired', 'silent-hang'].includes(incident?.status)) {
        const { status, since, retryAt, reason } = incident;
        const retry = retryAt == null ? '' : ` · retry ${new Date(retryAt).toISOString()}`;
        const id = `${row.addr}:liveness:${status}:${since}`;
        if (recorded?.incidentId !== id) {
          const event = { type: 'stuck', addr: row.addr, incidentId: id, at: now(), since, reason: status, liveness: result };
          appendFileSync(watchJournal, JSON.stringify(event) + '\n', { mode: 0o600, flush: true });
          recordedLiveness.set(row.addr, event);
        }
        notifications.add({ id, type: 'session-liveness',
          project: row.project, addr: row.addr, role: row.role, at: now(), reason: status,
          summary: reason, text: `${row.role} ${row.addr} · ${status} · ${reason}${retry}`, externalOnly: true });
      }
      if (result) {
        progress.set(row.addr, result);
        sessions.rememberLiveness(row.addr, { ...result, observedAt: now() });
      }
      observations.set(row.addr, { state: userPrompt?.kind ?? result?.health?.status ?? reportedState(snapshot, health.get(row.addr)),
        awaitingUser: Boolean(userPrompt) });
      if (!userPrompt || now() - userPrompt.since < stallMs ||
          !(senior(row) || row.role === 'super' || ['awaiting-user', 'overlay'].includes(userPrompt.kind))) return;
      const { kind, since, summary } = userPrompt;
      notifications.add({ id: `${row.addr}:user-prompt:${kind}:${since}`, type: 'target-awaiting-user',
        project: row.project, addr: row.addr, at: now(), reason: kind, role: row.role, summary,
        text: `Loom ${row.role} ${row.addr} ${kind} · ${summary}`,
        ...(row.role === 'leader' ? { auditor: true, batch: 'user-prompt:auditor',
          ...([approval, choice, 'awaiting-user', 'overlay'].includes(kind) && { desktopAlso: true }) } :
          { externalOnly: true, batch: 'user-prompt:external' }),
      });
    }));
  }

  function publishNotifications() {
    for (const row of sessions.rows().filter(row => row.endedAt === null)) {
      const job = sessions.jobs.get(row.addr);
      const mark = (event, reason) => notifications.add({ id: `${row.addr}:${reason}:${event.at}`,
        type: 'stuck', project: row.project, addr: row.addr, at: event.at, reason,
        ...(row.role === 'worker' && { logOnly: true }) });
      if (job?.exportFailure?.count >= opencodeExportFailureLimit) mark(job.exportFailure, 'opencode-export-failed');
      if (job?.pipeRecovery?.exhausted) mark(job.pipeRecovery, 'codex-resume-exhausted');
    }
    for (const event of jsonRows(readText(watchJournal)).filter(event => event.type === 'stuck')) {
      const row = sessions.rowFor(event.addr);
      if (!row || event.liveness || ['picker', 'trust', 'rate-limit', 'auth'].includes(event.reason)) continue;
      const job = sessions.jobs.get(row.addr);
      notifications.add({ id: event.incidentId, type: 'stuck', project: row.project, addr: row.addr,
        at: event.at, reason: event.reason, ...(row.role === 'worker' && { logOnly: true }) });
      if (row.role === 'worker') continue;
      const pending = deliveries(row.addr).find(message => message.from && message.id !== job?.firstId &&
        message.attemptAt <= event.at && message.received && !message.completion && !continuationGroup(message));
      const parent = pending && sessions.routeParent(pending.from.addr);
      if (parent && row.addr !== parent.addr && parent.endedAt === null) {
        const text = `Loom STUCK ${row.addr} ${event.reason}\n续作 ${pending.id}`;
        saved(sessions.targetBinding(parent), text, { id: batchDeliveryId(event.incidentId, parent.addr), stuckOf: pending.id });
      }
    }
    for (const row of sessions.rows().filter(row => row.role === 'leader' && row.endedAt !== null)) {
      if (sessions.jobs.has(row.addr) && !sessions.successorOf(row.addr)) notifications.add({ id: `${row.addr}:exit`, type: 'leader-exited',
        project: row.project, addr: row.addr, at: row.endedAt });
    }
    for (const message of mail.messages) {
      if (message.phase === 'corrupted') {
        const row = sessions.rowFor(message.target.addr);
        if (!row) continue;
        const id = `${message.id}:corrupted`;
        const text = `Loom 投递 CORRUPTED ${message.id}\n${row.addr} 的原生输入与原消息不符，未确认送达。`;
        const sender = message.from && sessions.routeParent(message.from.addr);
        if (sender && sender.addr !== row.addr && sender.endedAt === null) {
          saved(sessions.targetBinding(sender), text, { id: batchDeliveryId(id, sender.addr), corruptedOf: message.id });
        }
        notifications.add({ id, type: 'needs-decision', reason: 'payload-mismatch', project: row.project, addr: row.addr,
          at: message.corruption?.at ?? now(), deliveryId: message.id, text,
          ...(row.role === 'super' && { externalOnly: true, batch: message.id }) });
        continue;
      }
    }
    const byId = new Map(mail.messages.map(message => [message.id, message]));
    for (const delivery of stalledDeliveries(mail.messages, now())) {
      const message = byId.get(delivery.id);
      const row = sessions.rowFor(delivery.target);
      const promptEscalation = row && senior(row) && delivery.reason === 'target-awaiting-user';
      const briefing = message.startup && sessions.jobs.get(delivery.target)?.handoverAck || sessions.holdsForHandover(message);
      const upstream = !promptEscalation && row?.role === 'leader' && !message.deliveryEscalations && !briefing;
      const external = !promptEscalation && (row?.role === 'auditor' || row?.role === 'super' || Boolean(message.deliveryEscalations));
      const origin = message.deliveryEscalations?.map(id => byId.get(id)).filter(Boolean);
      const text = [stallText(delivery), ...(origin ?? []).map(item => `Original delivery ${item.id} to ${item.target.addr}`)].join('\n');
      notifications.add({ id: `${delivery.id}:stalled`, type: 'delivery-stalled',
        project: row?.project ?? project, at: delivery.stalledAt, addr: delivery.target,
        deliveryId: delivery.id, from: delivery.from, reason: delivery.reason, ageMs: delivery.ageMs, text,
        ...(upstream && { auditor: true, batch: 'delivery-stalled:auditor' }),
        ...(external && { externalOnly: true, batch: 'delivery-stalled:external' }),
        ...(!upstream && !external && !briefing && { logOnly: true }),
      });
    }
  }

  async function checkStartupBlockers() {
    const pending = mail.messages.filter(message => message.startup && message.target.backend === 'tui' &&
      ['queued', 'sending'].includes(message.phase) && sessions.rowFor(message.target.addr)?.endedAt === null);
    const active = new Set(pending.map(message => message.id));
    for (const id of startupBlockers.keys()) if (!active.has(id)) startupBlockers.delete(id);
    await Promise.all(pending.map(async message => {
      const snapshot = await sessions.transport.inspect(message.target).catch(() => undefined);
      const blocker = snapshot?.state;
      if (!isStartupBlocker(blocker) || blocker === 'draft-held' || snapshot.userPrompt ||
          snapshot.writeEvidence?.heldDeliveryId === message.id) { startupBlockers.delete(message.id); return; }
      const at = now();
      const previous = startupBlockers.get(message.id);
      const since = previous?.blocker === blocker ? previous.since : at;
      startupBlockers.set(message.id, { blocker, since });
      if (at - since <= 60_000) return;
      const row = sessions.rowFor(message.target.addr);
      notifications.add({ id: `${message.id}:startup:${blocker}`, type: 'needs-decision', project: row.project,
        addr: row.addr, deliveryId: message.id, reason: blocker, at,
        ...(row.role === 'super' && { externalOnly: true, batch: message.id }),
        text: `Loom 启动受阻超过 60 秒，${row.role} ${row.addr} 当前状态为 ${blocker}。请检查会话并决定如何继续。` });
    }));
  }

  const reportedState = (snapshot, incident) => snapshot?.userPrompt || isStartupBlocker(snapshot?.state) ||
    snapshot?.hookGap && snapshot.state === 'idle' && incident?.reason === 'idle-without-stop' ? snapshot.state :
    incident?.state === 'needs-you' ? 'stuck' : snapshot?.state ?? 'unknown';

  function continuations() {
    for (const message of mail.messages) {
      if (message.continuationEvents) notifications.add(...message.continuationEvents);
    }
    const groups = Map.groupBy(mail.messages.filter(continuationGroup), continuationGroup);
    if (!groups.size) return;
    const rows = new Map(sessions.rows().map(row => [row.addr, row]));
    const at = now();
    const settledAt = message => message.completion?.body || message.completion?.noReply ? message.completion.at :
      rows.get(message.target.addr)?.endedAt ?? (deliveryFailed(message) ? message.corruption?.at ?? message.refusedAt ?? at : Infinity);
    for (const [id, group] of groups) {
      const first = group[0];
      const parent = sessions.routeParent(first.from.addr);
      const target = parent ? sessions.targetBinding(parent) : first.from;
      const noticeId = batchDeliveryId(id, first.from.addr);
      const final = mail.messages.find(message => message.id === noticeId);
      const earlyId = batchDeliveryId(`blocked:${id}`, first.from.addr);
      const early = mail.messages.find(message => message.id === earlyId);
      const completed = new Set([...(early?.continuationMembers ?? []), ...(final?.continuationMembers ?? []),
        ...mail.messages.filter(message => message.continuationBatch === id && message.continuationKind === 'late')
          .flatMap(message => message.continuationMembers)]);
      const resultText = message => {
        const row = rows.get(message.target.addr);
        const result = message.completion;
        const detail = result?.body ?? (result?.unconfirmed ? `UNCONFIRMED 未确认正文\n${result.unconfirmedBody ?? ''}` :
          `FAILED ${message.issue ?? '无原生最终回复'}`);
        return `${row?.task ?? ''} ${message.target.addr}\n${terminalText(detail)}`;
      };
      function announce(delivery, kind, selected, pending = [], missing = 0, deadline = at) {
        const results = selected.map(resultText);
        for (const message of pending) {
          const row = rows.get(message.target.addr);
          const activity = row && sessions.lastActivity(row, sessions.events(row.addr).at(-1));
          results.push(`${row?.task ?? ''} ${message.target.addr}\nSTUCK（最近活动 ${activity ? new Date(activity).toISOString() : '未知'}）`);
        }
        if (missing) results.push(`未提交 ${missing} 项`);
        const label = { blocked: '（阻塞）', late: '（补投）', timeout: '（超时）', merged: '' }[kind];
        const text = [`续作批次 ${id}${label}`, ...results].join('\n\n');
        const alert = { batch: delivery, project: parent?.project ?? rows.get(first.target.addr)?.project,
          addr: target.addr, text };
        const events = [
          kind === 'timeout' && { ...alert, id: delivery, type: 'continuation-timeout', at: deadline },
          selected.some(message => isBlockedReply(message.completion?.body)) &&
            { ...alert, id: `${delivery}:blocked`, type: 'blocked-escalation', at },
        ].filter(Boolean);
        // Retry publication from the durable delivery if interrupted between the two writes.
        const record = saved(target, text, { id: delivery, continuationBatch: id, continuationKind: kind,
          continuationMembers: selected.map(message => message.id), continuationEvents: events,
          ...(first.streamContinuation && { streamAt: selected.length ? Math.min(...selected.map(settledAt)) : deadline }),
          ...(kind === 'timeout' && { allowIdleWithoutEnd: true }) });
        notifications.add(...(record.continuationEvents ?? []));
      }
      if (final) {
        for (const message of group.filter(message => !completed.has(message.id) && settledAt(message) <= at)) {
          const row = rows.get(message.target.addr);
          if (row && superseded(row, workers())) continue;
          announce(batchDeliveryId(`late:${id}`, message.id), 'late', [message]);
        }
        continue;
      }
      const expected = first.batchSize ?? group.length;
      const earliest = Math.min(...group.map(settledAt));
      const partialDeadline = expected > 1 && partialWindow !== undefined ?
        Math.max(first.createdAt, earliest) + partialWindow : Infinity;
      const deadline = Math.min(first.createdAt + window, partialDeadline);
      const present = group.filter(message => settledAt(message) <= deadline && settledAt(message) <= at);
      const blocked = present.filter(message => isBlockedReply(message.completion?.body));
      const coalesceAt = blocked.length ? Math.min(...blocked.map(message => message.completion.at)) +
        (first.coalesceWindow ?? blockedWindow) : Infinity;
      const ready = present.length === expected &&
        (!first.implicitBatch || !blocked.length || early || at >= coalesceAt);
      if (ready || at >= deadline) {
        announce(noticeId, present.length === expected ? 'merged' : 'timeout',
          present.filter(message => !completed.has(message.id)), group.filter(message => !present.includes(message)),
          expected - group.length, deadline);
      } else if (!early && at >= coalesceAt) {
        announce(earlyId, 'blocked', present.filter(message => settledAt(message) <= coalesceAt));
      }
    }
  }

  function leaderSignals(name) {
    return [...org.notices().filter(notice => notice.project === name), ...notifications.list(name, false, true)
      .filter(event => event.type === 'auditor-budget-exceeded' && event.overBudget !== false ||
        event.type === 'stuck' && sessions.rowFor(event.addr)?.role === 'worker')];
  }

  function auditorDigest(row) {
    if (row?.role !== 'auditor') return [];
    const targets = new Map();
    const relevant = mail.messages.filter(item => {
      if (!item.auditorDigestIds && item.issue !== auditorWakeFiltered) return false;
      const addr = item.target.addr;
      if (!targets.has(addr)) targets.set(addr, parentFor(addr));
      return targets.get(addr) === row.addr;
    });
    const seen = new Set(relevant.filter(message => message.payloadFrozen && !deliveryFailed(message))
      .flatMap(message => message.auditorDigestIds ?? []));
    return relevant.filter(message => message.issue === auditorWakeFiltered && message.from && !seen.has(message.id));
  }

  function noticeLines(batch) {
    return batch.map(({ type, task, addr, command, ...fields }) => {
      const details = fields.text ?? (type === 'fact-miss' ? fields.misses.map(({ kind, value }) => `${kind} ${value}`).join(', ') +
        (fields.count > fields.misses.length ? ` (+${fields.count - fields.misses.length} more)` : '') : type === 'slow-command' ?
        `${command} ${fields.durationMs} ms (median ${fields.medianMs} ms)` :
        Object.entries(fields).filter(([key]) => !['id', 'at', 'project', 'audience'].includes(key))
          .map(([key, value]) => `${key}=${value}`).join(' '));
      return terminalText(`${type} ${task ?? addr} · ${details}`);
    }).join('\n');
  }

  function messageIssue(message) {
    const row = sessions.rowFor(message.target.addr);
    if (row?.role === 'leader') {
      const stuck = message.stuckOf && mail.messages.find(item => item.id === message.stuckOf);
      if (message.orgEvents && !message.orgAppendix || stuck && sessions.rowFor(stuck.target.addr)?.role === 'worker' ||
          notifications.list(row.project, false, true).some(event =>
            event.type === 'auditor-budget-exceeded' && batchDeliveryId(event.id, 'leader') === message.id)) {
        return 'leader-signal-deferred';
      }
    }
    if (row?.role !== 'auditor') return;
    const job = sessions.jobs.get(message.target.addr);
    const reviewer = message.reviewerResult && sessions.jobs.get(message.reviewerResult);
    const deepReview = message.reviewerConclusion === true && reviewer?.row.role === 'reviewer' && reviewerDeliveryId(reviewer) === message.id &&
      sessions.routeParent(reviewer.row.parent)?.addr === row.addr;
    if (message.deliveryEscalations && message.projectEvents) return;
    const request = message.replyKey && mail.messages.find(item => item.id === message.replyTo);
    if (request?.expectReply && request.completion?.relay?.deliveryId === message.id &&
        request.target.addr === message.from?.addr && parentFor(request.from?.addr) === row.addr) return;
    if (!auditorWakeSource(message, { startupId: job?.firstId,
      handoverId: job?.handoverReportId, senderRole: sessions.rowFor(message.from?.addr)?.role, deepReview })) return auditorWakeFiltered;
  }

  async function closeReviews() {
    for (const job of sessions.jobs.values()) {
      if (!job.reviewDeadline) continue;
      const row = sessions.rowFor(job.row.addr);
      if (!row) continue;
      const first = mail.messages.find(message => message.id === job.firstId);
      const result = first?.completion;
      const expired = now() >= job.reviewDeadline;
      if (!expired && !result && row.endedAt == null && !deliveryFailed(first)) continue;
      const id = reviewerDeliveryId(job);
      const owner = row.parent && sessions.routeParent(row.parent);
      const audit = owner?.role === 'auditor';
      const gate = audit && row.wave && mail.messages.some(message => matchesGate(message, row.project, row.wave)) ? row.wave : undefined;
      if (!audit && mail.messages.some(message => message.id === id) ||
          notifications.list(row.project, false, true).some(event => event.id === id)) continue;
      if (row.endedAt == null) {
        try { await sessions.stop(row); }
        catch (error) { report(`${row.addr} reviewer stop: ${error.message}`); continue; }
      }
      const onTime = result && result.at <= job.reviewDeadline;
      const body = onTime && (result.body ?? result.unconfirmedBody);
      const conclusion = body && conclusoryReply(body);
      const detail = onTime && result.body ? result.body : onTime && result.unconfirmedBody ?
        `UNCONFIRMED\n${result.unconfirmedBody}` :
        expired && (!onTime || row.endedAt >= job.reviewDeadline) ? 'TIMED OUT' :
          `FAILED ${result?.outcome?.failure ?? first?.issue ?? 'no native reply'}`;
      const text = `Loom reviewer ${row.addr}${row.task ? ' · ' + row.task : ''}\n\n${detail}`;
      const routed = owner?.endedAt === null && (conclusion || !audit && !body);
      if (routed) {
        saved(sessions.targetBinding(owner), text, { id, reviewerResult: row.addr, ...(audit && { reviewerConclusion: true }) });
      }
      if (audit || !routed && row.parent) {
        notifications.add({ id, gate, type: 'reviewer-result', project: row.project, addr: row.addr,
          at: result?.at ?? row.endedAt ?? job.reviewDeadline, text, logOnly: true });
      } else if (!row.parent) {
        notifications.add({ id, type: 'reviewer-result', project: row.project, addr: row.addr,
          batch: id, at: result?.at ?? row.endedAt ?? job.reviewDeadline, text, externalOnly: true });
      }
    }
  }

  function notifyProfile(name, addr, warnings) {
    for (const warning of warnings ?? []) {
      if (warning.code === 'preferred-fallback') {
        notifications.add({ id: randomUUID(), project: name, type: warning.code, addr, at: now(), text: warning.message });
      }
    }
  }

  async function spawnSession(args, caller) {
    const actor = caller && sessions.rows().find(row => row.addr === caller || row.pane === caller);
    if (args.role === 'auditor' && actor &&
        (actor.endedAt !== null || actor.role !== 'super' &&
          !(actor.role === 'leader' && sessions.rowFor(args['handover-from'])?.project === actor.project))) {
      throw new CommandError('invalid-arguments', 'Auditor startup requires Super or a Leader supervising succession');
    }
    const job = await sessions.newJob(args, caller, checkBarrier, occupied, handoverState);
    let session;
    try {
      if (!job.herdr) await sessionOptions?.layout?.ensure(false).catch(error => {
        if (error.code !== 'herdr-unavailable') throw error;
        report(`Herdr layout unavailable for ${job.row.addr}: ${error.message}`);
      });
      session = await sessions.activate(job, mail);
      sessions.requireLive(session);
    } catch (error) {
      if (job.row.role === 'worker') failedWorkerLaunches.set(job.row.project, now());
      await sessions.failSpawn(job, error);
      throw error;
    }
    if (session.role === 'worker') failedWorkerLaunches.delete(session.project);
    let retirementIssue;
    const retired = await sessions.retirePredecessor(job).catch(error => { retirementIssue = error.message; });
    const handoff = codexHandoff(session);
    notifyProfile(session.project, session.addr, job.warnings);
    return { session, deliveryId: job.firstId, requested: job.requested, ...sessions.runtimeSelection(session),
      ...(job.integration && { workerProfile: 'integration' }),
      ...(job.deliver && { deliver: job.deliver, ...(job.barrier && { barrier: job.barrier }) }),
      ...(handoff && { handoff }), ...(job.handoverFrom && { handoverFrom: job.handoverFrom }),
      ...(retired && { retired: retired.addr }), ...(retirementIssue && { retirementIssue }) };
  }

  async function tick() {
    policy = policyForTick();
    await sessions.refresh(mail);
    for (const job of sessions.jobs.values()) {
      await sessions.retirePredecessor(job).catch(error => report(`handover retirement: ${error.message}`));
    }
    const rows = workers();
    for (const message of mail.messages.filter(message => message.lateWorker && !message.combinedInto && message.phase === 'queued')) {
      const old = rows.find(row => row.addr === message.lateWorker);
      if (old && superseded(old, rows)) mail.refuseQueued(message, 'superseded');
    }
    const routed = new Map();
    let seats;
    await mail.step(({ id, target: { addr } }) => {
      if (id === sessions.jobs.get(addr)?.firstId) return;
      if (!routed.has(addr)) {
        const row = sessions.routeParent(addr);
        routed.set(addr, row?.addr !== addr && row?.endedAt === null ? sessions.targetBinding(row) : undefined);
      }
      return routed.get(addr);
    }, {
      async beforeDispatch() {
        await settleHandovers();
        await org.collect(sessions.rows());
        await stepRelay(now());
        continuations();
        seats = workerSeats(workerLimit(policy));
      },
      now,
      messageIssue,
      canDispatchMessage: message => !sessions.holdsForHandover(message),
      stallMs: policy.delivery?.stallMs ?? uncertainWindow ?? defaultStallMs,
      coalesceMs: policy.delivery?.coalesceMs ?? defaultCoalesceMs,
      async decorate(message) {
        const row = sessions.rowFor(message.target.addr);
        const byId = new Map(mail.messages.map(item => [item.id, item]));
        const senderStalls = stalledDeliveries(mail.messages, now()).filter(delivery => {
          const pending = byId.get(delivery.id);
          return [delivery.from, pending.startup && sessions.rowFor(delivery.target)?.parent, ...(pending.resultWorkers ?? []),
          ...(pending.continuationMembers ?? []).map(id => byId.get(id)?.target.addr)]
            .some(addr => addr && parentFor(addr) === row?.addr);
        });
        const delivered = new Set(mail.messages.filter(item =>
          !deliveryFailed(item) && sessions.rowFor(item.target.addr)?.role === 'leader')
          .flatMap(item => item.orgEvents ?? []));
        const batch = row?.role === 'leader' && !message.orgEvents && !message.stuckOf ?
          leaderSignals(row.project).filter(notice => !delivered.has(notice.id)) : [];
        const lines = noticeLines(batch);
        const summary = Buffer.byteLength(lines) > 1200 ?
          clip(lines, 1200) + '\n完整记录见 loom status --json。' : lines;
        const seenSuppressions = new Set(mail.messages.filter(item => item.received && !deliveryFailed(item) &&
          row && parentFor(item.target.addr) === row.addr).flatMap(item => item.replySuppressionNotices ?? []));
        const senderSuppressions = suppressedReplies(mail.messages).filter(notice =>
          row && notice.from && parentFor(notice.from) === row.addr && !seenSuppressions.has(notice.id));
        const deliveryLines = [...senderSuppressions.map(notice => ({ text: suppressedReplyText(notice), id: notice.id })),
          ...senderStalls.map(delivery => ({ text: stallText(delivery) }))];
        let deliveryAppendix;
        const replySuppressionNotices = [];
        if (deliveryLines.length) {
          const visible = [];
          let bytes = 0;
          for (const { text, id } of deliveryLines) {
            bytes += Buffer.byteLength(text) + 1;
            if (bytes > 1200) break;
            visible.push(text);
            if (id) replySuppressionNotices.push(id);
          }
          if (visible.length < deliveryLines.length) visible.push('More delivery notices in loom status.');
          deliveryAppendix = visible.join('\n');
        }
        const deferred = auditorDigest(row);
        const digest = deferred.length && replyForDelivery(project, deferred.map(item =>
          `[${item.id}] ${item.from.addr}\n${item.text}`).join('\n\n'), policy.delivery?.replyBytes);
        if (digest) deliveryAppendix = [deliveryAppendix, `Loom Auditor next-wake digest\n${digest}`].filter(Boolean).join('\n\n');
        const job = sessions.jobs.get(row?.addr);
        const { text: memoryText, ...memoryReceipt } = job ?
          await injection.decorate(job, sessionMemoryBinding(row, job), message, mail.messages,
            row.cli === 'claude' ? [] : sessions.events(row.addr)) : {};
        if (memoryText) deliveryAppendix = [deliveryAppendix, memoryText].filter(Boolean).join('\n\n');
        return { ...(deliveryAppendix && { deliveryAppendix }), ...(replySuppressionNotices.length && { replySuppressionNotices }),
          ...memoryReceipt,
          ...(memoryText && { memoryRecipient: row.addr }),
          ...(deferred.length && { auditorDigestIds: deferred.map(item => item.id) }),
          ...(batch.length && {
            orgEvents: batch.map(notice => notice.id), orgAppendix: 'Loom drift and fact checks\n' + summary,
          }) };
      },
      canDispatch(target) {
        const job = sessions.jobs.get(target.addr);
        if (job?.row.role === 'worker') return seats.has(target.addr);
        if (!job?.reviewDeadline) return true;
        const first = mail.messages.find(message => message.id === job.firstId);
        return now() < job.reviewDeadline && !first?.completion && !deliveryFailed(first);
      },
    });
    await memory.tick(mail.messages);
    for (const row of sessions.rows()) {
      const job = sessions.jobs.get(row.addr);
      if (job && row.endedAt === null && row.cli === 'claude') {
        await injection.refreshCompactIndex(job, sessionMemoryBinding(row, job));
      }
    }
    await closeReviews();
    const current = sessions.rows();
    for (const [name, rows] of Map.groupBy(current, row => row.project)) {
      await budget.check(name, rows, policy, { safeLeader: safeLeader(name, rows) })
        .catch(error => report(`Role budget ${name}: ${error.message}`));
    }
    await checkStartupBlockers();
    await observeSessions(policy.delivery?.stallMs ?? uncertainWindow ?? defaultStallMs);
    health = new Map((await watcher.poll()).map(row => [row.addr, row]));
    publishNotifications();
    await pushNotifications();
  }

  return {
    tick,
    upgradeSessions: sessions.upgradeSessions,
    upgradeHolder: sessions.upgradeHolder,
    async reattach(expected) {
      await sessions.refresh(mail);
      const attached = await sessions.upgradeSessions();
      const represented = new Set(attached.map(session => session.addr));
      for (const binding of expected) {
        if (represented.has(binding.addr)) continue;
        const endedAt = sessions.rowFor(binding.addr)?.endedAt;
        attached.push(endedAt == null ? { ...binding, status: 'unavailable', reason: 'Session index binding missing' } :
          { ...binding, status: 'ended', endedAt });
      }
      return attached;
    },
    shutdown: sessions.shutdown,
    async handle(command, args, caller) {
      if (command === 'mem') return memory.handle(args, caller);
      if (command === 'spawn') return spawnSession(args, caller);
      if (command === 'layout-up') {
        if (!sessionOptions?.layout) throw new CommandError('not-ready', 'Herdr layout is unavailable');
        return { layout: await sessionOptions.layout.ensure(true) };
      }
      if (command === 'layout-adopt') return { layout: await sessions.adoptLayout(args) };
      if (command === 'board') {
        const rows = sessions.rows();
        const events = notifications.list(undefined, false, true);
        const pending = events.filter(event => !event.auditor && !event.logOnly && event.takenAt == null);
        const names = new Set(rows.map(row => row.project));
        if (!names.size) names.add(project);
        return {
          layout: readLayout(project),
          roles: rows.filter(row => row.endedAt === null && ['super', 'leader', 'auditor'].includes(row.role)).map(row => ({
            role: row.role, addr: row.addr, backend: row.backend, cli: row.cli,
            state: observations.get(row.addr)?.state ?? 'starting',
            awaitingHandover: Boolean(sessions.jobs.get(row.addr)?.handoverAck && !sessions.jobs.get(row.addr)?.handoverBound),
          })),
          workers: rows.filter(row => row.endedAt === null && row.role === 'worker' && row.backend === 'headless').map(row => ({
            addr: row.addr, task: row.task, wave: row.wave, state: observations.get(row.addr)?.state ?? 'starting',
          })),
          delivery: deliveryBoard(mail.messages, observations, now()),
          gates: gateBoard(mail.messages, events),
          notifications: { count: pending.length, last: pending.slice(-8).reverse().map(({ type, at, text }) =>
            ({ type, at, text: text?.slice(0, 200) })) },
          pyramids: [...names].flatMap(name => {
            const sample = budget.pyramid(name);
            return sample ? [{ project: name, ...sample }] : [];
          }),
          release: { id: releaseId(), root: releaseRoot, active: activeRelease(project)?.current?.root, cli: managedCliPath(project),
            warnings: rows.filter(row => row.endedAt === null).flatMap(row =>
              sessions.pathWarnings(row).map(warning => ({ role: row.role, ...warning }))) },
        };
      }
      if (command === 'senior-override') {
        const rows = sessions.rows();
        const actor = caller && rows.find(row => row.addr === caller || row.pane === caller);
        const reason = typeof args.reason === 'string' ? args.reason.trim() : '';
        if (!actor || !senior(actor) || actor.endedAt !== null || !sessions.jobs.has(actor.addr) ||
            !validInput(args.command) || args.command.length > 16_000 || reason && (!validInput(reason) || reason.length > 300)) {
          throw new CommandError('invalid-arguments', 'A live Leader or Auditor, a command and a short reason are required');
        }
        const at = now();
        const gate = notifications.list(actor.project, false, true).findLast(gateBoundary);
        const since = gate?.at ?? -Infinity;
        const workerUnavailable = at - (failedWorkerLaunches.get(actor.project) ?? -Infinity) < 600_000 ||
          rows.some(row => row.role === 'worker' && row.project === actor.project && row.startedAt >= since &&
            (sessions.jobs.get(row.addr)?.exit?.code > 0 || ['silent-hang', 'auth-expired', 'quota-wait'].includes(progress.get(row.addr)?.health?.status))) ||
          stalledDeliveries(mail.messages, at).some(delivery => sessions.rowFor(delivery.target)?.project === actor.project);
        const permit = authorizeSeniorTool(project, actor, { command: args.command, reason, workerUnavailable, since, at });
        if (permit.category) {
          const count = rows.filter(row => row.role === actor.role && row.project === actor.project).flatMap(row => seniorToolEvents(project, row.addr))
            .filter(event => event.type === 'senior-override' && event.at >= since).length;
          if (count > 3) notifications.add({ id: `senior-override-budget:${batchDeliveryId(actor.project, actor.role + (gate?.id ?? ''))}`,
            type: 'senior-override-budget', project: actor.project, addr: actor.addr, role: actor.role, gate: gate?.gate, at,
            text: `${actor.role} 在本门禁重试重型工具 ${count} 次。请检查分工或卡片设计。` });
        }
        return permit;
      }
      if (command === 'switch') {
        const { role, to } = args;
        if (!['leader', 'auditor', 'worker'].includes(role) || !validInput(to)) {
          throw new CommandError('invalid-arguments', 'Switch requires leader, auditor or worker and a profile');
        }
        if (role === 'worker') {
          const { selected, fastRequested, warnings } = setWorkerProfile(project, to);
          const actor = sessions.rows().find(row => row.addr === caller || row.pane === caller);
          const names = new Set(sessions.rows().map(row => row.project));
          notifyProfile(actor?.project ?? (names.size === 1 ? names.values().next().value : project), actor?.addr, warnings);
          return { role, selected, ...(fastRequested !== undefined && { fastRequested }), warnings };
        }
        const old = sessions.resolve(role, caller);
        return spawnSession({ role, cwd: old.cwd, 'handover-from': old.addr, profileChoice: to, defaultMode: old.backend,
          prompt: 'Take over the resident role. In your first report, ground the current state in repository SHAs, paths and any test or metric names you rely on.' }, caller);
      }
      if (['notifications', 'gate-pack', 'escalate'].includes(command)) {
        const rows = sessions.rows();
        const names = new Set(rows.map(row => row.project));
        const actor = caller && rows.find(row => row.addr === caller || row.pane === caller);
        const name = args.project ?? actor?.project ?? (names.size <= 1 ? (names.values().next().value ?? project) : undefined);
        const gateWriter = name && (names.has(name) || name === project) && (!actor ||
          ['leader', 'super'].includes(actor.role) && actor.endedAt === null && actor.project === name);
        if (command !== 'notifications') {
          const escalation = command === 'escalate';
          if (!gateWriter || typeof args.gate !== 'string' || !gateId.test(args.gate) ||
              args.round !== undefined && (!Number.isSafeInteger(args.round) || args.round < 1) ||
              args.reuse !== undefined && typeof args.reuse !== 'boolean' ||
              ['base', 'candidate', 'question'].some(key => args[key] !== undefined && (args.reuse || !validInput(args[key])))) {
            throw new CommandError('invalid-arguments', 'A Leader or Super must supply a gate ID in this project');
          }
          if (escalation && (actor?.role !== 'leader' || !redReasons.has(args.reason) ||
              !validInput(args.evidence) || Buffer.byteLength(args.evidence) > 2048)) {
            throw new CommandError('invalid-arguments', 'Escalation requires the live Leader, a red reason and up to 2048 bytes of evidence');
          }
          const { gate } = args;
          const rounds = mail.messages.filter(message => matchesGate(message, name, gate));
          const latest = Math.max(0, ...rounds.map(message => message.gateRound ?? 1));
          const round = args.round ?? (args.reuse || escalation && latest ? latest : latest + 1);
          const existing = rounds.find(message => (message.gateRound ?? 1) === round);
          if (args.reuse && !existing) throw new CommandError('not-found', `No saved packet for ${gate} round ${round || '(latest)'}`);
          if (existing && !args.reuse && !escalation) {
            throw new CommandError('gate-round-exists', `Gate ${gate} round ${round} already exists. Use --reuse or pack a new round.`);
          }
          const id = existing?.id ?? packetDeliveryId(name, gate, round);
          const red = escalation && { id: `red:${batchDeliveryId(id, `${args.reason}\0${args.evidence}`)}`,
            gate, round, project: name, addr: actor.addr, at: now(), type: 'red-escalation', reason: args.reason,
            text: args.evidence, evidencePath: replyForDelivery(project, args.evidence, 0).split(' ')[1], logOnly: true };
          if (existing) {
            if (red) notifications.add(red);
            return { gate, round, reused: true, path: existing.gatePacket, ...(existing.gateFullPath && { fullPath: existing.gateFullPath }),
              ...(red && { wakeQueued: false, evidencePath: red.evidencePath }), ...receiptFor(existing) };
          }
          const auditor = liveRole(name, 'auditor');
          if (!auditor) throw new CommandError('not-ready', 'No live managed Auditor in this project');
          const members = rows.filter(row => row.project === name && ['worker', 'reviewer'].includes(row.role) &&
            (row.wave === gate || sessions.jobs.get(row.addr)?.barrier === gate));
          const decisions = notifications.list(name).filter(event => event.type === 'needs-decision' &&
            (event.gate === gate || members.some(row => row.addr === event.addr)));
          const workerAddrs = new Set(members.filter(row => row.role === 'worker').map(row => row.addr));
          const boundary = notifications.list(name, false, true)
            .findLast(gateBoundary)?.at ?? 0;
          const signals = leaderSignals(name).filter(notice => workerAddrs.has(notice.addr) ||
            notice.type === 'auditor-budget-exceeded' && notice.at >= boundary);
          const { path, fullPath } = saveGatePacket(project, { ...args, id, round }, { members, jobs: sessions.jobs, messages: mail.messages,
            decisions, signalSummary: noticeLines(signals), signalCount: signals.length, red });
          const delivery = saved(sessions.targetBinding(auditor), red ?
            `Loom red escalation (${red.reason}). Read gate packet ${path}` : `Read gate packet ${path}`, {
            id, gatePacket: path, gateId: gate, gateProject: name, gateRound: round, ...(fullPath && { gateFullPath: fullPath }),
            ...(red && { redEscalation: red.reason }),
            ...(actor && { from: sessions.targetBinding(actor), expectReply: true }),
          });
          if (red) notifications.add(red);
          return { gate, round, path, ...(fullPath && { fullPath }),
            ...(red && { wakeQueued: true, evidencePath: red.evidencePath }), ...receiptFor(delivery) };
        }
        if (args.take && actor && actor.role !== 'super') {
          throw new CommandError('invalid-arguments', 'Only the Super takes project notifications');
        }
        if (args.complete !== undefined || args.phase !== undefined) {
          if (!name || !names.has(name) && name !== project || !validInput(args.complete) ||
              args.phase !== undefined && (typeof args.phase !== 'string' || !gateId.test(args.phase))) {
            throw new CommandError('invalid-arguments', 'Completion requires a project, summary and a valid phase ID if supplied');
          }
          const { phase } = args;
          const history = notifications.list(name, false, true);
          const id = phase === undefined ? history.find(event => event.type === 'project-completed' &&
            event.phase === undefined && event.text === args.complete)?.id ?? 'completed:' + batchDeliveryId(name, args.complete) :
            'completed-phase:' + batchDeliveryId(name, phase);
          const prior = history.find(event => event.id === id);
          if (prior && prior.text !== args.complete) {
            throw new CommandError('id-conflict', `Phase ${phase} already has a different completion (${id})`);
          }
          notifications.add({ id, project: name, at: now(), type: 'project-completed',
            ...(phase !== undefined && { phase }), text: args.complete });
          notifications.retryLoggedCompletion(id);
          if (!prior?.pushRoute || prior.pushRoute === 'log') await pushNotifications();
          const completion = notifications.list(name, false, true).find(event => event.id === id);
          if (!completion.pushRoute || completion.pushRoute === 'log') {
            const reason = desktop ? 'no managed Super and desktop notification failed or is throttled' : 'no managed Super or desktop notification route';
            throw new CommandError('notification-pending', `Completion ${id} is persisted at .project/loomd/notifications.json but has not been pushed: ${reason}`);
          }
          return { completion };
        }
        if (args.gateComplete !== undefined) {
          if (!gateWriter || typeof args.gateComplete !== 'string' || !gateId.test(args.gateComplete)) {
            throw new CommandError('invalid-arguments', 'A Leader or Super must supply a completed gate ID in this project');
          }
          const gate = args.gateComplete;
          const id = 'gate:' + batchDeliveryId(name, gate);
          if (!notifications.list(name, false, true).some(event => event.id === id)) {
            const currentPolicy = policyForTick();
            const sample = await budget.check(name, rows.filter(row => row.project === name), currentPolicy, { completeGate: true });
            const proposal = sample || currentPolicy.roles?.auditor?.rotateAt === 'gate';
            notifications.add({ id, gate, project: name, at: now(), type: proposal ? 'auditor-rotation-proposed' : 'gate-completed',
              ...(actor && { addr: actor.addr }), ...sample, logOnly: !proposal,
              text: proposal ? `门禁 ${gate} 已完成。${sample ? `Auditor 已超出预算（采样 ${new Date(sample.sampledAt).toISOString()}）。` : ''}建议由 Leader 监督 Auditor 换班；已有换班须先结算。` :
                `门禁 ${gate} 已完成。` });
            const scoped = rows.filter(row => row.project === name);
            await budget.check(name, scoped, currentPolicy, { gateRecorded: true, safeLeader: safeLeader(name, scoped) });
          }
        }
        if (args.decision !== undefined || args.auditEscalation !== undefined || args.kind !== undefined) {
          const plain = args.kind === 'decision';
          if (!name || !names.has(name) && name !== project || !validInput(args.decision) || actor?.role === 'worker' ||
              (args.kind !== undefined && (!plain || args.auditEscalation !== undefined)) ||
              (!plain && actor?.role === 'auditor' || args.auditEscalation !== undefined) &&
              (actor?.role !== 'auditor' || !auditEscalations.has(args.auditEscalation))) {
            throw new CommandError('invalid-arguments', 'A decision summary is required. Auditor must use --kind decision or an allowed --audit-escalation reason');
          }
          notifications.add({ id: randomUUID(), project: name, at: now(), type: 'needs-decision', text: args.decision,
            ...(plain && { kind: 'decision' }), addr: actor?.addr, reason: args.auditEscalation });
        }
        return { notifications: notifications.list(name, args.take === true, args.history === true) };
      }
      if (command === 'status' || command === 'ls') {
        const live = await Promise.all(sessions.rows().filter(row => row.endedAt === null).map(async row => {
          const incident = health.get(row.addr);
          const { snapshot, userPrompt } = await inspectSession(row);
          const observed = progress.get(row.addr);
          const liveness = observed?.health;
          const pathWarnings = sessions.pathWarnings(row);
          return { addr: row.addr, state: userPrompt?.kind ?? liveness?.status ?? reportedState(snapshot, incident),
            ...(sessions.jobs.has(row.addr) && { memoryIsolation: memoryIsolationCoverage(row.cli) }),
            lastProgressAt: observed?.lastProgressAt ?? row.startedAt, ...(liveness && { liveness }),
            ...(pathWarnings.length && { pathWarnings }),
            ...(userPrompt && { userPrompt }), ...(snapshot?.hookGap && { hookGap: snapshot.hookGap }) };
        }));
        if (command === 'status') return { sessions: live, exits: sessions.rows().flatMap(row => {
          const exit = sessions.jobs.get(row.addr)?.exit;
          return row.endedAt !== null && exit && !sessions.successorOf(row.addr) ? [{ addr: row.addr, role: row.role, ...exit }] : [];
        }) };
        return { ...pendingWork(mail.messages, undefined, parentFor, targetEnded),
          awaitingUser: live.flatMap(row => row.userPrompt ? [{ addr: row.addr, ...row.userPrompt }] : []) };
      }
      const row = command === 'send' ? sessions.resolveDelivery(args.target, caller) : sessions.resolve(args.target, caller);
      if (command === 'handover') {
        const old = sessions.rowFor(args.from);
        if (!validInput(args.text)) throw new CommandError('invalid-arguments', 'Handover brief is required');
        const actor = caller && sessions.rows().find(item => item.addr === caller || item.pane === caller);
        if (row.role === 'auditor' && actor && (actor.endedAt !== null || actor.project !== row.project ||
            !['leader', 'super'].includes(actor.role))) {
          throw new CommandError('invalid-arguments', 'Auditor succession requires Super or the project Leader');
        }
        let delivery;
        sessions.bindSuccessor(old, row, () => {
          delivery = saved(sessions.targetBinding(row), args.text, { id: batchDeliveryId(old.addr, row.addr) });
          return delivery;
        });
        if (old.endedAt === null && sessions.jobs.has(old.addr)) await sessions.retirePredecessor(sessions.jobs.get(row.addr));
        return receiptFor(delivery);
      }
      if (command === 'state') {
        const incident = health.get(row.addr);
        const tui = sessions.jobs.get(row.addr)?.tui;
        const { snapshot, userPrompt } = row.endedAt === null ? await inspectSession(row) : {};
        const observed = progress.get(row.addr);
        const liveness = row.endedAt !== null ? sessions.jobs.get(row.addr)?.exit : observed?.health;
        return { addr: row.addr, state: row.endedAt !== null ? 'exited' : userPrompt?.kind ?? liveness?.status ?? reportedState(snapshot, incident),
          lastProgressAt: observed?.lastProgressAt ?? row.startedAt, ...(liveness && { liveness }),
          ...(tui && { transport: tui.transport, ...(tui.reason && { transportReason: tui.reason }) }),
          ...((snapshot?.reason ?? incident?.reason) && { reason: snapshot?.reason ?? incident.reason }),
          ...(snapshot?.writeEvidence && { writeEvidence: snapshot.writeEvidence }),
          ...(snapshot?.hcStatus && { hcStatus: snapshot.hcStatus }),
          ...(snapshot?.hookGap && { hookGap: snapshot.hookGap }),
          ...(userPrompt && { userPrompt }),
          ...(snapshot?.runtimeStatus && { runtimeStatus: snapshot.runtimeStatus }),
          deliveries: deliveries(row.addr).map(receiptFor), notifications: notifications.list(row.project),
          rotations: index.rotations().filter(item => item.project === row.project),
          ...pendingWork(mail.messages, row.addr, parentFor, targetEnded) };
      }
      if (command === 'stop') {
        const closed = row.endedAt !== null ? row : await sessions.stop(row);
        return { addr: row.addr, endedAt: closed.endedAt };
      }
      if (command !== 'send') throw new CommandError('invalid-arguments', 'Unknown loomd request');
      if (!validInput(args.text) || !['queue', 'steer', 'interrupt'].includes(args.mode) ||
          args.expectReply !== undefined && typeof args.expectReply !== 'boolean') {
        throw new CommandError('invalid-arguments', 'Invalid send request');
      }
      if (args.id !== undefined && !messageIdPattern.test(args.id) ||
          (args.batch !== undefined || args.batchSize !== undefined) &&
          (!messageIdPattern.test(args.batch) || !Number.isSafeInteger(args.batchSize) || args.batchSize < 1 || args.mode !== 'queue')) {
        throw new CommandError('invalid-arguments', 'Invalid delivery ID or continuation batch');
      }
      const from = args.from ? sessions.resolve(args.from, caller) : caller &&
        sessions.rows().find(row => row.addr === caller || row.pane === caller);
      const actor = caller && sessions.rows().find(row => row.addr === caller || row.pane === caller);
      const existing = args.id && mail.messages.find(message => message.id === args.id);
      const requestedRole = rotatingRoles.includes(args.target) ? args.target : undefined;
      if (existing) {
        const initial = existing.originalTarget ?? existing.target.addr;
        const sameTarget = existing.requestedRole ? existing.requestedRole === requestedRole &&
          sessions.rowFor(initial)?.project === row.project : initial === row.addr;
        if (!sameTarget || existing.from?.addr !== from?.addr || existing.text !== args.text ||
            existing.requestedMode !== args.mode || existing.batchId !== args.batch || existing.batchSize !== args.batchSize ||
            Boolean(existing.expectReply) !== Boolean(args.expectReply)) {
          throw new CommandError('id-conflict', 'Delivery ID is already bound to a different request');
        }
        return { addr: row.addr, ...receiptFor(existing) };
      }
      const holdForRole = requestedRole && sessions.holdsForHandover({ target: { addr: row.addr }, mode: 'queue' });
      const effectiveMode = holdForRole ? 'queue' : args.mode;
      const successor = effectiveMode === 'queue' ? sessions.routeParent(row.addr) : row;
      if (!holdForRole) sessions.requireLive(successor);
      if (from) sessions.requireLive(from);
      if (args.batch) {
        if (from?.role !== 'leader' || row.role !== 'worker' || from.project !== row.project) {
          throw new CommandError('invalid-arguments', 'Continuation batches require a Leader and workers in the same project');
        }
        const members = mail.messages.filter(message => message.batchId === args.batch);
        if (members.length >= args.batchSize || members.some(message => parentFor(message.from.addr) !== from.addr ||
            message.batchSize !== args.batchSize || message.target.addr === row.addr) ||
            members.length && (now() >= members[0].createdAt + window ||
              mail.messages.some(message => message.id === batchDeliveryId(args.batch, members[0].from.addr)))) {
          throw new CommandError('batch-closed', 'Continuation batch is full, expired or already has this worker');
        }
      }
      const target = sessions.targetBinding(successor);
      const userWake = actor ? actor.role === 'super' && actor.endedAt === null : !from || from.role === 'super';
      const fields = { ...(from && { from: sessions.targetBinding(from) }), ...(args.expectReply && { expectReply: true }),
        ...(userWake && { superPriority: true, ...(successor.role === 'auditor' && { userWake: true }) }),
        ...(row.addr !== successor.addr && { originalTarget: row.addr }),
        ...(requestedRole && { requestedRole }),
        ...(holdForRole && args.mode !== 'queue' && { queuedForHandover: true }),
        ...(args.id && { id: args.id }), ...(args.batch && { batchId: args.batch, batchSize: args.batchSize }),
        requestedMode: args.mode,
      };
      if (successor.role === 'auditor' && !userWake) {
        const message = saved(target, args.text, { ...fields, mode: args.mode, phase: 'refused',
          issue: auditorWakeFiltered, refusedAt: now() });
        return { addr: row.addr, ...receiptFor(message) };
      }
      if (effectiveMode === 'interrupt' && !sessions.canInterrupt(target)) {
        throw new CommandError('unsupported', 'Runtime cannot guard the requested turn at interrupt submission');
      }
      const observation = effectiveMode !== 'queue' && await sessions.transport.inspect(target).catch(() => undefined);
      if (observation?.state === 'finished') throw new CommandError('not-ready', 'Target has exited');
      const active = observation?.active;
      if (effectiveMode === 'interrupt' && !active) throw new CommandError('not-ready', 'interrupt requires an active turn');
      const mode = sessions.requestedMode(target, effectiveMode, active);
      const continuation = mode === 'queue' && from?.role === 'leader' && row.role === 'worker' && from.project === row.project;
      const message = saved(target, args.text, { ...fields,
        ...(continuation && !args.batch && { implicitBatch: 'auto:' + randomUUID(), coalesceWindow: 0, streamContinuation: true }),
        mode, active, barrier: mode === 'queue' ? active : undefined });
      return { addr: row.addr, ...receiptFor(message) };
    },
  };
}
