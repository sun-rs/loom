import type { DatabaseSync } from "node:sqlite";

import {
  ConflictError,
  NotFoundError,
  RuntimeTerminationProofError,
} from "./errors.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import { integer, text, type Row } from "./sqlite-row.ts";

export function requestActiveTaskExecutionCancellation(input: {
  actorId: string;
  createId: (prefix: string) => string;
  database: DatabaseSync;
  participantId: string;
  reason: string;
  requestedAt: string;
  roomId: string;
  taskId: string;
}): string | undefined {
  const activation = input.database
    .prepare(
      `SELECT * FROM activations
       WHERE room_id = ? AND participant_id = ? AND state = 'leased'
       ORDER BY updated_at DESC, activation_id DESC LIMIT 1`,
    )
    .get(input.roomId, input.participantId);
  if (activation === undefined) return undefined;
  const attemptNumber = integer(activation, "attempt_count");
  if (attemptNumber <= 0) return undefined;
  const requestId = input.createId("activation_cancel");
  input.database
    .prepare(
      `INSERT INTO activation_cancellation_requests(
         request_id, activation_id, activation_attempt_number, room_id,
         task_id, participant_id, requested_by, reason, requested_at
       ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      requestId,
      text(activation, "activation_id"),
      attemptNumber,
      input.roomId,
      input.taskId,
      input.participantId,
      input.actorId,
      input.reason,
      input.requestedAt,
    );
  return requestId;
}

export function unresolvedActivationCancellation(
  database: DatabaseSync,
  activation: Row,
): Row | undefined {
  return database
    .prepare(
      `SELECT 'task' AS cancellation_kind, request.*
       FROM activation_cancellation_requests AS request
       WHERE request.activation_id = ? AND request.activation_attempt_number = ?
         AND request.resolved_at IS NULL
       UNION ALL
       SELECT
         'room_sos' AS cancellation_kind,
         target.target_id AS request_id,
         target.activation_id,
         target.activation_attempt_number,
         operation.room_id,
         NULL AS task_id,
         target.participant_id,
         operation.requested_by,
         'Room Agent SOS requested by a Human manager' AS reason,
         target.requested_at,
         target.resolved_at
       FROM room_agent_sos_targets AS target
       JOIN room_agent_sos_operations AS operation
         ON operation.operation_id = target.operation_id
       WHERE target.activation_id = ?
         AND target.activation_attempt_number = ?
         AND target.state = 'requested'
         AND operation.state = 'stopping'
       LIMIT 1`,
    )
    .get(
      text(activation, "activation_id"),
      integer(activation, "attempt_count"),
      text(activation, "activation_id"),
      integer(activation, "attempt_count"),
    );
}

export function resolveRecoveredActivationCancellation(
  database: DatabaseSync,
  activation: Row,
  resolvedAt: string,
): void {
  database
    .prepare(
      `UPDATE activation_cancellation_requests
       SET resolved_at = ?
       WHERE activation_id = ? AND activation_attempt_number = ?
         AND resolved_at IS NULL`,
    )
    .run(
      resolvedAt,
      text(activation, "activation_id"),
      integer(activation, "attempt_count"),
    );
  database
    .prepare(
      `UPDATE room_agent_sos_targets
       SET state = 'terminal_proven', resolved_at = ?
       WHERE activation_id = ? AND activation_attempt_number = ?
         AND state = 'requested'`,
    )
    .run(
      resolvedAt,
      text(activation, "activation_id"),
      integer(activation, "attempt_count"),
    );
}

export function resolveActivationCancellationTransaction(input: {
  activation: Row;
  database: DatabaseSync;
  events: RoomEventWriter;
  now: Date;
  systemPrincipalId: string;
}): Row {
  const activationId = text(input.activation, "activation_id");
  const request = unresolvedActivationCancellation(
    input.database,
    input.activation,
  );
  if (request === undefined) {
    throw new ConflictError(
      `activation ${activationId} has no cancellation request`,
    );
  }
  const unfinishedRun = input.database
    .prepare(
      "SELECT run_attempt_id FROM run_attempts WHERE activation_id = ? AND state IN ('starting', 'running') LIMIT 1",
    )
    .get(activationId);
  if (unfinishedRun !== undefined) {
    throw new RuntimeTerminationProofError(
      `activation ${activationId} has unfinished RunAttempt ${text(unfinishedRun, "run_attempt_id")}`,
    );
  }
  const unterminatedRuntime = input.database
    .prepare(
      "SELECT runtime_process_id FROM runtime_processes WHERE activation_id = ? AND state <> 'terminated' LIMIT 1",
    )
    .get(activationId);
  if (unterminatedRuntime !== undefined) {
    throw new RuntimeTerminationProofError(
      `activation ${activationId} has RuntimeProcess ${text(unterminatedRuntime, "runtime_process_id")} without terminal proof`,
    );
  }

  const followUp = input.database
    .prepare(
      "SELECT * FROM activations WHERE room_id = ? AND participant_id = ? AND state = 'queued' AND activation_id <> ?",
    )
    .get(
      text(input.activation, "room_id"),
      text(input.activation, "participant_id"),
      activationId,
    );
  let fromSeq = integer(input.activation, "from_seq");
  let toSeq = integer(input.activation, "to_seq");
  let mergedActivationId: string | undefined;
  if (followUp !== undefined) {
    fromSeq = Math.min(fromSeq, integer(followUp, "from_seq"));
    toSeq = Math.max(toSeq, integer(followUp, "to_seq"));
    mergedActivationId = text(followUp, "activation_id");
    input.database
      .prepare(
        "UPDATE activations SET state = 'cancelled', last_error = ?, updated_at = ? WHERE activation_id = ?",
      )
      .run(
        `merged into cancelled execution ${activationId}`,
        input.now.toISOString(),
        mergedActivationId,
      );
  }
  const taskCancellation = text(request, "cancellation_kind") === "task";
  const cancellationLabel = taskCancellation
    ? `Task ${text(request, "task_id")} execution cancelled`
    : "Room Agent SOS execution stopped";
  input.database
    .prepare(
      "UPDATE activations SET state = 'queued', from_seq = ?, to_seq = ?, lease_owner = NULL, lease_until = NULL, lease_until_ms = NULL, available_at = ?, available_at_ms = ?, last_error = ?, updated_at = ? WHERE activation_id = ?",
    )
    .run(
      fromSeq,
      toSeq,
      input.now.toISOString(),
      input.now.getTime(),
      cancellationLabel,
      input.now.toISOString(),
      activationId,
    );
  if (taskCancellation) {
    input.database
      .prepare(
        "UPDATE activation_cancellation_requests SET resolved_at = ? WHERE request_id = ?",
      )
      .run(input.now.toISOString(), text(request, "request_id"));
  } else {
    input.database
      .prepare(
        "UPDATE room_agent_sos_targets SET state = 'terminal_proven', resolved_at = ? WHERE target_id = ?",
      )
      .run(input.now.toISOString(), text(request, "request_id"));
  }
  input.events.append({
    actorId: input.systemPrincipalId,
    aggregateId: activationId,
    aggregateType: "activation",
    idempotencyKey: `activation.cancellation_resolved:${text(request, "request_id")}`,
    payload: {
      activationId,
      cancellationRequestId: text(request, "request_id"),
      ...(mergedActivationId === undefined ? {} : { mergedActivationId }),
      ...(taskCancellation
        ? { taskId: text(request, "task_id") }
        : { roomAgentSosTargetId: text(request, "request_id") }),
    },
    roomId: text(input.activation, "room_id"),
    type: "activation.cancellation_resolved",
  });
  const updated = input.database
    .prepare("SELECT * FROM activations WHERE activation_id = ?")
    .get(activationId);
  if (updated === undefined) {
    throw new NotFoundError(`activation ${activationId} was not found`);
  }
  return updated;
}
