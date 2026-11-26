import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { CommandError } from '../cli/sessions.mjs';
import { projectIndex } from '../cli/project.mjs';
import { inbox, pendingWork, receipt } from '../inbox/engine.mjs';
import { conclusoryReply, deliveryFailed, isBlockedReply, messageIdPattern } from '../inbox/message.mjs';
import { relay } from '../relay/project.mjs';
import { withClaudeTranscriptStops } from '../relay/sources.mjs';
import { createWatcher } from '../watch/index.mjs';
import { opencodeExportFailureLimit, ownedSessions, validInput } from './sessions.mjs';
import { jsonRows, prepareJournal, readText } from './io.mjs';
import { desktopEnabled, notifyExternal, projectNotifications } from './notifications.mjs';
import { organization } from './org.mjs';
import { clip } from '../evidence/checks.mjs';
import { defaultCoalesceMs, readPolicy, setWorkerProfile, workerLimit } from '../cli/policy.mjs';
import { isStartupBlocker } from '../tui/agent-status.mjs';
import { gateId, saveGatePacket } from './gate-packet.mjs';
import { roleBudget } from './role-budget.mjs';
import { auditorWakeFiltered, auditorWakeSource, redReasons } from './routing.mjs';

function batchDeliveryId(batch, dest) {
  const bytes = createHash('sha256').update(`${batch}\0${dest}`).digest('hex').slice(0, 32);
  return [bytes.slice(0, 8), bytes.slice(8, 12), bytes.slice(12, 16), bytes.slice(16, 20), bytes.slice(20)].join('-');
}

const reviewerDeliveryId = job => batchDeliveryId(job.firstId, 'reviewer');
const continuationGroup = message => message.batchId ?? message.implicitBatch;
const packetDeliveryId = (project, gate) => batchDeliveryId('gate-packet:' + project, gate);
const auditEscalations = new Set(['blocking-disagreement', 'three-failed-rounds', 'major-risk', 'overreach']);
const terminalText = text => text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');

function codexHandoff(row) {
  if (row.cli !== 'codex' || !row.sessionId) return;
  return { cwd: row.cwd, argv: ['codex', '--no-daemon', '--disable', 'memories', '-c',
    'check_for_update_on_startup=false', '-c', `projects.${JSON.stringify(row.cwd)}.trust_level="trusted"`, 'resume', row.sessionId] };
}

