import { randomUUID } from 'node:crypto';
import { openStore } from './store.mjs';
import { refusals } from './tui.mjs';
import { checksDeliveryIntegrity, combinedDeliveryText, payloadDigest } from './message.mjs';

const terminalText = text => text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
const isDone = message => message.phase === 'received';
const isUrgent = message => message.superPriority || message.mode === 'interrupt';
const awaiting = message => ['sending', 'stopping'].includes(message.phase);
const rejected = message => ['refused', 'corrupted'].includes(message.phase);

export function receipt(message) {
  const { id, mode, requestedMode, createdAt, received, phase } = message;
  const issue = message.issue ?? (phase === 'sending' ? 'awaiting-native-confirmation' : undefined);
  const status = phase === 'corrupted' ? 'corrupted' : received ? { queue: 'delivered', steer: 'steered', interrupt: 'interrupted' }[mode] : 'queued';
  const deliveryStatus = phase === 'corrupted' ? 'corrupted' : message.completion?.body ? 'answered' : received ? 'delivered' :
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
  const pending = messages.filter(message => !rejected(message) &&
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
  const integrityScanned = new Set();
  const legacyCorruption = message => message.target.provider === 'claude' &&
    message.phase === 'corrupted' && message.corruption && !message.corruption.digestVersion;
  const needsIntegrity = message => checksDeliveryIntegrity(message.target) && !integrityScanned.has(message.id) &&
    (legacyCorruption(message) || isDone(message) && !message.payloadVerified);
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
    const complete = Boolean(message.completion?.body || message.completion?.noReply);
    const corrective = legacyCorruption(message);
    if (!message.attemptAt || (message.phase === 'corrupted' || complete) && !needsIntegrity(message)) return;
    const native = transport.nativeDelivery(message, observation);
    if (complete) integrityScanned.add(message.id);
    if (!native) return;
    if (corrective) {
      integrityScanned.add(message.id);
      const { at, sessionId, turnId } = message.corruption;
      if (!native.payloadVerified || native.at !== at || native.sessionId !== sessionId || native.turnId !== turnId) return;
      delete message.corruption;
    }
    if (native.corrupted) {
      message.corruption = { ...native.corrupted, at: native.at, sessionId: native.sessionId, turnId: native.turnId };
      message.phase = 'corrupted';
      message.issue = 'payload-mismatch';
      delete message.received;
      delete message.completion;
      save();
      return;
    }
    if (native.payloadVerified && !message.payloadVerified) {
      message.payloadVerified = true;
      if (isDone(message)) save();
    }
    if (complete) return;
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
    const idle = observation.state === 'idle' || message.urgent && observation.urgentReady;
    if (message.phase === 'stopped') return idle;
    if (message.mode !== 'queue') {
      if (idle ||
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
    return idle && (message.urgent || message.allowIdleWithoutEnd || !message.barrier ||
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
    if (observation.state !== 'idle' && !observation.urgentReady) return;
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

  async function send(message, observation, waves, urgent) {
    const pendingPhase = message.phase;
    message.payloadFrozen = true;
    if (waves.length) {
      message.combinedWaves = waves.map(wave => wave.id);
      for (const wave of waves) wave.combinedInto = message.id;
      if (!message.allowIdleWithoutEnd && waves.some(wave => wave.allowIdleWithoutEnd)) {
        message.allowIdleWithoutEnd = message.combinedForcesIdle = true;
      }
    }
    message.phase = 'sending';
    message.attemptAt = Date.now();
    message.writeTurn = observation.terminal.turn;
    if (observation.hostIncarnation) message.hostAttempt = observation.hostIncarnation;
    const input = { ...message, urgent, text: combinedDeliveryText(message, waves) };
    if (checksDeliveryIntegrity(message.target)) message.payloadDigest = payloadDigest(input.text);
    delete message.waitingForWritable;
    save();
    try {
      const attempt = await transport.send(input, observation);
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

  function settleCombined(group) {
    const primaries = new Map(group.filter(message => message.combinedWaves).map(message => [message.id, message]));
    let changed = false;
    for (const wave of group.filter(message => message.combinedInto)) {
      const primary = primaries.get(wave.combinedInto);
      if (!primary) continue;
      if (primary.phase === 'refused') {
        delete wave.combinedInto;
        wave.phase = 'queued';
        for (const key of ['received', 'completion', 'issue', 'refusedAt']) delete wave[key];
        if (primary.combinedForcesIdle) {
          delete primary.combinedForcesIdle;
          delete primary.allowIdleWithoutEnd;
        }
        changed = true;
        continue;
      }
      for (const field of ['phase', 'received', 'completion', 'issue', 'refusedAt', 'corruption']) {
        if (wave[field] === primary[field]) continue;
        if (wave[field] != null && JSON.stringify(wave[field]) === JSON.stringify(primary[field])) continue;
        if (primary[field] === undefined) delete wave[field];
        else wave[field] = primary[field];
        changed = true;
      }
    }
    for (const primary of primaries.values()) {
      if (group.some(wave => wave.combinedInto === primary.id)) continue;
      delete primary.combinedWaves;
      changed = true;
    }
    if (changed) save();
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

  async function observeTarget(all) {
    const observation = await inspect(all[0].target);
    if (!observation) return;
    const group = all.filter(message => !message.combinedInto);
    for (const message of group) reconcile(message, observation);
    for (const message of group) await recoverAttempt(message, observation);
    settleCombined(all);
    return observation;
  }

  async function processTarget(all, observation, { canDispatch, known, at, coalesceMs } = {}) {
    const group = all.filter(message => !message.combinedInto);
    if (!group.length || !observation) return;
    const { target } = group[0];
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
      settleCombined(all);
      return;
    }
    const queued = group.filter(message => message.phase === 'queued');
    const streams = queued.filter(message => message.streamAt != null).sort((a, b) => a.streamAt - b.streamAt);
    const receiving = group.some(message => message.phase === 'sending' || isDone(message) && !message.completion);
    const completed = group.filter(message => message.received?.at != null && message.completion?.at != null);
    const waiting = streams.filter(message => !message.streamWaited &&
      (observation.state === 'busy' || receiving || completed.some(turn =>
        message.streamAt >= turn.received.at && message.streamAt <= turn.completion.at)));
    for (const message of waiting) message.streamWaited = true;
    if (waiting.length) save();
    if (canDispatch && !canDispatch(target)) return;
    for (const message of group.filter(message => message.phase === 'stopping')) confirmStop(message, observation);
    const unsettled = group.filter(awaiting);
    const urgentOnly = unsettled.length > 0;
    const cutoff = streams[0]?.streamAt + coalesceMs;
    const overdue = streams.some(message => message.streamWaited || message.allowIdleWithoutEnd);
    const cohort = overdue ? streams : at >= cutoff ? streams.filter(message => message.streamAt <= cutoff) : [];
    const stream = cohort[0];
    const pending = queued.filter(message => (!urgentOnly || isUrgent(message)) &&
      (message.streamAt != null ? message === stream : !known || known.has(message.id)));
    const priority = pending.find(message => message.superPriority && message.mode === 'queue');
    const isWave = message => message.mode === 'queue' && (message.waveBatch || message.continuationBatch);
    const waves = priority ? queued.filter(isWave) : [];
    const forcedPriority = waves.some(wave => wave.allowIdleWithoutEnd) ? priority : undefined;
    const streamPeers = overdue ? [...cohort.slice(1), ...queued.filter(message => message.streamAt == null && isWave(message))] :
      cohort.slice(1);
    const forcedStream = [stream, ...streamPeers].some(message => message?.allowIdleWithoutEnd) ? stream : undefined;
    const forced = group.findLastIndex(message => message.allowIdleWithoutEnd && message.received);
    let next = group.find(message => message.phase === 'stopped' && (!urgentOnly || isUrgent(message))) ??
      pending.find(message => message.superPriority && message.mode !== 'queue') ??
      pending.find(message => message.mode !== 'queue') ?? pending.find(message => message.startup) ?? priority ??
      (overdue ? stream : undefined) ?? pending[0];
    if (next?.mode === 'queue' && !urgentOnly && group.some((message, index) => index >= forced && isDone(message) && !message.completion &&
      !transport.deliveryTurnReplaced?.(message, observation) &&
      !group.some(item => item.stoppedAt && item.stoppedAt >= message.attemptAt &&
        (message.received.streamId ? item.active.streamId === message.received.streamId &&
          item.active.turnId === message.received.turnId : item.active.hcTurn === message.writeTurn)))) {
      next = pending.find(message => message.startup && message.allowIdleWithoutEnd) ?? forcedPriority ?? forcedStream ??
        pending.find(message => message.allowIdleWithoutEnd && message.superPriority) ??
        pending.find(message => message.allowIdleWithoutEnd);
    }
    if (!next) return;
    // A sealed turn or a fresh interrupt guard still applies. Escalate the
    // unresolved write without replaying it or merging wave results into it.
    const urgent = urgentOnly && isUrgent(next);
    if (next.mode === 'interrupt' && next.phase === 'queued' && unsettled.some(message =>
      message.phase === 'stopping' && !message.issue?.startsWith('uncertain') &&
      transport.sameTurn(message.active, next.active))) return;
    const combined = next.payloadFrozen || next.combinedWaves ? (next.combinedWaves ?? [])
      .map(id => all.find(message => message.id === id)).filter(Boolean) :
      next === priority && !urgent ? waves : next === stream && !urgent ? streamPeers : [];
    const frame = urgent ? { ...next, urgent } : (next === forcedPriority || next === forcedStream) && !next.allowIdleWithoutEnd &&
      combined.some(message => message.allowIdleWithoutEnd) ?
      { ...next, allowIdleWithoutEnd: true } : next;
    if (!ready(frame, observation, group)) return recordWait(next, observation);
    const fresh = await inspect(target);
    if (!fresh) return;
    if (!ready(frame, fresh, group)) return recordWait(next, fresh);
    if (urgent) {
      for (const message of unsettled) escalate(message, at);
    }
    if (next.mode === 'interrupt' && next.phase === 'queued') await stop(next, fresh);
    else await send(next, fresh, combined, urgent);
    settleCombined(all);
  }

  async function step(routeTarget, { beforeDispatch, canDispatch, now = Date.now, coalesceMs = 0 } = {}) {
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
    const groups = () => Map.groupBy(messages, ({ target }) => JSON.stringify([target.addr, target.createdAt, target.pid]));
    const active = [...groups()].filter(([, group]) =>
      group.some(message => needsIntegrity(message) || !rejected(message) &&
        (!isDone(message) || !(message.completion?.body || message.completion?.noReply))));
    if (beforeDispatch) {
      const known = new Set(messages.map(message => message.id));
      const observed = new Map(await Promise.all(active.map(async ([key, group]) => [key, await observeTarget(group)])));
      await beforeDispatch();
      const at = now();
      await Promise.all([...groups()].filter(([key, group]) => observed.has(key) ||
        group.some(message => !known.has(message.id) && message.streamAt != null)).map(async ([key, group]) =>
        processTarget(group, observed.has(key) ? observed.get(key) : await observeTarget(group),
          { canDispatch, known, at, coalesceMs })));
    } else {
      await Promise.all(active.map(async ([, group]) => processTarget(group, await observeTarget(group),
        { canDispatch, at: now(), coalesceMs })));
    }
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

  function appendQueued(message, text, ids) {
    const previous = { text: message.text, orgEvents: message.orgEvents };
    message.text += '\n' + text;
    message.orgEvents = [...message.orgEvents, ...ids];
    try { save(); } catch (error) { Object.assign(message, previous); throw error; }
  }

  function refuseQueued(message, issue) {
    if (message.phase !== 'queued') return;
    message.phase = 'refused';
    message.issue = issue;
    save();
  }

  function escalate(message, bypassAt) {
    if (bypassAt != null && message.bypassedAt == null) {
      message.bypassedAt = bypassAt;
      message.issue ??= message.phase === 'stopping' ? 'uncertain-stop' : 'uncertain';
      save();
    }
    if (message.issue?.startsWith('uncertain')) return;
    message.issue = message.phase === 'stopping' ? 'uncertain-stop-timeout' : 'uncertain-timeout';
    save();
  }

  return { step, routesForTurn, enqueue, appendQueued, refuseQueued, escalate, messages };
}
