import { randomUUID } from 'node:crypto';
import { openStore } from './store.mjs';
import { refusals } from './tui.mjs';

const terminalText = text => text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
const isDone = message => message.phase === 'received';

export function receipt(message) {
  const { id, mode, requestedMode, createdAt, received, phase } = message;
  const issue = message.issue ?? (phase === 'sending' ? 'awaiting-native-confirmation' : undefined);
  const status = received ? { queue: 'delivered', steer: 'steered', interrupt: 'interrupted' }[mode] : 'queued';
  const deliveryStatus = message.completion?.body ? 'answered' : received ? 'delivered' :
    phase === 'refused' ? 'refused' : message.issue?.startsWith('uncertain') ? 'uncertain' : 'accepted';
  return {
    id, status, deliveryStatus, at: received?.at ?? createdAt, requestedMode, mode,
    downgraded: requestedMode !== mode,
    ...(message.target.tui?.transport && { transport: message.target.tui.transport }),
    ...(message.target.tui?.reason && { transportReason: message.target.tui.reason }),
    ...(message.waitingForWritable && { waitingForWritable: message.waitingForWritable }),
    ...(message.completion?.unconfirmed && { replyStatus: 'unconfirmed' }),
    ...(issue ? { issue } : {}),
  };
}

export function pendingWork(messages, addr, parentFor = value => value) {
  const pending = messages.filter(message => message.phase !== 'refused' &&
    !message.completion?.body && !message.completion?.noReply);
  const relevant = message => !addr || parentFor(message.target.addr) === addr || parentFor(message.from?.addr) === addr;
  const groups = Map.groupBy(messages.filter(message => message.batchId || message.implicitBatch),
    message => message.batchId ?? message.implicitBatch);
  const ids = new Set(pending.map(message => message.id));
  const summaries = Map.groupBy(messages.filter(message => message.continuationBatch), message => message.continuationBatch);
  const pendingContinuations = [];
  for (const [batch, members] of groups) {
    const first = members[0];
    const parent = parentFor(first.from?.addr);
    if (addr && addr !== parent && !members.some(message => message.target.addr === addr)) continue;
    const expected = first.batchSize ?? members.length;
    const waiting = members.filter(message => ids.has(message.id));
    const results = summaries.get(batch) ?? [];
    const final = results.some(message => message.continuationKind ?
      ['merged', 'timeout'].includes(message.continuationKind) : !message.text.split('\n', 1)[0].endsWith('（阻塞）'));
    if (!waiting.length && final) continue;
    pendingContinuations.push({ batch, parent, createdAt: first.createdAt, expected, submitted: members.length,
      pending: waiting.map(message => ({ addr: message.target.addr, deliveryId: message.id, phase: message.phase })) });
  }
  return { pendingContinuations, pendingDeliveries: pending.filter(relevant).map(message => ({
    ...receipt(message), phase: message.phase, target: parentFor(message.target.addr),
    ...(message.from && { from: parentFor(message.from.addr) }),
  })) };
}

