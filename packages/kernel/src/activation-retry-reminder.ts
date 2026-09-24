import type { DatabaseSync } from "node:sqlite";
import type { ActivationCredentialScope } from "@rah-os/protocol";

import { ACTIVATION_DELIVERY_NOT_ACKNOWLEDGED } from "./errors.ts";
import { nullableText, text } from "./sqlite-row.ts";

/**
 * True when this Activation was retried because its previous RunAttempt ended
 * with neither a reply nor a delivery confirmation: the durable retry record
 * (`activations.last_error`) is the completion refusal for an unacknowledged
 * head, and no message of this Activation was committed. Read-only; the wake
 * turns it into one reminder line, and only the retry that follows carries it
 * (any later retry for another reason replaces `last_error`).
 */
export function previousAttemptUnconfirmed(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
): boolean {
  const row = database
    .prepare(
      "SELECT last_error FROM activations WHERE activation_id=? AND participant_id=?",
    )
    .get(scope.activationId, scope.participantId);
  const lastError = row === undefined ? null : nullableText(row, "last_error");
  if (lastError?.includes(ACTIVATION_DELIVERY_NOT_ACKNOWLEDGED) !== true)
    return false;
  const posted = database
    .prepare(
      `SELECT 1 FROM room_events WHERE type='message.posted' AND actor_id=?
        AND json_extract(payload_json, '$.activationId')=? LIMIT 1`,
    )
    .get(scope.participantId, scope.activationId);
  return posted === undefined;
}

/**
 * The message a previous RunAttempt of this Activation already committed in
 * this Room when that attempt ended without acknowledging delivery: the same
 * durable retry record, plus this participant's latest post carrying this
 * Activation. A neutral fact: it may be a progress post or one of several
 * targets' answers. `final` only when that post carries this Activation's
 * final-reply marker. Read-only.
 */
export function previousAttemptReply(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
): { messageId: string; final: boolean } | undefined {
  const row = database
    .prepare(
      "SELECT last_error FROM activations WHERE activation_id=? AND participant_id=?",
    )
    .get(scope.activationId, scope.participantId);
  const lastError = row === undefined ? null : nullableText(row, "last_error");
  if (lastError?.includes(ACTIVATION_DELIVERY_NOT_ACKNOWLEDGED) !== true)
    return undefined;
  const posted = database
    .prepare(
      `SELECT aggregate_id, event_id FROM room_events WHERE type='message.posted'
        AND room_id=? AND actor_id=?
        AND json_extract(payload_json, '$.activationId')=?
        ORDER BY room_seq DESC LIMIT 1`,
    )
    .get(scope.roomId, scope.participantId, scope.activationId);
  if (posted === undefined) return undefined;
  const final = database
    .prepare(
      "SELECT 1 FROM run_attempt_final_replies WHERE activation_id=? AND event_id=? LIMIT 1",
    )
    .get(scope.activationId, text(posted, "event_id"));
  return {
    messageId: text(posted, "aggregate_id"),
    final: final !== undefined,
  };
}

/** The rendered window's optional retry facts: either the previous attempt
 * posted nothing (`previousAttemptUnconfirmed`) or it already committed a
 * post that was never acknowledged (`previousAttemptReplyMessageId`, plus
 * `previousAttemptReplyFinal` only when that post was the final reply). */
export function retryReminder(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
): {
  previousAttemptUnconfirmed?: true;
  previousAttemptReplyMessageId?: string;
  previousAttemptReplyFinal?: true;
} {
  if (previousAttemptUnconfirmed(database, scope))
    return { previousAttemptUnconfirmed: true };
  const reply = previousAttemptReply(database, scope);
  return reply === undefined
    ? {}
    : {
        previousAttemptReplyMessageId: reply.messageId,
        ...(reply.final ? { previousAttemptReplyFinal: true as const } : {}),
      };
}
