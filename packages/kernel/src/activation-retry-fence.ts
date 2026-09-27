import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  BUSINESS_OBLIGATION_UNMET_MARKER,
  WakeHintSchema,
  type RuntimeRetryDisposition,
} from "@rah-os/protocol";

import { previousAttemptCleanExitUnconfirmed } from "./activation-retry-reminder.ts";
import { integer, nullableText, text } from "./sqlite-row.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";

export const ACTIVATION_RUNTIME_ERROR_FENCE_THRESHOLD = 3;

export type ActivationRetryFenceObservation = Readonly<{
  blocked: boolean;
  errorFingerprint: string;
  sameErrorCount: number;
  threshold: number;
}>;

export function applyActivationRetryPolicy(
  database: DatabaseSync,
  events: RoomEventWriter,
  input: Readonly<{
    activationId: string;
    attemptCount: number;
    error: string;
    fromSeq: number;
    hostId: string;
    mergedActivationId?: string;
    now: Date;
    participantId: string;
    retryAfterMs: number;
    retryDisposition?: RuntimeRetryDisposition;
    roomId: string;
    systemPrincipalId: string;
    toSeq: number;
  }>,
): ActivationRetryFenceObservation {
  const observedAt = input.now.toISOString();
  const retryDisposition = input.retryDisposition ?? "recoverable";
  // The previous RunAttempt ended cleanly without a reply or delivery
  // confirmation: not a transient failure, so the retry is leasable now and
  // one Outbox wake hint is recorded. The same-error fence still counts it.
  const wakeNow =
    retryDisposition === "recoverable" &&
    previousAttemptCleanExitUnconfirmed(database, input);
  const retryDelayMs = wakeNow ? 0 : input.retryAfterMs;
  const retryFence =
    retryDisposition === "recoverable"
      ? noteActivationRetryFailure(database, {
          activationId: input.activationId,
          error: input.error,
          observedAt,
          participantId: input.participantId,
          roomId: input.roomId,
        })
      : noteImmediateActivationRetryBlock(database, {
          activationId: input.activationId,
          error: input.error,
          observedAt,
          participantId: input.participantId,
          retryDisposition,
          roomId: input.roomId,
        });
  if (retryFence.blocked) {
    database
      .prepare(
        "UPDATE activations SET state = 'quarantined', from_seq = ?, to_seq = ?, lease_owner = NULL, lease_until = NULL, lease_until_ms = NULL, last_error = ?, updated_at = ? WHERE activation_id = ?",
      )
      .run(
        input.fromSeq,
        input.toSeq,
        input.error,
        observedAt,
        input.activationId,
      );
  } else {
    const availableAt = new Date(input.now.getTime() + retryDelayMs);
    database
      .prepare(
        "UPDATE activations SET state = 'queued', from_seq = ?, to_seq = ?, lease_owner = NULL, lease_until = NULL, lease_until_ms = NULL, available_at = ?, available_at_ms = ?, last_error = ?, updated_at = ? WHERE activation_id = ?",
      )
      .run(
        input.fromSeq,
        input.toSeq,
        availableAt.toISOString(),
        availableAt.getTime(),
        input.error,
        observedAt,
        input.activationId,
      );
  }
  const availableAt = retryFence.blocked
    ? undefined
    : new Date(input.now.getTime() + retryDelayMs).toISOString();
  const event = events.append({
    actorId: input.systemPrincipalId,
    aggregateId: input.activationId,
    aggregateType: "activation",
    idempotencyKey: `activation.${retryFence.blocked ? "retry_blocked" : "retry"}:${input.activationId}:${input.attemptCount}`,
    payload: {
      activationId: input.activationId,
      ...(availableAt === undefined ? {} : { availableAt }),
      error: input.error,
      errorFingerprint: retryFence.errorFingerprint,
      hostId: input.hostId,
      ...(input.mergedActivationId === undefined
        ? {}
        : { mergedActivationId: input.mergedActivationId }),
      sameErrorCount: retryFence.sameErrorCount,
      threshold: retryFence.threshold,
      retryDisposition,
      actionRequired: retryDisposition === "action_required",
      sticky: retryDisposition !== "recoverable",
    },
    roomId: input.roomId,
    type: retryFence.blocked
      ? "activation.retry_blocked"
      : "activation.retry_scheduled",
  });
  if (wakeNow && !retryFence.blocked) {
    const row = database
      .prepare("SELECT reason FROM activations WHERE activation_id = ?")
      .get(input.activationId);
    events.insertOutbox({
      payload: WakeHintSchema.parse({
        activationId: input.activationId,
        headCursor: input.toSeq,
        participantId: input.participantId,
        reason: row === undefined ? undefined : text(row, "reason"),
        roomId: input.roomId,
      }),
      roomId: input.roomId,
      roomSeq: event.roomSeq,
      topic: "activation.requested",
    });
  }
  return retryFence;
}