// The adapter-facing transport supplies pane binding, events and native input.
// A headless runtime can supply the same operations when it owns its event stream.
export function inbox(project, transport, report = console.error) {
  const store = openStore(project);
  const { messages, save } = store;
  const recovering = messages.filter(message =>
    (message.phase === 'sending' && !message.typedAt || message.phase === 'stopping' && !message.stopKeySent) && !message.issue);
  for (const message of recovering) message.issue = message.phase === 'sending' ? 'uncertain' : 'uncertain-stop';
  if (recovering.length) save();

  function route(message, completion) {
    const { from, target } = message;
    if (!from || !completion.body || message.batchId || message.implicitBatch) return;
    if (messages.some(item => item.waveParent === from.addr && item.target.addr === target.addr &&
        item.completion?.sessionId === completion.sessionId && item.completion?.turnId === completion.turnId)) return;
    const key = JSON.stringify([target.addr, target.createdAt, completion.sessionId,
      completion.turnId ?? completion.at, from.addr, from.createdAt]);
    if (messages.some(item => item.replyKey === key)) return;
    messages.push({
      id: randomUUID(), replyKey: key, replyTo: message.id, createdAt: Date.now(), target: from,
      requestedMode: 'queue', mode: 'queue', phase: 'queued',
      text: `Loom reply from ${target.addr} (${message.id})\n\n${terminalText(completion.body)}`,
    });
  }

  function reconcile(message, observation) {
    if (!message.attemptAt || message.completion?.body || message.completion?.noReply) return;
    const native = transport.nativeDelivery(message, observation);
    if (!native) return;
    if (native.dropped) {
      if (isDone(message)) return;
      message.issue = 'input-dropped';
      message.phase = 'refused';
      message.refusedAt = Date.now();
      save();
      return;
    }
    if (!isDone(message)) {
      const turn = message.active;
      if (message.mode === 'steer' && turn?.turnId && (turn.turnId !== native.turnId || turn.sessionId !== native.sessionId)) {
        message.mode = 'queue';
        message.issue = 'target-turn-ended';
      } else {
        delete message.issue;
      }
      message.received = { at: native.at, sessionId: native.sessionId, turnId: native.turnId, streamId: native.streamId };
      message.phase = 'received';
      save();
    }
    const completion = native.completion;
    if (completion && (!message.completion || completion.body || completion.noReply)) {
      message.completion = completion;
      route(message, completion);
      save();
    }
  }

  function targetTurnEnded(message) {
    message.issue = 'target-turn-ended';
    if (message.mode === 'interrupt') {
      message.phase = 'refused';
    } else {
      message.mode = 'queue';
      message.barrier ??= message.active;
      message.phase = 'queued';
    }
    save();
  }

  function barrierPassed(barrier, observation, group) {
    return transport.turnEnd(barrier, observation) ||
      transport.turnReplaced?.(barrier, observation) ||
      group.some(message => message.allowIdleWithoutEnd && message.received && message.attemptAt > barrier.since) ||
      group.some(message => message.stoppedAt && transport.sameTurn(barrier, message.active));
  }

  function ready(message, observation, group) {
    if (message.phase === 'stopped') return observation.state === 'idle';
    if (message.mode !== 'queue') {
      if (observation.state === 'idle' ||
          (observation.state === 'busy' && !transport.sameTurn(message.active, observation.active))) {
        targetTurnEnded(message);
        return false;
      }
      return message.mode !== 'queue' && observation.state === 'busy';
    }
    if (observation.state === 'busy' &&
        (!message.barrier || (!transport.sameTurn(message.barrier, observation.active) && barrierPassed(message.barrier, observation, group)))) {
      message.barrier = observation.active;
      save();
    }
    return observation.state === 'idle' && (message.allowIdleWithoutEnd || !message.barrier ||
      barrierPassed(message.barrier, observation, group));
  }

  async function stop(message, observation) {
    message.phase = 'stopping';
    message.stopAttemptAt ??= Date.now();
    if (observation.hostIncarnation) message.hostStopAttempt = observation.hostIncarnation;
    save();
    try {
      await transport.interrupt(message, transport.plan(message.target.provider, 'interrupt').stop, observation);
    } catch (error) {
      if (refusals.has(error.kind)) message.phase = 'queued';
      else if (error.kind === 'input-refused') {
        message.phase = 'refused';
        message.issue = 'unsupported-interrupt';
      } else message.issue = 'uncertain-stop';
      save();
      report(error.message);
      return;
    }
    message.stopKeySent = true;
    save();
  }

  function confirmStop(message, observation) {
    if (observation.state === 'busy' && !transport.sameTurn(message.active, observation.active)) {
      targetTurnEnded(message);
      return;
    }
    if (observation.state !== 'idle') return;
    const ended = transport.turnEnd(message.active, observation);
    if (ended && !ended.canceled) {
      targetTurnEnded(message);
      return;
    }
    if (!ended && observation.terminal.turn <= message.active.hcTurn) return;
    if (!ended && observation.strictEnd) return;
    if (!message.stopKeySent && !ended?.canceled) return;
    message.phase = 'stopped';
    message.stoppedAt = Date.now();
    delete message.issue;
    save();
  }

  async function send(message, observation) {
    const pendingPhase = message.phase;
    message.phase = 'sending';
    message.attemptAt = Date.now();
    message.writeTurn = observation.terminal.turn;
    if (observation.hostIncarnation) message.hostAttempt = observation.hostIncarnation;
    delete message.waitingForWritable;
    save();
    try {
      const attempt = await transport.send(message, observation);
      if (attempt?.requestId) message.nativeAttempt = attempt;
    } catch (error) {
      if (error.kind === 'steer-unavailable') {
        message.mode = 'queue';
        message.barrier = message.active;
        message.phase = pendingPhase;
        delete message.attemptAt;
        save();
        return;
      }
      if (refusals.has(error.kind)) {
        message.phase = pendingPhase;
        delete message.attemptAt;
        delete message.nativeAttempt;
        delete message.typedAt;
        if (['human-active', 'frame-changed'].includes(error.kind)) {
          message.waitingForWritable = { ...observation.writeEvidence, reason: error.kind };
        }
      } else {
        message.issue = error.kind === 'input-refused' ? 'input-refused' : 'uncertain';
        if (error.kind === 'input-refused') message.phase = 'refused';
      }
      save();
      report(error.message);
      return;
    }
    message.typedAt = Date.now();
    save();
  }

  async function inspect(target) {
    try {
      return await transport.inspect(target);
    } catch (error) {
      report(error.message);
    }
  }

  function recordWait(message, observation) {
    const evidence = observation.writeEvidence;
    if (!evidence || observation.state === 'idle' ||
        JSON.stringify(evidence) === JSON.stringify(message.waitingForWritable)) return;
    message.waitingForWritable = evidence;
    save();
  }

  async function recoverAttempt(message, observation) {
    const stopping = message.phase === 'stopping' && !message.stopKeySent && message.hostStopAttempt;
    const sending = message.phase === 'sending' && !message.typedAt && message.hostAttempt;
    if ((!stopping && !sending) || !transport.recoverAttempt) return;
    let result;
    try { result = await transport.recoverAttempt(message, observation); }
    catch (error) { report(error.message); return; }
    if (!result || !['absent', 'refused', 'accepted'].includes(result.status)) return;
    if (result.status === 'accepted') {
      if (stopping) message.stopKeySent = true;
      else {
        message.typedAt = result.at;
        message.nativeAttempt = { streamId: result.streamId, requestId: result.result?.requestId, seq: result.result?.seq };
      }
    } else if (result.kind === 'input-refused') {
      message.phase = 'refused';
      message.issue = stopping ? 'unsupported-interrupt' : 'input-refused';
      message.refusedAt = Date.now();
      save();
      return;
    } else {
      message.phase = sending && message.mode === 'interrupt' ? 'stopped' : 'queued';
      if (stopping) delete message.stopAttemptAt;
      else {
        delete message.attemptAt;
        if (result.kind === 'steer-unavailable') {
          message.mode = 'queue';
          message.barrier = message.active;
        }
      }
    }
    delete message.issue;
    save();
  }

  async function processTarget(group) {
    const { target } = group[0];
    const observation = await inspect(target);
    if (!observation) return;
    for (const message of group) reconcile(message, observation);
    for (const message of group) await recoverAttempt(message, observation);
    if (observation.state === 'finished') {
      let changed = false;
      for (const message of group) {
        if (['queued', 'stopped'].includes(message.phase)) {
          message.phase = 'refused';
          message.refusedAt = Date.now();
          message.issue = 'target-exited';
          changed = true;
        } else if (['sending', 'stopping'].includes(message.phase) && !message.issue?.endsWith('target-exited') &&
            (!message.issue?.startsWith('uncertain') || observation.tui?.transport === 'loom-pty')) {
          message.issue = message.phase === 'sending' ? 'uncertain-target-exited' : 'uncertain-stop-target-exited';
          changed = true;
        }
      }
      if (changed) save();
      return;
    }
    if (group.some(message => message.phase === 'sending')) return;
    const stopping = group.find(message => message.phase === 'stopping');
    if (stopping) confirmStop(stopping, observation);
    if (stopping?.phase === 'stopping') return;
    const pending = group.filter(message => message.phase === 'queued');
    const forced = group.findLastIndex(message => message.allowIdleWithoutEnd && message.received);
    let next = group.find(message => message.phase === 'stopped') ??
      pending.find(message => message.mode !== 'queue') ?? pending[0];
    if (next?.mode === 'queue' && group.some((message, index) => index >= forced && isDone(message) && !message.completion &&
      !transport.deliveryTurnReplaced?.(message, observation) &&
      !group.some(item => item.stoppedAt && item.stoppedAt >= message.attemptAt &&
        (message.received.streamId ? item.active.streamId === message.received.streamId &&
          item.active.turnId === message.received.turnId : item.active.hcTurn === message.writeTurn)))) {
      next = pending.find(message => message.allowIdleWithoutEnd);
    }
    if (!next) return;
    if (!ready(next, observation, group)) return recordWait(next, observation);
    const fresh = await inspect(target);
    if (!fresh) return;
    if (!ready(next, fresh, group)) return recordWait(next, fresh);
    if (next.mode === 'interrupt' && next.phase === 'queued') await stop(next, fresh);
    else await send(next, fresh);
  }

  async function step(routeTarget) {
    store.ingest();
    let changed = false;
    for (const message of messages) {
      const pending = message.phase === 'queued' || message.phase === 'refused' && message.issue === 'target-exited';
      if (!pending || message.attemptAt != null || message.stopAttemptAt != null || message.mode !== 'queue' ||
          message.requestedMode !== 'queue' || message.startup || message.watchResume) continue;
      const target = routeTarget?.(message);
      if (!target || target.addr === message.target.addr) continue;
      message.originalTarget ??= message.target.addr;
      message.target = target;
      message.phase = 'queued';
      for (const key of ['active', 'barrier', 'issue', 'refusedAt', 'waitingForWritable']) delete message[key];
      changed = true;
    }
    if (changed) save();
    const groups = Map.groupBy(messages, ({ target }) => JSON.stringify([target.addr, target.createdAt, target.pid]));
    await Promise.all([...groups.values()].filter(group =>
      group.some(message => message.phase !== 'refused' &&
        (!isDone(message) || !(message.completion?.body || message.completion?.noReply))))
      .map(group => processTarget(group.sort((a, b) => Number(Boolean(b.startup)) - Number(Boolean(a.startup))))));
  }

  function routesForTurn(addr, reply) {
    const related = messages.filter(({ target, completion }) => target.addr === addr &&
      completion && completion.sessionId === reply.sessionId &&
      (completion.at === reply.at || (reply.turnId && completion.turnId === reply.turnId)));
    if (related.length) return [...new Set(related.flatMap(message =>
      message.from && message.completion.body ? [message.from.addr] : []))];
  }

  function enqueue(message) {
    const existing = messages.find(item => item.id === message.id);
    if (existing) return existing;
    messages.push(message);
    try { save(); } catch (error) { messages.pop(); throw error; }
    return message;
  }

  function refuseQueued(message, issue) {
    if (message.phase !== 'queued') return;
    message.phase = 'refused';
    message.issue = issue;
    save();
  }

  function escalate(message) {
    if (message.issue?.startsWith('uncertain')) return;
    message.issue = message.phase === 'stopping' ? 'uncertain-stop-timeout' : 'uncertain-timeout';
    save();
  }

  return { step, routesForTurn, enqueue, refuseQueued, escalate, messages };
}
