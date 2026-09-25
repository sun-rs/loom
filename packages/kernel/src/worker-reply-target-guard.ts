import type { DatabaseSync } from "node:sqlite";
import {
  shortWorkerRef,
  type ActivationCredentialScope,
} from "@rah-os/protocol";

import { ReplyTargetMismatchError } from "./errors.ts";
import { integer, nullableText, text } from "./sqlite-row.ts";
import { workerAddressing } from "./worker-addressing.ts";

/**
 * The first sequence this Activation delivered: the presented range starts at
 * `from_seq`, and a `message-check` replay (once it happened) starts after the
 * recorded delivery boundary. Read-only: the guard never pins a boundary.
 */
function deliveredFromSeq(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
): number | undefined {
  const activation = database
    .prepare(
      "SELECT from_seq FROM activations WHERE activation_id=? AND room_id=? AND participant_id=?",
    )
    .get(scope.activationId, scope.roomId, scope.participantId);
  if (activation === undefined) return undefined;
  const replay = database
    .prepare(
      "SELECT after_seq FROM activation_delivery_windows WHERE activation_id=? AND consumer_id=?",
    )
    .get(scope.activationId, scope.consumerId);
  const fromSeq = integer(activation, "from_seq");
  return replay === undefined
    ? fromSeq
    : Math.min(fromSeq, integer(replay, "after_seq") + 1);
}

/** Whether the consumer already confirmed this Activation's delivered range
 * (`message-check` or an implicit post ACK). Read-only. */
function deliveryConfirmed(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
): boolean {
  const cursor = database
    .prepare(
      "SELECT last_seq FROM subscription_cursors WHERE room_id=? AND participant_id=? AND consumer_id=?",
    )
    .get(scope.roomId, scope.participantId, scope.consumerId);
  return cursor !== undefined && integer(cursor, "last_seq") >= scope.toSeq;
}

/**
 * Reply-target guard, judged after the post's target is normalized on every
 * route (the originating route's explicit `threadId`/`null`, and `--target`
 * with or without a Thread suffix), so the same reply cannot escape it by
 * changing syntax.
 *
 * A post in this Activation's Room is a reply to this turn when it is marked
 * `final`, when it cites this turn's delivered messages with a model-submitted
 * `basedOnRoomSeq`, or while this turn's delivered range is still unconfirmed.
 * A `final` post elsewhere (another Room) is refused too: `final` always names
 * this turn's reply. Only a non-final, uncited post after confirmation is a
 * deliberate post that this guard does not judge.
 *
 * A reply must land where the delivered messages arrived, with explicit
 * evidence for anything else:
 * - a Thread a delivered event belongs to, or one rooted at a delivered
 *   message, or one this participant opened after the window head (this
 *   participant's own events in the range, such as its previous round's reply
 *   caught by a replay or a busy append, were never delivered to it);
 * - the Room top level when a delivered inbox item arrived there (or the
 *   window delivered no inbox item at all);
 * - an old Task Thread whose Task this participant is assigned to, claimed,
 *   created, collaborates on or reviews, or read with `task-get` in this
 *   Activation.
 * Anything else is the drift failure where a compacted session re-uses an
 * earlier round's target; it is refused before any write, naming the
 * target(s) the delivered messages arrived in.
 *
 * Returns true when the post was judged as this turn's reply and accepted:
 * its target is then proven, so a client-side target heuristic (Raft's
 * thread-context confirmation) has nothing left to add.
 */
