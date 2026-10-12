import type { DatabaseSync } from "node:sqlite";

import {
  type ActivationReason,
  messageHasBroadcastMention,
  type RoomEvent,
} from "@rah-os/protocol";

import { integer, nullableInteger, text } from "./sqlite-row.ts";

/**
 * evo §37 A — wake rules for instance-authored messages and the Channel chain
 * guard. Owner: the Kernel attention derivation (`RoomEventWriter`), so every
 * facade (Worker CLI, MCP, any future path) is held to the same rule.
 *
 * - An agent-authored `message.posted` (Role instance or legacy Agent) wakes
 *   another agent through a `mention` recipient that the message's
 *   canonical mentions (bound participant IDs) prove; implicit routes (room policy, Thread
 *   followers and Thread root) never do. A Kernel-proven single-hop `reply`
 *   return is the owner-approved exception. Multica's original rule: agent
 *   authors skip implicit routing (`comment.go:2685`).
 * - Each Channel counts consecutive instance-to-instance wakes since its last
 *   Human message. A Human `message.posted` anywhere in the Channel (top level
 *   or any Thread) resets it; another Channel's messages never do. Past the
 *   runtime setting `wakeGuard.instanceChainLimit` no Inbox item or Activation is
 *   derived and the Channel receives one system notice per trip.
 * - Each decision (admitted or not, with its count) is recorded on the causal
 *   chain in `instance_wake_chain`, keyed by the waking event and recipient.
 */
export const INSTANCE_WAKE_GUARD_SCHEMA = `
CREATE TABLE IF NOT EXISTS instance_wake_guards (
  room_id TEXT PRIMARY KEY,
  human_seq INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0 CHECK (streak >= 0),
  noticed_human_seq INTEGER,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS instance_wake_chain (
  event_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  room_seq INTEGER NOT NULL,
  author_id TEXT NOT NULL,
  streak INTEGER NOT NULL CHECK (streak > 0),
  chain_limit INTEGER NOT NULL CHECK (chain_limit > 0),
  admitted INTEGER NOT NULL CHECK (admitted IN (0, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (event_id, participant_id)
) STRICT;
`;

function principalKind(
  database: DatabaseSync,
  principalId: string,
): string | undefined {
  const row = database
    .prepare("SELECT kind FROM principals WHERE principal_id = ?")
    .get(principalId);
  return row === undefined ? undefined : text(row, "kind");
}

/**
 * A `mention` recipient must be proven by the canonical mentions the
 * RoomEventWriter bound to the message (participant IDs), never by a
 * facade-supplied reason or a display-name rematch.
 */
function canonicallyMentions(event: RoomEvent, participantId: string): boolean {
  const mentions = (event.payload as { mentions?: unknown }).mentions;
  return (
    Array.isArray(mentions) &&
    mentions.some(
      (mention: unknown) =>
        typeof mention === "object" &&
        mention !== null &&
        (mention as { principalId?: unknown }).principalId === participantId,
    )
  );
}

/** A Human message resets its Channel's instance chain. */
export function noteHumanMessageForWakeGuard(
  database: DatabaseSync,
  event: RoomEvent,
): void {
  if (event.type !== "message.posted") return;
  if (principalKind(database, event.actorId) !== "human") return;
  database
    .prepare(
      `INSERT INTO instance_wake_guards(room_id, human_seq, streak, updated_at)
       VALUES(?, ?, 0, ?)
       ON CONFLICT(room_id) DO UPDATE SET human_seq = excluded.human_seq,
         streak = 0, updated_at = excluded.updated_at`,
    )
    .run(event.roomId, event.roomSeq, event.createdAt);
}

/**
 * Owner ruling 2026-09-27 (contract §3): the instances a Human message
 * addresses, as a message-level set. It is the canonical mentions bound to the
 * message (code, links and emails are already excluded by the mention parser)
 * intersected with the Channel's enabled agent members. `undefined` means
 * broadcast: not a Human message, no such mention (none, a non-member, a
 * Human, a typo) or an explicit `@all` / `@所有人`.
 */
export function addressedParticipants(
  database: DatabaseSync,
  event: RoomEvent,
): string[] | undefined {
  if (event.type !== "message.posted") return undefined;
  const kind = principalKind(database, event.actorId);
  // `@all` / `@所有人`: every other instance member, for any author (an
  // instance's broadcast is still counted per wake by the chain guard).
  if (broadcasts(event) && (kind === "human" || kind === "agent")) {
    const everyone = channelInstanceMembers(database, event.roomId)
      .filter((id) => id !== event.actorId)
      .sort();
    return everyone.length === 0 ? undefined : everyone;
  }
  if (kind !== "human") return undefined;
  const members = new Set(channelInstanceMembers(database, event.roomId));
  const addressed = [
    ...new Set(
      canonicalMentionIds(event).filter(
        (id) => id !== event.actorId && members.has(id),
      ),
    ),
  ].sort();
  return addressed.length === 0 ? undefined : addressed;
}

