import { approval, choice } from '../adapters/prompt-state.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { CommandError } from '../cli/sessions.mjs';
import { accountService } from './account-service.mjs';
import { projectIndex } from '../cli/project.mjs';
import { reportedContext } from '../cli/state.mjs';
import { defaultStallMs, inbox, pendingWork, receipt, stalledDeliveries, stallText, suppressedReplies, suppressedReplyText } from '../inbox/engine.mjs';
import { conclusoryReply, deliveryFailed, isBlockedReply, messageIdPattern, replyConclusion } from '../inbox/message.mjs';
import { relay } from '../relay/project.mjs';
import { withClaudeTranscriptStops } from '../relay/sources.mjs';
import { createWatcher } from '../watch/index.mjs';
import { createLiveness, returnedToShell } from '../watch/liveness.mjs';
import { opencodeExportFailureLimit, ownedSessions, validDispatchReason, validInput } from './sessions.mjs';
import { jsonRows, prepareJournal, readText } from './io.mjs';
import { desktopEnabled, notifyExternal, projectNotifications } from './notifications.mjs';
import { organization } from './org.mjs';
import { clip } from '../evidence/checks.mjs';
import { plannedCardPaths } from '../evidence/facts.mjs';
import { defaultCoalesceMs, readPolicy, setWorkerProfile, workerHandoffLimits,
  workerLimit, workerReuseLimits, workerWarmMs } from '../cli/policy.mjs';
import { isStartupBlocker } from '../tui/agent-status.mjs';
import { recordAuditFinding, requireAuditRegressions } from './audit-findings.mjs';
import { gateId, saveGatePacket } from './gate-packet.mjs';
import { auditorBudgetBoundary, gateBoundary, roleBudget } from './role-budget.mjs';
import { leaderHandoverState } from '../handover/brief.mjs';
import { startedOutstanding } from '../handover/outstanding.mjs';
import { denialIdPattern } from '../lib/senior-command.mjs';
import { authorizeSeniorTool, seniorToolEvents } from './senior-tools.mjs';
import { replyForDelivery } from '../inbox/reply-file.mjs';
import { auditEscalations, auditorWakeFiltered, auditorWakeSource, redReasons } from './routing.mjs';
import { readLayout } from './herdr-layout.mjs';
import { attentionBoard, contextBoard, deliveryBoard, gateBoard, notificationBoard, workerBoard } from './status-board.mjs';
import { activeRelease, managedCliPath, releaseId, releaseRoot } from './release.mjs';
import { rotatingRoles } from '../index/index.mjs';
import { createProjectMemory } from './memory.mjs';
import { createMemoryInjection, sessionMemoryBinding } from './memory-injection.mjs';
import { codexMemoryArgs, memoryIsolationCoverage } from '../memory/launch-config.mjs';
import { memoryWriteReminder } from '../memory/prompts.mjs';
import { createMemoryExtractor } from './memory-extractor.mjs';
import { rotationPolicy } from './rotation-policy.mjs';
import { selfRotation } from './self-rotation.mjs';
import { approvedWaves, handoffReason, idleForRelease, isReleased, releaseConditions, retainedState, retirementReason, retentionStatus,
  reuseStatus, workerCardId, workerContext, workerDetails, workerIdleSince, workerMetrics, workerStalledSince } from './worker-retention.mjs';
import { hostGrantSpec, storedHostUnconfined, storedWorkerTier } from '../lib/worker-tiers.mjs';
import { hostGrantWarning, hostGrants, hostWritePaths } from './host-grants.mjs';
import { superHandoffReminder } from './global-registry.mjs';
import { recoverProject } from './recover.mjs';

function batchDeliveryId(batch, dest) {
  const bytes = createHash('sha256').update(`${batch}\0${dest}`).digest('hex').slice(0, 32);
  return [bytes.slice(0, 8), bytes.slice(8, 12), bytes.slice(12, 16), bytes.slice(16, 20), bytes.slice(20)].join('-');
}

const continuationGroup = message => message.batchId ?? message.implicitBatch;
const packetDeliveryId = (project, gate, round) => batchDeliveryId('gate-packet:' + project, round === undefined ? gate : `${gate}\0${round}`);
const matchesGate = (message, project, gate) => message.gatePacket &&
  (message.gateId === gate && message.gateProject === project || message.id === packetDeliveryId(project, gate));
const terminalText = text => text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
const handoverWorkWait = 3 * 60_000;

const durableMessageSignals = [
  /^(?:纠正|更正|勘误|裁决|决议|决定|偏好|长期规则|correction|ruling|decision|preference|standing rule)[*\s]*[:：]\s*\S/iu,
  /^(?:我|我们)(?:已经|正式)?(?:决定|规定|纠正|更正|确认(?:此|该|这个|这一)(?:规则|做法))/u,
  /^(?:i|we)\s+(?:(?:have|hereby)\s+)?(?:decided|ruled|confirm (?:this|the) (?:rule|practice))\b/iu,
  /^(?:(?:以后|今后|从现在起)[，,\s]*)?我(?:更?喜欢|更?偏好|倾向于|习惯于)|^我希望[^。！？]*(?:以后|今后|一律|每次)/u,
  /^(?:(?:from now on|going forward)[,\s]+)?i\s+(?:prefer|would prefer|would rather|always want)\b/iu,
  /^(?:以后|今后|从现在起|自即日起)[，,\s]*(?:一律|必须|不得|禁止|始终|统一|每次|我希望)/u,
  /^(?:from now on|going forward)[,\s]+(?:always|never|(?:we|you)\s+(?:must|will always|will never))\b/iu,
];

