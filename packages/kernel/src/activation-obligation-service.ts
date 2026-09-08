import type { DatabaseSync } from "node:sqlite";

import type { RoomEvent } from "@rah-os/protocol";

import { TaskSubmissionProofError } from "./errors.ts";
import {
  integer,
  jsonObject,
  nullableText,
  text,
  type Row,
} from "./sqlite-row.ts";

export type ActivationObligationSpec =
  | {
      kind: "task_owner_follow_up";
      taskId: string;
    }
  | {
      kind: "task_review";
      submissionId: string;
      taskId: string;
    };

export class ActivationObligationService {
  readonly #createId: (prefix: string) => string;
  readonly #database: DatabaseSync;

  constructor(input: {
    createId: (prefix: string) => string;
    database: DatabaseSync;
  }) {
    this.#createId = input.createId;
    this.#database = input.database;
  }

  record(input: {
    activationId: string;
    createdAt: string;
    event: RoomEvent;
    participantId: string;
    specs: readonly ActivationObligationSpec[];
  }): void {
    for (const spec of input.specs) {
      const submissionId =
        spec.kind === "task_review" ? spec.submissionId : null;
      const obligationKey = [
        spec.kind,
        input.event.eventId,
        input.participantId,
        spec.taskId,
        submissionId ?? "-",
      ].join(":");
      this.#database
        .prepare(
          `INSERT OR IGNORE INTO activation_obligations(
             obligation_id, obligation_key, activation_id, room_id,
             participant_id, source_event_id, kind, task_id, submission_id,
             created_at
           ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          this.#createId("activation_obligation"),
          obligationKey,
          input.activationId,
          input.event.roomId,
          input.participantId,
          input.event.eventId,
          spec.kind,
          spec.taskId,
          submissionId,
          input.createdAt,
        );
    }
  }

  backfillActive(): void {
    const rows = this.#database
      .prepare(
        `SELECT
           activations.activation_id,
           activations.participant_id,
           inbox_items.reason,
           room_events.*
         FROM activations
         JOIN room_events
           ON room_events.room_id = activations.room_id
          AND room_events.room_seq BETWEEN activations.from_seq AND activations.to_seq
         JOIN inbox_items
           ON inbox_items.event_id = room_events.event_id
          AND inbox_items.participant_id = activations.participant_id
         WHERE activations.state IN ('queued', 'leased', 'quarantined')
         ORDER BY activations.activation_id, room_events.room_seq`,
      )
      .all();
    for (const row of rows) {
      const event = this.#eventFromBackfillRow(row);
      const specs = this.#inferLegacySpecs(
        text(row, "reason"),
        event,
        text(row, "participant_id"),
      ).filter(
        (spec) =>
          !this.#database
            .prepare(
              `SELECT 1 FROM room_events WHERE room_id = ? AND aggregate_type = 'task'
         AND aggregate_id = ? AND type = 'task.deleted' AND room_seq > ? LIMIT 1`,
            )
            .get(event.roomId, spec.taskId, event.roomSeq),
      );
      if (specs.length === 0) continue;
      this.record({
        activationId: text(row, "activation_id"),
        createdAt: event.createdAt,
        event,
        participantId: text(row, "participant_id"),
        specs,
      });
    }
  }

  assertSatisfied(activationId: string): void {
    const rows = this.#database
      .prepare(
        `SELECT * FROM activation_obligations
         WHERE activation_id = ?
         ORDER BY created_at, obligation_id`,
      )
      .all(activationId);
    for (const row of rows) {
      const kind = text(row, "kind");
      if (kind === "task_owner_follow_up") {
        this.#assertOwnerFollowUpSatisfied(activationId, row);
        continue;
      }
      if (kind === "task_review") {
        this.#assertReviewSatisfied(activationId, row);
        continue;
      }
      throw new TaskSubmissionProofError(
        `activation ${activationId} has unknown business obligation ${kind}`,
      );
    }
    this.#assertLegacyTaskSatisfied(activationId);
  }

  #assertLegacyTaskSatisfied(activationId: string): void {
    const activation = this.#database
      .prepare("SELECT * FROM activations WHERE activation_id = ?")
      .get(activationId);
    if (activation === undefined) {
      throw new TaskSubmissionProofError(
        `activation ${activationId} was not found while proving Task obligations`,
      );
    }
    const unfinishedTask = this.#database
      .prepare(
        `SELECT DISTINCT tasks.task_id, tasks.state
         FROM room_events
         JOIN tasks ON (
           room_events.type IN ('task.created', 'task.assigned', 'task.unblocked', 'task.released')
           AND tasks.task_id = room_events.aggregate_id
           OR room_events.type = 'message.posted'
           AND room_events.aggregate_type = 'message'
           AND tasks.source_message_id = room_events.aggregate_id
           OR room_events.type = 'input.resolved'
           AND tasks.task_id = json_extract(room_events.payload_json, '$.taskId')
           OR room_events.type = 'task.completed'
           AND EXISTS (
             SELECT 1 FROM json_each(room_events.payload_json, '$.readyTaskIds')
             WHERE json_each.value = tasks.task_id
           )
         )
         WHERE room_events.room_id = ?
           AND room_events.room_seq BETWEEN ? AND ?
           AND EXISTS (
             SELECT 1 FROM inbox_items
             WHERE inbox_items.event_id = room_events.event_id
               AND inbox_items.participant_id = ?
           )
           AND tasks.assignee_id = ?
           AND tasks.state NOT IN ('waiting_input', 'blocked', 'submitted', 'completed', 'cancelled')
           AND NOT EXISTS (
             SELECT 1 FROM room_events AS requested_input
             WHERE requested_input.room_id = room_events.room_id
               AND requested_input.room_seq > ?
               AND requested_input.type = 'input.requested'
               AND requested_input.actor_id = ?
               AND json_extract(requested_input.payload_json, '$.taskId') = tasks.task_id
           )
         ORDER BY room_events.room_seq
         LIMIT 1`,
      )
      .get(
        text(activation, "room_id"),
        integer(activation, "from_seq"),
        integer(activation, "to_seq"),
        text(activation, "participant_id"),
        text(activation, "participant_id"),
        integer(activation, "to_seq"),
        text(activation, "participant_id"),
      );
    if (unfinishedTask !== undefined) {
      throw new TaskSubmissionProofError(
        `activation ${activationId} contains unfinished Task ${text(unfinishedTask, "task_id")} in state ${text(unfinishedTask, "state")}`,
      );
    }
  }

  #assertOwnerFollowUpSatisfied(activationId: string, obligation: Row): void {
    const taskId = text(obligation, "task_id");
    const participantId = text(obligation, "participant_id");
    const task = this.#database
      .prepare(
        "SELECT state, assignee_id, claimed_by FROM tasks WHERE task_id = ?",
      )
      .get(taskId);
    if (task === undefined) {
      throw new TaskSubmissionProofError(
        `activation ${activationId} business obligation references missing Task ${taskId}`,
      );
    }
    const state = text(task, "state");
    const stillOwned =
      nullableText(task, "assignee_id") === participantId ||
      nullableText(task, "claimed_by") === participantId;
    if (!stillOwned) return;
    if (
      state === "waiting_input" ||
      state === "blocked" ||
      state === "submitted" ||
      state === "completed" ||
      state === "cancelled"
    ) {
      return;
    }
    throw new TaskSubmissionProofError(
      `activation ${activationId} requires Agent ${participantId} to produce a canonical outcome for Task ${taskId}; current state is ${state}`,
    );
  }

  #assertReviewSatisfied(activationId: string, obligation: Row): void {
    const participantId = text(obligation, "participant_id");
    const submissionId = text(obligation, "submission_id");
    const taskId = text(obligation, "task_id");
    const review = this.#database
      .prepare(
        "SELECT review_id FROM task_reviews WHERE submission_id = ? AND reviewer_id = ?",
      )
      .get(submissionId, participantId);
    if (review !== undefined) return;
    const task = this.#database
      .prepare("SELECT state FROM tasks WHERE task_id = ?")
      .get(taskId);
    if (task === undefined) {
      throw new TaskSubmissionProofError(
        `activation ${activationId} review obligation references missing Task ${taskId}`,
      );
    }
    const currentSubmission = this.#database
      .prepare(
        `SELECT submission_id FROM task_submissions
         WHERE task_id = ? ORDER BY submission_number DESC LIMIT 1`,
      )
      .get(taskId);
    if (
      text(task, "state") !== "submitted" ||
      currentSubmission === undefined ||
      text(currentSubmission, "submission_id") !== submissionId
    ) {
      return;
    }
    throw new TaskSubmissionProofError(
      `activation ${activationId} requires Agent ${participantId} to record a canonical Review for submission ${submissionId} of Task ${taskId}`,
    );
  }

  #inferLegacySpecs(
    reason: string,
    event: RoomEvent,
    participantId: string,
  ): ActivationObligationSpec[] {
    if (reason === "task_review" && event.type === "task.submitted") {
      const taskId = event.aggregateId;
      const submissionId = event.payload.submissionId;
      if (typeof submissionId === "string" && submissionId.length > 0) {
        return [{ kind: "task_review", submissionId, taskId }];
      }
      const currentSubmission = this.#database
        .prepare(
          `SELECT submission_id FROM task_submissions
           WHERE task_id = ? ORDER BY submission_number DESC LIMIT 1`,
        )
        .get(taskId);
      return currentSubmission === undefined
        ? []
        : [
            {
              kind: "task_review",
              submissionId: text(currentSubmission, "submission_id"),
              taskId,
            },
          ];
    }
    if (reason !== "task_assigned") return [];
    if (event.type === "task.reopened" || event.type === "task.reassigned") {
      return [{ kind: "task_owner_follow_up", taskId: event.aggregateId }];
    }
    if (
      event.type === "review.submitted" &&
      event.payload.disposition === "changes_requested" &&
      typeof event.payload.taskId === "string"
    ) {
      const task = this.#database
        .prepare("SELECT assignee_id FROM tasks WHERE task_id = ?")
        .get(event.payload.taskId);
      return task !== undefined &&
        nullableText(task, "assignee_id") === participantId
        ? [
            {
              kind: "task_owner_follow_up",
              taskId: event.payload.taskId,
            },
          ]
        : [];
    }
    return [];
  }

  #eventFromBackfillRow(row: Row): RoomEvent {
    return {
      actorId: text(row, "actor_id"),
      aggregateId: text(row, "aggregate_id"),
      aggregateType: text(row, "aggregate_type"),
      createdAt: text(row, "created_at"),
      eventId: text(row, "event_id"),
      idempotencyKey: text(row, "idempotency_key"),
      payload: jsonObject(row, "payload_json"),
      roomId: text(row, "room_id"),
      roomSeq: integer(row, "room_seq"),
      schemaVersion: integer(row, "schema_version"),
      type: text(row, "type"),
    };
  }
}