function broadcasts(event: RoomEvent): boolean {
  const body = (event.payload as { body?: unknown }).body;
  return typeof body === "string" && messageHasBroadcastMention(body);
}

function channelInstanceMembers(
  database: DatabaseSync,
  roomId: string,
): string[] {
  return database
    .prepare(
      `SELECT m.principal_id FROM memberships m
       JOIN principals p ON p.principal_id = m.principal_id
       LEFT JOIN agent_definitions a ON a.participant_id = p.principal_id
       WHERE m.room_id = ? AND p.kind = 'agent'
         AND (a.state IS NULL OR a.state = 'enabled')`,
    )
    .all(roomId)
    .map((row) => text(row, "principal_id"));
}

function canonicalMentionIds(event: RoomEvent): string[] {
  const mentions = (event.payload as { mentions?: unknown }).mentions;
  if (!Array.isArray(mentions)) return [];
  return mentions.flatMap((mention: unknown) => {
    const id =
      typeof mention === "object" && mention !== null
        ? (mention as { principalId?: unknown }).principalId
        : undefined;
    return typeof id === "string" ? [id] : [];
  });
}

export type InstanceWakeDecision =
  | { kind: "not_instance_wake" }
  | { kind: "admitted" }
  | { kind: "implicit_route_refused" }
  | { kind: "chain_limit"; humanSeq: number; limit: number; notice: boolean };

/**
 * Decide one attention recipient of `event`. Only instance-authored
 * `message.posted` events are governed; everything else is not an
 * instance-to-instance wake here.
 */
export function decideInstanceWake(
  database: DatabaseSync,
  event: RoomEvent,
  recipient: { participantId: string; reason: ActivationReason },
  chainLimit: () => number,
): InstanceWakeDecision {
  if (event.type !== "message.posted") return { kind: "not_instance_wake" };
  if (recipient.participantId === event.actorId)
    return { kind: "not_instance_wake" };
  if (principalKind(database, event.actorId) !== "agent")
    return { kind: "not_instance_wake" };
  const returned = event.payload.replyReturn as
    { participantId?: string } | undefined;
  const isReturn =
    recipient.reason === "reply" &&
    returned?.participantId === recipient.participantId;
  if (recipient.reason !== "mention" && !isReturn)
    return { kind: "implicit_route_refused" };
  if (
    !isReturn &&
    !canonicallyMentions(event, recipient.participantId) &&
    !broadcasts(event)
  )
    return { kind: "implicit_route_refused" };
  const limit = chainLimit();
  const guard = database
    .prepare("SELECT * FROM instance_wake_guards WHERE room_id = ?")
    .get(event.roomId);
  const humanSeq = guard === undefined ? 0 : integer(guard, "human_seq");
  const streak = (guard === undefined ? 0 : integer(guard, "streak")) + 1;
  const admitted = streak <= limit;
  database
    .prepare(
      `INSERT INTO instance_wake_guards(room_id, human_seq, streak, updated_at)
       VALUES(?, ?, ?, ?)
       ON CONFLICT(room_id) DO UPDATE SET streak = excluded.streak,
         updated_at = excluded.updated_at`,
    )
    .run(
      event.roomId,
      humanSeq,
      admitted ? streak : streak - 1,
      event.createdAt,
    );
  database
    .prepare(
      `INSERT OR IGNORE INTO instance_wake_chain(event_id, participant_id, room_id,
         room_seq, author_id, streak, chain_limit, admitted, created_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      event.eventId,
      recipient.participantId,
      event.roomId,
      event.roomSeq,
      event.actorId,
      streak,
      limit,
      admitted ? 1 : 0,
      event.createdAt,
    );
  if (admitted) return { kind: "admitted" };
  const noticed =
    guard === undefined ? null : nullableInteger(guard, "noticed_human_seq");
  const notice = noticed !== humanSeq;
  if (notice)
    database
      .prepare(
        "UPDATE instance_wake_guards SET noticed_human_seq = ? WHERE room_id = ?",
      )
      .run(humanSeq, event.roomId);
  return { humanSeq, kind: "chain_limit", limit, notice };
}

export function instanceWakeLimitNotice(limit: number): string {
  return `【Loom 系统】自上一条 Human 消息以来，本频道实例之间已连续唤醒 ${String(limit)} 次（上限 ${String(limit)}）。为防止循环，实例消息暂不再唤醒其他实例；消息仍保留在频道里。Human 在本频道发任意一条消息即重置计数并恢复唤醒。`;
}