export function createSupervisor(project, {
  report = console.log, window = 900_000, sealWindow = window, partialWindow = Math.min(window, 120_000),
  uncertainWindow = 60_000, blockedWindow = 60_000, sessionOptions, now = Date.now, watchOptions,
  externalNotification = notifyExternal,
} = {}) {
  if (![window, sealWindow, partialWindow, uncertainWindow, blockedWindow].every(value => Number.isSafeInteger(value) && value >= 0)) {
    throw new RangeError('Invalid loomd timeout in milliseconds');
  }
  const index = projectIndex(project);
  index.initialize();
  const sessions = ownedSessions(project, index, report, sessionOptions);
  const policyForTick = () => {
    try { return readPolicy(project, { optional: true }); }
    catch { return {}; }
  };
  let policy = policyForTick();
  const mail = inbox(project, sessions.transport, report, { replyLimit: () => policy.delivery?.replyBytes,
    canRelayReply: addr => sessions.rowFor(addr)?.role !== 'auditor' });
  const org = organization(project, index, sessions, mail, now, report);
  const watchJournal = join(project, '.project', 'watch', 'events.jsonl');
  prepareJournal(watchJournal);
  const notifications = projectNotifications(project, now);
  const deliveries = addr => mail.messages.filter(message => message.target.addr === addr);
  const receiptFor = message => ({ ...receipt(message), deliveryId: message.id, phase: message.phase });
  const saved = (target, text, fields = {}) => mail.enqueue({
    id: randomUUID(), createdAt: now(), target, text, requestedMode: 'queue', mode: 'queue', phase: 'queued', ...fields,
  });
  const budget = roleBudget(project, { now, sessions, notifications, batchDeliveryId, report });
  const parentFor = addr => sessions.routeParent(addr)?.addr ?? addr;
  const targetEnded = addr => sessions.rowFor(addr)?.endedAt != null;
  const liveRole = (name, role) => sessions.rows().findLast(row =>
    row.project === name && row.role === role && row.endedAt === null && sessions.jobs.has(row.addr));
  let health = new Map();
  const startupBlockers = new Map();
  const desktop = externalNotification !== notifyExternal || desktopEnabled() ? async (name, batch) => {
    try { await externalNotification(name, batch); }
    catch (error) { report(`macOS project notification: ${error.message}`); }
  } : undefined;

  async function pushNotifications() {
    await notifications.push(async batch => {
      const { project: name, pushBatch } = batch[0];
      const id = batchDeliveryId(pushBatch, 'super');
      const existing = mail.messages.find(message => message.id === id);
      if (existing) return existing.target.addr;
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
    hc: sessions.managedHc, report, now, ...watchOptions,
    async inspectRuntime(row) {
      const snapshot = await sessions.transport.inspect(sessions.targetBinding(row));
      const last = snapshot.events.findLast(event => ['stuck', 'recovered'].includes(event.type));
      return { state: snapshot.state, reason: snapshot.reason ?? (last?.type === 'stuck' ? last.reason : undefined),
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
          evidenceInput: { cwd: row.cwd, sessionId: row.sessionId, nativeTurnIndex: completion?.nativeTurnIndex ?? 1,
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
      if (!row) continue;
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
      if (message.combinedInto || !['sending', 'stopping'].includes(message.phase)) continue;
      if (message.providerPendingUntil !== undefined) continue;
      const at = message.attemptAt ?? message.stopAttemptAt;
      if (!at || message.bypassedAt == null && now() - at < uncertainWindow) continue;
      const row = sessions.rowFor(message.target.addr);
      if (!row) continue;
      mail.escalate(message);
      const id = `${message.id}:uncertain`;
      const text = `Loom 投递 UNCERTAIN ${message.id}\n目标 ${row.addr}，请核对原生记录。`;
      const parent = sessions.routeParent(message.from?.addr ?? row.parent);
      if (parent && parent.addr !== row.addr && parent.endedAt === null && !message.uncertainOf) {
        saved(sessions.targetBinding(parent), text, { id: batchDeliveryId(id, parent.addr), uncertainOf: message.id });
      }
      notifications.add({ id, type: 'delivery-uncertain', project: row.project, addr: row.addr,
        at: Math.min(at + uncertainWindow, message.bypassedAt ?? Infinity),
        deliveryId: message.id, text, ...((message.projectEvents || message.uncertainOf) && { logOnly: true }) });
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
      if (!isStartupBlocker(blocker)) { startupBlockers.delete(message.id); return; }
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

  async function checkHeldDrafts() {
    const pending = mail.messages.filter(message => message.target.backend === 'tui' && message.phase === 'sending' &&
      sessions.rowFor(message.target.addr)?.endedAt === null);
    await Promise.all(pending.map(async message => {
      const snapshot = await sessions.transport.inspect(message.target).catch(() => undefined);
      const proof = snapshot?.writeEvidence;
      if (!['draft-held', 'overlay'].includes(snapshot?.state) || proof?.heldDeliveryId !== message.id ||
          !['unproven', 'incomplete', 'uncertain-enter'].includes(proof.heldDraftProof)) return;
      const row = sessions.rowFor(message.target.addr);
      const bytes = proof.heldDraftBytes;
      const progress = bytes?.total == null ? '字节数未知' : `${bytes.written ?? '未知'}/${bytes.total} 字节`;
      notifications.add({ id: `${message.id}:held-draft`, type: 'needs-decision', project: row.project, addr: row.addr,
        deliveryId: message.id, reason: 'draft-held', at: now(),
        ...(row.role === 'super' && { externalOnly: true, batch: message.id }),
        text: `Loom 保留了 ${row.role} ${row.addr} 的草稿 ${message.id}（${progress}）。完整粘贴或 Enter 状态未获确认。` });
    }));
  }

  const reportedState = (snapshot, incident) => isStartupBlocker(snapshot?.state) ? snapshot.state :
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
      .filter(event => event.type === 'auditor-budget-exceeded' ||
        event.type === 'stuck' && sessions.rowFor(event.addr)?.role === 'worker')];
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
      const gate = audit && row.wave && mail.messages.some(message =>
        message.id === packetDeliveryId(row.project, row.wave) && message.gatePacket) ? row.wave : undefined;
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
    const job = await sessions.newJob(args, caller, checkBarrier, occupied);
    let session;
    try {
      session = await sessions.activate(job, mail);
      sessions.requireLive(session);
    } catch (error) {
      await sessions.failSpawn(job, error);
      throw error;
    }
    let retirementIssue;
    const retired = await sessions.retirePredecessor(job).catch(error => { retirementIssue = error.message; });
    const handoff = codexHandoff(session);
    notifyProfile(session.project, session.addr, job.warnings);
    return { session, deliveryId: job.firstId, requested: job.requested, ...sessions.runtimeSelection(session),
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
        await org.collect(sessions.rows());
        await stepRelay(now());
        continuations();
        seats = workerSeats(workerLimit(policy));
      },
      now,
      messageIssue,
      coalesceMs: policy.delivery?.coalesceMs ?? defaultCoalesceMs,
      decorate(message) {
        const row = sessions.rowFor(message.target.addr);
        if (row?.role !== 'leader' || message.orgEvents || message.stuckOf) return;
        const delivered = new Set(mail.messages.filter(item =>
          !deliveryFailed(item) && sessions.rowFor(item.target.addr)?.role === 'leader')
          .flatMap(item => item.orgEvents ?? []));
        const batch = leaderSignals(row.project).filter(notice => !delivered.has(notice.id));
        if (batch.length) {
          const lines = noticeLines(batch);
          const summary = Buffer.byteLength(lines) > 1200 ?
            clip(lines, 1200) + '\n完整记录见 loom status --json。' : lines;
          return { orgEvents: batch.map(notice => notice.id), orgAppendix: 'Loom drift and fact checks\n' + summary };
        }
      },
      canDispatch(target) {
        const job = sessions.jobs.get(target.addr);
        if (job?.row.role === 'worker') return seats.has(target.addr);
        if (!job?.reviewDeadline) return true;
        const first = mail.messages.find(message => message.id === job.firstId);
        return now() < job.reviewDeadline && !first?.completion && !deliveryFailed(first);
      },
    });
    await closeReviews();
    const current = sessions.rows();
    for (const [name, rows] of Map.groupBy(current, row => row.project)) {
      await budget.check(name, rows, policy).catch(error => report(`Role budget ${name}: ${error.message}`));
    }
    health = new Map((await watcher.poll()).map(row => [row.addr, row]));
    await checkStartupBlockers();
    await checkHeldDrafts();
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
      if (command === 'spawn') return spawnSession(args, caller);
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
              ['base', 'candidate', 'question'].some(key => args[key] !== undefined && !validInput(args[key]))) {
            throw new CommandError('invalid-arguments', 'A Leader or Super must supply a gate ID in this project');
          }
          if (escalation && (actor?.role !== 'leader' || !redReasons.has(args.reason) ||
              !validInput(args.evidence) || Buffer.byteLength(args.evidence) > 2048)) {
            throw new CommandError('invalid-arguments', 'Escalation requires the live Leader, a red reason and up to 2048 bytes of evidence');
          }
          const { gate } = args;
          const id = packetDeliveryId(name, gate);
          const existing = mail.messages.find(message => message.id === id);
          const red = escalation && { id: `red:${id}`, gate, project: name, addr: actor.addr, at: now(),
            type: 'red-escalation', reason: args.reason, text: args.evidence, logOnly: true };
          if (existing) {
            if (red) notifications.add(red);
            return { gate, path: existing.gatePacket, ...(!escalation && existing.gateWarnings && { warnings: existing.gateWarnings }),
              ...(red && { wakeQueued: false }), ...receiptFor(existing) };
          }
          const auditor = liveRole(name, 'auditor');
          if (!auditor) throw new CommandError('not-ready', 'No live managed Auditor in this project');
          const members = rows.filter(row => row.project === name && ['worker', 'reviewer'].includes(row.role) &&
            (row.role === 'worker' || sessions.rowFor(row.parent)?.role === 'leader') &&
            (row.wave === gate || sessions.jobs.get(row.addr)?.barrier === gate));
          const decisions = notifications.list(name).filter(event => event.type === 'needs-decision' &&
            (event.gate === gate || members.some(row => row.addr === event.addr)));
          const workerAddrs = new Set(members.filter(row => row.role === 'worker').map(row => row.addr));
          const boundary = notifications.list(name, false, true)
            .findLast(event => ['gate-completed', 'auditor-rotation-proposed'].includes(event.type))?.at ?? 0;
          const signals = leaderSignals(name).filter(notice => workerAddrs.has(notice.addr) ||
            notice.type === 'auditor-budget-exceeded' && notice.at >= boundary);
          const { path, warnings } = saveGatePacket(project, { ...args, id }, { members, jobs: sessions.jobs, messages: mail.messages,
            decisions, signalSummary: noticeLines(signals), signalCount: signals.length, red });
          const delivery = saved(sessions.targetBinding(auditor), red ?
            `Loom red escalation (${red.reason}). Read gate packet ${path}` : `Read gate packet ${path}`, {
            id, gatePacket: path, ...(warnings.length && { gateWarnings: warnings }), ...(red && { redEscalation: red.reason }),
            ...(actor && { from: sessions.targetBinding(actor), expectReply: true }),
          });
          if (red) notifications.add(red);
          return { gate, path, ...(!escalation && warnings.length && { warnings }), ...(red && { wakeQueued: true }), ...receiptFor(delivery) };
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
          const id = phase === undefined ? `completed:${name}` : 'completed-phase:' + batchDeliveryId(name, phase);
          notifications.add({ id, project: name, at: now(), type: 'project-completed',
            ...(phase !== undefined && { phase }), text: args.complete });
        }
        if (args.gateComplete !== undefined) {
          if (!gateWriter || typeof args.gateComplete !== 'string' || !gateId.test(args.gateComplete)) {
            throw new CommandError('invalid-arguments', 'A Leader or Super must supply a completed gate ID in this project');
          }
          const gate = args.gateComplete;
          const id = 'gate:' + batchDeliveryId(name, gate);
          if (!notifications.list(name, false, true).some(event => event.id === id)) {
            const currentPolicy = policyForTick();
            const usage = await budget.check(name, rows.filter(row => row.project === name), currentPolicy, { completeGate: true });
            const proposal = usage || currentPolicy.roles?.auditor?.rotateAt === 'gate';
            notifications.add({ id, gate, project: name, at: now(), type: proposal ? 'auditor-rotation-proposed' : 'gate-completed',
              ...(actor && { addr: actor.addr }), ...(usage && { usage }), logOnly: !proposal,
              text: proposal ? `门禁 ${gate} 已完成。${usage ? 'Auditor 已超出预算。' : ''}建议由 Leader 监督 Auditor 换班；已有换班须先结算。` :
                `门禁 ${gate} 已完成。` });
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
      if (command === 'ls') return pendingWork(mail.messages, undefined, parentFor, targetEnded);
      if (command === 'status') return { sessions: await Promise.all(sessions.rows().filter(row => row.endedAt === null)
        .map(async row => {
          const incident = health.get(row.addr);
          const snapshot = await Promise.resolve().then(() => sessions.transport.inspect(sessions.targetBinding(row))).catch(() => undefined);
          return { addr: row.addr, state: reportedState(snapshot, incident) };
        })) };
      const row = sessions.resolve(args.target, caller);
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
        const snapshot = row.endedAt === null && await sessions.transport.inspect(sessions.targetBinding(row)).catch(() => undefined);
        return { addr: row.addr, state: row.endedAt !== null ? 'exited' : reportedState(snapshot, incident),
          ...(tui && { transport: tui.transport, ...(tui.reason && { transportReason: tui.reason }) }),
          ...((snapshot?.reason ?? incident?.reason) && { reason: snapshot?.reason ?? incident.reason }),
          ...(snapshot?.writeEvidence && { writeEvidence: snapshot.writeEvidence }),
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
      if (existing) {
        if ((existing.originalTarget ?? existing.target.addr) !== row.addr || existing.from?.addr !== from?.addr || existing.text !== args.text ||
            existing.requestedMode !== args.mode || existing.batchId !== args.batch || existing.batchSize !== args.batchSize ||
            Boolean(existing.expectReply) !== Boolean(args.expectReply)) {
          throw new CommandError('id-conflict', 'Delivery ID is already bound to a different request');
        }
        return { addr: row.addr, ...receiptFor(existing) };
      }
      const successor = args.mode === 'queue' ? sessions.routeParent(row.addr) : row;
      sessions.requireLive(successor);
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
        ...(args.id && { id: args.id }), ...(args.batch && { batchId: args.batch, batchSize: args.batchSize }),
        requestedMode: args.mode,
      };
      if (successor.role === 'auditor' && !userWake) {
        const message = saved(target, args.text, { ...fields, mode: args.mode, phase: 'refused',
          issue: auditorWakeFiltered, refusedAt: now() });
        return { addr: row.addr, ...receiptFor(message) };
      }
      if (args.mode === 'interrupt' && !sessions.canInterrupt(target)) {
        throw new CommandError('unsupported', 'Runtime cannot guard the requested turn at interrupt submission');
      }
      const observation = args.mode !== 'queue' && await sessions.transport.inspect(target).catch(() => undefined);
      if (observation?.state === 'finished') throw new CommandError('not-ready', 'Target has exited');
      const active = observation?.active;
      if (args.mode === 'interrupt' && !active) throw new CommandError('not-ready', 'interrupt requires an active turn');
      const mode = sessions.requestedMode(target, args.mode, active);
      const continuation = mode === 'queue' && from?.role === 'leader' && row.role === 'worker' && from.project === row.project;
      const message = saved(target, args.text, { ...fields,
        ...(continuation && !args.batch && { implicitBatch: 'auto:' + randomUUID(), coalesceWindow: 0, streamContinuation: true }),
        mode, active, barrier: mode === 'queue' ? active : undefined });
      return { addr: row.addr, ...receiptFor(message) };
    },
  };
}
