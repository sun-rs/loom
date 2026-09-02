import type { DatabaseSync } from "node:sqlite";

import {
  RoomEventSchema,
  WakeHintSchema,
  type ActivationReason,
  type RoomEvent,
} from "@rah-os/protocol";

import type {
  ActivationObligationService,
  ActivationObligationSpec,
} from "./activation-obligation-service.ts";
import { NotFoundError } from "./errors.ts";
import { integer, jsonObject, text, type Row } from "./sqlite-row.ts";

export type AttentionRecipient = {
  obligations?: readonly ActivationObligationSpec[];
  participantId: string;
  reason: ActivationReason;
};

export type AppendRoomEventInput = {
  actorId: string;
  aggregateId: string;
  aggregateType: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  roomId: string;
  type: string;
};

export class RoomEventWriter {
  readonly #createId: (prefix: string) => string;
  readonly #database: DatabaseSync;
  readonly #now: () => Date;
  readonly #obligations: ActivationObligationService;

  constructor(input: {
    createId: (prefix: string) => string;
    database: DatabaseSync;
    now: () => Date;
    obligations: ActivationObligationService;
  }) {
    this.#createId = input.createId;
    this.#database = input.database;
    this.#now = input.now;
    this.#obligations = input.obligations;
  }

  append(input: AppendRoomEventInput): RoomEvent {
    const room = this.#database
      .prepare("SELECT * FROM rooms WHERE room_id = ?")
      .get(input.roomId);
    if (room === undefined) {
      throw new NotFoundError(`room ${input.roomId} was not found`);
    }
    const roomSeq = integer(room, "next_seq");
    const event = RoomEventSchema.parse({
      actorId: input.actorId,
      aggregateId: input.aggregateId,
      aggregateType: input.aggregateType,
      createdAt: this.#timestamp(),
      eventId: this.#createId("event"),
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
      roomId: input.roomId,
      roomSeq,
      schemaVersion: 1,
      type: input.type,
    });
    this.#database
      .prepare("UPDATE rooms SET next_seq = next_seq + 1 WHERE room_id = ?")
      .run(input.roomId);
    this.#database
      .prepare(
        "INSERT INTO room_events(event_id, room_id, room_seq, type, actor_id, aggregate_type, aggregate_id, payload_json, idempotency_key, schema_version, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        event.eventId,
        event.roomId,
        event.roomSeq,
        event.type,
        event.actorId,
        event.aggregateType,
        event.aggregateId,
        JSON.stringify(event.payload),
        event.idempotencyKey,
        event.schemaVersion,
        event.createdAt,
      );
    this.insertOutbox({
      payload: {
        eventId: event.eventId,
        roomId: event.roomId,
        roomSeq: event.roomSeq,
        type: event.type,
      },
      roomId: event.roomId,
      roomSeq: event.roomSeq,
      topic: "room.event",
    });
    return event;
  }

  deriveAttention(
    event: RoomEvent,
    recipients: AttentionRecipient[],
    createdAt: string,
  ): string[] {
    const activationIds: string[] = [];
    for (const recipient of recipients) {
      this.insertInboxItem({
        createdAt,
        event,
        participantId: recipient.participantId,
        reason: recipient.reason,
      });

      const queuedRow = this.#database
        .prepare(
          "SELECT * FROM activations WHERE room_id = ? AND participant_id = ? AND state = 'queued'",
        )
        .get(event.roomId, recipient.participantId);

      let activationId: string;
      if (queuedRow) {
        activationId = text(queuedRow, "activation_id");
        this.#database
          .prepare(
            "UPDATE activations SET to_seq = MAX(to_seq, ?), updated_at = ? WHERE activation_id = ?",
          )
          .run(event.roomSeq, createdAt, activationId);
      } else {
        activationId = this.#createId("activation");
        this.#database
          .prepare(
            "INSERT INTO activations(activation_id, room_id, participant_id, from_seq, to_seq, reason, state, available_at, available_at_ms, attempt_count, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, 'queued', ?, ?, 0, ?, ?)",
          )
          .run(
            activationId,
            event.roomId,
            recipient.participantId,
            event.roomSeq,
            event.roomSeq,
            recipient.reason,
            createdAt,
            this.#now().getTime(),
            createdAt,
            createdAt,
          );
      }
      activationIds.push(activationId);
      this.#obligations.record({
        activationId,
        createdAt,
        event,
        participantId: recipient.participantId,
        specs: recipient.obligations ?? [],
      });
      this.insertOutbox({
        payload: WakeHintSchema.parse({
          activationId,
          headCursor: event.roomSeq,
          participantId: recipient.participantId,
          reason: recipient.reason,
          roomId: event.roomId,
        }),
        roomId: event.roomId,
        roomSeq: event.roomSeq,
        topic: "activation.requested",
      });
    }
    return activationIds;
  }

  eventFromRow(row: Row): RoomEvent {
    return RoomEventSchema.parse({
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
    });
  }

  insertInboxItem(input: {
    createdAt: string;
    event: RoomEvent;
    participantId: string;
    reason: ActivationReason;
  }): void {
    this.#database
      .prepare(
        "INSERT INTO inbox_items(inbox_item_id, room_id, participant_id, event_id, event_seq, reason, state, created_at) VALUES(?, ?, ?, ?, ?, ?, 'pending', ?)",
      )
      .run(
        this.#createId("inbox"),
        input.event.roomId,
        input.participantId,
        input.event.eventId,
        input.event.roomSeq,
        input.reason,
        input.createdAt,
      );
  }

  insertOutbox(input: {
    payload: Record<string, unknown>;
    roomId: string;
    roomSeq: number;
    topic: string;
  }): void {
    this.#database
      .prepare(
        "INSERT INTO outbox(outbox_id, room_id, room_seq, topic, payload_json, created_at) VALUES(?, ?, ?, ?, ?, ?)",
      )
      .run(
        this.#createId("outbox"),
        input.roomId,
        input.roomSeq,
        input.topic,
        JSON.stringify(input.payload),
        this.#timestamp(),
      );
  }

  #timestamp(): string {
    return this.#now().toISOString();
  }
}
