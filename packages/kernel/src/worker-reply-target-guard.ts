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

/**
 * A reply that cites this Activation's delivered messages (the model's own
 * `basedOnRoomSeq`) and targets a Thread of this Activation's Room must go to
 * a Thread those messages came from, a Thread rooted at one of them, or a
 * Thread this participant opened after the window head (its own Task Thread).
 * Anything else is the drift failure where a compacted session re-used an
 * earlier round's Thread; it is refused before any write, and the error names
 * the target(s) the delivered messages arrived in.
 *
 * Posts without a model-cited `basedOnRoomSeq` (deliberate posts elsewhere),
 * posts to the Room itself and posts to other Rooms are not judged here.
 *
 * Applied on the `--target` route only, where the model names the place from
 * memory. The originating route's explicit canonical `threadId` keeps its own
 * contract: an old Task Thread read through `task-get` stays addressable, and
 * newer or foreign Threads keep their stale/forbidden refusals
 * (`collaboration-closure.test.ts`).
 */
export function assertWorkerReplyTarget(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
  input: {
    roomId: string;
    threadId: string | undefined;
    modelBasedOnRoomSeq: number | undefined;
  },
): void {
  if (input.modelBasedOnRoomSeq === undefined) return;
  if (input.threadId === undefined || input.roomId !== scope.roomId) return;
  const fromSeq = deliveredFromSeq(database, scope);
  if (fromSeq === undefined) return;
  const allowed = database
    .prepare(
      `SELECT 1 FROM threads t WHERE t.thread_id=? AND t.room_id=? AND (
        EXISTS (SELECT 1 FROM room_events e
          LEFT JOIN tasks ON e.aggregate_type='task' AND tasks.task_id=e.aggregate_id
          WHERE e.room_id=t.room_id AND e.room_seq BETWEEN ? AND ?
            AND COALESCE(tasks.thread_id, json_extract(e.payload_json, '$.threadId'))=t.thread_id)
        OR EXISTS (SELECT 1 FROM room_events e
          WHERE e.room_id=t.room_id AND e.room_seq BETWEEN ? AND ?
            AND e.type='message.posted' AND e.aggregate_id=t.root_message_id)
        OR (t.created_by=? AND EXISTS (SELECT 1 FROM room_events e
          WHERE e.room_id=t.room_id AND e.room_seq > ?
            AND e.type IN ('thread.created','task.created')
            AND json_extract(e.payload_json, '$.threadId')=t.thread_id))
      ) LIMIT 1`,
    )
    .get(
      input.threadId,
      scope.roomId,
      fromSeq,
      scope.toSeq,
      fromSeq,
      scope.toSeq,
      scope.participantId,
      scope.toSeq,
    );
  if (allowed !== undefined) return;
  const targets = deliveredReplyTargets(database, scope, fromSeq);
  const named = targets.map((target) => `--target ${target}`).join(" or ");
  throw new ReplyTargetMismatchError(
    `reply target Thread ${input.threadId} is not where this Activation's messages arrived`,
    `Nothing was sent. Resend the reply with ${named} and the same --based-on-room-seq. To post in that Thread deliberately, omit --based-on-room-seq.`,
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
