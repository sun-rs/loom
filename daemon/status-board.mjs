import { conclusoryReply, deliveryFailed, replyConclusion } from '../inbox/message.mjs';
import { stalledDelivery } from '../inbox/engine.mjs';
import { gateBoundary } from './role-budget.mjs';

export function deliveryBoard(messages, observed, now) {
  const counts = { queued: 0, typed: 0, stalled: 0, refused: 0, 'awaiting-user': 0 };
  let oldestAgeMs = null;
  for (const message of messages) {
    if (deliveryFailed(message)) { counts.refused++; continue; }
    if (message.received) continue;
    const awaitingUser = message.pendingReason === 'target-awaiting-user' || observed.get(message.target.addr)?.awaitingUser;
    const state = stalledDelivery(message) ? 'stalled' : awaitingUser ? 'awaiting-user' :
      message.typedAt != null ? 'typed' : 'queued';
    counts[state]++;
    oldestAgeMs = Math.max(oldestAgeMs ?? 0, now - message.createdAt);
  }
  return { counts, oldestAgeMs };
}

export function gateBoard(messages, events) {
  const gates = new Map();
  for (const message of messages) {
    if (!message.gateId || !message.gatePacket) continue;
    const { gateId: id, gateRound: round, completion, phase } = message;
    const gate = gates.get(id) ?? { id };
    if (gate.round === undefined || gate.round <= round) {
      Object.assign(gate, { round, phase, at: message.createdAt, packet: message.gatePacket });
    }
    if (!completion?.unconfirmed && completion?.at >= (gate.verdict?.at ?? -Infinity) && conclusoryReply(completion.body, true)) {
      const { tag, body } = replyConclusion(completion.body);
      const line = (body ?? completion.body).trimStart().split(/\r?\n/, 1)[0].slice(0, 200);
      gate.verdict = { tag: tag ?? 'REPLY', round, at: completion.at, line, text: completion.body };
    }
    gates.set(id, gate);
  }
  for (const event of events) {
    if (!event.gate || !gateBoundary(event)) continue;
    const gate = gates.get(event.gate) ?? { id: event.gate };
    gate.completedAt = event.at;
    gates.set(event.gate, gate);
  }
  return [...gates.values()].sort((a, b) =>
    Math.max(b.verdict?.at ?? 0, b.completedAt ?? 0, b.at ?? 0) -
    Math.max(a.verdict?.at ?? 0, a.completedAt ?? 0, a.at ?? 0)).slice(0, 12);
}
