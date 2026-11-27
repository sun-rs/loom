import { deliveryFailed, isBlockedReply, replyConclusion } from '../inbox/message.mjs';
import { reportedContext } from '../cli/state.mjs';

const delivered = message => Boolean(message?.received && !deliveryFailed(message));
export const workerStallMs = 10 * 60_000;
export const workerResultReceiptMs = workerStallMs;
export const isReleased = job => job?.retention?.releasedAt != null;
export const isThresholdRetirement = reason => reason === 'context-limit' || reason === 'compaction-limit';

export function workerCardId(messages, firstId, turn) {
  // Prefer native input bindings so adjacent cards that share a clock tick stay distinct.
  const bound = turn?.inputIds?.length ? messages.findLastIndex(message => turn.inputIds.includes(message.id)) : -1;
  return messages.findLast((message, i) => message.nextCard && delivered(message) &&
    (bound >= 0 ? i <= bound : message.received.at <= (turn?.at ?? Infinity)))?.id ?? firstId;
}

export function workerStalledSince(view, lastProgressAt, at) {
  if (view?.state !== 'busy' || !Number.isFinite(view.active?.since) || view.userPrompt) return;
  const since = Math.max(view.active.since, view.runtimeStatus?.lastEventAt ?? 0, lastProgressAt ?? 0);
  if (at - since >= workerStallMs) return since;
}

export const nativeCompaction = event => event.type === 'compaction_ended' &&
  (event.outcome?.kind ?? event.outcome) === 'completed' ||
  event.hook_event_name === 'PostCompact' && !event.agent_id && !event.isSidechain;

export function workerContext(events, snapshot) {
  const compactions = events.filter(nativeCompaction).length;
  const contextPercent = reportedContext(snapshot ?? {}, events, []).percent;
  // A sample from before compaction describes the old context window.
  const contextAfterCompactionPercent = compactions ?
    reportedContext({}, events.slice(events.findLastIndex(nativeCompaction) + 1), []).percent : null;
  return { compactions, contextPercent, contextAfterCompactionPercent };
}

export function retirementReason({ contextPercent, compactions }, limits, findings = []) {
  if (findings.some(finding => ['overreach', 'fabrication'].includes(finding.kind))) return 'previous-card-overreach';
  if (findings.length) return 'previous-card-fact-error';
  if (compactions > limits.compactions) return 'compaction-limit';
  if (contextPercent != null && contextPercent > limits.contextPercent) return 'context-limit';
}

export function handoffReason({ contextAfterCompactionPercent, compactions }, limits) {
  if (compactions >= limits.compactions && contextAfterCompactionPercent != null &&
      100 - contextAfterCompactionPercent < limits.remainingPercent) return 'context-after-compaction';
}

export function reuseStatus(job, ended, context, limits, findings) {
  const closed = job?.closed?.reason;
  const retirement = ended ? (isThresholdRetirement(closed) ? closed : undefined) : retirementReason(context, limits, findings);
  return { reuse: ended ? (retirement ? 'retired' : 'closed') :
    retirement ? 'same-card-only' : context.contextPercent == null ? 'unmeasured' : 'reusable',
    ...(retirement && { retirementReason: retirement }) };
}

export function retentionStatus(job, at, ttl) {
  if (!job || !(job.row?.role === 'worker' || job.reviewDeadline || job.handoverFailure)) return;
  const { keep, keepWarm, eligible, idleSince, releasedAt, resuming, releasedBy,
    resultUnconfirmedAt, releaseTimeoutAt } = job.retention ?? {};
  const releaseTimedOut = releaseTimeoutAt != null && releasedAt == null && !job.closed;
  return { keep: Boolean(keep), eligible: Boolean(eligible), resumable: releasedAt != null && job.row?.role === 'worker',
    idleSince: idleSince ?? null, releasedAt: releasedAt ?? null,
    ...(job.closed && { closedAt: job.closed.at, closeReason: job.closed.reason, resumable: false }),
    ...(keepWarm && { keepWarm: true }), ...(releasedBy && { releasedBy }), ...(resuming && { resuming: true }),
    ...(resultUnconfirmedAt != null && { resultUnconfirmedAt }),
    ...(releaseTimeoutAt != null && { releaseTimeoutAt }),
    ...(releaseTimedOut && { releaseTimedOut: true }),
    remainingMs: !keep && !keepWarm && eligible && idleSince != null && releasedAt == null ?
      Math.max(0, ttl - (at - idleSince)) : null };
}

