import type { DatabaseSync } from "node:sqlite";
import type { ActivationCredentialScope } from "@rah-os/protocol";

import { ACTIVATION_DELIVERY_NOT_ACKNOWLEDGED } from "./errors.ts";
import { nullableText } from "./sqlite-row.ts";

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

/** The rendered window's optional retry flag (`previousAttemptUnconfirmed`). */
export function retryReminder(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
): { previousAttemptUnconfirmed?: true } {
  return previousAttemptUnconfirmed(database, scope)
    ? { previousAttemptUnconfirmed: true }
    : {};
}