function durableUserMessage(text) {
  const conclusion = replyConclusion(text);
  if (conclusion.reason === 'noreply' || /^(?:PASS(?:ED)?|APPROVE(?:D)?)$/u.test(conclusion.tag ?? '')) return false;
  let fence;
  for (const raw of text.split(/\r?\n/u)) {
    const delimiter = /^\s*(`{3,}|~{3,})/u.exec(raw)?.[1];
    if (delimiter) {
      if (!fence) fence = delimiter;
      else if (delimiter[0] === fence[0] && delimiter.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence || /^\s*>/u.test(raw)) continue;
    const line = raw.replace(/^[#*_\s+-]+/u, '').replace(/^(?:super|user|用户)\s*[:：]\s*/iu, '').trimEnd();
    if (!/[?？]$/u.test(line) && durableMessageSignals.some(pattern => pattern.test(line))) return true;
  }
  return false;
}

function codexHandoff(row) {
  if (row.cli !== 'codex' || !row.sessionId) return;
  return { cwd: row.cwd, argv: ['codex', '--no-daemon', ...codexMemoryArgs(), '-c',
    'check_for_update_on_startup=false', '-c', `projects.${JSON.stringify(row.cwd)}.trust_level="trusted"`, 'resume', row.sessionId] };
}

export function createSupervisor(project, {
  report = console.log, window = 900_000, sealWindow = window, partialWindow = Math.min(window, 120_000),
  uncertainWindow, blockedWindow = 60_000, sessionOptions, now = Date.now, watchOptions,
  externalNotification = notifyExternal, accountOptions = {}, memoryOptions, memoryExtractorOptions,
} = {}) {
  if (![window, sealWindow, partialWindow, uncertainWindow ?? defaultStallMs, blockedWindow].every(value => Number.isSafeInteger(value) && value >= 0)) {
    throw new RangeError('Invalid loomd timeout in milliseconds');
  }
  const index = projectIndex(project);
  index.initialize();
  let injection;
  const grants = hostGrants(project, { now, notify: (...events) => notifications.add(...events) });
  const accounts = accountService(project, { now, report, notifications: { add: (...items) => notifications.add(...items) },
    rows: () => sessions.rows(), options: accountOptions, accountBinding: accountOptions.bindSession ?? sessionOptions?.accountBinding });
  const sessions = ownedSessions(project, index, report, { ...sessionOptions, hostGrants: grants, ...accounts.collectors, memoryInjection: () => injection });
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
    ...(message.dispatch && { dispatch: message.dispatch, dispatchReason: message.dispatchReason }),
    ...(message.nextCard && { nextCard: true }),
    ...(message.issue === auditorWakeFiltered && { reason: auditorWakeFiltered, nextWakeDigest: Boolean(message.from) }) });
  const saved = (target, text, fields = {}) => mail.enqueue({
    id: randomUUID(), createdAt: now(), target, text, requestedMode: 'queue', mode: 'queue', phase: 'queued', ...fields,
  });
  const extractor = createMemoryExtractor(project, { memory, sessions, now, report,
    options: memoryExtractorOptions, events: () => notifications.list(undefined, false, true),
    enqueueReview(id, text, routedTo) {
      const reviewer = liveRole(project, 'super');
      if (!reviewer || reviewer.addr === routedTo) return reviewer?.addr;
      const deliveryId = batchDeliveryId('memory-proposal:' + id, reviewer.addr);
      if (!mail.messages.some(message => message.id === deliveryId)) {
        saved(sessions.targetBinding(reviewer), 'User memory proposal for Super review\n' + text,
          { id: deliveryId, memoryReview: true, superPriority: true });
      }
      return reviewer.addr;
    },
  });
  const rotation = selfRotation(project, { sessions, index, mail, notifications, now, spawn: spawnSession, failHandover, inFlight: rotationWork, report,
    v2: () => v2, cleanBoundary: name => rotationBoundary(name, sessions.rows().filter(row => row.project === name)) });
  const v2 = rotationPolicy(project, { now, sessions, mail, notifications, policy: policyForTick,
    propose: rotation.propose, emergency: rotation.emergency, reviewNote: queueRotationNoteReview });
  function queueRotationNoteReview(member, row, request, work, id) {
    const messageId = batchDeliveryId(id, 'v2-note-review');
    if (mail.messages.some(message => message.id === messageId)) return messageId;
    const proof = replyForDelivery(project, request.note, 0);
    saved(sessions.targetBinding(member), [
      `请先核对 ${row.role} ${row.addr} 的交接单，用命令确认 SHA、路径及在途项。`, proof,
      `loomd 在途项：${work.map(item => [item.task, item.addr].filter(Boolean).join(' ')).join(' · ') || '无'}`,
      `用 "$LOOM_BIN" rotation-policy verify-note --target ${row.addr} --id ${id} --verdict pass|fail --detail TEXT --evidence FILE[:LINE] 登记。`,
    ].join('\n'), { id: messageId, rotationVerification: true });
    return messageId;
  }
  const budget = roleBudget(project, { now, sessions, notifications, batchDeliveryId, report, signalRotation: rotation.propose,
    observeRotation: (row, usage, snapshot, safe) => v2.observe(row, usage, { ...snapshot,
      health: progress.get(row.addr)?.health?.status }, safe), policyV2: v2.enabled });
  const parentFor = addr => sessions.routeParent(addr)?.addr ?? addr;
  const targetEnded = addr => sessions.rowFor(addr)?.endedAt != null;
  const senior = row => row.role === 'leader' || row.role === 'auditor';
  const liveRole = (name, role) => sessions.rows().findLast(row => {
    const job = sessions.jobs.get(row.addr);
    return row.project === name && row.role === role && row.endedAt === null && job && !job.stopping && !job.handoverFailure &&
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
    listSessions: () => sessions.rows().filter(row => (row.backend === 'headless' || row.pane) && !isReleased(sessions.jobs.get(row.addr))),
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

  function rotationWork(row) {
    return sessions.rows().filter(item => item.endedAt === null && item.role === 'worker' &&
      item.project === row.project && parentFor(item.parent) === row.addr && occupied(item));
  }

  function rotationBoundary(name, rows) {
    return !rows.some(row => row.endedAt === null && row.role === 'worker' &&
      sessions.jobs.has(row.addr) && occupied(row)) &&
      !index.rotations().some(item => item.project === name && item.verifiedAt === null && item.failedAt === null);
  }

  function handoverState(old) {
    const active = sessions.rows().filter(row => row.role === 'worker' &&
      row.project === old.project && parentFor(row.parent) === old.addr);
    const latest = [...new Map(active.map(row => [row.task ?? row.addr, row])).values()];
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

  const activationId = job => batchDeliveryId(job.firstId, job.rotationV2 ? 'v2-confirmation' : 'handover-activation');
  const outstandingLines = job => job.handoverItems?.length ?
    ['### Do now', ...job.handoverItems.map(item => '- ' + item)] : [];
  function activateOutstanding(job, row) {
    if (!job.handoverItems?.length || !job.handoverBound || row?.endedAt !== null || job.stopping) return;
    saved(sessions.targetBinding(row), ['接管生效。立即开始交接中的待办。', ...outstandingLines(job)].join('\n'),
      { id: activationId(job), rotationVerification: true, superPriority: true, rotationActivation: true });
  }

  async function settleV2Handover(job, row, message, rotation) {
    const record = v2.pending(row.addr) ?? v2.begin(sessions.rowFor(job.handoverFrom), job, job.rotationPhase);
    if (record.failed) {
      if (!job.stopping || rotation.failedAt == null) await sessions.failSpawn(job, new Error(record.failed.reason));
      return;
    }
    const done = message?.completion;
    const old = sessions.rowFor(record.predecessor);
    const verification = record.verification;
    const confirmed = Boolean(message?.received && done?.body && !done.unconfirmed &&
      (!done.outcome || done.outcome.kind === 'completed') &&
      done.body.trimStart().split(/\r?\n/, 1)[0] === job.handoverAck);
    const mismatch = /^MISMATCH(?:\b|$)/im.test(done?.body ?? '');
    const observedMismatch = confirmed && !v2.reportMatches(job, done.body);
    const reason = record.cancelled ? 'verification-cancelled' : mismatch || observedMismatch ? 'first-report-mismatch' :
      verification?.verdict === 'fail' ? 'first-report-rejected' :
      !confirmed && v2.firstReportExpired(record) ? 'first-report-timeout' :
      job.error ?? (row.endedAt !== null ? 'successor-exited' : deliveryFailed(message) ? message.issue :
      done && !done.unconfirmed && (done.body || done.noReply) && !confirmed ? 'first-turn-missing-acknowledgement' : undefined);
    if (reason && rotation.verifiedAt == null) {
      v2.fail(row, job, reason);
      if (reason === 'first-report-mismatch') {
        const other = liveRole(row.project, row.role === 'leader' ? 'auditor' : 'leader');
        if (other) saved(sessions.targetBinding(other), `继任 ${row.addr} 首报与交接原件不符，已停止接管。请核对原件与 Super 处理。`,
          { id: batchDeliveryId(job.firstId, 'v2-mismatch'), rotationVerification: true });
      }
      await sessions.failSpawn(job, new Error(reason));
      return;
    }
    if (!confirmed) return;
    if (!verification) {
      const announced = v2.ready(row, done.body, message.id);
      v2.verificationTimeout(row, announced);
      const other = liveRole(row.project, row.role === 'leader' ? 'auditor' : 'leader');
      if (other) {
        const proof = replyForDelivery(project, done.body, 0);
        saved(sessions.targetBinding(other), [
          `请核对 ${row.role} ${row.addr} 的首报，核对 HEAD、分支、基线、WIP 和裁决编号。`,
          proof,
          `用 "$LOOM_BIN" rotation-policy verify --target ${row.addr} --verdict pass|fail --detail TEXT --evidence FILE[:LINE] 登记原件和结论。`,
        ].join('\n'), { id: batchDeliveryId(message.id, 'v2-verification'), rotationVerification: true });
      }
      return;
    }
    const target = sessions.targetBinding(row);
    const plan = record.messages ?? mail.handoverMessages(old.addr, target);
    if (!record.completedAt) {
      v2.savePlan(row, plan);
      if (!job.handoverBound) sessions.bindSuccessor(old, row);
      index.reportRotation(row.addr, { at: verification.at, turn: done.turnId ?? message.id, misses: 0 });
      mail.handoverMessages(old.addr, target, true);
      v2.finish(row, plan);
    }
    saved(target, v2.facts(row, [
      `接管生效。另一方已核对首报（${verification.actor}，原件 ${verification.evidence}）。立即执行交接单中触发条件已满足的首个动作。`,
      ...outstandingLines(job), '### 旧地址的在途消息', ...plan.map(item => `- ${item.id} ${item.action}`),
    ]), { id: activationId(job), rotationVerification: true, superPriority: true,
      rotationActivation: true });
    sessions.finalizeV2(job);
    await sessions.retirePredecessor(job).catch(error => report(`handover retirement: ${error.message}`));
  }

  async function failHandover(job, reason) {
    const row = sessions.rowFor(job.row.addr);
    const type = `${row.role}-handover-failed`;
    const title = row.role === 'leader' ? 'Leader' : 'Auditor';
    const at = now();
    notifications.add({ id: `${type}:${job.firstId}`, project: row.project, type,
      addr: row.addr, deliveryId: job.firstId, reason, at, ...(job.selfRotationId && { logOnly: true }),
      text: `${title} ${row.addr} 交接失败（${reason}）。` });
    await sessions.failHandover(job, reason, at);
  }

  async function settleHandovers() {
    for (const rotation of index.rotations().filter(item => item.failedAt == null)) {
      const job = sessions.jobs.get(rotation.successor);
      if (!job?.handoverAck) continue;
      if (job.rotationV2) {
        const row = sessions.rowFor(rotation.successor);
        if (row && !job.rotationV2Finalized) await settleV2Handover(job, row, mail.messages.find(item => item.id === job.firstId), rotation);
        continue;
      }
      if (job.handoverBound) {
        activateOutstanding(job, sessions.rowFor(rotation.successor));
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
        const old = sessions.rowFor(job.handoverFrom);
        if (job.selfRotationId && old?.endedAt === null) {
          const view = await sessions.transport.inspect(sessions.targetBinding(old)).catch(() => undefined);
          if (view?.state !== 'idle' || view.active || view.userPrompt) continue;
        }
        sessions.bindSuccessor(old, row);
        activateOutstanding(job, row);
        await sessions.retirePredecessor(job).catch(error => report(`handover retirement: ${error.message}`));
        continue;
      }
      const reason = job.error ?? (row.endedAt !== null ? 'successor-exited' : deliveryFailed(message) ? message.issue :
        done && !done.unconfirmed && (done.body || done.noReply) ? 'first-turn-missing-acknowledgement' : undefined);
      if (!reason) continue;
      await failHandover(job, reason);
    }
  }

  async function followUpHandoverWork() {
    for (const job of sessions.jobs.values()) {
      if (!job.handoverItems?.length || job.handoverWorkStarted || !job.handoverBound || job.stopping) continue;
      const activation = mail.messages.find(message => message.id === activationId(job));
      const effectiveAt = activation?.received?.at;
      if (effectiveAt == null || now() - effectiveAt < handoverWorkWait) continue;
      const row = sessions.rowFor(job.row.addr);
      if (row?.endedAt !== null || parentFor(row.addr) !== row.addr) continue;
      const notices = notifications.list(row.project, false, true);
      const escalationId = `handover-work:${job.firstId}`;
      if (notices.some(event => event.id === escalationId)) continue;
      const tools = sessions.events(row.addr).filter(event => (event.at ?? event.receivedAt) >= effectiveAt && !event.agent_id && !event.isSidechain &&
        !event.parent_tool_use_id && !event.parentToolUseId &&
        /^(?:PreToolUse|tool_call_started|tool_call_input|tool_use|function_call|custom_tool_call)$/
          .test(event.hook_event_name ?? event.payload?.type ?? event.type));
      const evidence = [
        ...tools.map(event => JSON.stringify(event.tool_input ?? event.input ?? event.payload?.arguments ??
          event.payload?.input ?? event.command ?? '')),
        ...mail.messages.filter(message => message.from?.addr === row.addr && message.createdAt >= effectiveAt).map(message => message.text),
        ...notices.filter(event => event.addr === row.addr && event.at >= effectiveAt && ['project-completed', 'gate-completed', 'needs-decision']
          .includes(event.type)).map(event => [event.phase, event.gate, event.text].filter(Boolean).join(' ')),
      ];
      const remaining = job.handoverItems.filter(item => !startedOutstanding(item, evidence));
      if (!remaining.length) {
        sessions.markHandoverStarted(job);
        continue;
      }
      const id = batchDeliveryId(job.firstId, 'handover-do-now');
      const nudge = mail.messages.find(message => message.id === id);
      if (nudge && now() - (nudge.received?.at ?? nudge.createdAt) < handoverWorkWait) continue;
      const target = sessions.targetBinding(row);
      const view = await sessions.transport.inspect(target).catch(() => undefined);
      if (view?.state !== 'idle' || view.active || view.userPrompt) continue;
      const text = `交接里有待办：${clip(remaining.join(' · '), 400)}`;
      if (!nudge) {
        saved(target, text, { id });
      } else {
        notifications.add({ id: escalationId, project: row.project, addr: row.addr, at: now(),
          type: 'needs-decision', reason: 'handover-work-unstarted', text, deliveryId: nudge.id,
          ...(row.role === 'leader' && { auditor: true, batch: 'leader-handover-work' }) });
      }
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
        const mismatch = job.firstReportCheck?.status === 'mismatch' && job.firstReportCheck.mismatches;
        const settled = completion?.body || completion?.noReply || row.endedAt !== null || deliveryFailed(message);
        const unconfirmed = completion?.unconfirmed;
        const reply = settled ? {
          key: job.firstId, at: completion?.at ?? row.endedAt ?? now(),
          body: mismatch ? `BLOCKED ${row.task}\nWorker first-report mismatch: ${mismatch.join(', ')}` :
            completion?.body ?? (unconfirmed ? `UNCONFIRMED ${row.task} 未确认正文\n${completion.unconfirmedBody ?? ''}` :
            `FAILED ${row.task}\n${job.error ?? message?.issue ?? '无原生最终回复'}`),
          source: completion?.source ?? 'loom inbox', failed: !mismatch && !unconfirmed && !completion?.body,
          unconfirmed, sessionId: row.sessionId,
          evidenceInput: !mismatch && { cwd: row.cwd, sessionId: row.sessionId, expectRed: job.expectRed, nativeTurnIndex: completion?.nativeTurnIndex ?? 1,
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
      if (row.endedAt !== null || isReleased(job)) {
        progress.delete(row.addr);
        accounts.clearHealth(row.addr);
        observations.delete(row.addr);
        liveness.remove(row.addr);
        if (row.endedAt !== null && job.exit && !sessions.successorOf(row.addr)) {
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
      if (result?.authWarning) {
        const { account, text } = result.authWarning;
        notifications.add({ id: `agy-auth-warning:${account}`, type: 'session-liveness', project: row.project,
          addr: row.addr, role: row.role, at: now(), reason: 'auth-warning', summary: text, text, batch: 'auth-warning' });
      }
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
        accounts.observeHealth(row, job, snapshot, incident);
        progress.set(row.addr, result);
        sessions.rememberLiveness(row.addr, { ...result, observedAt: now() });
      }
      const roleStatus = {};
      if (row.role === 'worker' && row.backend === 'headless') {
        roleStatus.workerContext = contextFor(row, snapshot);
        roleStatus.stalledSince = workerStalledSince(snapshot, result?.lastProgressAt, now());
      }
      if (senior(row)) {
        const events = sessions.events(row.addr);
        const root = events.filter(event => !event.agent_id && !event.isSidechain &&
          (!row.sessionId || (event.session_id ?? event.sessionId ?? event.conversationId) === row.sessionId));
        roleStatus.context = reportedContext(snapshot ?? {}, root, []);
        roleStatus.activityAt = sessions.lastActivity(row, events.at(-1));
      }
      if (senior(row) || row.role === 'super') {
        const { compactions } = workerContext(snapshot?.events ?? sessions.events(row.addr), snapshot);
        roleStatus.compactions = compactions;
        roleStatus.rotationDue = !v2.enabled() && compactions >= policy.roles?.[row.role]?.rotateAtCompactions;
      }
      observations.set(row.addr, { state: userPrompt?.kind ?? result?.health?.status ?? reportedState(snapshot, health.get(row.addr)),
        awaitingUser: Boolean(userPrompt), awaitingUserAt: userPrompt?.since, idle: idleForRelease(snapshot), ...roleStatus });
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
      const job = sessions.jobs.get(row.addr);
      if (job && !job.handoverFailure && !sessions.successorOf(row.addr)) notifications.add({ id: `${row.addr}:exit`, type: 'leader-exited',
        project: row.project, addr: row.addr, at: row.endedAt });
    }
    for (const message of mail.messages) {
      if (message.from?.external && message.from.addr === 'super') {
        const row = sessions.rowFor(message.target.addr);
        const identity = { project: row?.project ?? project, addr: message.target.addr, deliveryId: message.id,
          externalOnly: true, batch: `super-delivery:${message.id}` };
        if (message.received || deliveryFailed(message)) {
          const reason = deliveryFailed(message) ? message.issue ?? message.phase : 'received';
          notifications.add({ ...identity, id: `external-super:${message.id}:receipt:${reason}`, type: 'super-delivery-receipt',
            at: message.corruption?.at ?? message.refusedAt ?? message.received?.at ?? now(), reason,
            text: `Loom 投递 ${message.id} · ${message.target.addr} · ${reason}` });
        }
        const done = message.completion;
        if (message.expectReply && !done?.unconfirmed && done?.body) {
          notifications.add({ ...identity, id: `external-super:${message.id}:reply`, type: 'super-delivery-reply', at: done.at,
            text: replyForDelivery(project, done.body) });
        }
      }
      if (message.phase === 'refused' && message.issue === 'holder-partial-write' && message.partialWrite) {
        const row = sessions.rowFor(message.target.addr);
        const { written, total, reason } = message.partialWrite;
        notifications.add({ id: `${message.id}:partial-write`, type: 'needs-decision', reason: message.issue,
          project: row?.project ?? project, addr: message.target.addr, deliveryId: message.id, at: message.refusedAt,
          text: `Loom 投递 ${message.id} 未送达：holder 只写入 ${written}/${total} 字节（${reason}）。草稿仍受保护。` });
        continue;
      }
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
      .filter(event => event.type === 'worker-handoff' ||
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
    if (row?.role === 'reviewer' || message.reviewerResult) return 'role-retired';
    const targetJob = sessions.jobs.get(row?.addr);
    if (targetJob?.firstReportCheck?.status === 'mismatch') return 'worker-first-report-mismatch';
    if (targetJob?.handoverFailure) return 'handover-failed';
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
    if (message.deliveryEscalations && message.projectEvents) return;
    const request = message.replyKey && mail.messages.find(item => item.id === message.replyTo);
    if (request?.expectReply && request.completion?.relay?.deliveryId === message.id &&
        request.target.addr === message.from?.addr && parentFor(request.from?.addr) === row.addr) return;
    if (!auditorWakeSource(message, { startupId: job?.firstId,
      handoverId: job?.handoverReportId,
      handoverFollowupId: job?.handoverBound && job.handoverItems?.length && batchDeliveryId(job.firstId, 'handover-do-now'),
      senderRole: sessions.rowFor(message.from?.addr)?.role })) return auditorWakeFiltered;
  }

  const retainMs = row => workerWarmMs(policy, row.cli);
  const currentCard = (row, job) => workerCardId(deliveries(row.addr), job.firstId);
  const workerFindings = (row, job) => org.workerFindings(currentCard(row, job));
  const incidentFinding = (row, job) => workerFindings(row, job).findLast(finding =>
    finding.kind === 'overreach' || finding.kind === 'fabrication');
  function contextFor(row, view) {
    const cached = sessions.jobs.get(row.addr)?.retention?.lastContext;
    if (cached) return cached;
    if (view) return workerContext(view.events ?? sessions.events(row.addr), view);
    return observations.get(row.addr)?.workerContext ?? workerContext(sessions.events(row.addr));
  }
  async function requireNextCardReuse(row) {
    const job = sessions.jobs.get(row.addr);
    if (row.role !== 'worker' || row.backend !== 'headless' || !job) {
      throw new CommandError('invalid-arguments', 'Cross-card reuse requires a managed headless Worker');
    }
    const view = !isReleased(job) && await sessions.transport.inspect(sessions.targetBinding(row));
    await mail.observe(releaseConditions(mail.messages).relatedTargets(row.addr), now(),
      policy.delivery?.stallMs ?? uncertainWindow ?? defaultStallMs);
    const conditions = releaseConditions(mail.messages);
    if (job.retention?.keepWarm || view && !idleForRelease(view) || conditions.pending(row.addr) || !conditions.workerResult(row, job)) {
      throw new CommandError('not-ready', 'Wait for the current card and its deliveries to settle before reusing this Worker');
    }
    await org.collect([row]);
    const context = contextFor(row, view);
    const reason = retirementReason(context, workerReuseLimits(policy), workerFindings(row, job));
    if (reason || context.contextPercent == null) {
      throw new CommandError('worker-not-reusable', `Next-card reuse refused: ${reason ?? 'context-unmeasured'}`);
    }
  }
  const resumeWorker = row => sessions.resume(row, mail, now(), retainMs(row));
  const retentionFor = (row, at = now()) => retentionStatus(sessions.jobs.get(row.addr), at, retainMs(row));
  function workerStatus(row, snapshot) {
    const retention = retentionFor(row);
    if (!retention) return;
    const idle = snapshot ? idleForRelease(snapshot) : observations.get(row.addr)?.idle;
    const context = contextFor(row, snapshot);
    const job = sessions.jobs.get(row.addr);
    const stalledSince = snapshot ? workerStalledSince(snapshot, progress.get(row.addr)?.lastProgressAt, now()) :
      observations.get(row.addr)?.stalledSince;
    const pressure = row.role === 'worker' && row.endedAt === null && (incidentFinding(row, job)?.kind ||
      (stalledSince != null && 'no-progress') || handoffReason(context, workerHandoffLimits(policy)));
    const draft = job.workerHandoff;
    const handoff = draft?.ready ? draft : pressure && (draft?.reason === pressure &&
      (draft.cardId == null || draft.cardId === currentCard(row, job)) ? draft : { reason: pressure, ready: false });
    return { state: retainedState(retention, idle, row.endedAt != null), retention,
      ...(job?.firstReportCheck?.status === 'mismatch' ? { lastResultTag: 'BLOCKED' } : workerDetails(deliveries(row.addr))), ...context,
      ...(row.role === 'worker' && reuseStatus(job, row.endedAt != null, context, workerReuseLimits(policy), workerFindings(row, job))),
      ...(job?.firstReportCheck && { firstReportCheck: job.firstReportCheck }),
      ...(handoff && { handoff }) };
  }
  const metrics = rows => workerMetrics(rows, addr => sessions.jobs.get(addr), sessions.events, mail.messages);
  async function publishWorkerHandoff(row, job, reason, { acceptance, evidence } = {}) {
    const cardId = currentCard(row, job);
    const card = deliveries(row.addr).find(message => message.id === cardId);
    const handoff = await sessions.workerHandoff(job, reason, now(), { acceptance, card, evidence });
    notifications.add({ id: `worker-handoff:${row.addr}:${cardId}:${reason}:${handoff.ready ? 'ready' : 'draft'}`,
      project: row.project, addr: row.addr, task: row.task, type: 'worker-handoff', at: handoff.at, logOnly: true,
      text: `Worker ${row.task} handoff ${handoff.ready ? 'ready' : 'draft'} · ${reason} · ${handoff.path}` });
    return handoff;
  }
  async function seniorWorkerHandoff(args, caller, external) {
    const actor = sessions.liveCaller(caller) ?? (external && { role: 'super', project, endedAt: null });
    if (!actor || actor.endedAt !== null || !(senior(actor) || actor.role === 'super')) {
      throw new CommandError('invalid-arguments', 'A live Leader, Auditor or Super must request a replacement handoff');
    }
    const { target, evidence, reason = 'no-progress' } = args;
    const reported = reason === 'fabrication' || reason === 'overreach';
    if (typeof target !== 'string' || !target.trim() || [args.wip, args.passed, args.pending].some(value => value !== undefined) ||
        (reported ? !validInput(evidence) || Buffer.byteLength(evidence) > 2048 : reason !== 'no-progress' || evidence !== undefined)) {
      throw new CommandError('invalid-arguments', 'Use no-progress or a confirmed fabrication/overreach finding with evidence up to 2048 bytes');
    }
    const row = sessions.resolve(target, caller, { latestTask: true });
    const job = sessions.jobs.get(row.addr);
    if (row.project !== actor.project || row.role !== 'worker' || row.backend !== 'headless' || row.endedAt !== null || !job || job.stopping) {
      throw new CommandError('invalid-arguments', 'Select a live managed headless Worker in your project');
    }
    if (reported) {
      org.confirmWorkerFinding(currentCard(row, job), { kind: reason, at: now(), reporter: actor.addr, evidence });
    } else {
      const view = !isReleased(job) && await sessions.transport.inspect(sessions.targetBinding(row));
      const current = view && await liveness.observe(row, view, job.liveness);
      if (workerStalledSince(view, current?.lastProgressAt, now()) == null) {
        throw new CommandError('not-ready', 'No active Worker turn has gone 10 minutes without progress');
      }
    }
    if (job.workerHandoff?.ready) return { handoff: job.workerHandoff };
    return { handoff: await publishWorkerHandoff(row, job, reason, { evidence }) };
  }
  async function reapSessions() {
    const conditions = releaseConditions(mail.messages);
    const rows = sessions.rows();
    const approvals = approvedWaves(mail.messages, rows);
    const at = now();
    for (const row of rows) {
      const job = sessions.jobs.get(row.addr);
      if (!job || row.endedAt !== null || job.stopping || job.hostGrant ||
          row.role !== 'worker' || row.backend !== 'headless' && job.firstReportCheck?.status !== 'mismatch') continue;
      if (job.retention?.keepWarm && deliveries(row.addr).some(message => message.id !== job.firstId &&
          message.received && !deliveryFailed(message))) sessions.setRetention(job, { keepWarm: undefined });
      const approved = row.role === 'worker' && [row.wave, job.barrier].filter(Boolean)
        .some(gate => approvals.get(JSON.stringify([row.project, gate])) >= row.startedAt);
      const context = row.role === 'worker' && contextFor(row);
      const mismatch = job.firstReportCheck?.status === 'mismatch';
      const handoff = job.workerHandoff?.ready;
      const closingReason = mismatch ? 'first-report-mismatch' : handoff ? 'worker-handoff' : approved && 'gate-approved';
      if (isReleased(job) && (!closingReason || job.retention.resuming)) continue;
      const resultDelivered = mismatch ? conditions.workerSummaryDelivered(row.addr) :
        conditions.workerResult(row, job, { allowBlocked: handoff });
      const eligible = Boolean(resultDelivered && !conditions.pending(row.addr));
      if (!eligible) {
        if (context && !isReleased(job) && !handoff && observations.get(row.addr)?.idle && !conditions.pending(row.addr)) {
          const reason = handoffReason(context, workerHandoffLimits(policy));
          const draft = job.workerHandoff;
          if (reason && (draft?.cardId !== currentCard(row, job) || draft.reason !== reason) && !incidentFinding(row, job)) {
            await publishWorkerHandoff(row, job, reason).catch(error => report(`${row.addr}: ${error.message}`));
          }
        }
        if (job.retention?.eligible) sessions.setRetention(job, { eligible: false, idleSince: undefined, idleStream: undefined });
        continue;
      }
      try {
        if (isReleased(job)) {
          await sessions.closeWorker(row, closingReason, at, context?.contextPercent);
          continue;
        }
        const view = await sessions.transport.inspect(sessions.targetBinding(row));
        const idle = idleForRelease(view);
        const idleSince = idle ? workerIdleSince(view, at, job.retention) : undefined;
        sessions.setRetention(job, { idleSince, idleStream: idle ? view.streamId : undefined, eligible: eligible && idle });
        const finalContext = idle && contextFor(row, view);
        if (idle && closingReason) {
          if (row.backend === 'headless') await sessions.release(row, view, at, closingReason, finalContext);
          await sessions.closeWorker(row, closingReason, at, finalContext.contextPercent);
        } else if (idle && !job.retention.keep && !job.retention.keepWarm && at - idleSince >= retainMs(row)) {
          if (row.backend === 'headless' && row.sessionId) {
            await sessions.release(row, view, at, 'ttl', finalContext);
          }
          else if (row.backend === 'tui') await sessions.stop(row);
        }
      } catch (error) {
        sessions.setRetention(job, { eligible: false });
        report(`${row.addr} release: ${error.message}`);
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

  async function spawnSession(args, caller, selfHandoff) {
    const actor = caller && sessions.rows().find(row => row.addr === caller || row.pane === caller);
    if (args.role === 'auditor' && actor &&
        (actor.endedAt !== null || actor.role !== 'super' &&
          !(actor.role === 'leader' && sessions.rowFor(args['handover-from'])?.project === actor.project))) {
      throw new CommandError('invalid-arguments', 'Auditor startup requires Super or a Leader supervising succession');
    }
    await memory.prepareLibrary();
    const old = sessions.rowFor(args['handover-from']);
    const safety = old && v2.checkStart(old, selfHandoff);
    const checkedHandoff = safety ? { ...selfHandoff, phase: safety.phase, expectedFacts: v2.repositoryFacts(old),
      facts: v2.facts(old, [
        ...(selfHandoff.urgent ? ['## Next action', '接管生效后向 Super 报告事故状态和待裁决事项。'] : []),
        '### 旧地址的在途消息（交接确认后处理）',
        ...mail.handoverMessages(old.addr).map(item => `- ${item.id} ${item.action}`),
      ]) } : selfHandoff;
    const job = await sessions.newJob(args, caller, checkBarrier, occupied, handoverState, checkedHandoff);
    if (safety) v2.begin(old, job, safety.phase);
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
      if (safety) v2.fail(old, job, error.code ?? 'spawn-failed');
      await sessions.failSpawn(job, error);
      throw error;
    }
    if (session.role === 'worker') {
      failedWorkerLaunches.delete(session.project);
      v2.recordDispatch(actor, session, { id: job.firstId }, args.prompt);
    }
    let retirementIssue;
    const retired = await sessions.retirePredecessor(job).catch(error => { retirementIssue = error.message; });
    const handoff = job.hostGrant ? undefined : codexHandoff(session);
    notifyProfile(session.project, session.addr, job.warnings);
    return { session, ...(job.firstId && { deliveryId: job.firstId }), ...(job.resumeNativeId && { resumedSessionId: job.resumeNativeId }),
      requested: job.requested, ...sessions.runtimeSelection(session),
      ...(session.role === 'worker' && { dispatch: 'new', dispatchReason: args.reason ?? 'clean context',
        ...(job.checkpoint && { checkpoint: job.checkpoint }) }),
      ...(session.role === 'worker' && { workerTier: storedWorkerTier(job) }),
      ...(job.integration && { workerProfile: 'integration' }),
      ...(job.hostGrant && { hostGrant: job.hostGrant }),
      ...(storedHostUnconfined(job) && { unconfined: true }),
      ...(job.deliver && { deliver: job.deliver, ...(job.barrier && { barrier: job.barrier }) }),
      ...(handoff && { handoff }), ...(job.handoverFrom && { handoverFrom: job.handoverFrom }),
      ...(retired && { retired: retired.addr }), ...(retirementIssue && { retirementIssue }) };
  }

  async function reconcileHostCards() {
    for (const job of sessions.jobs.values()) {
      if (!job.hostGrant) continue;
      const row = sessions.rowFor(job.row.addr);
      const reply = deliveries(job.row.addr).find(message => {
        const body = message.completion?.body ?? message.completion?.unconfirmedBody;
        return body && conclusoryReply(body);
      });
      if (reply) grants.closeCard(job.row, job.hostGrant.id, reply.completion.at);
      if (row?.endedAt === null && !grants.active(row, job.hostGrant.id)) {
        await sessions.stop(row).catch(error => report(`${row.addr} host expiry: ${error.message}`));
      }
    }
  }

  async function tick() {
    policy = policyForTick();
    await memory.prepareLibrary();
    await reconcileHostCards();
    grants.sweep();
    await sessions.refresh(mail);
    if (v2.enabled()) v2.checkProtectedRefs();
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
        await reconcileHostCards();
        await settleHandovers();
        await followUpHandoverWork();
        await org.collect(sessions.rows());
        await rotation.advance();
        await stepRelay(now());
        continuations();
        const queued = new Set(mail.messages.filter(message => message.phase === 'queued').map(message => message.target.addr));
        for (const row of rows) {
          if (row.endedAt !== null || !isReleased(sessions.jobs.get(row.addr)) || !queued.has(row.addr)) continue;
          await resumeWorker(row).catch(error => report(`${row.addr} resume: ${error.message}`));
        }
        seats = workerSeats(workerLimit(policy));
        await Promise.all(rows.filter(row => seats.has(row.addr)).map(async row => {
          const job = sessions.jobs.get(row.addr);
          const first = mail.messages.find(message => message.id === job.firstId);
          if (first?.phase === 'queued') await sessions.verifyWorkerStart(job, now(), 'daemon');
        }));
        for (const [name, rows] of Map.groupBy(sessions.rows(), row => row.project)) {
          v2.sync(name);
          const leader = liveRole(name, 'leader');
          const auditor = liveRole(name, 'auditor');
          const boundaryKey = JSON.stringify([leader, auditor].map(row => row &&
            [row.addr, mail.messages.findLast(message => message.target.addr === row.addr && message.completion)?.id,
              v2.enabled() ? mail.messages.findLast(message => message.target.addr === row.addr && message.phase === 'queued')?.id : undefined]));
          await budget.check(name, rows, policy, { safe: rotationBoundary(name, rows), boundaryKey, leader, auditor })
            .catch(error => report(`Role budget ${name}: ${error.message}`));
        }
      },
      now,
      messageIssue,
      canDispatchMessage(message) {
        if (sessions.holdsForHandover(message) || rotation.holds(message.target.addr) || !v2.deliverable(message)) return false;
        const job = sessions.jobs.get(message.target.addr);
        if (!job?.handoverItems?.length || !job.handoverBound || message.rotationActivation) return true;
        return mail.messages.some(item => item.id === activationId(job) && item.received && !deliveryFailed(item));
      },
      stallMs: policy.delivery?.stallMs ?? uncertainWindow ?? defaultStallMs,
      coalesceMs: policy.delivery?.coalesceMs ?? defaultCoalesceMs,
      async decorate(message, peers) {
        // Defer delivery notices until after the compact TUI briefing.
        if (message.startup && sessions.jobs.get(message.target.addr)?.compactHandover) return;
        const row = sessions.rowFor(message.target.addr);
        const rotationNotices = [...v2.decorate(message, row, v2.enabled() && senior(row ?? {}) ?
          budget.freshContext(row) : budget.context(row?.addr)), ...rotation.decorate(message, row)];
        const byId = new Map(mail.messages.map(item => [item.id, item]));
        const workerDigest = row?.role === 'leader' && await workerDigestFor(row, [message, ...peers], byId);
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
        const deliveryLines = [...rotationNotices.map(notice => ({ ...notice,
          text: Buffer.byteLength(notice.text) > 950 ? replyForDelivery(project, notice.text, 500) : notice.text })),
          ...senderSuppressions.map(notice => ({ text: suppressedReplyText(notice), id: notice.id })),
          ...senderStalls.map(delivery => ({ text: stallText(delivery) }))];
        let deliveryAppendix;
        const visibleIds = new Set();
        if (deliveryLines.length) {
          const visible = [];
          let bytes = 0;
          for (const { text, id } of deliveryLines) {
            bytes += Buffer.byteLength(text) + 1;
            if (bytes > 1200) break;
            visible.push(text);
            if (id) visibleIds.add(id);
          }
          if (visible.length < deliveryLines.length) visible.push('More delivery notices in loom status.');
          deliveryAppendix = visible.join('\n');
        }
        const deferred = auditorDigest(row);
        const digest = deferred.length && replyForDelivery(project, deferred.map(item =>
          `[${item.id}] ${item.from.addr}\n${item.text}`).join('\n\n'), policy.delivery?.replyBytes);
        if (digest) deliveryAppendix = [deliveryAppendix, `Loom Auditor next-wake digest\n${digest}`].filter(Boolean).join('\n\n');
        if (row && (senior(row) || row.role === 'super')) {
          const request = message.replyKey && byId.get(message.replyTo);
          const gateRejection = request?.gatePacket && request.completion?.relay?.deliveryId === message.id &&
            /^REJECT(?:ED)?$/u.test(replyConclusion(request.completion.body).tag ?? '');
          const fromUser = !message.replyKey && (message.from ?
            message.from.external && message.from.addr === 'super' || sessions.rowFor(message.from.addr)?.role === 'super' :
            message.userDelivery === true);
          if (gateRejection || fromUser && durableUserMessage(message.text)) {
            deliveryAppendix = [deliveryAppendix, memoryWriteReminder].filter(Boolean).join('\n\n');
          }
        }
        const replySuppressionNotices = senderSuppressions.filter(notice => visibleIds.has(notice.id)).map(notice => notice.id);
        const shownRotationNotices = rotationNotices.filter(notice => visibleIds.has(notice.id))
          .flatMap(notice => [notice.id, ...notice.aliases ?? []]);
        const job = sessions.jobs.get(row?.addr);
        const sessionEvents = row && row.cli === 'claude' && row.backend === 'tui' ?
          withClaudeTranscriptStops(row, sessions.events(row.addr), row.sessionId) :
          row ? sessions.events(row.addr) : [];
        const { text: memoryText, ...memoryReceipt } = job ?
          await injection.decorate(job, sessionMemoryBinding(row, job), message, mail.messages, sessionEvents) : {};
        if (memoryText) deliveryAppendix = [deliveryAppendix, memoryText].filter(Boolean).join('\n\n');
        return { ...(deliveryAppendix && { deliveryAppendix }), ...(workerDigest && { resultContext: workerDigest }),
          ...(replySuppressionNotices.length && { replySuppressionNotices }),
          ...(shownRotationNotices.length && { rotationNotices: shownRotationNotices }),
          ...memoryReceipt,
          ...(memoryText && { memoryRecipient: row.addr }),
          ...(deferred.length && { auditorDigestIds: deferred.map(item => item.id) }),
          ...(batch.length && {
            orgEvents: batch.map(notice => notice.id), orgAppendix: 'Loom drift and fact checks\n' + summary,
          }) };
      },
      canDispatch(target) {
        const job = sessions.jobs.get(target.addr);
        return job?.row.role !== 'worker' || seats.has(target.addr);

      },
    });
    await memory.recordExplicit();
    for (const row of sessions.rows()) {
      const job = sessions.jobs.get(row.addr);
      if (job && row.endedAt === null && row.cli === 'claude') {
        await injection.refreshCompactIndex(job, sessionMemoryBinding(row, job));
      }
    }
    const extraction = extractor.tick(policy, mail.messages);
    if (memoryExtractorOptions) await extraction;
    await reconcileHostCards();
    await checkStartupBlockers();
    await observeSessions(policy.delivery?.stallMs ?? uncertainWindow ?? defaultStallMs);
    health = new Map((await watcher.poll()).map(row => [row.addr, row]));
    publishNotifications();
    accounts.publishWarnings();
    await pushNotifications();
    await reapSessions();
  }

  async function workerDigestFor(leader, messages, byId) {
    const addrs = new Set(messages.flatMap(message => [
      ...message.resultWorkers ?? [],
      ...(message.continuationMembers ?? []).map(id => byId.get(id)?.target.addr),
    ]));
    const gates = new Set(messages.map(message => byId.get(message.replyTo)?.gateId).filter(Boolean));
    const selected = workers().filter(row => row.project === leader.project && row.backend === 'headless' &&
      (addrs.has(row.addr) || gates.has(row.wave) || gates.has(sessions.jobs.get(row.addr)?.barrier)));
    const details = await Promise.all(selected.slice(-16).map(async row => {
      const view = row.endedAt === null && !isReleased(sessions.jobs.get(row.addr)) ?
        await sessions.transport.inspect(sessions.targetBinding(row)).catch(() => undefined) : undefined;
      const status = workerStatus(row, view);
      if (!status) return;
      const { state, retention, contextPercent, lastResultTag, compactions, reuse, retirementReason, handoff, firstReportCheck } = status;
      const at = now();
      const onReceipt = idleForRelease(view) && addrs.has(row.addr) && lastResultTag &&
        !['BLOCKED', 'UNCONFIRMED'].includes(lastResultTag) ?
        Math.max(0, retainMs(row) - (at - workerIdleSince(view, at, retention))) : null;
      const remaining = retention.remainingMs ?? onReceipt;
      const warm = retention.keep || retention.keepWarm ? 'kept warm' :
        remaining != null ? `warm ${Math.ceil(remaining / 1000)}s` : 'warm —';
      const context = contextPercent == null ? 'context unknown' : `context ${Math.round(contextPercent)}%`;
      const lifespan = reuse === 'same-card-only' ? `same card only (${retirementReason})` : reuse;
      return [row.task, state, warm, context, lastResultTag ?? 'no result', `${compactions} compactions`, lifespan,
        firstReportCheck && `baseline ${firstReportCheck.status}`, handoff && `handoff ${handoff.reason}${handoff.path ? ' · ' + handoff.path : ''}`]
        .filter(Boolean).join(' · ');
    }));
    const lines = details.filter(Boolean);
    if (selected.length > details.length) lines.push(`+${selected.length - details.length} workers in loom status`);
    return lines.length ? 'Loom Workers\n' + clip(lines.join('\n'), 1400) : undefined;
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
        const endedAt = sessions.rowFor(binding.addr)?.endedAt ?? sessions.jobs.get(binding.addr)?.retention?.releasedAt;
        attached.push(endedAt == null ? { ...binding, status: 'unavailable', reason: 'Session index binding missing' } :
          { ...binding, status: 'ended', endedAt });
      }
      return attached;
    },
    async shutdown() {
      await extractor.shutdown();
      await accounts.close();
      await sessions.shutdown();
    },
    liveCaller: sessions.liveCaller,
    legacySessions: sessions.legacySessions,
    legacyPeerCaller: sessions.legacyPeerCaller,
    async handle(command, args, caller, { external = false } = {}) {
      const rpcActor = caller && sessions.liveCaller(caller);
      if (v2.enabled() && (rpcActor || external)) v2.checkProtectedRefs();
      if (command === 'rotation-policy') {
        const result = v2.admin(args, rpcActor, external);
        if ((external || rpcActor?.role === 'super') && ['ruling', 'rule-change'].includes(args.action)) {
          return { ...result, handoffReminder: superHandoffReminder() };
        }
        return result;
      }
      const read = ['ls', 'status', 'state', 'board'].includes(command) ||
        command === 'audit-findings' && [args.id, args.category, args.evidence, args.regression].every(value => value === undefined) ||
        command === 'notifications' && ![args.take, args.complete, args.gateComplete, args.decision].some(value => value != null && value !== false);
      if (caller && v2.restricted(caller) && !read && !(command === 'rotate' && v2.canRequest(caller))) {
        throw new CommandError('permission-denied', 'The role is in read-only verification');
      }
      if (rpcActor && v2.enabled() && command === 'switch') v2.ruleChange(rpcActor, 'budget');
      if (rpcActor && v2.enabled() && command === 'senior-override') v2.ruleChange(rpcActor, 'merge');
      if (command === 'mem') return memory.handle(args, rpcActor?.addr);
      if (['memory-proposals', 'memory-review', 'memory-index', 'memory-show'].includes(command)) {
        return extractor.handle(command, args, rpcActor?.addr);
      }
      if (command === 'spawn') return spawnSession(args, caller);
      if (command === 'resume') return sessions.resumeSession(args.target, args, mail);
      if (command === 'recover') {
        const liveStatus = await this.handle('status', {}, caller, { external });
        return recoverProject(project, { liveStatus, ccpBridge: sessionOptions?.ccpBridge });
      }
      if (command === 'accounts-refresh') {
        const job = rpcActor?.role === 'worker' && sessions.jobs.get(rpcActor.addr);
        if (!external && rpcActor?.role !== 'super' && !(job?.hostGrant && grants.active(rpcActor, job.hostGrant.id))) {
          throw new CommandError('forbidden', 'Account refresh requires authenticated Super or a Worker with an active host grant');
        }
        return accounts.refresh();
      }
      if (command === 'grant') {
        const spec = hostGrantSpec(args);
        const { request: requestOnly, ...desired } = spec;
        const names = new Set(sessions.rows().map(row => row.project));
        const name = rpcActor?.project ?? (names.size === 1 ? names.values().next().value : project);
        if (!requestOnly) {
          if (!external && rpcActor?.role !== 'super') throw new CommandError('forbidden', 'Only authenticated Super can grant host access');
          const grant = grants.grant(name, desired, rpcActor?.addr ?? 'external-super');
          return { grant, warning: hostGrantWarning(grant), handoffReminder: superHandoffReminder() };
        }
        if (rpcActor?.role !== 'leader' || liveRole(name, 'leader')?.addr !== rpcActor.addr) {
          throw new CommandError('forbidden', 'Use the live authenticated Leader to request a host grant');
        }
        desired.write = hostWritePaths(project, desired.write);
        const id = randomUUID();
        notifications.add({ id, type: 'needs-decision', kind: 'worker-tier-request', project: name, at: now(),
          addr: rpcActor.addr, workerTierRequest: desired, requestOriginVerified: true,
          text: `请求 host${spec.unconfined ? ' (unconfined)' : ''} 权限 · ${spec.wave ? 'wave' : 'task'} ${spec.target} · ${spec.reason} · ${spec.uses} 次` +
            (spec.ttlMs ? ` · TTL ${spec.ttlMs / 1000}s` : '') +
            (spec.write.length ? ` · 写入路径 ${desired.write.join(', ')}` : '') + ` · ${hostGrantWarning(spec)}` });
        return { requested: desired, notificationId: id };
      }
      if (command === 'worker-handoff' && args.target !== undefined) return seniorWorkerHandoff(args, caller, external);
      if (command === 'worker-check' || command === 'worker-handoff') {
        const actor = caller && sessions.rows().find(row => row.addr === caller || row.pane === caller);
        const job = actor && sessions.jobs.get(actor.addr);
        if (actor?.role !== 'worker' || actor.endedAt !== null || !job || isReleased(job)) {
          throw new CommandError('invalid-arguments', 'This command requires the current live Worker');
        }
        if (command === 'worker-check') {
          const check = await sessions.verifyWorkerStart(job, now(), 'worker');
          if (check?.status === 'mismatch') {
            throw new CommandError('worker-first-report-mismatch', `Stop work and report BLOCKED. Mismatch: ${check.mismatches.join(', ')}`);
          }
          return { firstReportCheck: check ?? { status: 'unavailable' } };
        }
        const { wip, passed, pending } = args;
        if (![wip, passed, pending].every(value => validInput(value) && Buffer.byteLength(value) <= 2048)) {
          throw new CommandError('invalid-arguments', 'Provide WIP, passed and remaining acceptance checks of up to 2048 bytes each');
        }
        const view = await sessions.transport.inspect(sessions.targetBinding(actor));
        const finding = incidentFinding(actor, job);
        const reason = finding?.kind || handoffReason(contextFor(actor, view), workerHandoffLimits(policy));
        if (!reason) throw new CommandError('not-ready', 'Worker has not reached its mid-card handoff limit');
        return { handoff: await publishWorkerHandoff(actor, job, reason, { acceptance: { wip, passed, pending }, evidence: finding?.evidence }) };
      }
      if (command === 'session-memory') return { memory: await sessions.sessionMemory() };
      if (command === 'rotate') return rotation.request(args, caller, external);
      if (command === 'layout-up') {
        if (!sessionOptions?.layout) throw new CommandError('not-ready', 'Herdr layout is unavailable');
        return { layout: await sessionOptions.layout.ensure(true) };
      }
      if (command === 'layout-adopt') return { layout: await sessions.adoptLayout(args) };
      if (command === 'board') {
        const rows = sessions.rows();
        const events = notifications.list(undefined, false, true);
        const names = new Set(rows.map(row => row.project));
        if (!names.size) names.add(project);
        const rolesByAddr = new Map(rows.map(row => [row.addr, row.role]));
        const roleFor = addr => rolesByAddr.get(addr);
        const sessionFields = ({ addr, cli, model, sessionId, cwd, transcriptPath, startedAt }) =>
          ({ addr, cli, model, sessionId, cwd, transcriptPath, startedAt, state: observations.get(addr)?.state ?? 'starting' });
        const roles = rows.filter(row => row.endedAt === null && ['super', 'leader', 'auditor'].includes(row.role)).map(row => ({
          ...sessionFields(row), role: row.role, backend: row.backend,
          ...contextBoard(budget.context(row.addr), observations.get(row.addr)?.context),
          compactions: budget.context(row.addr)?.compactions ?? observations.get(row.addr)?.compactions,
          ...(observations.get(row.addr)?.rotationDue && { rotationDue: true }),
          activityAt: observations.get(row.addr)?.activityAt ?? row.startedAt,
          awaitingUser: observations.get(row.addr)?.awaitingUser,
          awaitingHandover: Boolean(sessions.jobs.get(row.addr)?.handoverAck && !sessions.jobs.get(row.addr)?.handoverBound),
        }));
        const workers = workerBoard(rows, mail.messages, sessions.jobs, observations, sessionFields).map(entry => {
          const job = sessions.jobs.get(entry.addr);
          const worker = { ...entry, workerTier: storedWorkerTier(job), ...(storedHostUnconfined(job) && { unconfined: true }) };
          const details = workerStatus(sessions.rowFor(worker.addr));
          return details ? { ...worker, ...details, releasedAt: details.retention.releasedAt ?? worker.releasedAt } : worker;
        });
        const gates = gateBoard(mail.messages, events, roleFor);
        const delivery = deliveryBoard(mail.messages, observations, now());
        return {
          layout: readLayout(project),
          accounts: accounts.read(),
          roles, workers, delivery, gates,
          attention: attentionBoard(delivery, roles, workers, gates, events, roleFor),
          notifications: notificationBoard(events, roleFor),
          workerMetrics: metrics(rows),
          memory: await sessions.sessionMemory(),
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
        const { command: toolCommand, retryId, reason } = args;
        const hasCommand = retryId === undefined ? validInput(toolCommand) && toolCommand.length <= 16_000 :
          toolCommand === undefined && typeof retryId === 'string' && denialIdPattern.test(retryId);
        if (!actor || !senior(actor) || actor.endedAt !== null || !sessions.jobs.has(actor.addr) || !hasCommand) {
          throw new CommandError('invalid-arguments', 'Use a live Leader or Auditor session and supply one command or a denial ID.');
        }
        const at = now();
        const gate = notifications.list(actor.project, false, true).findLast(gateBoundary);
        const since = gate?.at ?? -Infinity;
        const workerUnavailable = at - (failedWorkerLaunches.get(actor.project) ?? -Infinity) < 600_000 ||
          rows.some(row => row.role === 'worker' && row.project === actor.project && row.startedAt >= since &&
            (sessions.jobs.get(row.addr)?.exit?.code > 0 || ['silent-hang', 'auth-expired', 'quota-wait'].includes(progress.get(row.addr)?.health?.status))) ||
          stalledDeliveries(mail.messages, at).some(delivery => sessions.rowFor(delivery.target)?.project === actor.project);
        const permit = authorizeSeniorTool(project, actor, { command: toolCommand, retryId, reason, workerUnavailable, since, at });
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
      if (['notifications', 'gate-pack', 'escalate', 'audit-findings'].includes(command)) {
        const rows = sessions.rows();
        const names = new Set(rows.map(row => row.project));
        const actor = caller && rows.find(row => row.addr === caller || row.pane === caller);
        const name = args.project ?? actor?.project ?? (names.size <= 1 ? (names.values().next().value ?? project) : undefined);
        if (actor && name !== actor.project) throw new CommandError('forbidden', 'Choose your own project');
        if (command === 'audit-findings') {
          if (!name || !names.has(name) && name !== project) {
            throw new CommandError('invalid-arguments', 'Select one Loom project for audit findings');
          }
          return recordAuditFinding(project, name, actor, args, notifications, now);
        }
        const gateWriter = name && (names.has(name) || name === project) && (external ||
          ['leader', 'super'].includes(actor?.role) && actor.endedAt === null && actor.project === name);
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
          const members = rows.filter(row => row.project === name && row.role === 'worker' &&
            (row.wave === gate || sessions.jobs.get(row.addr)?.barrier === gate));
          const decisions = notifications.list(name).filter(event => event.type === 'needs-decision' &&
            (event.gate === gate || members.some(row => row.addr === event.addr)));
          const workerAddrs = new Set(members.filter(row => row.role === 'worker').map(row => row.addr));
          const boundary = notifications.list(name, false, true)
            .findLast(auditorBudgetBoundary)?.at ?? 0;
          const signals = leaderSignals(name).filter(notice => workerAddrs.has(notice.addr) ||
            notice.type === 'auditor-budget-exceeded' && notice.at >= boundary);
          const { path, fullPath, candidate, base } = saveGatePacket(project, { ...args, id, round }, { members,
            decisions, signalSummary: noticeLines(signals), signalCount: signals.length, red,
            memoryProposals: name === project ? extractor.gateText() : '' });
          const delivery = saved(sessions.targetBinding(auditor), red ?
            `Loom red escalation (${red.reason}). Read gate packet ${path}` :
            `Read gate packet ${path}${v2.enabled() ? `\n在签收时用 "$LOOM_BIN" rotation-policy spot-check --target leader --id ${id} --verdict ok|error --detail TEXT --evidence FILE[:LINE] 登记抽查。` : ''}`, {
            id, gatePacket: path, gateId: gate, gateProject: name, gateRound: round,
            ...(v2.enabled() && { gateCandidate: candidate, gateBase: base, gatePaths: members.flatMap(member => [...plannedCardPaths(sessions.jobs.get(member.addr)?.prompt ?? '')]) }), ...(fullPath && { gateFullPath: fullPath }),
            ...(red && { redEscalation: red.reason }),
            ...(actor && { from: sessions.targetBinding(actor), expectReply: true }),
          });
          if (red) notifications.add(red);
          v2.recordDecision(actor, 'gate-packet', id, gate);
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
          const completing = phase === undefined ? new Set(history.filter(event => event.type === 'audit-finding')
            .map(event => event.phase)) : [phase];
          for (const phase of completing) requireAuditRegressions(history, phase);
          const id = phase === undefined ? history.find(event => event.type === 'project-completed' &&
            event.phase === undefined && event.text === args.complete)?.id ?? 'completed:' + batchDeliveryId(name, args.complete) :
            'completed-phase:' + batchDeliveryId(name, phase);
          const prior = history.find(event => event.id === id);
          if (prior && prior.text !== args.complete) {
            throw new CommandError('id-conflict', `Phase ${phase} already has a different completion (${id})`);
          }
          notifications.add({ id, project: name, at: now(), type: 'project-completed',
            ...(phase !== undefined && { phase }), ...(actor && { addr: actor.addr }), text: args.complete });
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
          requireAuditRegressions(notifications.list(name, false, true), gate);
          if (args.candidate !== undefined && !v2.enabled()) throw new CommandError('invalid-arguments', '--candidate requires rotation v2');
          if (v2.enabled() && args.candidate !== undefined) {
            const approval = mail.messages.findLast(message => matchesGate(message, name, gate) && message.gateCandidate === args.candidate);
            const audit = approval?.completion;
            if (!approval?.received || !audit?.body || audit.unconfirmed ||
                !/^\**(?:PASS|APPROVE)\b/i.test(audit.body.trimStart())) {
              throw new CommandError('permission-denied', 'A received Auditor approval for this exact gate and SHA is required');
            }
            v2.authorizeGate(name, gate, args.candidate);
            v2.recordDecision(actor, 'gate-authorization', approval.id, `${gate} ${args.candidate}`);
            return { gate, candidate: args.candidate, authorized: true };
          }
          const id = 'gate:' + batchDeliveryId(name, gate);
          if (!notifications.list(name, false, true).some(event => event.id === id)) {
            const currentPolicy = policyForTick();
            const scoped = rows.filter(row => row.project === name);
            const auditor = liveRole(name, 'auditor');
            await budget.check(name, scoped, currentPolicy, { completeGate: gate, auditor });
            notifications.add({ id, gate, project: name, at: now(), type: 'gate-completed',
              ...(actor && { addr: actor.addr }), logOnly: true, text: `门禁 ${gate} 已完成。` });
            v2.recordDecision(actor, 'gate-complete', id, gate);
            await budget.check(name, scoped, currentPolicy, { gateRecorded: true, safe: rotationBoundary(name, scoped),
              leader: liveRole(name, 'leader'), auditor });
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
        const listed = notifications.list(name, args.take === true, args.history === true);
        const tookDecision = args.take === true && listed.some(event => event.type === 'needs-decision');
        return { notifications: listed, ...(tookDecision && { handoffReminder: superHandoffReminder() }) };
      }
      if (command === 'status' || command === 'ls') {
        const rows = sessions.rows();
        const live = await Promise.all(rows.filter(row => row.endedAt === null).map(async row => {
          const incident = health.get(row.addr);
          const { snapshot, userPrompt } = await inspectSession(row);
          const observed = progress.get(row.addr);
          const liveness = observed?.health;
          const pathWarnings = sessions.pathWarnings(row);
          const runtimeState = userPrompt?.kind ?? liveness?.status ?? reportedState(snapshot, incident);
          const worker = workerStatus(row, snapshot);
          const job = sessions.jobs.get(row.addr);
          return { addr: row.addr, state: runtimeState,
            ...(row.role === 'worker' && { workerTier: storedWorkerTier(job), ...(storedHostUnconfined(job) && { unconfined: true }) }),
            ...(sessions.jobs.has(row.addr) && { memoryIsolation: memoryIsolationCoverage(row.cli) }),
            lastProgressAt: observed?.lastProgressAt ?? row.startedAt, ...(liveness && { liveness }),
            ...(worker && { ...worker, runtimeState }),
            ...((senior(row) || row.role === 'super') && { compactions: observations.get(row.addr)?.compactions ?? 0,
              ...(observations.get(row.addr)?.rotationDue && { rotationDue: true }) }),
            ...(pathWarnings.length && { pathWarnings }),
            ...(userPrompt && { userPrompt }), ...(snapshot?.hookGap && { hookGap: snapshot.hookGap }) };
        }));
        const closedWorkers = rows.filter(row => row.endedAt != null).flatMap(row => {
          const status = workerStatus(row);
          const job = sessions.jobs.get(row.addr);
          return status ? [{ addr: row.addr,
            ...(row.role === 'worker' && { workerTier: storedWorkerTier(job), ...(storedHostUnconfined(job) && { unconfined: true }) }),
            ...status }] : [];
        });
        if (command === 'status') return { sessions: [...live, ...closedWorkers], workerMetrics: metrics(rows),
          ...(v2.enabled() && { rotationPolicy: [...new Set(rows.filter(row => row.endedAt === null).map(row => row.project))]
            .map(name => v2.snapshot(name)) }),
          memory: await sessions.sessionMemory(), exits: rows.flatMap(row => {
          const exit = sessions.jobs.get(row.addr)?.exit;
          return row.endedAt !== null && exit && !sessions.successorOf(row.addr) ? [{ addr: row.addr, role: row.role, ...exit }] : [];
        }) };
        return { ...pendingWork(mail.messages, undefined, parentFor, targetEnded),
          workers: [...live.filter(row => row.retention), ...closedWorkers].map(({ addr, state, retention, contextPercent, lastResultTag,
            compactions, reuse, retirementReason, handoff, firstReportCheck }) =>
            ({ addr, state, retention, contextPercent, lastResultTag, compactions, reuse, retirementReason, handoff, firstReportCheck })),
          awaitingUser: live.flatMap(row => row.userPrompt ? [{ addr: row.addr, ...row.userPrompt }] : []) };
      }
      const row = sessions.resolve(args.target, caller, { latestTask: ['send', 'keep', 'assign', 'release'].includes(command) });
      if (['assign', 'keep', 'release'].includes(command)) {
        const job = sessions.jobs.get(row.addr);
        const actor = caller && sessions.rows().find(item => item.addr === caller || item.pane === caller);
        if (!job || row.backend !== 'headless' || row.role !== 'worker' ||
            caller && (!actor || actor.endedAt !== null || actor.project !== row.project ||
               actor.role !== 'super' && (actor.role !== 'leader' || parentFor(row.parent) !== actor.addr))) {
          throw new CommandError('invalid-arguments', 'Expected a headless worker in the Leader’s project');
        }
        sessions.requireLive(row);
        if (command === 'keep') {
          sessions.setRetention(job, { keep: args.keep !== false, ...(args.keep === false && { keepWarm: undefined }) });
          return { addr: row.addr, retention: retentionFor(row) };
        }
        if (command === 'assign') {
          if (!validDispatchReason(args.reason)) throw new CommandError('invalid-arguments', 'Expected a one-line dispatch reason');
          const dispatch = isReleased(job) ? 'revived' : 'continued';
          const dispatchReason = args.reason ?? (dispatch === 'revived' ? 'reuse task context' : 'continue in live context');
          return { session: await resumeWorker(row), dispatch, dispatchReason, retention: retentionFor(row) };
        }
        if (!isReleased(job)) {
          const at = now();
          await mail.observe(releaseConditions(mail.messages).relatedTargets(row.addr), at,
            policy.delivery?.stallMs ?? uncertainWindow ?? defaultStallMs);
          const conditions = releaseConditions(mail.messages);
          if (conditions.pending(row.addr) || !conditions.workerResult(row, job)) {
            throw new CommandError('not-ready', 'Worker has pending deliveries or its final result has no native delivery receipt');
          }
          const view = await sessions.transport.inspect(sessions.targetBinding(row));
          if (!row.sessionId || !idleForRelease(view)) throw new CommandError('not-ready', 'Worker is not idle');
          await sessions.release(row, view, at, actor ? 'leader' : 'operator', contextFor(row, view));
        } else if (job.retention.resuming) {
          throw new CommandError('not-ready', 'The worker is starting a native resume');
        }
        return { addr: row.addr, state: 'offline', retention: retentionFor(row) };
      }
      if (command === 'handover') {
        if (v2.enabled() && senior(row)) throw new CommandError('rotation-note-required', 'Use loom rotate for a v2 handover');
        const old = sessions.rowFor(args.from);
        if (!validInput(args.text)) throw new CommandError('invalid-arguments', 'Handover brief is required');
        const actor = caller && sessions.rows().find(item => item.addr === caller || item.pane === caller);
        if (actor?.role === 'leader' && (row.project !== actor.project || row.role !== 'auditor' && old?.addr !== actor.addr)) {
          throw new CommandError('forbidden', 'Leader can hand over itself or its project Auditor');
        }
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
        const job = sessions.jobs.get(row.addr);
        const tui = job?.tui;
        const { snapshot, userPrompt } = row.endedAt === null ? await inspectSession(row) : {};
        const observed = progress.get(row.addr);
        const liveness = row.endedAt !== null ? job?.exit : isReleased(job) ? undefined : observed?.health;
        const runtimeState = userPrompt?.kind ?? liveness?.status ?? reportedState(snapshot, incident);
        const worker = workerStatus(row, snapshot);
        return { addr: row.addr, state: row.endedAt !== null ? 'exited' : runtimeState,
          ...(row.role === 'worker' && { workerTier: storedWorkerTier(job), ...(storedHostUnconfined(job) && { unconfined: true }) }),
          ...(worker && { ...worker, runtimeState }),
          ...((senior(row) || row.role === 'super') && { compactions: observations.get(row.addr)?.compactions ?? 0,
            ...(observations.get(row.addr)?.rotationDue && { rotationDue: true }) }),
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
        const actor = sessions.liveCaller(caller);
        if (actor?.role === 'leader' && row.addr !== actor.addr && (row.role !== 'worker' ||
            row.project !== actor.project || sessions.routeParent(row.parent)?.addr !== actor.addr)) {
          throw new CommandError('forbidden', 'Leader can only stop itself or its own Workers');
        }
        const closed = row.endedAt !== null ? row : row.role === 'worker' && retentionFor(row) ?
          await sessions.closeWorker(row, 'cancelled', now()) : await sessions.stop(row);
        return { addr: row.addr, endedAt: closed.endedAt, ...(row.role === 'super' && { handoffReminder: superHandoffReminder() }) };
      }
      if (command !== 'send') throw new CommandError('invalid-arguments', 'Unknown loomd request');
      if (!validInput(args.text) || !validDispatchReason(args.reason) || !['queue', 'steer', 'interrupt'].includes(args.mode) ||
          args.expectReply !== undefined && typeof args.expectReply !== 'boolean' ||
          args.nextCard !== undefined && typeof args.nextCard !== 'boolean') {
        throw new CommandError('invalid-arguments', 'Invalid send request');
      }
      if (args.id !== undefined && !messageIdPattern.test(args.id) ||
          (args.batch !== undefined || args.batchSize !== undefined) &&
          (!messageIdPattern.test(args.batch) || !Number.isSafeInteger(args.batchSize) || args.batchSize < 1 || args.mode !== 'queue')) {
        throw new CommandError('invalid-arguments', 'Invalid delivery ID or continuation batch');
      }
      const actor = caller && sessions.rows().find(row => row.addr === caller || row.pane === caller);
      const externalSuper = args.from === 'super' && external;
      if (args.from !== undefined && !externalSuper && (!actor || ![actor.addr, actor.pane,
        ...(actor.role === 'super' ? ['super'] : [])].includes(args.from))) {
        throw new CommandError('invalid-arguments', 'The sender must be the authenticated caller');
      }
      const from = actor;
      const sender = externalSuper ? { addr: 'super', role: 'super', external: true } : from && sessions.targetBinding(from);
      const existing = args.id && mail.messages.find(message => message.id === args.id);
      const requestedRole = rotatingRoles.includes(args.target) ? args.target : undefined;
      if (existing) {
        const initial = existing.originalTarget ?? existing.target.addr;
        const sameTarget = existing.requestedRole ? existing.requestedRole === requestedRole &&
          sessions.rowFor(initial)?.project === row.project : initial === row.addr;
        if (!sameTarget || existing.from?.addr !== sender?.addr || existing.text !== args.text ||
            existing.requestedMode !== args.mode || existing.batchId !== args.batch || existing.batchSize !== args.batchSize ||
            Boolean(existing.expectReply) !== Boolean(args.expectReply) || existing.requestedDispatchReason !== args.reason ||
            Boolean(existing.nextCard) !== Boolean(args.nextCard)) {
          throw new CommandError('id-conflict', 'Delivery ID is already bound to a different request');
        }
        return { addr: row.addr, ...receiptFor(existing) };
      }
      const holdForRole = requestedRole && sessions.holdsForHandover({ target: { addr: row.addr }, mode: 'queue' });
      const effectiveMode = holdForRole ? 'queue' : args.mode;
      const successor = effectiveMode === 'queue' ? sessions.routeParent(row.addr) : row;
      if (!holdForRole) sessions.requireLive(successor);
      if (from) sessions.requireLive(from);
      const targetJob = sessions.jobs.get(successor.addr);
      if (targetJob?.handoverFailure) {
        throw new CommandError('not-ready', 'Failed successors do not accept follow-up messages');
      }
      if (targetJob?.firstReportCheck?.status === 'mismatch' || targetJob?.workerHandoff?.ready) {
        throw new CommandError('not-ready', 'This Worker is awaiting closure. Use its report or handoff sheet to start a successor.');
      }
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
      const userWake = external || actor?.role === 'super' && actor.endedAt === null;
      const fields = { ...(sender && { from: sender }), ...(args.expectReply && { expectReply: true }),
        ...(!sender && userWake && { userDelivery: true }),
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
      if (args.nextCard) {
        if (from?.role !== 'leader' || from.project !== successor.project || effectiveMode !== 'queue') {
          throw new CommandError('invalid-arguments', 'Next-card dispatch requires a Leader queuing work in this project');
        }
        await requireNextCardReuse(successor);
      }
      const revived = isReleased(targetJob);
      if (revived) {
        if (effectiveMode === 'interrupt') throw new CommandError('not-ready', 'interrupt requires an active turn');
        await resumeWorker(successor);
      }
      const observation = effectiveMode !== 'queue' && await sessions.transport.inspect(target).catch(() => undefined);
      if (observation?.state === 'finished') throw new CommandError('not-ready', 'Target has exited');
      const active = observation?.active;
      if (effectiveMode === 'interrupt' && !active) throw new CommandError('not-ready', 'interrupt requires an active turn');
      const mode = sessions.requestedMode(target, effectiveMode, active);
      const continuation = mode === 'queue' && from?.role === 'leader' && row.role === 'worker' && from.project === row.project;
      const message = saved(target, args.text, { ...fields,
        ...(continuation && !args.batch && { implicitBatch: 'auto:' + randomUUID(), coalesceWindow: 0, streamContinuation: true }),
        ...(row.role === 'worker' && { dispatch: revived ? 'revived' : 'continued',
          dispatchReason: args.reason ?? (revived ? 'reuse task context' : 'continue in live context') }),
        ...(args.reason !== undefined && { requestedDispatchReason: args.reason }),
        ...(args.nextCard && { nextCard: true }),
        mode, active, barrier: mode === 'queue' ? active : undefined });
      if (successor.role === 'worker') {
        const card = args.nextCard ? message.id : currentCard(successor, targetJob);
        v2.recordDispatch(actor, successor, message, args.text, card === targetJob.firstId ? successor.task : card);
      }
      const superRuling = userWake && (durableUserMessage(args.text) ||
        notifications.list(successor.project).some(event => event.type === 'needs-decision'));
      return { addr: row.addr, ...receiptFor(message), ...(superRuling && { handoffReminder: superHandoffReminder() }) };
    },
  };
}