export function activationFailureFingerprint(error: string): string {
  const normalized = error
    .trim()
    .toLowerCase()
    .replace(
      /\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?z\b/gu,
      "<timestamp>",
    )
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gu,
      "<uuid>",
    )
    .replace(/\b0x[0-9a-f]+\b/gu, "<hex>")
    .replace(/\s+/gu, " ");
  return createHash("sha256").update(normalized).digest("hex");
}

export function noteActivationRetryFailure(
  database: DatabaseSync,
  input: Readonly<{
    activationId: string;
    error: string;
    observedAt: string;
    participantId: string;
    roomId: string;
  }>,
): ActivationRetryFenceObservation {
  const errorFingerprint = activationFailureFingerprint(input.error);
  const existing = database
    .prepare("SELECT * FROM activation_retry_fences WHERE activation_id = ?")
    .get(input.activationId);
  const sameErrorCount =
    existing !== undefined &&
    nullableText(existing, "error_fingerprint") === errorFingerprint &&
    text(existing, "state") !== "resolved"
      ? integer(existing, "same_error_count") + 1
      : 1;
  const blocked = sameErrorCount >= ACTIVATION_RUNTIME_ERROR_FENCE_THRESHOLD;
  database
    .prepare(
      `INSERT INTO activation_retry_fences(
         activation_id, room_id, participant_id, state, retry_disposition, error_fingerprint,
         same_error_count, last_error, first_observed_at, last_observed_at,
         blocked_at, resolved_at, resolution_kind
       ) VALUES(?, ?, ?, ?, 'recoverable', ?, ?, ?, ?, ?, ?, NULL, NULL)
       ON CONFLICT(activation_id) DO UPDATE SET
         room_id = excluded.room_id,
         participant_id = excluded.participant_id,
         state = excluded.state,
         retry_disposition = excluded.retry_disposition,
         error_fingerprint = excluded.error_fingerprint,
         same_error_count = excluded.same_error_count,
         last_error = excluded.last_error,
         first_observed_at = CASE
           WHEN activation_retry_fences.error_fingerprint = excluded.error_fingerprint
            AND activation_retry_fences.state <> 'resolved'
             THEN activation_retry_fences.first_observed_at
           ELSE excluded.first_observed_at
         END,
         last_observed_at = excluded.last_observed_at,
         blocked_at = excluded.blocked_at,
         resolved_at = NULL,
         resolution_kind = NULL`,
    )
    .run(
      input.activationId,
      input.roomId,
      input.participantId,
      blocked ? "blocked" : "observing",
      errorFingerprint,
      sameErrorCount,
      input.error,
      input.observedAt,
      input.observedAt,
      blocked ? input.observedAt : null,
    );
  return Object.freeze({
    blocked,
    errorFingerprint,
    sameErrorCount,
    threshold: ACTIVATION_RUNTIME_ERROR_FENCE_THRESHOLD,
  });
}