export function retainedState(retention, idle, ended) {
  return ended ? 'closed' : retention.releasedAt != null && !retention.resuming ? 'offline' : idle ? 'idle-warm' : 'working';
}

export function workerDetails(messages) {
  const completion = messages.findLast(message => message.completion?.body || message.completion?.unconfirmed)?.completion;
  const lastResultTag = completion && (completion.unconfirmed ? 'UNCONFIRMED' :
    replyConclusion(completion.body).tag ?? (completion.outcome?.kind === 'failed' ? 'FAILED' : 'DONE'));
  return { lastResultTag: lastResultTag ?? null };
}

export function workerMetrics(rows, getJob, getEvents, messages) {
  const gates = new Map();
  const contexts = new Map();
  const inputsByWorker = Map.groupBy(messages.filter(delivered), message => message.target.addr);
  const dispatches = new Map();
  const gateCounts = (project, gate) => {
    const key = JSON.stringify([project, gate]);
    if (!gates.has(key)) gates.set(key, { project, gate, newSpawns: 0, revives: 0, coldRevives: 0, coldRevivesMeasured: 0,
      coldReviveTokens: 0, reuses: 0, crossCardReuses: 0, workerHandoffs: 0, firstReportMismatches: 0,
      thresholdRetirements: 0, averageRetirementContextPercent: null,
      leader: 0, ttl: 0, operator: 0, closed: 0 });
    return gates.get(key);
  };
  for (const row of rows) {
    if (row.role !== 'worker') continue;
    const job = getJob(row.addr);
    if (!job || row.backend !== 'headless') continue;
    const gate = job.barrier ?? row.wave;
    const metrics = gateCounts(row.project, gate);
    metrics.newSpawns++;
    if (job.firstReportCheck?.status === 'mismatch') metrics.firstReportMismatches++;
    if (job.closed && row.endedAt != null) {
      metrics.closed++;
      if (job.closed.reason === 'worker-handoff') metrics.workerHandoffs++;
      if (job.closed.reason === 'worker-handoff' && job.workerHandoff?.reason === 'context-after-compaction' ||
          isThresholdRetirement(job.closed.reason)) {
        metrics.thresholdRetirements++;
        if (job.closed.contextPercent != null) {
          const context = contexts.get(metrics) ?? { sum: 0, count: 0 };
          context.sum += job.closed.contextPercent;
          metrics.averageRetirementContextPercent = context.sum / ++context.count;
          contexts.set(metrics, context);
        }
      }
    }
    for (const { gate, by } of job.releases ?? []) gateCounts(row.project, gate)[by]++;
    const inputs = inputsByWorker.get(row.addr) ?? [];
    metrics.crossCardReuses += inputs.filter(message => message.nextCard).length;
    const initial = inputs.find(message => message.id === job.firstId);
    const attempts = dispatches.get(metrics) ?? [];
    if (initial) attempts.push({ kind: 'new', at: initial.received.at, dispatchedAt: initial.createdAt });
    dispatches.set(metrics, attempts);
    const resumedInputs = new Set(job.revivals?.map(({ streamId }) => inputs.find(message => message.received.streamId === streamId)?.id));
    metrics.reuses += inputs.filter(message => message.dispatch === 'continued' && !resumedInputs.has(message.id)).length;
    if (!job.revivals?.length) continue;
    const streams = Map.groupBy(getEvents(row.addr), event => event.streamId);
    for (const { streamId, warmUntil } of job.revivals) {
      metrics.revives++;
      metrics.reuses++;
      const input = inputs.find(message => !message.startup && message.received.streamId === streamId);
      if (input) attempts.push({ kind: 'revived', at: input.received.at, dispatchedAt: input.createdAt });
      const stream = streams.get(streamId) ?? [];
      const first = stream.find(event => event.type === 'turn-start');
      if (!first || first.at < warmUntil) continue;
      metrics.coldRevives++;
      const tokens = stream.find(event => event.type === 'usage' && event.turn === first.turn &&
        Number.isFinite(event.usage?.tokens?.input))?.usage.tokens;
      if (tokens) {
        metrics.coldRevivesMeasured++;
        metrics.coldReviveTokens += tokens.input + (tokens.output ?? 0);
      }
    }
  }
  for (const [key, packets] of gatePackets(messages, rows)) {
    const metrics = gates.get(key);
    if (metrics) metrics.fixAfterReject = fixAfterReject(packets, dispatches.get(metrics));
  }
  return [...gates.values()].reverse();
}

