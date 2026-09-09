import type { DatabaseSync } from "node:sqlite";

import {
  ClientAgentRemindersListRequestSchema,
  ClientAgentRemindersListResponseSchema,
  ReminderEventSchema,
  ReminderSchema,
  WorkerReminderCancelRequestSchema,
  WorkerReminderListRequestSchema,
  WorkerReminderLogRequestSchema,
  WorkerReminderScheduleRequestSchema,
  WorkerReminderSnoozeRequestSchema,
  WorkerReminderUpdateRequestSchema,
  type ActivationCredentialScope,
  type ClientAgentRemindersListRequest,
  type ClientAgentRemindersListResponse,
  type Reminder,
  type ReminderEvent,
  type ReminderRecurrence,
  type WorkerReminderCancelRequest,
  type WorkerReminderListRequest,
  type WorkerReminderLogRequest,
  type WorkerReminderLogResponse,
  type WorkerReminderMutationResponse,
  type WorkerReminderScheduleRequest,
  type WorkerReminderSnoozeRequest,
  type WorkerReminderUpdateRequest,
} from "@rah-os/protocol";

import type {
  AuthenticatedActorContext,
  AuthenticatedWorkerExecutionContext,
} from "./auth.ts";
import { requireRoomMember } from "./collaboration-policy.ts";
import {
  ConflictError,
  ForbiddenError,
  IdempotencyConflictError,
  NotFoundError,
} from "./errors.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import { integer, nullableText, text, type Row } from "./sqlite-row.ts";

const SYSTEM_PRINCIPAL_ID = "principal_system";
const FIRE_RETRY_BASE_MS = 1_000;
const FIRE_RETRY_MAX_MS = 60_000;
const FIRE_RETRY_MAX_ATTEMPTS = 8;
const FIRE_RETRY_DEADLINE_MS = 15 * 60_000;

export type ReminderReconcileResult = Readonly<{
  delivered: number;
  exhausted: number;
  pending: number;
  staged: number;
}>;

export type ReminderServiceOptions = {
  createId: (prefix: string) => string;
  database: DatabaseSync;
  defaultTimezone?: string | undefined;
  events: RoomEventWriter;
  fireDeliveryHook?:
    | ((input: {
        occurrenceId: string;
        reminderId: string;
        reminderVersion: number;
      }) => void)
    | undefined;
  now: () => Date;
  requireActor: (actor: AuthenticatedActorContext) => string;
  requireWorker: (
    worker: AuthenticatedWorkerExecutionContext,
  ) => ActivationCredentialScope;
  transaction: <Result>(operation: () => Result) => Result;
};

/**
 * Durable Reminder authority. This is the local-first equivalent of Raft's
 * Server-owned schedule plus Computer fire receipt: a due occurrence is
 * persisted before the owner-only Inbox/Activation is materialized.
 */
export class ReminderService {
  readonly #createId: (prefix: string) => string;
  readonly #database: DatabaseSync;
  readonly #defaultTimezone: string;
  readonly #events: RoomEventWriter;
  readonly #fireDeliveryHook:
    ReminderServiceOptions["fireDeliveryHook"] | undefined;
  readonly #now: () => Date;
  readonly #requireActor: ReminderServiceOptions["requireActor"];
  readonly #requireWorker: ReminderServiceOptions["requireWorker"];
  readonly #transaction: ReminderServiceOptions["transaction"];