export function assertWorkerReplyTarget(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
  input: {
    roomId: string;
    threadId: string | undefined;
    modelBasedOnRoomSeq: number | undefined;
    final: boolean | undefined;
  },
): boolean {
  const final = input.final === true;
  if (input.roomId !== scope.roomId) {
    if (!final) return false;
    const fromSeq = deliveredFromSeq(database, scope);
    if (fromSeq === undefined) return false;
    refuse(database, scope, fromSeq, "a final reply in another Room");
  }
  if (
    !final &&
    input.modelBasedOnRoomSeq === undefined &&
    deliveryConfirmed(database, scope)
  )
    return false;
  const fromSeq = deliveredFromSeq(database, scope);
  if (fromSeq === undefined) return false;
  if (input.threadId === undefined) {
    if (roomTopLevelDelivered(database, scope, fromSeq)) return true;
    refuse(database, scope, fromSeq, "the Room top level");
  }
  const allowed = database
    .prepare(
      `SELECT 1 FROM threads t WHERE t.thread_id=? AND t.room_id=? AND (
        EXISTS (SELECT 1 FROM room_events e
          LEFT JOIN tasks ON e.aggregate_type='task' AND tasks.task_id=e.aggregate_id
          WHERE e.room_id=t.room_id AND e.room_seq BETWEEN ? AND ? AND e.actor_id<>?
            AND COALESCE(tasks.thread_id, json_extract(e.payload_json, '$.threadId'))=t.thread_id)
        OR EXISTS (SELECT 1 FROM room_events e
          WHERE e.room_id=t.room_id AND e.room_seq BETWEEN ? AND ? AND e.actor_id<>?
            AND e.type='message.posted' AND e.aggregate_id=t.root_message_id)
        OR (t.created_by=? AND EXISTS (SELECT 1 FROM room_events e
          WHERE e.room_id=t.room_id AND e.room_seq > ?
            AND e.type IN ('thread.created','task.created')
            AND json_extract(e.payload_json, '$.threadId')=t.thread_id))
        OR EXISTS (SELECT 1 FROM tasks k WHERE k.thread_id=t.thread_id AND (
            k.assignee_id=? OR k.claimed_by=? OR k.creator_id=?
            OR EXISTS (SELECT 1 FROM task_participants p
              WHERE p.task_id=k.task_id AND p.participant_id=?)
            OR EXISTS (SELECT 1 FROM activation_task_reads r
              WHERE r.task_id=k.task_id AND r.activation_id=?)))
      ) LIMIT 1`,
    )
    .get(
      input.threadId,
      scope.roomId,
      fromSeq,
      scope.toSeq,
      scope.participantId,
      fromSeq,
      scope.toSeq,
      scope.participantId,
      scope.participantId,
      scope.toSeq,
      scope.participantId,
      scope.participantId,
      scope.participantId,
      scope.participantId,
      scope.activationId,
    );
  if (allowed !== undefined) return true;
  refuse(database, scope, fromSeq, `Thread ${input.threadId}`);
}

/** A delivered inbox item arrived at the Room top level, or the window
 * delivered no inbox item at all (nothing narrower to hold the reply to). */
function roomTopLevelDelivered(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
  fromSeq: number,
): boolean {
  const rows = database
    .prepare(
      `SELECT COALESCE(tasks.thread_id, json_extract(e.payload_json, '$.threadId')) AS reply_thread_id
        FROM inbox_items i JOIN room_events e ON e.event_id=i.event_id
        LEFT JOIN tasks ON e.aggregate_type='task' AND tasks.task_id=e.aggregate_id
        WHERE i.participant_id=? AND i.room_id=? AND i.event_seq BETWEEN ? AND ?`,
    )
    .all(scope.participantId, scope.roomId, fromSeq, scope.toSeq);
  return (
    rows.length === 0 ||
    rows.some((row) => nullableText(row, "reply_thread_id") === null)
  );
}

function refuse(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
  fromSeq: number,
  place: string,
): never {
  const targets = deliveredReplyTargets(database, scope, fromSeq);
  const named = targets.map((target) => `--target ${target}`).join(" or ");
  throw new ReplyTargetMismatchError(
    `reply target ${place} is not where this Activation's messages arrived`,
    `Nothing was sent. Resend this turn's reply with ${named} and the same --based-on-room-seq. A post in another Thread needs explicit evidence, such as reading that Thread's Task with task-get first.`,
  );
}

/** The quoted `--target` argument of each place a delivered message arrived. */
function deliveredReplyTargets(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
  fromSeq: number,
): string[] {
  const room =
    workerAddressing(database, scope, [
      { roomId: scope.roomId, actorId: scope.participantId },
    ]).targets[scope.roomId] ?? scope.roomId;
  const addressable = room.startsWith("#") || room.startsWith("dm:@");
  const rows = database
    .prepare(
      `SELECT json_extract(payload_json, '$.threadId') AS thread_id, MIN(room_seq) AS first_seq
        FROM room_events WHERE room_id=? AND room_seq BETWEEN ? AND ? AND type='message.posted'
          AND actor_id<>?
        GROUP BY thread_id ORDER BY first_seq`,
    )
    .all(scope.roomId, fromSeq, scope.toSeq, scope.participantId);
  const targets = rows.map((row) => {
    const threadId = nullableText(row, "thread_id");
    return threadId === null
      ? `"${room}"`
      : addressable
        ? `"${room}:${shortWorkerRef(threadId)}"`
        : `"${room}" --thread-id ${text(row, "thread_id")}`;
  });
  return targets.length > 0 ? targets : [`"${room}"`];
}