function fixAfterReject(packets, attempts) {
  const result = { new: { rounds: 0, decided: 0, approved: 0 }, revived: { rounds: 0, decided: 0, approved: 0 } };
  const verdicts = packets.toSorted((a, b) => (a.gateRound ?? 1) - (b.gateRound ?? 1))
    .map(gateVerdict).filter(Boolean);
  for (const [i, verdict] of verdicts.entries()) {
    if (verdict.kind !== 'reject') continue;
    const next = verdicts[i + 1];
    const kinds = new Set(attempts.filter(attempt => attempt.dispatchedAt >= verdict.at && attempt.at <= (next?.at ?? Infinity))
      .map(attempt => attempt.kind));
    for (const kind of kinds) {
      result[kind].rounds++;
      if (next) result[kind].decided++;
      if (next?.kind === 'approve') result[kind].approved++;
    }
  }
  return result;
}

export function workerIdleSince(view, at, previous, fallbackAt) {
  const boundary = view.events?.findLast(event => event.streamId === view.streamId &&
    ['turn-end', 'compaction_ended', 'turn-start'].includes(event.type));
  if (boundary?.type === 'turn-end' || boundary?.type === 'compaction_ended') return Math.min(at, boundary.at);
  if (previous?.idleStream === view.streamId && Number.isFinite(previous?.idleSince)) return previous.idleSince;
  if (!boundary) {
    const legacy = view.events?.findLast(event => !event.streamId &&
      ['turn-end', 'compaction_ended', 'turn-start'].includes(event.type));
    if (legacy?.type === 'turn-end' || legacy?.type === 'compaction_ended') return Math.min(at, legacy.at);
    if (Number.isFinite(fallbackAt)) return Math.min(at, fallbackAt);
  }
  return at;
}

function gatePackets(messages, rows) {
  const auditors = new Map(rows.filter(row => row.role === 'auditor').map(row => [row.addr, row.project]));
  const packets = new Map();
  for (const message of messages) {
    const project = auditors.get(message.target.addr);
    if (!project || !message.gatePacket || !message.gateId) continue;
    const key = JSON.stringify([project, message.gateId]);
    if (!packets.has(key)) packets.set(key, []);
    packets.get(key).push(message);
  }
  return packets;
}

function gateVerdict(message) {
  const { completion } = message;
  if (!delivered(message) || !Number.isFinite(completion?.at) || completion.unconfirmed ||
      completion.outcome && completion.outcome.kind !== 'completed') return;
  const { tag } = replyConclusion(completion.body);
  const kind = ['APPROVE', 'APPROVED'].includes(tag) ? 'approve' : ['REJECT', 'REJECTED'].includes(tag) ? 'reject' : undefined;
  if (kind) return { kind, at: completion.at };
}

export function approvedWaves(messages, rows) {
  return new Map([...gatePackets(messages, rows)].flatMap(([key, packets]) => {
    const latest = packets.reduce((prior, message) => (message.gateRound ?? 1) >= (prior.gateRound ?? 1) ? message : prior);
    const verdict = gateVerdict(latest);
    return verdict?.kind === 'approve' ? [[key, verdict.at]] : [];
  }));
}

export function idleForRelease(view) {
  if (view?.state !== 'idle' || view.active || view.userPrompt) return false;
  const compaction = view.events?.findLast(event => event.streamId === view.streamId && event.type?.startsWith('compaction_'));
  return compaction?.type !== 'compaction_started';
}

