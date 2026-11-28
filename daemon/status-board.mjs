import { conclusoryReply, deliveryFailed, replyConclusion } from '../inbox/message.mjs';
import { stalledDelivery } from '../inbox/engine.mjs';
import { gateBoundary } from './role-budget.mjs';

const hour = 60 * 60_000;
const recent = (at, now) => Number.isFinite(at) && at >= now - hour && at <= now;
export const routineSuperReceipt = ({ type, reason }) => type === 'super-delivery-receipt' && (reason == null || reason === 'received');
export const newestNoticeFirst = (a, b) => (b.at ?? 0) - (a.at ?? 0);

export function notificationBoard(events, roleFor = () => undefined) {
  const groups = new Map();
  let count = 0;
  let routineReceipts = 0;
  for (const event of events) {
    if (event.auditor || (event.logOnly && !event.type.endsWith('-rotation-completed'))) continue;
    const unread = !event.logOnly && event.takenAt == null && event.resolvedAt == null;
    if (unread) count++;
    if (routineSuperReceipt(event)) {
      routineReceipts++;
      continue;
    }
    const { id, type, at, text, reason } = event;
    const role = event.role ?? roleFor(event.addr);
    const key = JSON.stringify([event.project, type, role, reason, text]);
    const group = groups.get(key) ?? { key, count: 0, unread: 0 };
    if (newestNoticeFirst({ at }, group) <= 0) Object.assign(group, { id, type, at, text, reason, role });
    group.count++;
    if (unread) group.unread++;
    groups.set(key, group);
  }
  return { count, routineReceipts, last: [...groups.values()].sort(newestNoticeFirst) };
}

export function contextBoard(native, observed) {
  const contextTokens = native?.tokens ?? observed?.tokens ?? null;
  const contextWindow = native?.contextWindow ?? observed?.contextWindow ?? null;
  const contextEstimated = native?.windowSource === 'model-table' && contextTokens != null;
  const contextPercent = native?.percent ?? observed?.percent ??
    (contextTokens != null && contextWindow > 0 ? 100 * contextTokens / contextWindow : null);
  return { contextTokens, contextWindow, contextPercent, contextEstimated };
}

const emptyDelivery = () => ({ counts: { queued: 0, typed: 0, stalled: 0, refused: 0, 'awaiting-user': 0 }, oldestAgeMs: null });

export function deliveryBoard(messages, observed, now) {
  const lastHour = emptyDelivery();
  const allTime = emptyDelivery();
  for (const message of messages) {
    const observation = observed.get(message.target.addr);
    let state, at;
    if (deliveryFailed(message)) {
      state = 'refused';
      at = message.refusedAt ?? message.corruption?.at ?? message.createdAt;
    } else if (message.received) continue;
    else if (stalledDelivery(message)) [state, at] = ['stalled', message.stalledAt];
    else if (message.pendingReason === 'target-awaiting-user' || observation?.awaitingUser) {
      [state, at] = ['awaiting-user', observation?.awaitingUserAt ?? message.attemptAt ?? message.createdAt];
    } else if (message.typedAt != null) [state, at] = ['typed', message.typedAt];
    else [state, at] = ['queued', message.createdAt];

    const window = recent(at, now);
    allTime.counts[state]++;
    if (window) lastHour.counts[state]++;
    if (state !== 'refused') {
      const age = Math.max(0, now - message.createdAt);
      allTime.oldestAgeMs = Math.max(allTime.oldestAgeMs ?? 0, age);
      if (window) lastHour.oldestAgeMs = Math.max(lastHour.oldestAgeMs ?? 0, age);
    }
  }
  return { ...lastHour, allTime };
}

export function workerBoard(rows, messages, jobs, observations, sessionFields) {
  const latest = new Map();
  for (const message of messages) {
    const completion = message.completion;
    if (completion && !completion.unconfirmed && completion.body &&
        completion.at >= (latest.get(message.target.addr)?.at ?? -Infinity)) latest.set(message.target.addr, completion);
  }
  return rows.filter(row => row.role === 'worker' && row.backend === 'headless').map(row => {
    const session = sessionFields(row);
    const job = jobs.get(row.addr);
    const releasedAt = job?.retention?.releasedAt ?? job?.releasedAt ?? row.releasedAt;
    const endedAt = row.endedAt ?? releasedAt ?? null;
    const state = endedAt == null ? session.state : releasedAt == null ? 'ended' : 'released';
    const releaseAt = state === 'idle' ? job?.releaseAt ?? row.releaseAt ?? null : null;
    const completion = latest.get(row.addr);
    const result = job?.retention?.resultUnconfirmedAt != null ? 'UNCONFIRMED' : replyConclusion(completion?.body).tag;
    const releaseTimedOut = job?.retention?.releaseTimeoutAt != null && endedAt == null;
    return { ...session, state, task: row.task, wave: row.wave, endedAt, releasedAt, releaseAt,
      awaitingUser: observations.get(row.addr)?.awaitingUser,
      ...(releaseTimedOut && { releaseTimedOut: true, releaseTimeoutAt: job.retention.releaseTimeoutAt }),
      lastResult: ['DONE', 'BLOCKED', 'FAILED', 'UNCONFIRMED'].includes(result) ? result : undefined };
  });
}