  constructor(options: ReminderServiceOptions) {
    this.#createId = options.createId;
    this.#database = options.database;
    this.#events = options.events;
    this.#fireDeliveryHook = options.fireDeliveryHook;
    this.#now = options.now;
    this.#requireActor = options.requireActor;
    this.#requireWorker = options.requireWorker;
    this.#transaction = options.transaction;
    this.#defaultTimezone =
      options.defaultTimezone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone ??
      "UTC";
    assertTimezone(this.#defaultTimezone);
  }

  schedule(
    worker: AuthenticatedWorkerExecutionContext,
    untrustedInput: WorkerReminderScheduleRequest,
  ): WorkerReminderMutationResponse {
    const presented = WorkerReminderScheduleRequestSchema.parse(untrustedInput);
    return this.#transaction(() => {
      const scope = this.#requireWorker(worker);
      // Raft's `reminder schedule` carries no causal cursor: the anchor is
      // resolved against the read position the tool already owns. Here that is
      // the Activation head this credential was issued for.
      const input = {
        ...presented,
        basedOnRoomSeq: presented.basedOnRoomSeq ?? scope.toSeq,
      };
      const replay = this.#commandReplay(scope.participantId, input);
      if (replay !== undefined) return replay;
      const anchor = this.#requireAnchor(
        scope,
        input.messageId,
        input.basedOnRoomSeq,
      );
      const targetRoomId = this.#resolveTargetRoom(scope, input.channel);
      const owner = this.#requireOwnerAgent(scope.participantId);
      const now = this.#now();
      const timezone = input.timezone ?? this.#defaultTimezone;
      if (input.repeat !== undefined) assertTimezone(timezone);
      const fireAtMs = initialFireAt(input, now.getTime(), timezone);
      if (fireAtMs <= now.getTime()) {
        throw new ConflictError("reminder fireAt must be in the future");
      }
      const createdAt = now.toISOString();
      const reminderId = this.#createId("reminder");
      this.#database
        .prepare(
          `INSERT INTO reminders(
             reminder_id, owner_agent_id, owner_participant_id, room_id,
             target_room_id, thread_id, root_message_id, title, fire_at,
             fire_at_ms, status, message_id, payload_json, repeat_rule,
             timezone, version, created_at, updated_at
           ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(
          reminderId,
          owner.agentDefinitionId,
          scope.participantId,
          scope.roomId,
          targetRoomId,
          anchor.threadId ?? null,
          anchor.rootMessageId ?? null,
          input.title,
          new Date(fireAtMs).toISOString(),
          fireAtMs,
          anchor.messageId,
          input.payload === undefined ? null : JSON.stringify(input.payload),
          input.repeat ?? null,
          input.repeat === undefined ? null : timezone,
          createdAt,
          createdAt,
        );
      this.#appendReminderEvent({
        actorId: scope.participantId,
        actorType: "agent",
        eventType: "scheduled",
        nextFireAt: new Date(fireAtMs).toISOString(),
        occurredAt: createdAt,
        reminderId,
      });
      const response = {
        deduplicated: false,
        reminder: this.#reminder(reminderId),
      } satisfies WorkerReminderMutationResponse;
      this.#recordCommand(scope.participantId, input, response);
      return response;
    });
  }

  listWorker(
    worker: AuthenticatedWorkerExecutionContext,
    untrustedInput: WorkerReminderListRequest,
  ): Reminder[] {
    const input = WorkerReminderListRequestSchema.parse(untrustedInput);
    const scope = this.#requireWorker(worker);
    const owner = this.#requireOwnerAgent(scope.participantId);
    return this.#list(owner.agentDefinitionId, input);
  }

  cancel(
    worker: AuthenticatedWorkerExecutionContext,
    untrustedInput: WorkerReminderCancelRequest,
  ): WorkerReminderMutationResponse {
    const input = WorkerReminderCancelRequestSchema.parse(untrustedInput);
    return this.#mutate(worker, input, (scope, row, occurredAt) => {
      const reminderId = text(row, "reminder_id");
      const status = text(row, "status");
      if (status === "canceled") {
        throw new ConflictError(`Reminder ${reminderId} is canceled`);
      }
      this.#database
        .prepare(
          "UPDATE reminders SET status = 'canceled', version = version + 1, updated_at = ? WHERE reminder_id = ?",
        )
        .run(occurredAt, reminderId);
      this.#obsoletePendingReceipts(reminderId, occurredAt);
      this.#appendReminderEvent({
        actorId: scope.participantId,
        actorType: "agent",
        eventType: "canceled",
        occurredAt,
        reminderId,
      });
    });
  }

  snooze(
    worker: AuthenticatedWorkerExecutionContext,
    untrustedInput: WorkerReminderSnoozeRequest,
  ): WorkerReminderMutationResponse {
    const input = WorkerReminderSnoozeRequestSchema.parse(untrustedInput);
    return this.#mutate(worker, input, (scope, row, occurredAt) => {
      const reminderId = text(row, "reminder_id");
      if (text(row, "status") === "canceled") {
        throw new ConflictError(`Reminder ${reminderId} is canceled`);
      }
      const fireAtMs = this.#now().getTime() + input.delaySeconds * 1_000;
      const fireAt = new Date(fireAtMs).toISOString();
      this.#database
        .prepare(
          `UPDATE reminders
           SET status = 'scheduled', fire_at = ?, fire_at_ms = ?, fired_at = NULL,
               version = version + 1, updated_at = ?
           WHERE reminder_id = ?`,
        )
        .run(fireAt, fireAtMs, occurredAt, reminderId);
      this.#obsoletePendingReceipts(reminderId, occurredAt);
      this.#appendReminderEvent({
        actorId: scope.participantId,
        actorType: "agent",
        eventType: "snoozed",
        nextFireAt: fireAt,
        occurredAt,
        reminderId,
      });
    });
  }

  update(
    worker: AuthenticatedWorkerExecutionContext,
    untrustedInput: WorkerReminderUpdateRequest,
  ): WorkerReminderMutationResponse {
    const input = WorkerReminderUpdateRequestSchema.parse(untrustedInput);
    return this.#mutate(worker, input, (scope, row, occurredAt) => {
      const reminderId = text(row, "reminder_id");
      if (text(row, "status") !== "scheduled") {
        throw new ConflictError(
          `Reminder ${reminderId} can only be updated while scheduled`,
        );
      }
      const nowMs = this.#now().getTime();
      const oldRepeat = nullableText(row, "repeat_rule");
      const oldTimezone = nullableText(row, "timezone");
      let title = text(row, "title");
      let fireAtMs = integer(row, "fire_at_ms");
      let repeat: string | null = oldRepeat;
      let timezone: string | null = oldTimezone;
      if (input.title !== undefined) title = input.title;
      if (input.delaySeconds !== undefined) {
        fireAtMs = nowMs + input.delaySeconds * 1_000;
      }
      if (input.fireAt !== undefined) {
        fireAtMs = new Date(input.fireAt).getTime();
        if (fireAtMs <= nowMs) {
          throw new ConflictError("reminder fireAt must be in the future");
        }
      }
      if (input.repeat !== undefined) {
        repeat = input.repeat;
        if (repeat === null) {
          timezone = null;
        } else {
          timezone = input.timezone ?? oldTimezone ?? this.#defaultTimezone;
          assertTimezone(timezone);
          fireAtMs = computeNextFireAt(repeat, timezone, nowMs);
        }
      }
      const fireAt = new Date(fireAtMs).toISOString();
      this.#database
        .prepare(
          `UPDATE reminders
           SET title = ?, fire_at = ?, fire_at_ms = ?, repeat_rule = ?, timezone = ?,
               version = version + 1, updated_at = ?
           WHERE reminder_id = ?`,
        )
        .run(title, fireAt, fireAtMs, repeat, timezone, occurredAt, reminderId);
      this.#obsoletePendingReceipts(reminderId, occurredAt);
      this.#appendReminderEvent({
        actorId: scope.participantId,
        actorType: "agent",
        eventType: "updated",
        nextFireAt: fireAt,
        occurredAt,
        reminderId,
      });
    });
  }

  log(
    worker: AuthenticatedWorkerExecutionContext,
    untrustedInput: WorkerReminderLogRequest,
  ): WorkerReminderLogResponse {
    const input = WorkerReminderLogRequestSchema.parse(untrustedInput);
    const scope = this.#requireWorker(worker);
    const row = this.#requireOwnedReminder(scope, input.reminderId);
    const reminderId = text(row, "reminder_id");
    return {
      events: this.#database
        .prepare(
          "SELECT * FROM reminder_events WHERE reminder_id = ? ORDER BY occurred_at, rowid",
        )
        .all(reminderId)
        .map((eventRow) => reminderEventFromRow(eventRow)),
      reminder: reminderFromRow(row),
    };
  }

  listHuman(
    actor: AuthenticatedActorContext,
    untrustedInput: ClientAgentRemindersListRequest,
  ): ClientAgentRemindersListResponse {
    const input = ClientAgentRemindersListRequestSchema.parse(untrustedInput);
    const actorId = this.#requireActor(actor);
    const definition = this.#database
      .prepare(
        "SELECT control_room_id FROM agent_definitions WHERE agent_definition_id = ? AND state != 'tombstoned'",
      )
      .get(input.agentDefinitionId);
    if (definition === undefined) {
      throw new NotFoundError(
        `agent definition ${input.agentDefinitionId} was not found`,
      );
    }
    requireRoomMember(
      this.#database,
      text(definition, "control_room_id"),
      actorId,
    );
    return ClientAgentRemindersListResponseSchema.parse({
      reminders: this.#list(input.agentDefinitionId, input),
    });
  }

  reconcileDue(limit = 32): ReminderReconcileResult {
    if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
      throw new Error("Reminder reconcile limit must be between 1 and 500");
    }
    const staged = this.#transaction(() => this.#stageDue(limit));
    const nowMs = this.#now().getTime();
    const candidates = this.#database
      .prepare(
        `SELECT * FROM reminder_fire_receipts
         WHERE state = 'pending' AND next_attempt_at_ms <= ?
         ORDER BY next_attempt_at_ms, occurrence_id LIMIT ?`,
      )
      .all(nowMs, limit);
    let delivered = 0;
    let exhausted = 0;
    for (const candidate of candidates) {
      const outcome = this.#deliverOccurrence(candidate);
      if (outcome === "delivered") delivered += 1;
      if (outcome === "exhausted") exhausted += 1;
    }
    const pending = Number(
      this.#database
        .prepare(
          "SELECT COUNT(*) AS count FROM reminder_fire_receipts WHERE state = 'pending'",
        )
        .get()?.count ?? 0,
    );
    return { delivered, exhausted, pending, staged };
  }

  #mutate<Input extends { idempotencyKey: string; reminderId: string }>(
    worker: AuthenticatedWorkerExecutionContext,
    input: Input,
    apply: (
      scope: ActivationCredentialScope,
      row: Row,
      occurredAt: string,
    ) => void,
  ): WorkerReminderMutationResponse {
    return this.#transaction(() => {
      const scope = this.#requireWorker(worker);
      const replay = this.#commandReplay(scope.participantId, input);
      if (replay !== undefined) return replay;
      const row = this.#requireOwnedReminder(scope, input.reminderId);
      const occurredAt = this.#now().toISOString();
      apply(scope, row, occurredAt);
      const response = {
        deduplicated: false,
        reminder: this.#reminder(text(row, "reminder_id")),
      } satisfies WorkerReminderMutationResponse;
      this.#recordCommand(scope.participantId, input, response);
      return response;
    });
  }

  #stageDue(limit: number): number {
    const now = this.#now();
    const nowMs = now.getTime();
    const due = this.#database
      .prepare(
        `SELECT reminder_id, version, fire_at, fire_at_ms FROM reminders
         WHERE status = 'scheduled' AND fire_at_ms <= ?
         ORDER BY fire_at_ms, reminder_id LIMIT ?`,
      )
      .all(nowMs, limit);
    let staged = 0;
    for (const row of due) {
      const result = this.#database
        .prepare(
          `INSERT OR IGNORE INTO reminder_fire_receipts(
             occurrence_id, request_id, reminder_id, reminder_version,
             scheduled_fire_at, fired_at_client, catchup, state, attempts,
             next_attempt_at_ms, deadline_at_ms, created_at, updated_at
           ) VALUES(?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)`,
        )
        .run(
          this.#createId("reminder_occurrence"),
          this.#createId("reminder_fire_request"),
          text(row, "reminder_id"),
          integer(row, "version"),
          text(row, "fire_at"),
          now.toISOString(),
          integer(row, "fire_at_ms") < nowMs ? 1 : 0,
          nowMs,
          nowMs + FIRE_RETRY_DEADLINE_MS,
          now.toISOString(),
          now.toISOString(),
        );
      staged += Number(result.changes);
    }
    return staged;
  }

  #deliverOccurrence(
    candidate: Row,
  ): "delivered" | "exhausted" | "pending" | "obsolete" {
    const occurrenceId = text(candidate, "occurrence_id");
    const reminderId = text(candidate, "reminder_id");
    const reminderVersion = integer(candidate, "reminder_version");
    try {
      this.#fireDeliveryHook?.({
        occurrenceId,
        reminderId,
        reminderVersion,
      });
      return this.#transaction(() => {
        const receipt = this.#database
          .prepare(
            "SELECT * FROM reminder_fire_receipts WHERE occurrence_id = ?",
          )
          .get(occurrenceId);
        if (receipt === undefined || text(receipt, "state") !== "pending") {
          return "obsolete" as const;
        }
        const reminderRow = this.#database
          .prepare("SELECT * FROM reminders WHERE reminder_id = ?")
          .get(reminderId);
        if (
          reminderRow === undefined ||
          text(reminderRow, "status") !== "scheduled" ||
          integer(reminderRow, "version") !== reminderVersion
        ) {
          this.#markReceipt(occurrenceId, "obsolete");
          return "obsolete" as const;
        }
        const ownerParticipantId = text(reminderRow, "owner_participant_id");
        const anchorRoomId = text(reminderRow, "room_id");
        const targetRoomId = text(reminderRow, "target_room_id");
        requireRoomMember(this.#database, targetRoomId, ownerParticipantId);
        const firedAt = this.#now().toISOString();
        const repeat = nullableText(reminderRow, "repeat_rule");
        const timezone = nullableText(reminderRow, "timezone");
        const nextFireAtMs: number | undefined =
          repeat === null
            ? undefined
            : computeNextFireAt(
                repeat,
                timezone ?? this.#defaultTimezone,
                Math.max(
                  this.#now().getTime(),
                  integer(reminderRow, "fire_at_ms"),
                ),
              );
        const nextFireAt =
          nextFireAtMs === undefined
            ? undefined
            : new Date(nextFireAtMs).toISOString();
        const event = this.#events.append({
          actorId: SYSTEM_PRINCIPAL_ID,
          aggregateId: reminderId,
          aggregateType: "reminder",
          idempotencyKey: `reminder-fire:${reminderId}:${String(reminderVersion)}`,
          payload: {
            firedAt,
            anchorRoomId,
            messageId: text(reminderRow, "message_id"),
            reminderId,
            scheduledFireAt: text(receipt, "scheduled_fire_at"),
            title: text(reminderRow, "title"),
            targetRoomId,
            ...(nullableText(reminderRow, "thread_id") === null
              ? {}
              : { threadId: nullableText(reminderRow, "thread_id")! }),
            ...(nullableText(reminderRow, "root_message_id") === null
              ? {}
              : {
                  rootMessageId: nullableText(reminderRow, "root_message_id")!,
                }),
            ...(nextFireAt === undefined ? {} : { nextFireAt }),
          },
          roomId: targetRoomId,
          type: "reminder.fired",
        });
        this.#events.deriveAttention(
          event,
          [{ participantId: ownerParticipantId, reason: "reminder" }],
          firedAt,
        );
        if (nextFireAtMs === undefined) {
          this.#database
            .prepare(
              `UPDATE reminders
               SET status = 'fired', fired_at = ?, updated_at = ?
               WHERE reminder_id = ? AND version = ?`,
            )
            .run(firedAt, firedAt, reminderId, reminderVersion);
        } else {
          this.#database
            .prepare(
              `UPDATE reminders
               SET fire_at = ?, fire_at_ms = ?, fired_at = ?, version = version + 1,
                   updated_at = ?
               WHERE reminder_id = ? AND version = ?`,
            )
            .run(
              nextFireAt!,
              nextFireAtMs,
              firedAt,
              firedAt,
              reminderId,
              reminderVersion,
            );
        }
        this.#appendReminderEvent({
          actorType: "system",
          eventType: "fired",
          ...(nextFireAt === undefined ? {} : { nextFireAt }),
          occurredAt: firedAt,
          reminderId,
        });
        this.#database
          .prepare(
            `UPDATE reminder_fire_receipts
             SET state = 'delivered', attempts = attempts + 1, delivered_at = ?,
                 updated_at = ? WHERE occurrence_id = ?`,
          )
          .run(firedAt, firedAt, occurrenceId);
        return "delivered" as const;
      });
    } catch (error) {
      return this.#transaction(() => {
        const row = this.#database
          .prepare(
            "SELECT * FROM reminder_fire_receipts WHERE occurrence_id = ?",
          )
          .get(occurrenceId);
        if (row === undefined || text(row, "state") !== "pending") {
          return "obsolete" as const;
        }
        const now = this.#now();
        const attempts = integer(row, "attempts") + 1;
        const exhausted =
          attempts >= FIRE_RETRY_MAX_ATTEMPTS ||
          now.getTime() >= integer(row, "deadline_at_ms");
        const delay = Math.min(
          FIRE_RETRY_MAX_MS,
          FIRE_RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1),
        );
        this.#database
          .prepare(
            `UPDATE reminder_fire_receipts
             SET state = ?, attempts = ?, next_attempt_at_ms = ?, last_error = ?,
                 updated_at = ? WHERE occurrence_id = ?`,
          )
          .run(
            exhausted ? "exhausted" : "pending",
            attempts,
            now.getTime() + delay,
            errorMessage(error).slice(0, 2_000),
            now.toISOString(),
            occurrenceId,
          );
        return exhausted ? ("exhausted" as const) : ("pending" as const);
      });
    }
  }

  #markReceipt(occurrenceId: string, state: "obsolete" | "exhausted"): void {
    this.#database
      .prepare(
        "UPDATE reminder_fire_receipts SET state = ?, updated_at = ? WHERE occurrence_id = ?",
      )
      .run(state, this.#now().toISOString(), occurrenceId);
  }

  #obsoletePendingReceipts(reminderId: string, occurredAt: string): void {
    this.#database
      .prepare(
        "UPDATE reminder_fire_receipts SET state = 'obsolete', updated_at = ? WHERE reminder_id = ? AND state = 'pending'",
      )
      .run(occurredAt, reminderId);
  }

  #appendReminderEvent(input: {
    actorId?: string;
    actorType: "agent" | "human" | "system";
    eventType: "scheduled" | "fired" | "snoozed" | "updated" | "canceled";
    metadata?: Record<string, unknown>;
    nextFireAt?: string;
    occurredAt: string;
    reminderId: string;
  }): ReminderEvent {
    const event = ReminderEventSchema.parse({
      eventId: this.#createId("reminder_event"),
      reminderId: input.reminderId,
      eventType: input.eventType,
      actorType: input.actorType,
      ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
      occurredAt: input.occurredAt,
      ...(input.nextFireAt === undefined
        ? {}
        : { nextFireAt: input.nextFireAt }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    });
    this.#database
      .prepare(
        `INSERT INTO reminder_events(
           event_id, reminder_id, event_type, actor_type, actor_id, occurred_at,
           next_fire_at, metadata_json
         ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.eventId,
        event.reminderId,
        event.eventType,
        event.actorType,
        event.actorId ?? null,
        event.occurredAt,
        event.nextFireAt ?? null,
        event.metadata === undefined ? null : JSON.stringify(event.metadata),
      );
    return event;
  }

  #commandReplay(
    ownerParticipantId: string,
    input: unknown,
  ): WorkerReminderMutationResponse | undefined {
    const key = commandKey(input);
    const requestJson = JSON.stringify(input);
    const row = this.#database
      .prepare(
        `SELECT request_json, response_json FROM reminder_command_receipts
         WHERE owner_participant_id = ? AND idempotency_key = ?`,
      )
      .get(ownerParticipantId, key);
    if (row === undefined) return undefined;
    if (text(row, "request_json") !== requestJson) {
      throw new IdempotencyConflictError(
        "idempotency key already used for another Reminder intent",
      );
    }
    const parsed = JSON.parse(text(row, "response_json")) as {
      reminder?: { reminderId?: unknown };
    };
    const reminderId = parsed.reminder?.reminderId;
    if (typeof reminderId !== "string") {
      throw new Error(
        "Reminder command receipt is missing its reminder identity",
      );
    }
    return {
      deduplicated: true,
      reminder: this.#reminder(reminderId),
    };
  }