export function releaseConditions(messages) {
  const byId = new Map(messages.map(message => [message.id, message]));
  const incoming = Map.groupBy(messages, message => message.target.addr);
  const outgoing = Map.groupBy(messages.filter(message => message.from), message => message.from.addr);
  const byResult = new Map();
  for (const message of messages) {
    const { continuationMembers, replyTo } = message;
    // Older wave deliveries identify workers in the result heading.
    const workers = message.resultWorkers ?? (message.waveBatch ? [...message.text
      .matchAll(/^\S+ ((?:loom|oar)-[0-9a-f-]+) (?:DONE|FAILED|BLOCKED|UNCONFIRMED)\b/gm)].map(match => match[1]) : []);
    for (const key of [...workers, ...continuationMembers ?? [], replyTo].filter(Boolean)) {
      if (!byResult.has(key)) byResult.set(key, []);
      byResult.get(key).push(message);
    }
  }
  const hasReceipt = key => byResult.get(key)?.some(delivered);
  const pending = message => !message.received && !deliveryFailed(message);
  const pendingFor = (addr, { ignoreResult = false } = {}) =>
    (incoming.get(addr) ?? []).some(message => !deliveryFailed(message) &&
      (!message.received || !message.completion?.body && !message.completion?.noReply)) ||
    (outgoing.get(addr) ?? []).some(message => pending(message) || message.expectReply && !deliveryFailed(message) &&
      (!message.completion || message.completion.relay?.deliveryId && !delivered(byId.get(message.completion.relay.deliveryId)))) ||
    !ignoreResult && (byResult.get(addr) ?? []).some(pending) ||
    !ignoreResult && (incoming.get(addr) ?? []).some(message => (byResult.get(message.id) ?? []).some(pending));
  const reportAt = message => message?.completion?.at ?? message?.refusedAt ?? message?.corruption?.at ??
    message?.received?.at ?? message?.createdAt;
  const isSettled = message => Boolean(message && (message.completion?.body || message.completion?.noReply || deliveryFailed(message)));
  const workerResultState = (row, job, { allowBlocked = false, allowUnconfirmed = false, at = Date.now(), receiptMs = workerResultReceiptMs } = {}) => {
    const reports = (incoming.get(row.addr) ?? []).filter(message =>
      message.id === job.firstId || message.batchId || message.implicitBatch);
    const final = reports.findLast(isSettled);
    const body = final?.completion?.body;
    const native = Boolean(body && !final.completion.unconfirmed);
    const blocked = native && isBlockedReply(body);
    const settled = Boolean(final && reports.length > 0 && reports.every(isSettled));
    const reportKey = message => (message.id === job.firstId ? row.addr : message.id);
    const resultAt = reportAt(final);
    const receipt = Boolean(final && hasReceipt(reportKey(final)));
    const allReceipts = reports.length > 0 && reports.every(message => hasReceipt(reportKey(message)));
    const earlierResolved = reports.every(message => message === final || hasReceipt(reportKey(message)) ||
      allowUnconfirmed && Number.isFinite(reportAt(message)) && at - reportAt(message) >= receiptMs);
    const confirmed = Boolean(settled && receipt && (allowUnconfirmed ? earlierResolved : allReceipts) &&
      (allowUnconfirmed || native) && (allowBlocked || !blocked));
    const stale = Boolean(settled && !receipt && Number.isFinite(resultAt) && at - resultAt >= receiptMs);
    const markedUnconfirmed = Boolean(job.retention?.resultUnconfirmedAt != null &&
      (job.retention.resultUnconfirmedFor == null || job.retention.resultUnconfirmedFor === final?.id));
    const unconfirmed = Boolean(!confirmed && settled && (markedUnconfirmed || stale));
    return { reports, final, body, native, blocked, settled, resultAt, receipt, allReceipts, confirmed, stale, unconfirmed,
      pending: pendingFor(row.addr), pendingWithoutResult: pendingFor(row.addr, { ignoreResult: true }) };
  };
  return {
    pending: pendingFor,
    workerResultState,
    workerResult(row, job, { allowBlocked = false } = {}) {
      return workerResultState(row, job, { allowBlocked }).confirmed;
    },
    workerSummaryDelivered: hasReceipt,
    relatedTargets: addr => new Set([addr, ...(outgoing.get(addr) ?? []).map(message => message.target.addr),
      ...(byResult.get(addr) ?? []).map(message => message.target.addr),
      ...(incoming.get(addr) ?? []).flatMap(message => (byResult.get(message.id) ?? []).map(result => result.target.addr))]),
  };
}
