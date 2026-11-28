import { promptKind } from '../adapters/prompt-state.mjs';
import { randomUUID } from 'node:crypto';
import { openStore } from './store.mjs';
import { refusals } from './tui.mjs';
import { checksDeliveryIntegrity, combinedDeliveryText, deliveryFailed, payloadDigest, replyConclusion, wireText } from './message.mjs';
import { replyForDelivery } from './reply-file.mjs';
import { defaultReplyBytes } from '../cli/policy.mjs';
import { maxSkillModules } from '../lib/role-skill.mjs';

export const defaultStallMs = 120_000;
const awaitingDelivery = message => !message.received && !deliveryFailed(message);
export const stalledDelivery = message => awaitingDelivery(message) && message.stalledAt != null;

function deliveryAge(message, at) {
  return Math.max(0, at - message.createdAt);
}

export function stalledDeliveries(messages, at = Date.now()) {
  return messages.filter(stalledDelivery).map(message => ({
    id: message.id, target: message.target.addr, from: message.from?.addr,
    reason: message.pendingReason ?? 'uncertain', ageMs: deliveryAge(message, at), stalledAt: message.stalledAt,
  })).sort((a, b) => b.ageMs - a.ageMs);
}

export const stallText = ({ id, target, reason, ageMs }) =>
  `your message ${id} to ${target} is not received (${reason}, ${Math.floor(ageMs / 1000)}s)`;

export function suppressedReplies(messages) {
  return messages.flatMap(({ id, from, target, completion, expectReply }) => expectReply && completion?.relay?.status === 'suppressed' ?
    [{ id, from: from?.addr, target: target.addr, at: completion.at, reason: completion.relay.reason }] : []);
}

export const suppressedReplyText = ({ id, reason }) => `reply to ${id} suppressed (${reason})`;

const isDone = message => message.phase === 'received';
const targetScope = ({ target }) => JSON.stringify([target.addr, target.createdAt, target.pid]);
const isUrgent = message => message.superPriority || message.mode === 'interrupt';
const awaiting = message => ['sending', 'stopping'].includes(message.phase);
const pendingReply = message => !deliveryFailed(message) && !message.completion?.body && !message.completion?.noReply;
const mayReroute = message => (['queued', 'target-ended'].includes(message.phase) ||
  message.phase === 'refused' && message.issue === 'target-exited') &&
  message.attemptAt == null && message.stopAttemptAt == null && message.mode === 'queue' &&
  (message.requestedMode === 'queue' || message.queuedForHandover === true) && !message.startup && !message.watchResume;
const providerFailures = new Set(['request-timeout', 'runtime-exited', 'retry-exhausted', 'provider-overloaded', 'holder-partial-write']);

export function receipt(message, at = Date.now()) {
  const { id, mode, requestedMode, createdAt, received, phase } = message;
  const issue = message.issue ?? (phase === 'sending' ? 'awaiting-native-confirmation' : undefined);
  const status = ['corrupted', 'refused', 'target-ended'].includes(phase) ? phase :
    received ? { queue: 'delivered', steer: 'steered', interrupt: 'interrupted' }[mode] : 'queued';
  const deliveryStatus = deliveryFailed(message) ? phase : stalledDelivery(message) ? 'stalled' :
    message.completion?.body ? 'answered' : received ? 'delivered' :
      message.issue?.startsWith('uncertain') ? 'uncertain' : 'accepted';
  return {
    id, status, deliveryStatus, at: received?.at ?? createdAt, requestedMode, mode,
    downgraded: requestedMode !== mode,
    ...(awaitingDelivery(message) && { ageMs: deliveryAge(message, at), reason: message.pendingReason ??
      (phase === 'sending' || phase === 'stopping' ? 'uncertain' : 'waiting-writable') }),
    ...(stalledDelivery(message) && { stalledAt: message.stalledAt }),
    ...(message.target.tui?.transport && { transport: message.target.tui.transport }),
    ...(message.target.tui?.reason && { transportReason: message.target.tui.reason }),
    ...(message.waitingForWritable && { waitingForWritable: message.waitingForWritable }),
    ...(message.partialWrite && { partialWrite: message.partialWrite }),
    ...(message.completion?.unconfirmed && { replyStatus: 'unconfirmed' }),
    ...(message.expectReply && message.completion?.relay && { relay: message.completion.relay }),
    ...(issue ? { issue } : {}),
  };
}

