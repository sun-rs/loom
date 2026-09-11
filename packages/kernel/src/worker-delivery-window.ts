import type { DatabaseSync } from "node:sqlite";
import type { ActivationCredentialScope } from "@rah-os/protocol";
import { integer } from "./sqlite-row.ts";

/** Immutable input boundary for retry, not another acknowledgement cursor.
 * Called only inside syncWorker's authenticated transaction. Raft's check hides
 * ACK; this receipt preserves RAH's finite-Activation retry semantics. */
export function workerDeliveryReplayStart(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
): number {
  const existing = database
    .prepare(
      `SELECT after_seq FROM activation_delivery_windows WHERE activation_id=? AND consumer_id=?`,
    )
    .get(scope.activationId, scope.consumerId);
  if (existing) return integer(existing, "after_seq");
  const activation = database
    .prepare(
      `SELECT from_seq FROM activations WHERE activation_id=? AND room_id=? AND participant_id=?`,
    )
    .get(scope.activationId, scope.roomId, scope.participantId);
  if (!activation) throw new Error("Activation delivery source is missing");
  const cursor = database
    .prepare(
      `SELECT last_seq FROM subscription_cursors WHERE room_id=? AND participant_id=? AND consumer_id=?`,
    )
    .get(scope.roomId, scope.participantId, scope.consumerId);
  // Missing subscription has canonical initial position zero (syncRoomEventWindow),
  // not a guessed fallback for a missing activation or deleted historical row.
  let afterSeq = Math.min(
    cursor ? integer(cursor, "last_seq") : 0,
    integer(activation, "from_seq") - 1,
  );
  const obligation = database
    .prepare(
      `SELECT MIN(e.room_seq) AS first_seq FROM activation_obligations o JOIN room_events e ON e.event_id=o.source_event_id WHERE o.activation_id=? AND o.participant_id=? AND e.room_id=? AND e.room_seq<=?`,
    )
    .get(scope.activationId, scope.participantId, scope.roomId, scope.toSeq);
  if (obligation?.first_seq != null)
    afterSeq = Math.min(afterSeq, integer(obligation, "first_seq") - 1);
  if (afterSeq < 0 || afterSeq > scope.toSeq)
    throw new Error("Activation delivery boundary is invalid");
  database
    .prepare(
      `INSERT INTO activation_delivery_windows(activation_id, consumer_id, after_seq) VALUES(?, ?, ?)`,
    )
    .run(scope.activationId, scope.consumerId, afterSeq);
  return afterSeq;
}