export function gateBoard(messages, events, roleFor = () => undefined) {
  const projects = new Map();
  for (const message of messages) {
    if (!message.gateId || !message.gatePacket) continue;
    const { gateId: id, gateRound: round = 1, completion, gateProject: project } = message;
    const key = JSON.stringify([project, id]);
    const rounds = projects.get(key) ?? new Map();
    const gate = rounds.get(round) ?? { id, round, project, at: message.createdAt };
    const owner = message.from?.role ?? roleFor(message.from?.addr) ?? 'leader';
    const reviewer = message.target?.role ?? roleFor(message.target?.addr) ?? 'auditor';
    gate.packet = message.gatePacket;
    gate.fullPath = message.gateFullPath;
    gate.waitingOn = gate.verdict || deliveryFailed(message) ? owner : reviewer;
    if (!completion?.unconfirmed && completion?.at >= (gate.verdict?.at ?? -Infinity) && conclusoryReply(completion.body, true)) {
      const { tag, body } = replyConclusion(completion.body);
      gate.verdict = { tag: tag ?? 'REPLY', round, at: completion.at,
        line: (body ?? completion.body).trimStart().split(/\r?\n/, 1)[0], text: completion.body };
      gate.waitingOn = owner;
    }
    rounds.set(round, gate);
    projects.set(key, rounds);
  }

  const gates = [];
  for (const rounds of projects.values()) {
    const ordered = [...rounds.values()].sort((a, b) => b.round - a.round);
    const [latest] = ordered;
    for (const event of events) {
      if (event.gate !== latest.id || (latest.project && event.project && event.project !== latest.project) || !gateBoundary(event)) continue;
      const closed = ordered.find(gate => gate.at <= event.at && (event.round == null || event.round === gate.round));
      if (closed) closed.completedAt = Math.max(closed.completedAt ?? 0, event.at);
    }
    for (const gate of ordered) {
      gate.superseded = gate !== latest && gate.completedAt == null;
      if (gate.completedAt != null || gate.superseded) gate.waitingOn = null;
      gates.push(gate);
    }
  }
  return gates.sort((a, b) => Math.max(b.verdict?.at ?? 0, b.completedAt ?? 0, b.at) -
    Math.max(a.verdict?.at ?? 0, a.completedAt ?? 0, a.at) || b.round - a.round);
}

export function attentionBoard(delivery, roles, workers, gates, events, roleFor) {
  const attention = [];
  for (const [state, count] of Object.entries(delivery.counts)) {
    if (count && ['refused', 'stalled'].includes(state)) attention.push({ id: 'delivery:' + state, kind: state, count, area: 'delivery' });
  }
  const awaiting = delivery.allTime.counts['awaiting-user'];
  if (awaiting) attention.push({ id: 'delivery:awaiting-user', kind: 'awaiting-user', count: awaiting, area: 'delivery' });
  const live = [...roles, ...workers.filter(worker => worker.endedAt == null)];
  const open = new Set(live.map(row => row.addr));
  for (const row of live) {
    if (['quota-wait', 'auth-expired'].includes(row.state) || row.awaitingUser) attention.push({
      id: 'session:' + row.addr, kind: ['quota-wait', 'auth-expired'].includes(row.state) ? row.state : 'awaiting-user',
      addr: row.addr, area: row.task ? 'workers' : 'roles', subject: row.task ?? row.role,
    });
    if (row.releaseTimedOut) attention.push({
      id: 'release-timeout:' + row.addr, kind: 'release-timeout',
      addr: row.addr, area: 'workers', subject: row.task ?? row.addr, at: row.releaseTimeoutAt,
    });
  }
  for (const event of events.filter(event => event.type === 'needs-decision' && !event.logOnly &&
      event.takenAt == null && event.resolvedAt == null).sort(newestNoticeFirst)) {
    const overdue = event.reason === 'self-rotation-overdue';
    if (overdue && !open.has(event.addr)) continue;
    attention.push({ id: 'notice:' + event.id, kind: overdue ? 'rotation-overdue' : 'needs-decision',
      area: 'notices', subject: event.role ?? roleFor(event.addr), text: event.text, at: event.at });
  }
  for (const gate of gates.filter(gate => gate.waitingOn)) {
    attention.push({ id: `gate:${gate.project ?? ''}:${gate.id}:${gate.round}`, kind: 'gate-wait',
      area: 'gates', subject: gate.id, round: gate.round, waitingOn: gate.waitingOn, at: gate.at });
  }
  return attention;
}