function noteImmediateActivationRetryBlock(
  database: DatabaseSync,
  input: Readonly<{
    activationId: string;
    error: string;
    observedAt: string;
    participantId: string;
    retryDisposition: Exclude<RuntimeRetryDisposition, "recoverable">;
    roomId: string;
  }>,
): ActivationRetryFenceObservation {
  const errorFingerprint = activationFailureFingerprint(input.error);
  database
    .prepare(
      `INSERT INTO activation_retry_fences(
         activation_id, room_id, participant_id, state, retry_disposition,
         error_fingerprint, same_error_count, last_error, first_observed_at,
         last_observed_at, blocked_at, resolved_at, resolution_kind
       ) VALUES(?, ?, ?, 'blocked', ?, ?, 0, ?, ?, ?, ?, NULL, NULL)
       ON CONFLICT(activation_id) DO UPDATE SET
         room_id = excluded.room_id,
         participant_id = excluded.participant_id,
         state = 'blocked',
         retry_disposition = excluded.retry_disposition,
         error_fingerprint = excluded.error_fingerprint,
         same_error_count = 0,
         last_error = excluded.last_error,
         first_observed_at = excluded.first_observed_at,
         last_observed_at = excluded.last_observed_at,
         blocked_at = excluded.blocked_at,
         resolved_at = NULL,
         resolution_kind = NULL`,
    )
    .run(
      input.activationId,
      input.roomId,
      input.participantId,
      input.retryDisposition,
      errorFingerprint,
      input.error,
      input.observedAt,
      input.observedAt,
      input.observedAt,
    );
  return Object.freeze({
    blocked: true,
    errorFingerprint,
    sameErrorCount: 0,
    threshold: ACTIVATION_RUNTIME_ERROR_FENCE_THRESHOLD,
  });
}

export function isActivationRetryBlocked(
  database: DatabaseSync,
  activationId: string,
): boolean {
  return (
    database
      .prepare(
        "SELECT 1 FROM activation_retry_fences WHERE activation_id = ? AND state = 'blocked'",
      )
      .get(activationId) !== undefined
  );
}

export function resolveActivationRetryFence(
  database: DatabaseSync,
  input: Readonly<{
    activationId: string;
    resolutionKind: "progress" | "restart";
    resolvedAt: string;
  }>,
): void {
  database
    .prepare(
      `UPDATE activation_retry_fences
       SET state = 'resolved', resolved_at = ?, resolution_kind = ?
       WHERE activation_id = ? AND state <> 'resolved'`,
    )
    .run(input.resolvedAt, input.resolutionKind, input.activationId);
}

export type ResumedActivationRetryFence = Readonly<{
  activationId: string;
  errorFingerprint: string;
  mergedActivationId?: string;
  roomId: string;
  sameErrorCount: number;
}>;

/**
 * SQL predicate over an `activations` row alias: the row holds its
 * participant's execution lane. A leased row holds it while its lease lasts;
 * a quarantined row holds it unless (D2-1) its blocked retry fence records a
 * business-obligation refusal (`BUSINESS_OBLIGATION_UNMET_MARKER`) and none of
 * its runs or runtime processes is still live: that refusal is not a Runtime
 * failure, and no process of it remains. `?` binds the current time in ms.
 */
export function activationHoldsLanePredicate(alias: string): string {
  return `(
    ${alias}.state = 'leased' AND ${alias}.lease_until_ms > ?
    OR ${alias}.state = 'quarantined' AND NOT (
      instr(COALESCE(${alias}.last_error, ''), '${BUSINESS_OBLIGATION_UNMET_MARKER}') > 0
      AND EXISTS (
        SELECT 1 FROM activation_retry_fences AS lane_fence
        WHERE lane_fence.activation_id = ${alias}.activation_id
          AND lane_fence.state = 'blocked'
      )
      AND NOT EXISTS (
        SELECT 1 FROM runtime_processes AS lane_process
        WHERE lane_process.activation_id = ${alias}.activation_id
          AND lane_process.state <> 'terminated'
      )
      AND NOT EXISTS (
        SELECT 1 FROM run_attempts AS lane_run
        WHERE lane_run.activation_id = ${alias}.activation_id
          AND lane_run.state IN ('starting', 'running', 'orphaned')
      )
    )
  )`;
}

