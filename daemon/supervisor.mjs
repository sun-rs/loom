import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { CommandError } from '../cli/sessions.mjs';
import { projectIndex } from '../cli/project.mjs';
import { inbox, pendingWork, receipt } from '../inbox/engine.mjs';
import { isBlockedReply, messageIdPattern } from '../inbox/message.mjs';
import { relay } from '../relay/project.mjs';
import { createWatcher } from '../watch/index.mjs';
import { ownedSessions, validInput } from './sessions.mjs';
import { jsonRows, prepareJournal, readText } from './io.mjs';
import { notifyExternal, projectNotifications } from './notifications.mjs';

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
      if (superSession) {
        const details = [...new Set(batch.map(event => terminalText(event.text ??
          `${event.type} ${event.addr ?? ''} ${event.reason ?? ''}`.trim()).slice(0, 4000)))];
        const heading = `Loom 项目通知：${[...new Set(batch.map(event => event.type))].join(', ')}`;
        saved(sessions.targetBinding(superSession), [heading, ...details].join('\n\n').slice(0, 16_000),
          { id, projectEvents: batch.map(event => event.id) });
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
    readHooks: row => sessions.events(row.addr),
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
    row.wave !== worker.wave && row.startedAt > worker.startedAt);
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
        const sealed = stepRelay.isSealed(row.parent, row.project, row.wave) || await sessions.sealed(row.parent, job.gate);
        return { id: row.task, addr: row.addr, provider: row.cli, wave: row.wave, managed: {
          parent: row.parent, project: row.project, startedAt: row.startedAt, activityAt, reply,
          superseded: superseded(row, rows), sealed,
        } };
      }));
    },
    async deliver(addr, batch) {
      const row = sessions.routeParent(addr);
      if (!row) throw new Error(`No wave recipient ${addr}`);
      const late = batch.lateWorker && sessions.rowFor(batch.lateWorker);
      if (late && superseded(late, workers())) return;
      saved(sessions.targetBinding(row), batch.message, { id: batchDeliveryId(batch.id, addr), waveBatch: batch.id, waveKey: batch.waveKey, waveKind: batch.waveKind,
        ...(late && { lateWorker: late.addr }), ...(batch.forcedSeal && { allowIdleWithoutEnd: true }) });
    },
  });

  async function checkWave(parent, name, wave, gate) {
    const prior = [...sessions.jobs.values()].filter(job => job.row.role === 'worker' && job.row.parent === parent &&
      job.row.project === name && job.row.wave === wave);
    if (stepRelay.isSealed(parent, name, wave) || prior.some(job => now() >= job.row.startedAt + sealWindow ||
        (Boolean(gate) !== Boolean(job.gate) || (gate && !sessions.transport.sameTurn(job.gate, gate))))) {
      throw new CommandError('wave-sealed', 'Use a new wave for later dispatch');
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
      if (!['sending', 'stopping'].includes(message.phase)) continue;
      const at = message.attemptAt ?? message.stopAttemptAt;
      if (!at || now() - at < uncertainWindow) continue;
      const row = sessions.rowFor(message.target.addr);
      if (!row) continue;
      mail.escalate(message);
      const id = `${message.id}:uncertain`;
      const text = `Loom 投递 UNCERTAIN ${message.id}\n目标 ${row.addr}，请核对原生记录。`;
      const parent = sessions.routeParent(message.from?.addr ?? row.parent);
      if (parent && parent.addr !== row.addr && parent.endedAt === null && !message.uncertainOf) {
        saved(sessions.targetBinding(parent), text, { id: batchDeliveryId(id, parent.addr), uncertainOf: message.id });
      }
      notifications.add({ id, type: 'delivery-uncertain', project: row.project, addr: row.addr, at: at + uncertainWindow,
        deliveryId: message.id, text, ...((message.projectEvents || message.uncertainOf) && { logOnly: true }) });
    }
  }

  function implicitContinuation(from) {
    const previous = mail.messages.findLast(message => message.implicitBatch && parentFor(message.from?.addr) === from);
    if (!previous) return 'auto:' + randomUUID();
    const first = mail.messages.find(message => message.implicitBatch === previous.implicitBatch);
    const closed = batchDeliveryId(first.implicitBatch, first.from.addr);
    if (now() >= first.createdAt + window || mail.messages.some(message => message.id === closed)) return 'auto:' + randomUUID();
    return first.implicitBatch;
  }

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

  async function tick() {
    await sessions.refresh(mail);
    for (const job of sessions.jobs.values()) {
      await sessions.retirePredecessor(job).catch(error => report(`handover retirement: ${error.message}`));
    }
    const rows = workers();
    for (const message of mail.messages.filter(message => message.lateWorker && message.phase === 'queued')) {
      const old = rows.find(row => row.addr === message.lateWorker);
      if (old && superseded(old, rows)) mail.refuseQueued(message, 'superseded');
    }
    const routed = new Map();
    await mail.step(({ id, target: { addr } }) => {
      if (id === sessions.jobs.get(addr)?.firstId) return;
      if (!routed.has(addr)) {
        const row = sessions.routeParent(addr);
        routed.set(addr, row?.addr !== addr && row?.endedAt === null ? sessions.targetBinding(row) : undefined);
      }
      return routed.get(addr);
    });
    await stepRelay(now());
    continuations();
    health = new Map((await watcher.poll()).map(row => [row.addr, row]));
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
      if (command === 'spawn') {
        const job = await sessions.newJob(args, caller, checkWave);
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
        return { session, deliveryId: job.firstId, requested: job.requested, ...sessions.runtimeSelection(session),
          ...(handoff && { handoff }), ...(job.handoverFrom && { handoverFrom: job.handoverFrom }),
          ...(retired && { retired: retired.addr }), ...(retirementIssue && { retirementIssue }) };
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
      const row = sessions.resolve(args.target, caller);
      if (command === 'handover') {
        const old = sessions.rowFor(args.from);
        if (!validInput(args.text)) throw new CommandError('invalid-arguments', 'Handover brief is required');
        let delivery;
        sessions.bindSuccessor(old, row, () => {
          delivery = saved(sessions.targetBinding(row), args.text, { id: batchDeliveryId(old.addr, row.addr) });
        });
        if (old.endedAt === null && sessions.jobs.has(old.addr)) await sessions.retirePredecessor(sessions.jobs.get(row.addr));
        return receiptFor(delivery);
      }
      if (command === 'state') {
        const incident = health.get(row.addr);
        const tui = sessions.jobs.get(row.addr)?.tui;
        const snapshot = row.endedAt === null && await sessions.transport.inspect(sessions.targetBinding(row)).catch(() => undefined);
        return { addr: row.addr, state: row.endedAt !== null ? 'exited' :
          incident?.state === 'needs-you' ? 'stuck' : snapshot?.state ?? 'unknown',
          ...(tui && { transport: tui.transport, ...(tui.reason && { transportReason: tui.reason }) }),
          ...(incident?.reason && { reason: incident.reason }),
          ...(snapshot?.writeEvidence && { writeEvidence: snapshot.writeEvidence }),
          ...(snapshot?.runtimeStatus && { runtimeStatus: snapshot.runtimeStatus }),
          deliveries: deliveries(row.addr).map(receiptFor), notifications: notifications.list(row.project),
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
        ...(row.addr !== successor.addr && { originalTarget: row.addr }),
        ...(args.id && { id: args.id }), ...(args.batch && { batchId: args.batch, batchSize: args.batchSize }),
        ...(continuation && { coalesceWindow: blockedWindow }),
        ...(continuation && !args.batch && { implicitBatch: implicitContinuation(from.addr) }),
        requestedMode: args.mode, mode, active, barrier: mode === 'queue' ? active : undefined });
      return { addr: row.addr, ...receiptFor(message) };
    },
  };
}