export function pendingWork(messages, addr, parentFor = value => value, targetEnded = () => false) {
  const pending = messages.filter(message => pendingReply(message) && (!targetEnded(message.target.addr) ||
    mayReroute(message) && !targetEnded(parentFor(message.target.addr))));
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
export function inbox(project, transport, report = console.error, { replyLimit, isSeniorSender } = {}) {
  const store = openStore(project);
  const { messages, save } = store;
  const integrityScanned = new Set();
  function legacyAgyBatchDigests(message) {
    if (message.target.provider !== 'agy' || !message.combinedWaves?.length ||
        message.waveSeparator || message.wireBody !== undefined || message.orgAppendix) return;
    const peers = message.combinedWaves.map(id => messages.find(item => item.id === id));
    if (peers.some(peer => peer?.combinedInto !== message.id) ||
        payloadDigest(combinedDeliveryText(message, peers)) !== message.payloadDigest) return;
    // Pilot-2's segmented composer consumed one newline at a Loom-inserted
    // result boundary. Compare only that exact byte change, never body whitespace.
    const bodies = [message, ...peers].map(item => item.text);
    const headings = message.superPriority ? ['Loom Super message', bodies.shift(), '--- Loom wave results ---'] :
      ['Loom worker results', bodies.shift()];
    const first = headings.join('\n\n');
    const parts = [first, ...bodies];
    return peers.map((_, index) => payloadDigest(parts.slice(0, index + 1).join('\n\n') +
      '\n' + parts.slice(index + 1).join('\n\n')));
  }
  function legacyAgySkillDigests({ wireBody, payloadFrozen, payloadDigest: expected, skillModules: names }) {
    if (!payloadFrozen || typeof wireBody !== 'string' || !Array.isArray(names) || !names.length || names.length > maxSkillModules ||
        payloadDigest(wireBody) !== expected) return [];
    // The recorded module names identify appended headers at the end of the frozen input.
    // Permit losing one LF at each of those separators while hashing every other byte.
    const headers = [...wireBody.matchAll(/\n\n\[loom-skill:([a-z0-9-]+)\]\n/g)].slice(-names.length);
    if (headers.length !== names.length || headers.some((header, index) => header[1] !== names[index])) return [];
    const variants = [wireBody];
    for (const { index } of headers.reverse()) {
      variants.push(...variants.map(body => body.slice(0, index) + body.slice(index + 1)));
    }
    return variants.slice(1).map(payloadDigest);
  }
  const agyCompatibleDigests = message => message.target.provider === 'agy' ?
    [...(legacyAgyBatchDigests(message) ?? []), ...legacyAgySkillDigests(message)] : [];
  const legacyCorruption = message => message.phase === 'corrupted' && message.corruption &&
    (message.target.provider === 'claude' && !message.corruption.digestVersion ||
      agyCompatibleDigests(message).includes(message.corruption.observed));
  const needsIntegrity = message => checksDeliveryIntegrity(message.target) && !integrityScanned.has(message.id) &&
    (legacyCorruption(message) || isDone(message) && !message.payloadVerified);
  const recovering = messages.filter(message =>
    (message.phase === 'sending' && !message.typedAt || message.phase === 'stopping' && !message.stopKeySent) && !message.issue);
  for (const message of recovering) message.issue = message.phase === 'sending' ? 'uncertain' : 'uncertain-stop';
  if (recovering.length) save();

  function route(message, completion) {
    const { from, target } = message;
    const suppress = reason => ({ relay: { status: 'suppressed', reason } });
    if (!from) return suppress('no-sender');
    if (message.replyKey || message.replyTo) return suppress('automatic-reply');
    if (message.batchId || message.implicitBatch) return suppress('continuation-batch');
    if (completion.unconfirmed) return suppress('unconfirmed');
    if (from.external && from.addr === 'super') return { relay: { status: 'notification' } };
    const conclusion = replyConclusion(completion.body);
    const fallback = conclusion.reason === 'missing-tag' && (message.gatePacket || isSeniorSender?.(from.addr));
    if (!conclusion.tag && !fallback) return suppress(conclusion.reason);
    if (messages.some(item => item.waveParent === from.addr && item.target.addr === target.addr &&
        item.completion?.sessionId === completion.sessionId && item.completion?.turnId === completion.turnId)) return suppress('wave-result');
    const key = JSON.stringify([target.addr, target.createdAt, completion.sessionId,
      completion.turnId ?? completion.at, from.addr, from.createdAt]);
    if (messages.some(item => item.replyKey === key)) return suppress('duplicate-turn');
    const reply = {
      id: randomUUID(), replyKey: key, replyTo: message.id, createdAt: Date.now(), target: from, from: target,
      requestedMode: 'queue', mode: 'queue', phase: 'queued',
      text: `Loom reply from ${target.addr} (${message.id})\n\n${fallback ? '未带结论标签\n\n' + completion.body : conclusion.body}`,
    };
    return { relay: { status: 'queued', deliveryId: reply.id }, reply };
  }

  function reconcile(message, observation) {
    const complete = Boolean(message.completion?.body || message.completion?.noReply);
    const corrective = legacyCorruption(message);
    if (message.phase === 'target-ended' || !(message.attemptAt || message.phase === 'stopping' && message.stopAttemptAt) ||
        (message.phase === 'corrupted' || complete) && !needsIntegrity(message) ||
        message.phase === 'refused' && providerFailures.has(message.issue)) return;
    const partial = observation.writeEvidence?.failedPartialWrite;
    if (message.phase === 'sending' && partial?.id === message.id) {
      const { written, total, reason } = partial;
      message.partialWrite = { written, total, reason };
      return failRequest(message, 'holder-partial-write');
    }
    const compatibleDigests = agyCompatibleDigests(message);
    const native = transport.nativeDelivery(compatibleDigests.length ? { ...message, compatibleDigests } : message, observation);
    if (complete) integrityScanned.add(message.id);
    if (!native) return;
    if (native.failed) {
      if (native.failed === 'runtime-exited' && observation.state === 'finished') return;
      failRequest(message, native.failed, native.at);
      return;
    }
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
    delete message.providerPendingUntil;
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
      delete message.pendingReason;
      delete message.waitingForWritable;
      save();
    }
    const completion = native.completion;
    if (completion && (!message.completion || completion.body || completion.noReply)) {
      const previous = message.completion;
      const { relay, reply } = message.expectReply ? route(message, completion) : {};
      message.completion = relay ? { ...completion, relay } : completion;
      if (reply) messages.push(reply);
      try { save(); } catch (error) {
        if (reply) messages.pop();
        if (previous) message.completion = previous;
        else delete message.completion;
        throw error;
      }
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

  function failRequest(message, issue, at = Date.now()) {
    message.phase = 'refused';
    message.issue = issue;
    message.refusedAt = at;
    delete message.providerPendingUntil;
    save();
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
      const attempt = await transport.interrupt(message, transport.plan(message.target.provider, 'interrupt').stop, observation);
      if (Number.isFinite(attempt?.deadlineAt)) {
        message.providerPendingUntil = attempt.deadlineAt;
        save();
        return;
      }
    } catch (error) {
      if (providerFailures.has(error.kind)) return failRequest(message, error.kind);
      if (error.kind === 'status_mismatch') return targetTurnEnded(message);
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

  async function send(message, observation, waves, urgent, decorate) {
    const pendingPhase = message.phase;
    const { deliveryAppendix, resultContext, ...extras } = message.payloadFrozen ? {} : await decorate?.(message, waves) ?? {};
    const waveSeparator = waves.length && message.target.provider === 'agy' && !message.combinedWaves ?
      '\n--- Loom result ---\n' : message.waveSeparator;
    const decorated = { ...message, ...extras, waveSeparator };
    const combined = combinedDeliveryText(decorated, waves);
    const automatic = message.replyKey || message.waveBatch || message.continuationBatch || message.projectEvents;
    let text = combined;
    if (!message.payloadFrozen && automatic) {
      const limit = replyLimit?.() ?? defaultReplyBytes;
      const options = { attachFile: Boolean(message.reviewerResult || decorated.gateRejection) };
      const overflow = Buffer.byteLength(combined) > limit;
      text = replyForDelivery(project, resultContext && overflow ? resultContext + '\n\n' + combined : combined, limit, options);
      if (resultContext) {
        const [heading, ...lines] = resultContext.split('\n');
        let preview = heading;
        for (const line of lines) {
          if (Buffer.byteLength(wireText(message.id, preview + '\n' + line + '\n\n' + text)) > limit) break;
          preview += '\n' + line;
        }
        if (preview !== heading) text += '\n\n' + preview;
      }
    } else if (!message.payloadFrozen && waves.length && message.wireBody === undefined) {
      const batch = waves.map(wave => wave.text).join('\n\n');
      const brief = replyForDelivery(project, batch, replyLimit?.());
      if (brief !== batch) text = combinedDeliveryText(decorated, [{ text: brief }]);
    }
    if (!message.payloadFrozen) {
      text = replyForDelivery(project, text, 16_000);
      if (!automatic && resultContext) text += '\n\n' + resultContext;
      if (deliveryAppendix) text += '\n\n' + deliveryAppendix;
    }
    Object.assign(message, extras);
    if (waveSeparator) message.waveSeparator = waveSeparator;
    if (text !== combined) message.wireBody = text;
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
    const input = { ...message, urgent, text };
    if (checksDeliveryIntegrity(message.target)) message.payloadDigest = payloadDigest(input.text);
    delete message.waitingForWritable;
    save();
    try {
      const attempt = await transport.send(input, observation);
      if (attempt?.requestId) message.nativeAttempt = attempt;
      if (Number.isFinite(attempt?.deadlineAt)) {
        message.providerPendingUntil = attempt.deadlineAt;
        save();
        return;
      }
    } catch (error) {
      if (providerFailures.has(error.kind)) {
        if (error.partialWrite) message.partialWrite = error.partialWrite;
        return failRequest(message, error.kind);
      }
      if (error.kind === 'steer-unavailable') {
        message.mode = 'queue';
        message.barrier = message.active;
        message.phase = pendingPhase;
        delete message.attemptAt;
        save();
        return;
      }
      if (error.kind === 'no-native-turn') {
        message.typedAt = Date.now();
        message.issue = 'no-native-turn';
      } else if (refusals.has(error.kind)) {
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
    if (!result) return;
    if (result.status === 'pending' && Number.isFinite(result.deadlineAt)) {
      if (message.providerPendingUntil !== result.deadlineAt || message.issue?.startsWith('uncertain')) {
        message.providerPendingUntil = result.deadlineAt;
        delete message.issue;
        save();
      }
      return;
    }
    if (result.status === 'uncertain' && message.providerPendingUntil !== undefined) {
      delete message.providerPendingUntil;
      message.issue = stopping ? 'uncertain-stop' : 'uncertain';
      save();
      return;
    }
    if (!['absent', 'refused', 'accepted'].includes(result.status)) return;
    delete message.providerPendingUntil;
    if (providerFailures.has(result.kind)) return failRequest(message, result.kind);
    if (stopping && result.kind === 'status_mismatch') return targetTurnEnded(message);
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

  function pendingReason(message, observation) {
    if (observation?.userPrompt || promptKind(observation?.state)) return 'target-awaiting-user';
    const proof = observation?.writeEvidence;
    if (proof?.heldDeliveryId === message.id || proof?.pendingDeliveryId === message.id && observation.state === 'draft-held') {
      return 'draft-held';
    }
    if (message.phase === 'sending') {
      return message.typedAt != null || proof?.submittedDeliveryId === message.id ? 'no-native-turn' : 'uncertain';
    }
    if (message.phase === 'stopping') return 'uncertain-stop';
    return ['trust-dialog', 'overlay', 'picker', 'permission'].includes(observation?.state) ? observation.state : 'waiting-writable';
  }

  function sweep(group, observation, at, stallMs) {
    let changed = false;
    const byId = new Map(group.map(message => [message.id, message]));
    const awaitingUser = observation?.userPrompt || promptKind(observation?.state);
    const busy = !awaitingUser &&
      (observation?.active || ['busy', 'compacting'].includes(observation?.state) ||
      ['busy', 'compacting', 'background-in-progress'].includes(observation?.writeEvidence?.native));
    for (const message of group.filter(awaitingDelivery)) {
      const carrier = byId.get(message.combinedInto) ?? message;
      const reason = !observation && message.pendingReason || pendingReason(carrier, observation);
      if (message.pendingReason !== reason) { message.pendingReason = reason; changed = true; }
      // A Stop hook may land just before dispatch. Preserve the SLA earned
      // while this input was blocked behind the native turn, even on restart.
      if (busy && !message.waitedForBusy) { message.waitedForBusy = true; changed = true; }
      const limit = !awaitingUser && message.waitedForBusy ? 3 * stallMs : stallMs;
      if (message.stalledAt == null && deliveryAge(message, at) >= limit) {
        message.stalledAt = at;
        changed = true;
      }
    }
    if (changed) save();
  }

  async function retryMissingTurn(message, observation) {
    if (!transport.retryMissingTurn || message.retryAt != null || message.mode !== 'queue' || message.received ||
        message.phase !== 'sending' ||
        observation?.writeEvidence?.retryableDeliveryId !== message.id) return;
    const fresh = await inspect(message.target);
    if (!fresh) return;
    reconcile(message, fresh);
    if (message.phase !== 'sending' || fresh.writeEvidence?.retryableDeliveryId !== message.id) return;
    // Reserve the retry before the side effect. Keep the original attempt time for late receipts.
    const waves = (message.combinedWaves ?? []).map(id => messages.find(item => item.id === id));
    if (waves.some(wave => !wave)) return;
    message.retryAt = Date.now();
    save();
    try { await transport.retryMissingTurn({ ...message, text: combinedDeliveryText(message, waves) }, fresh); }
    catch (error) { report(error.message); }
  }

  async function observeTarget(all, at, stallMs, canDispatchMessage) {
    const observation = await inspect(all[0].target);
    const group = all.filter(message => !message.combinedInto);
    if (observation) {
      for (const message of group) reconcile(message, observation);
      if (observation.state === 'finished') {
        const pending = group.filter(message => pendingReply(message) &&
          !(mayReroute(message) && canDispatchMessage?.(message) === false));
        for (const message of pending) {
          message.phase = 'target-ended';
          message.issue = 'target-ended';
          message.refusedAt = observation.row?.endedAt ?? at;
          delete message.providerPendingUntil;
          delete message.waitingForWritable;
        }
        if (pending.length) save();
      } else {
        for (const message of group) await recoverAttempt(message, observation);
      }
    }
    for (const message of group) {
      if (awaiting(message) && message.providerPendingUntil <= Date.now()) failRequest(message, 'request-timeout');
    }
    settleCombined(all);
    sweep(all, observation, at, stallMs);
    return observation;
  }

  async function processTarget(all, observation, { canDispatch, canDispatchMessage, known, at, coalesceMs, decorate } = {}) {
    const group = all.filter(message => !message.combinedInto);
    const target = group[0]?.target;
    if (!target || !observation || observation.state === 'finished' || observation.userPrompt || promptKind(observation.state)) return;
    const eligible = message => !canDispatchMessage || canDispatchMessage(message);
    const retry = group.find(message => stalledDelivery(message) &&
      observation.writeEvidence?.retryableDeliveryId === message.id && message.retryAt == null && eligible(message));
    if (retry && (!canDispatch || canDispatch(target))) {
      await retryMissingTurn(retry, observation);
      settleCombined(all);
    }
    const queued = group.filter(message => message.phase === 'queued' && eligible(message));
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
    let next = group.find(message => message.phase === 'stopped' && (!urgentOnly || isUrgent(message)) && eligible(message)) ??
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
    else await send(next, fresh, combined, urgent, decorate);
    settleCombined(all);
  }

  async function step(routeTarget, { beforeDispatch, canDispatch, canDispatchMessage, messageIssue,
    now = Date.now, coalesceMs = 0, stallMs = defaultStallMs, decorate } = {}) {
    store.ingest();
    let changed = false;
    for (const message of messages) {
      if (!mayReroute(message)) continue;
      const target = routeTarget?.(message);
      if (!target || target.addr === message.target.addr) continue;
      message.originalTarget ??= message.target.addr;
      message.target = target;
      message.phase = 'queued';
      if (message.memoryRecipient && message.memoryRecipient !== target.addr) {
        for (const key of ['wireBody', 'payloadFrozen', 'payloadDigest', 'memoryRecipient',
          'memoryAccess', 'memoryCursor', 'memoryCompaction', 'skillModules', 'skillDeferred',
          'skillDenialOf', 'skillRedNotices', 'skillCompactionAt', 'resumeCheckpoint', 'gateRejection']) delete message[key];
      }
      for (const key of ['active', 'barrier', 'issue', 'refusedAt', 'waitingForWritable']) delete message[key];
      changed = true;
    }
    if (changed) save();
    function filterMessages() {
      let filtered = false;
      for (const message of messages) {
        if (!['queued', 'stopped'].includes(message.phase) || message.combinedInto) continue;
        const issue = messageIssue?.(message);
        if (!issue) continue;
        message.phase = 'refused';
        message.refusedAt = now();
        message.issue = issue;
        filtered = true;
      }
      if (filtered) save();
    }
    if (messageIssue) filterMessages();
    const groups = () => Map.groupBy(messages, targetScope);
    const active = [...groups()].filter(([, group]) => group.some(message => needsIntegrity(message) || pendingReply(message)));
    if (beforeDispatch) {
      const known = new Set(messages.map(message => message.id));
      const observed = new Map(await Promise.all(active.map(async ([key, group]) =>
        [key, await observeTarget(group, now(), stallMs, canDispatchMessage)])));
      await beforeDispatch();
      if (messageIssue) filterMessages();
      const at = now();
      await Promise.all([...groups()].filter(([key, group]) => observed.has(key) ||
        group.some(message => !known.has(message.id) && message.streamAt != null)).map(async ([key, group]) =>
        processTarget(group, observed.has(key) ? observed.get(key) : await observeTarget(group, at, stallMs, canDispatchMessage),
          { canDispatch, canDispatchMessage, known, at, coalesceMs, decorate })));
    } else {
      await Promise.all(active.map(async ([, group]) => processTarget(group, await observeTarget(group, now(), stallMs, canDispatchMessage),
        { canDispatch, canDispatchMessage, at: now(), coalesceMs, decorate })));
    }
  }

  async function observe(targets, at, stallMs) {
    store.ingest();
    const groups = Map.groupBy(messages.filter(message => targets.has(message.target.addr)), targetScope);
    await Promise.all([...groups.values()].filter(group => group.some(message => needsIntegrity(message) || pendingReply(message)))
      .map(group => observeTarget(group, at, stallMs)));
  }

  function routesForTurn(addr, reply) {
    const related = new Set(messages.filter(({ target, completion }) => target.addr === addr &&
      completion && completion.sessionId === reply.sessionId &&
      (completion.at === reply.at || (reply.turnId && completion.turnId === reply.turnId)))
      .map(message => message.id));
    if (related.size) return [...new Set(messages.filter(message => related.has(message.replyTo) &&
      message.replyKey && !deliveryFailed(message)).map(message => message.target.addr))];
  }

  function enqueue(message) {
    const existing = messages.find(item => item.id === message.id);
    if (existing) return existing;
    messages.push(message);
    try { save(); } catch (error) { messages.pop(); throw error; }
    return message;
  }

  function handoverMessages(predecessor, successor, apply = false) {
    const affected = messages.filter(message => !message.startup && message.target.addr === predecessor &&
      (pendingReply(message) || mayReroute(message)));
    const plan = affected.map(message => ({ id: message.id, action: mayReroute(message) ? 'reroute' : 'void' }));
    if (!apply || !affected.length) return plan;
    const before = affected.map(message => ({ ...message }));
    for (const [i, message] of affected.entries()) {
      message.originalTarget ??= predecessor;
      if (plan[i].action === 'reroute') {
        message.target = successor;
        message.phase = 'queued';
        for (const field of ['active', 'barrier', 'issue', 'refusedAt', 'waitingForWritable']) delete message[field];
      } else {
        message.phase = 'refused';
        message.issue = 'handover-void';
        message.refusedAt = Date.now();
      }
    }
    try { save(); } catch (error) {
      for (const [i, message] of affected.entries()) {
        for (const field of Object.keys(message)) delete message[field];
        Object.assign(message, before[i]);
      }
      throw error;
    }
    return plan;
  }

  function refuseQueued(message, issue) {
    if (message.phase !== 'queued') return;
    message.phase = 'refused';
    message.issue = issue;
    save();
  }

  function escalate(message, bypassAt) {
    if (message.bypassedAt == null) {
      message.bypassedAt = bypassAt;
      message.issue ??= message.phase === 'stopping' ? 'uncertain-stop' : 'uncertain';
      save();
    }
  }

  function replayForResume(addr, target, { firstId, confirmedIds = new Set(), hadNativeTurns = false } = {}) {
    const affected = messages.filter(message => message.target?.addr === addr);
    if (!affected.length) return { replayed: [], deduplicated: [] };
    const before = affected.map(message => structuredClone(message));
    const replayed = [];
    const deduplicated = [];
    let changed = false;
    const clearFields = [
      'active', 'barrier', 'issue', 'refusedAt', 'attemptAt', 'typedAt', 'stopAttemptAt', 'stopKeySent',
      'stoppedAt', 'hostAttempt', 'hostStopAttempt', 'nativeAttempt', 'providerPendingUntil',
      'waitingForWritable', 'pendingReason', 'stalledAt',
    ];
    for (const message of affected) {
      if (message.received) continue;
      if (confirmedIds.has(message.id)) {
        message.received = { at: message.attemptAt ?? Date.now(), sessionId: target.sessionId ?? null, recovered: true };
        message.phase = 'received';
        for (const field of ['issue', 'refusedAt', 'pendingReason', 'waitingForWritable']) delete message[field];
        deduplicated.push(message.id);
        changed = true;
        continue;
      }
      if (message.id === firstId && hadNativeTurns) {
        deduplicated.push(message.id);
        continue;
      }
      const replayable = ['queued', 'target-ended', 'sending', 'stopping', 'stopped'].includes(message.phase) ||
        message.phase === 'refused' && message.issue === 'target-exited';
      if (!replayable) continue;
      message.target = target;
      if (!message.combinedInto) {
        message.phase = 'queued';
        for (const field of clearFields) delete message[field];
        replayed.push(message.id);
      }
      changed = true;
    }
    if (changed) {
      try { save(); } catch (error) {
        for (const [i, message] of affected.entries()) {
          for (const field of Object.keys(message)) delete message[field];
          Object.assign(message, before[i]);
        }
        throw error;
      }
    }
    return { replayed, deduplicated };
  }

  return { step, observe, routesForTurn, enqueue, refuseQueued, handoverMessages, replayForResume, messages };
}