  #recordCommand(
    ownerParticipantId: string,
    input: unknown,
    response: WorkerReminderMutationResponse,
  ): void {
    this.#database
      .prepare(
        `INSERT INTO reminder_command_receipts(
           owner_participant_id, idempotency_key, request_json, response_json, created_at
         ) VALUES(?, ?, ?, ?, ?)`,
      )
      .run(
        ownerParticipantId,
        commandKey(input),
        JSON.stringify(input),
        JSON.stringify(response),
        this.#now().toISOString(),
      );
  }

  #requireAnchor(
    scope: ActivationCredentialScope,
    messageId: string,
    basedOnRoomSeq: number,
  ): {
    messageId: string;
    rootMessageId?: string;
    threadId?: string;
  } {
    if (basedOnRoomSeq > scope.toSeq) {
      throw new ForbiddenError(
        "Reminder causal cursor exceeds this Activation range",
      );
    }
    const exact = this.#database
      .prepare(
        `SELECT messages.message_id, room_events.room_seq,
                COALESCE(messages.thread_id, root_thread.thread_id) AS anchor_thread_id,
                COALESCE(reply_thread.root_message_id, root_thread.root_message_id) AS root_message_id
         FROM messages
         JOIN room_events
           ON room_events.room_id = messages.room_id
          AND room_events.aggregate_type = 'message'
          AND room_events.aggregate_id = messages.message_id
          AND room_events.type = 'message.posted'
         LEFT JOIN threads AS reply_thread
           ON reply_thread.thread_id = messages.thread_id
         LEFT JOIN threads AS root_thread
           ON root_thread.room_id = messages.room_id
          AND root_thread.root_message_id = messages.message_id
         WHERE messages.message_id = ? AND messages.room_id = ?`,
      )
      .get(messageId, scope.roomId);
    const candidates =
      exact === undefined
        ? this.#database
            .prepare(
              `SELECT messages.message_id, room_events.room_seq,
                      COALESCE(messages.thread_id, root_thread.thread_id) AS anchor_thread_id,
                      COALESCE(reply_thread.root_message_id, root_thread.root_message_id) AS root_message_id
               FROM messages
               JOIN room_events
                 ON room_events.room_id = messages.room_id
                AND room_events.aggregate_type = 'message'
                AND room_events.aggregate_id = messages.message_id
                AND room_events.type = 'message.posted'
               LEFT JOIN threads AS reply_thread
                 ON reply_thread.thread_id = messages.thread_id
               LEFT JOIN threads AS root_thread
                 ON root_thread.room_id = messages.room_id
                AND root_thread.root_message_id = messages.message_id
               WHERE messages.room_id = ? AND messages.message_id LIKE ? ESCAPE '\\'
               ORDER BY messages.message_id LIMIT 2`,
            )
            .all(scope.roomId, `${escapeLike(messageId)}%`)
        : [exact];
    const visible = candidates.filter(
      (row) => integer(row, "room_seq") <= basedOnRoomSeq,
    );
    if (visible.length === 0) {
      throw new ForbiddenError(
        "Reminder message anchor was not available at the supplied Room cursor",
      );
    }
    if (visible.length > 1) {
      throw new ConflictError(`Message prefix ${messageId} is ambiguous`);
    }
    const row = visible[0]!;
    const threadId = nullableText(row, "anchor_thread_id");
    const rootMessageId = nullableText(row, "root_message_id");
    return {
      messageId: text(row, "message_id"),
      ...(threadId === null ? {} : { threadId }),
      ...(rootMessageId === null ? {} : { rootMessageId }),
    };
  }

  #resolveTargetRoom(
    scope: ActivationCredentialScope,
    channel: string | undefined,
  ): string {
    if (channel === undefined) return scope.roomId;
    if (!channel.startsWith("#") || channel.length === 1) {
      throw new ConflictError(
        "Reminder channel must be a #room slug in the current Workspace",
      );
    }
    const target = this.#database
      .prepare(
        `SELECT target.room_id
         FROM rooms AS anchor
         JOIN workspaces ON workspaces.workspace_id = anchor.workspace_id
         JOIN rooms AS target
           ON target.workspace_id = anchor.workspace_id
          AND target.slug = ?
          AND target.archived_at IS NULL
         WHERE anchor.room_id = ? AND workspaces.state = 'active'`,
      )
      .get(channel.slice(1), scope.roomId);
    if (target === undefined) {
      throw new NotFoundError(
        `Reminder target ${channel} was not found in this Workspace`,
      );
    }
    const targetRoomId = text(target, "room_id");
    requireRoomMember(this.#database, targetRoomId, scope.participantId);
    return targetRoomId;
  }

  #requireOwnerAgent(participantId: string): { agentDefinitionId: string } {
    const row = this.#database
      .prepare(
        `SELECT agent_definition_id FROM agent_definitions
         WHERE participant_id = ? AND state != 'tombstoned'`,
      )
      .get(participantId);
    if (row === undefined) {
      throw new ForbiddenError(
        `participant ${participantId} has no active Agent definition`,
      );
    }
    return { agentDefinitionId: text(row, "agent_definition_id") };
  }

  #requireOwnedReminder(
    scope: ActivationCredentialScope,
    reminderId: string,
  ): Row {
    const exact = this.#database
      .prepare("SELECT * FROM reminders WHERE reminder_id = ?")
      .get(reminderId);
    const candidates =
      exact === undefined
        ? this.#database
            .prepare(
              `SELECT * FROM reminders
               WHERE owner_participant_id = ? AND room_id = ? AND reminder_id LIKE ? ESCAPE '\\'
               ORDER BY reminder_id LIMIT 2`,
            )
            .all(
              scope.participantId,
              scope.roomId,
              `${escapeLike(reminderId)}%`,
            )
        : [exact];
    if (candidates.length === 0) {
      throw new NotFoundError(`Reminder ${reminderId} was not found`);
    }
    if (candidates.length > 1) {
      throw new ConflictError(`Reminder prefix ${reminderId} is ambiguous`);
    }
    const row = candidates[0]!;
    if (
      text(row, "owner_participant_id") !== scope.participantId ||
      text(row, "room_id") !== scope.roomId
    ) {
      throw new ForbiddenError(
        `Reminder ${reminderId} is outside this Worker execution scope`,
      );
    }
    return row;
  }

  #reminder(reminderId: string): Reminder {
    const row = this.#database
      .prepare("SELECT * FROM reminders WHERE reminder_id = ?")
      .get(reminderId);
    if (row === undefined) {
      throw new NotFoundError(`Reminder ${reminderId} was not found`);
    }
    return reminderFromRow(row);
  }

  #list(
    agentDefinitionId: string,
    input: {
      all?: boolean | undefined;
      status?: "scheduled" | "fired" | "canceled" | undefined;
      statuses?: ("scheduled" | "fired" | "canceled")[] | undefined;
    },
  ): Reminder[] {
    const statuses =
      input.status !== undefined
        ? [input.status]
        : input.statuses !== undefined
          ? [...new Set(input.statuses)]
          : input.all === true
            ? undefined
            : ["scheduled", "fired"];
    const rows =
      statuses === undefined
        ? this.#database
            .prepare(
              `SELECT * FROM reminders WHERE owner_agent_id = ?
               ORDER BY fire_at_ms, reminder_id`,
            )
            .all(agentDefinitionId)
        : this.#database
            .prepare(
              `SELECT * FROM reminders
               WHERE owner_agent_id = ? AND status IN (${statuses.map(() => "?").join(", ")})
               ORDER BY fire_at_ms, reminder_id`,
            )
            .all(agentDefinitionId, ...statuses);
    return rows.map((row) => reminderFromRow(row));
  }
}

