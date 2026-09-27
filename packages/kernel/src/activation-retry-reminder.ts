import type { DatabaseSync } from "node:sqlite";
import {
  BUSINESS_OBLIGATION_UNMET_MARKER,
  type ActivationCredentialScope,
} from "@rah-os/protocol";

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
 * True when a retry with `error` follows a RunAttempt that ended cleanly
 * (state `exited`, exit 0 or a successful native turn, no error or signal)
 * with neither a reply nor a delivery confirmation: `error` is exactly the
 * Kernel's completion refusal (no appended run failure) and no message of
 * this Activation was committed. Read before the retry is written, from the
 * durable RunAttempt, not from the Host's classification alone.
 */
export function previousAttemptCleanExitUnconfirmed(
  database: DatabaseSync,
  input: Readonly<{
    activationId: string;
    error: string;
    participantId: string;
  }>,
): boolean {
  if (!input.error.startsWith(ACTIVATION_DELIVERY_NOT_ACKNOWLEDGED))
    return false;
  if (!/^[^;]*\d+$/u.test(input.error)) return false;
  const attempt = database
    .prepare(
      `SELECT state, exit_code, exit_signal, error FROM run_attempts
        WHERE activation_id = ? ORDER BY attempt_number DESC LIMIT 1`,
    )
    .get(input.activationId);
  if (attempt === undefined) return false;
  const exitCode = attempt.exit_code;
  if (
    text(attempt, "state") !== "exited" ||
    (exitCode !== null && exitCode !== 0) ||
    nullableText(attempt, "exit_signal") !== null ||
    nullableText(attempt, "error") !== null
  )
    return false;
  const posted = database
    .prepare(
      `SELECT 1 FROM room_events WHERE type='message.posted' AND actor_id=?
        AND json_extract(payload_json, '$.activationId')=? LIMIT 1`,
    )
    .get(input.participantId, input.activationId);
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

/**
 * The business-obligation completion refusal that caused this retry (the
 * durable retry record carries `BUSINESS_OBLIGATION_UNMET_MARKER`), without
 * the marker. A fact the wake states once; never a behaviour rule.
 */
export function previousAttemptRefusal(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
): string | undefined {
  const row = database
    .prepare(
      "SELECT last_error FROM activations WHERE activation_id=? AND participant_id=?",
    )
    .get(scope.activationId, scope.participantId);
  const lastError = row === undefined ? null : nullableText(row, "last_error");
  const index = lastError?.indexOf(BUSINESS_OBLIGATION_UNMET_MARKER) ?? -1;
  if (lastError === null || lastError === undefined || index < 0)
    return undefined;
  const reason = lastError
    .slice(index + BUSINESS_OBLIGATION_UNMET_MARKER.length)
    .replace(/^:\s*/u, "")
    .trim()
    .slice(0, 2_000)
    .trim();
  return reason.length === 0 ? undefined : reason;
}

/**
 * The final reply an earlier RunAttempt of this Activation committed (its
 * durable final-reply marker), whatever the retry reason. Read-only.
 */
export function previousAttemptFinalReply(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
): { messageId: string; threadId?: string } | undefined {
  const row = database
    .prepare(
      `SELECT room_events.aggregate_id,
              json_extract(room_events.payload_json, '$.threadId') AS thread_id
       FROM run_attempt_final_replies
       JOIN room_events ON room_events.event_id = run_attempt_final_replies.event_id
       WHERE run_attempt_final_replies.activation_id = ?
         AND run_attempt_final_replies.run_attempt_id <> ?
       ORDER BY run_attempt_final_replies.room_seq DESC LIMIT 1`,
    )
    .get(scope.activationId, scope.runAttemptId);
  if (row === undefined) return undefined;
  const threadId = nullableText(row, "thread_id");
  return {
    messageId: text(row, "aggregate_id"),
    ...(threadId === null ? {} : { threadId }),
  };
}

/** The rendered window's optional retry facts: either the previous attempt
 * posted nothing (`previousAttemptUnconfirmed`) or it already committed a
 * post that was never acknowledged (`previousAttemptReplyMessageId`, plus
 * `previousAttemptReplyFinal` only when that post was the final reply). Any
 * earlier attempt's committed final reply is named whatever the retry reason,
 * with its Thread; a business-obligation refusal is stated as
 * `previousAttemptRefusal`. */
export function retryReminder(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
): {
  previousAttemptUnconfirmed?: true;
  previousAttemptReplyMessageId?: string;
  previousAttemptReplyFinal?: true;
  previousAttemptReplyThreadId?: string;
  previousAttemptRefusal?: string;
} {
  if (previousAttemptUnconfirmed(database, scope))
    return { previousAttemptUnconfirmed: true };
  const refusal = previousAttemptRefusal(database, scope);
  const refusalFact =
    refusal === undefined ? {} : { previousAttemptRefusal: refusal };
  const reply = previousAttemptReply(database, scope);
  if (reply !== undefined)
    return {
      previousAttemptReplyMessageId: reply.messageId,
      ...(reply.final ? { previousAttemptReplyFinal: true as const } : {}),
      ...refusalFact,
    };
  const final = previousAttemptFinalReply(database, scope);
  if (final === undefined) return refusalFact;
  return {
    previousAttemptReplyMessageId: final.messageId,
    previousAttemptReplyFinal: true,
    ...(final.threadId === undefined
      ? {}
      : { previousAttemptReplyThreadId: final.threadId }),
    ...refusalFact,
  };
}
