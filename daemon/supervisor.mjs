import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { CommandError } from '../cli/sessions.mjs';
import { projectIndex } from '../cli/project.mjs';
import { inbox, pendingWork, receipt } from '../inbox/engine.mjs';
import { isBlockedReply, messageIdPattern } from '../inbox/message.mjs';
import { relay } from '../relay/project.mjs';
import { withClaudeTranscriptStops } from '../relay/sources.mjs';
import { createWatcher } from '../watch/index.mjs';
import { ownedSessions, validInput } from './sessions.mjs';
import { jsonRows, prepareJournal, readText } from './io.mjs';
import { notifyExternal, projectNotifications } from './notifications.mjs';
import { organization } from './org.mjs';
import { defaultCoalesceMs, readPolicy, setWorkerProfile, workerLimit } from '../cli/policy.mjs';
import { isStartupBlocker } from '../tui/agent-status.mjs';

function batchDeliveryId(batch, dest) {
  const bytes = createHash('sha256').update(`${batch}\0${dest}`).digest('hex').slice(0, 32);
  return [bytes.slice(0, 8), bytes.slice(8, 12), bytes.slice(12, 16), bytes.slice(16, 20), bytes.slice(20)].join('-');
}

const continuationGroup = message => message.batchId ?? message.implicitBatch;
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
  const mail = inbox(project, sessions.transport, report);
  const org = organization(project, index, sessions, mail, now, report);
  const watchJournal = join(project, '.project', 'watch', 'events.jsonl');
  prepareJournal(watchJournal);
  const notifications = projectNotifications(project, now);
  const deliveries = addr => mail.messages.filter(message => message.target.addr === addr);
  const receiptFor = message => ({ ...receipt(message), deliveryId: message.id, phase: message.phase });
  const saved = (target, text, fields = {}) => mail.enqueue({
    id: randomUUID(), createdAt: now(), target, text, requestedMode: 'queue', mode: 'queue', phase: 'queued', ...fields,
  });
  const parentFor = addr => sessions.routeParent(addr)?.addr ?? addr;
  let health = new Map();
  const startupBlockers = new Map();
  let externalRetryAt = 0;

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
        const details = [...new Set(batch.map(event => terminalText(event.text ??
          `${event.type} ${event.addr ?? ''} ${event.reason ?? ''}`.trim()).slice(0, 4000)))];
        const heading = `Loom 项目通知：${[...new Set(batch.map(event => event.type))].join(', ')}`;
        saved(sessions.targetBinding(superSession), [heading, ...details].join('\n\n').slice(0, 16_000),
          { id, projectEvents: batch.map(event => event.id),
            ...(batch.some(event => event.type === 'needs-decision') && { superPriority: true }) });
        return superSession.addr;
      }
      if (now() < externalRetryAt) return;
      try { await externalNotification(project, batch); return 'external'; }
      catch (error) {
        externalRetryAt = now() + 30_000;
        report(`macOS project notification: ${error.message}`);
      }
    });
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
      return { state: snapshot.state, reason: last?.type === 'stuck' ? last.reason : undefined,
        lastEventAt: snapshot.runtimeStatus?.lastEventAt ?? snapshot.active?.since ?? row.startedAt };
    },
    enqueue: async ({ addr, message, eventId }) => receiptFor(saved(sessions.targetBinding(sessions.rowFor(addr)), message,
      { id: eventId, watchResume: true })),
  });

  const workers = () => sessions.rows().filter(row => row.role === 'worker' && sessions.jobs.has(row.addr));
  const superseded = (worker, rows) => rows.some(row => row.project === worker.project && row.task === worker.task &&
    row.startedAt > worker.startedAt);
  const workPending = message => message?.phase !== 'refused' && !message?.completion?.body && !message?.completion?.noReply;
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
    auditors: name => sessions.rows().filter(row => row.project === name && row.role === 'auditor' &&
      row.endedAt === null && sessions.jobs.has(row.addr)).map(row => row.addr),
    async managedWorkers() {
      const rows = workers();
      const byId = new Map(mail.messages.map(message => [message.id, message]));
      return Promise.all(rows.map(async row => {
        const job = sessions.jobs.get(row.addr);
        const message = byId.get(job.firstId);
        const completion = message?.completion;
        const settled = completion?.body || completion?.noReply || row.endedAt !== null || message?.phase === 'refused';
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
          parent: row.parent, project: row.project, startedAt: row.startedAt, activityAt, reply,
          superseded: superseded(row, rows), sealed,
          deliver: job.deliver, barrier: job.barrier,
        } };
      }));
    },
    async deliver(addr, batch) {
      const row = sessions.routeParent(addr);
      if (!row) throw new Error(`No wave recipient ${addr}`);
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
    for (const event of jsonRows(readText(watchJournal)).filter(event => event.type === 'stuck')) {
      const row = sessions.rowFor(event.addr);
      if (!row) continue;
      const job = sessions.jobs.get(row.addr);
      const coveredByBatch = row.role === 'worker' && deliveries(row.addr).some(message =>
        (message.id === job?.firstId || continuationGroup(message)) && !message.completion && message.phase !== 'refused');
      notifications.add({ id: event.incidentId, type: 'stuck', project: row.project, addr: row.addr,
        at: event.at, reason: event.reason, ...(coveredByBatch && { logOnly: true }) });
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
      if (message.combinedInto || !['sending', 'stopping'].includes(message.phase)) continue;
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
      rows.get(message.target.addr)?.endedAt ?? (message.phase === 'refused' ? message.refusedAt ?? at : Infinity);
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
      const resultText = (message, limit) => {
        const row = rows.get(message.target.addr);
        const result = message.completion;
        const detail = result?.body ?? (result?.unconfirmed ? `UNCONFIRMED 未确认正文\n${result.unconfirmedBody ?? ''}` :
          `FAILED ${message.issue ?? '无原生最终回复'}`);
        return `${row?.task ?? ''} ${message.target.addr}\n${terminalText(detail).slice(0, limit)}`;
      };
      function announce(delivery, kind, selected, pending = [], missing = 0, deadline = at) {
        const limit = Math.min(4000, Math.floor(32_000 / Math.max(1, selected.length)));
        const results = selected.map(message => resultText(message, limit));
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

  function orgNotices(rows) {
    const delivered = new Set(mail.messages.filter(message => message.issue !== 'target-exited' || message.received)
      .flatMap(message => message.orgEvents ?? []));
    const notices = org.notices().filter(notice => !delivered.has(notice.id));
    for (const batch of Map.groupBy(notices, notice => JSON.stringify([notice.project, notice.audience])).values()) {
      const { project: name, audience } = batch[0];
      const row = rows.findLast(row => row.project === name && row.role === audience &&
        row.endedAt === null && sessions.jobs.has(row.addr));
      if (!row) continue;
      const lines = batch.map(({ type, task, addr, value, kind, command, ...fields }) => {
        const details = type === 'fact-miss' ? `${kind} ${value}` : type === 'slow-command' ?
          `${command} ${fields.durationMs} ms (median ${fields.medianMs} ms)` :
          Object.entries(fields).filter(([key]) => !['id', 'at', 'project', 'audience'].includes(key))
            .map(([key, value]) => `${key}=${value}`).join(' ');
        return terminalText(`${type} ${task ?? addr} · ${details}`);
      }).join('\n');
      const ids = batch.map(notice => notice.id);
      const queued = mail.messages.find(message => message.orgEvents && message.target.addr === row.addr &&
        message.phase === 'queued' && !message.payloadFrozen);
      if (queued) mail.appendQueued(queued, lines, ids);
      else saved(sessions.targetBinding(row), 'Loom drift and fact checks\n' + lines, { orgEvents: ids });
    }
  }

  async function closeReviews() {
    for (const job of sessions.jobs.values()) {
      if (!job.reviewDeadline) continue;
      const row = sessions.rowFor(job.row.addr);
      if (!row) continue;
      const first = mail.messages.find(message => message.id === job.firstId);
      const result = first?.completion;
      const expired = now() >= job.reviewDeadline;
      if (!expired && !result && row.endedAt == null && first?.phase !== 'refused') continue;
      const id = batchDeliveryId(job.firstId, 'reviewer');
      if (mail.messages.some(message => message.id === id)) continue;
      if (row.endedAt == null) {
        try { await sessions.stop(row); }
        catch (error) { report(`${row.addr} reviewer stop: ${error.message}`); continue; }
      }
      const onTime = result && result.at <= job.reviewDeadline;
      const detail = onTime && result.body ? result.body : onTime && result.unconfirmedBody ?
        `UNCONFIRMED\n${result.unconfirmedBody}` :
        expired && (!onTime || row.endedAt >= job.reviewDeadline) ? 'TIMED OUT' :
          `FAILED ${result?.outcome?.failure ?? first?.issue ?? 'no native reply'}`;
      const text = `Loom reviewer ${row.addr}${row.task ? ' · ' + row.task : ''}\n\n${terminalText(detail).slice(0, 16_000)}`;
      const parent = row.parent && sessions.routeParent(row.parent);
      if (row.parent) {
        if (parent?.endedAt === null) saved(sessions.targetBinding(parent), text, { id, reviewerResult: row.addr });
      } else {
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
    let policy;
    try { policy = readPolicy(project, { optional: true }); }
    catch { policy = {}; }
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
        await stepRelay(now());
        continuations();
        seats = workerSeats(workerLimit(policy));
      },
      now,
      coalesceMs: policy.delivery?.coalesceMs ?? defaultCoalesceMs,
      canDispatch(target) {
        const job = sessions.jobs.get(target.addr);
        if (job?.row.role === 'worker') return seats.has(target.addr);
        if (!job?.reviewDeadline) return true;
        const first = mail.messages.find(message => message.id === job.firstId);
        return now() < job.reviewDeadline && !first?.completion && first?.phase !== 'refused';
      },
    });
    await closeReviews();
    const current = sessions.rows();
    await org.collect(current);
    orgNotices(current);
    health = new Map((await watcher.poll()).map(row => [row.addr, row]));
    await checkStartupBlockers();
    publishNotifications();
    await pushNotifications();
  }

  return {
    tick,
    upgradeSessions: sessions.upgradeSessions,
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
      if (command === 'notifications') {
        const names = new Set(sessions.rows().map(row => row.project));
        const actor = caller && sessions.rows().find(row => row.addr === caller || row.pane === caller);
        const name = args.project ?? actor?.project ?? (names.size <= 1 ? (names.values().next().value ?? project) : undefined);
        if (args.take && actor && actor.role !== 'super') {
          throw new CommandError('invalid-arguments', 'Only the Super takes project notifications');
        }
        if (args.complete !== undefined) {
          if (!name || !names.has(name) && name !== project || !validInput(args.complete)) {
            throw new CommandError('invalid-arguments', 'Project name and completion summary required');
          }
          notifications.add({ id: `completed:${name}`, project: name, at: now(), type: 'project-completed', text: args.complete });
        }
        if (args.decision !== undefined || args.auditEscalation !== undefined) {
          if (!name || !validInput(args.decision) || actor?.role === 'worker' ||
              (actor?.role === 'auditor' || args.auditEscalation !== undefined) &&
              (actor?.role !== 'auditor' || !auditEscalations.has(args.auditEscalation))) {
            throw new CommandError('invalid-arguments', 'A decision summary and an allowed Auditor escalation reason (for Auditor) are required');
          }
          notifications.add({ id: randomUUID(), project: name, at: now(), type: 'needs-decision', text: args.decision,
            addr: actor?.addr, reason: args.auditEscalation });
        }
        return { notifications: notifications.list(name, args.take === true, args.history === true) };
      }
      if (command === 'ls') return pendingWork(mail.messages, undefined, parentFor);
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
          ...(incident?.reason && { reason: incident.reason }),
          ...(snapshot?.writeEvidence && { writeEvidence: snapshot.writeEvidence }),
          ...(snapshot?.runtimeStatus && { runtimeStatus: snapshot.runtimeStatus }),
          deliveries: deliveries(row.addr).map(receiptFor), notifications: notifications.list(row.project),
          rotations: index.rotations().filter(item => item.project === row.project),
          ...pendingWork(mail.messages, row.addr, parentFor) };
      }
      if (command === 'stop') {
        const closed = row.endedAt !== null ? row : await sessions.stop(row);
        return { addr: row.addr, endedAt: closed.endedAt };
      }
      if (command !== 'send') throw new CommandError('invalid-arguments', 'Unknown loomd request');
      if (!validInput(args.text) || !['queue', 'steer', 'interrupt'].includes(args.mode)) {
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
            existing.requestedMode !== args.mode || existing.batchId !== args.batch || existing.batchSize !== args.batchSize) {
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
      if (args.mode === 'interrupt' && !sessions.canInterrupt(target)) {
        throw new CommandError('unsupported', 'Runtime cannot guard the requested turn at interrupt submission');
      }
      const observation = args.mode !== 'queue' && await sessions.transport.inspect(target).catch(() => undefined);
      if (observation?.state === 'finished') throw new CommandError('not-ready', 'Target has exited');
      const active = observation?.active;
      if (args.mode === 'interrupt' && !active) throw new CommandError('not-ready', 'interrupt requires an active turn');
      const mode = sessions.requestedMode(target, args.mode, active);
      const continuation = mode === 'queue' && from?.role === 'leader' && row.role === 'worker' && from.project === row.project;
      const message = saved(target, args.text, { ...(from && { from: sessions.targetBinding(from) }),
        ...(!actor || actor.role === 'super' ? { superPriority: true } : {}),
        ...(row.addr !== successor.addr && { originalTarget: row.addr }),
        ...(args.id && { id: args.id }), ...(args.batch && { batchId: args.batch, batchSize: args.batchSize }),
        ...(continuation && !args.batch && { implicitBatch: 'auto:' + randomUUID(), coalesceWindow: 0, streamContinuation: true }),
        requestedMode: args.mode, mode, active, barrier: mode === 'queue' ? active : undefined });
      return { addr: row.addr, ...receiptFor(message) };
    },
  };
}