function commandKey(input: unknown): string {
  if (
    typeof input !== "object" ||
    input === null ||
    !("idempotencyKey" in input) ||
    typeof input.idempotencyKey !== "string"
  ) {
    throw new Error("Reminder mutation requires an idempotency key");
  }
  return input.idempotencyKey;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

function initialFireAt(
  input: WorkerReminderScheduleRequest,
  nowMs: number,
  timezone: string,
): number {
  if (input.delaySeconds !== undefined) {
    return nowMs + input.delaySeconds * 1_000;
  }
  if (input.fireAt !== undefined) return new Date(input.fireAt).getTime();
  return computeNextFireAt(input.repeat!, timezone, nowMs);
}

function reminderFromRow(row: Row): Reminder {
  const payloadJson = nullableText(row, "payload_json");
  const repeat = nullableText(row, "repeat_rule");
  const timezone = nullableText(row, "timezone");
  return ReminderSchema.parse({
    reminderId: text(row, "reminder_id"),
    ownerAgentId: text(row, "owner_agent_id"),
    ownerParticipantId: text(row, "owner_participant_id"),
    roomId: text(row, "room_id"),
    targetRoomId: text(row, "target_room_id"),
    ...(nullableText(row, "thread_id") === null
      ? {}
      : { threadId: nullableText(row, "thread_id")! }),
    ...(nullableText(row, "root_message_id") === null
      ? {}
      : { rootMessageId: nullableText(row, "root_message_id")! }),
    title: text(row, "title"),
    fireAt: text(row, "fire_at"),
    ...(nullableText(row, "fired_at") === null
      ? {}
      : { firedAt: nullableText(row, "fired_at")! }),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
    status: text(row, "status"),
    msgId: text(row, "message_id"),
    ...(payloadJson === null
      ? {}
      : { payload: JSON.parse(payloadJson) as Record<string, unknown> }),
    ...(repeat === null
      ? {}
      : {
          recurrence: recurrencePresentation(repeat),
          repeat,
          timezone: timezone ?? "UTC",
        }),
    version: integer(row, "version"),
  });
}

function reminderEventFromRow(row: Row): ReminderEvent {
  const metadataJson = nullableText(row, "metadata_json");
  return ReminderEventSchema.parse({
    eventId: text(row, "event_id"),
    reminderId: text(row, "reminder_id"),
    eventType: text(row, "event_type"),
    actorType: text(row, "actor_type"),
    ...(nullableText(row, "actor_id") === null
      ? {}
      : { actorId: nullableText(row, "actor_id")! }),
    occurredAt: text(row, "occurred_at"),
    ...(nullableText(row, "next_fire_at") === null
      ? {}
      : { nextFireAt: nullableText(row, "next_fire_at")! }),
    ...(metadataJson === null
      ? {}
      : { metadata: JSON.parse(metadataJson) as Record<string, unknown> }),
  });
}

function recurrencePresentation(rule: string): ReminderRecurrence {
  if (/^every:[1-9]\d*[mhd]$/u.test(rule)) {
    return { description: rule, kind: "interval" };
  }
  if (/^daily@(?:[01]\d|2[0-3]):[0-5]\d$/u.test(rule)) {
    return { description: rule, kind: "daily" };
  }
  if (
    /^weekly:(?:sun|mon|tue|wed|thu|fri|sat)(?:,(?:sun|mon|tue|wed|thu|fri|sat))*@(?:[01]\d|2[0-3]):[0-5]\d$/u.test(
      rule,
    )
  ) {
    return { description: rule, kind: "weekly" };
  }
  return { description: rule, kind: "unsupported" };
}

function computeNextFireAt(
  rule: string,
  timezone: string,
  afterMs: number,
): number {
  const recurrence = recurrencePresentation(rule);
  if (recurrence.kind === "unsupported") {
    throw new ConflictError(
      "repeat must be every:15m, every:2h, every:1d, daily@09:00, or weekly:mon,fri@09:00",
    );
  }
  if (recurrence.kind === "interval") {
    const match = /^every:([1-9]\d*)([mhd])$/u.exec(rule)!;
    const multiplier =
      match[2] === "m" ? 60_000 : match[2] === "h" ? 3_600_000 : 86_400_000;
    const interval = Number(match[1]) * multiplier;
    if (!Number.isSafeInteger(interval)) {
      throw new ConflictError("repeat interval is too large");
    }
    return afterMs + interval;
  }
  assertTimezone(timezone);
  const current = zonedParts(afterMs, timezone);
  const [hours, minutes] = rule
    .slice(rule.lastIndexOf("@") + 1)
    .split(":")
    .map(Number) as [number, number];
  if (recurrence.kind === "daily") {
    for (let offset = 0; offset <= 2; offset += 1) {
      const date = addLocalDays(current, offset);
      const candidate = zonedLocalToEpoch(
        { ...date, hour: hours, minute: minutes, second: 0 },
        timezone,
      );
      if (candidate > afterMs) return candidate;
    }
  }
  const days = new Set(
    rule
      .slice("weekly:".length, rule.lastIndexOf("@"))
      .split(",")
      .map((day) => WEEKDAYS.indexOf(day)),
  );
  for (let offset = 0; offset <= 14; offset += 1) {
    const date = addLocalDays(current, offset);
    const weekday = new Date(
      Date.UTC(date.year, date.month - 1, date.day),
    ).getUTCDay();
    if (!days.has(weekday)) continue;
    const candidate = zonedLocalToEpoch(
      { ...date, hour: hours, minute: minutes, second: 0 },
      timezone,
    );
    if (candidate > afterMs) return candidate;
  }
  throw new ConflictError("repeat rule did not produce a future fire time");
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

type LocalParts = {
  day: number;
  hour: number;
  minute: number;
  month: number;
  second: number;
  year: number;
};

function assertTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(0);
  } catch {
    throw new ConflictError(`invalid reminder timezone ${timezone}`);
  }
}

function zonedParts(epochMs: number, timezone: string): LocalParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: timezone,
    year: "numeric",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(epochMs))
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  );
  return {
    day: parts.day!,
    hour: parts.hour!,
    minute: parts.minute!,
    month: parts.month!,
    second: parts.second!,
    year: parts.year!,
  };
}

function addLocalDays(parts: LocalParts, days: number): LocalParts {
  const date = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + days),
  );
  return {
    ...parts,
    day: date.getUTCDate(),
    month: date.getUTCMonth() + 1,
    year: date.getUTCFullYear(),
  };
}

function zonedLocalToEpoch(target: LocalParts, timezone: string): number {
  const targetSerial = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
    target.second,
  );
  let candidate = targetSerial;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const actual = zonedParts(candidate, timezone);
    const actualSerial = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const difference = targetSerial - actualSerial;
    if (difference === 0) return candidate;
    candidate += difference;
  }
  throw new ConflictError(
    `reminder local time does not exist in timezone ${timezone}`,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