/**
 * The Host's marker for a failure that only a new native session can clear
 * (`runtime-error-policy.ts`): a lost, ambiguous or refused session binding.
 */
export const SESSION_CONTINUITY_FAILURE_MARKER =
  "RAH_SESSION_CONTINUITY_REQUIRED";

/**
 * Requeues the participant's retry-blocked quarantined Activations (merging a
 * queued follow-up) and resolves their fences as `restart`. `errorMarker`
 * narrows the recovery to fences whose last error carries it, so an exit that
 * clears one cause never lifts an unrelated safety fence.
 */
export function resumeBlockedActivationRetryFences(
  database: DatabaseSync,
  input: Readonly<{
    errorMarker?: string;
    participantId: string;
    resumedAt: string;
  }>,
): readonly ResumedActivationRetryFence[] {
  const rows = database
    .prepare(
      `SELECT activation_retry_fences.*, activations.from_seq, activations.to_seq,
              activations.state AS activation_state
       FROM activation_retry_fences
       JOIN activations USING(activation_id)
       WHERE activation_retry_fences.participant_id = ?
         AND activation_retry_fences.state = 'blocked'
         AND (? IS NULL OR instr(activation_retry_fences.last_error, ?) > 0)
       ORDER BY activation_retry_fences.blocked_at, activation_retry_fences.activation_id`,
    )
    .all(
      input.participantId,
      input.errorMarker ?? null,
      input.errorMarker ?? null,
    );
  const resumed: ResumedActivationRetryFence[] = [];
  for (const row of rows) {
    if (text(row, "activation_state") !== "quarantined") continue;
    const activationId = text(row, "activation_id");
    const roomId = text(row, "room_id");
    let fromSeq = integer(row, "from_seq");
    let toSeq = integer(row, "to_seq");
    const followUp = database
      .prepare(
        `SELECT * FROM activations
         WHERE room_id = ? AND participant_id = ? AND state = 'queued'
           AND activation_id <> ?
         ORDER BY created_at, activation_id
         LIMIT 1`,
      )
      .get(roomId, input.participantId, activationId);
    let mergedActivationId: string | undefined;
    if (followUp !== undefined) {
      mergedActivationId = text(followUp, "activation_id");
      fromSeq = Math.min(fromSeq, integer(followUp, "from_seq"));
      toSeq = Math.max(toSeq, integer(followUp, "to_seq"));
      database
        .prepare(
          "UPDATE activations SET state = 'cancelled', last_error = ?, updated_at = ? WHERE activation_id = ?",
        )
        .run(
          `merged into restarted activation ${activationId}`,
          input.resumedAt,
          mergedActivationId,
        );
    }
    database
      .prepare(
        `UPDATE activations
         SET state = 'queued', from_seq = ?, to_seq = ?, lease_owner = NULL,
             lease_until = NULL, lease_until_ms = NULL, available_at = ?,
             available_at_ms = ?, last_error = NULL, updated_at = ?
         WHERE activation_id = ?`,
      )
      .run(
        fromSeq,
        toSeq,
        input.resumedAt,
        Date.parse(input.resumedAt),
        input.resumedAt,
        activationId,
      );
    resolveActivationRetryFence(database, {
      activationId,
      resolutionKind: "restart",
      resolvedAt: input.resumedAt,
    });
    resumed.push(
      Object.freeze({
        activationId,
        errorFingerprint: text(row, "error_fingerprint"),
        ...(mergedActivationId === undefined ? {} : { mergedActivationId }),
        roomId,
        sameErrorCount: integer(row, "same_error_count"),
      }),
    );
  }
  return Object.freeze(resumed);
}
