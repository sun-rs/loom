import type { DatabaseSync } from "node:sqlite";

import type {
  AcknowledgeRoomMessageRequest,
  AcknowledgeRoomInboxItemRequest,
  AcknowledgeRoomRequest,
  RoomEvent,
  RoomInboxItem,
  RoomMutationResult,
} from "@rah/runtime-protocol";
import {
  validateAcknowledgeRoomMessageRequest,
  validateAcknowledgeRoomInboxItemRequest,
  validateAcknowledgeRoomRequest,
} from "@rah/runtime-protocol";

import { roomError } from "./room-errors";
import { inboxFromRow, integer, text, type RoomSqlRow as Row } from "./room-rows";

type InboxCommand = { idempotencyKey: string };

export interface RoomInboxServiceOptions {
  database: DatabaseSync;
  now: () => Date;
  transaction: <T>(operation: () => T) => T;
  command: (actorId: string, kind: string, request: InboxCommand) => RoomEvent | undefined;
  rememberCommand: (
    actorId: string,
    kind: string,
    request: InboxCommand,
    event: RoomEvent,
  ) => void;
  appendEvent: (input: {
    roomId: string;
    actorId: string;
    type: string;
    aggregateType: string;
    aggregateId: string;
    payload: Record<string, unknown>;
    idempotencyKey: string;
    createdAt: string;
  }) => RoomEvent;
  requireMembership: (roomId: string, principalId: string) => unknown;
  requirePrincipal: (principalId: string) => unknown;
  roomHead: (roomId: string) => number;
  maximumList: number;
}

export class RoomInboxService {
  readonly #options: RoomInboxServiceOptions;

  constructor(options: RoomInboxServiceOptions) {
    this.#options = options;
  }

  head(participantId: string): number {
    this.#options.requirePrincipal(participantId);
    const row = this.#options.database.prepare(
      "SELECT COALESCE(MAX(inbox_seq), 0) AS inbox_head FROM room_inbox_items WHERE participant_id = ?",
    ).get(participantId) as Row;
    return integer(row, "inbox_head");
  }

  list(
    participantId: string,
    options: {
      afterInboxSeq?: number;
      limit?: number;
      roomId?: string;
      pendingOnly?: boolean;
      messageIds?: string[];
      taskIds?: string[];
    } = {},
  ): RoomInboxItem[] {
    this.#options.requirePrincipal(participantId);
    if (options.roomId) this.#options.requireMembership(options.roomId, participantId);
    const afterInboxSeq = options.afterInboxSeq ?? 0;
    const limit = options.limit ?? this.#options.maximumList;
    if (!Number.isInteger(afterInboxSeq) || afterInboxSeq < 0) {
      throw roomError("invalid_argument", "afterInboxSeq must be a non-negative integer");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > this.#options.maximumList) {
      throw roomError(
        "invalid_argument",
        `limit must be between 1 and ${this.#options.maximumList}`,
      );
    }
    const roomCondition = options.roomId ? " AND inbox.room_id = ?" : "";
    const stateCondition = options.pendingOnly ? " AND inbox.state = 'pending'" : "";
    const messageIds = options.messageIds ?? [];
    const taskIds = options.taskIds ?? [];
    const targetClauses: string[] = [];
    if (messageIds.length > 0) {
      targetClauses.push(
        `(event.aggregate_type = 'message' AND event.aggregate_id IN (${messageIds.map(() => "?").join(",")}))`,
      );
    }
    if (taskIds.length > 0) {
      const placeholders = taskIds.map(() => "?").join(",");
      targetClauses.push(
        `((event.aggregate_type = 'task' AND event.aggregate_id IN (${placeholders}))
          OR (event.aggregate_type = 'review' AND json_extract(event.payload_json, '$.taskId') IN (${placeholders})))`,
      );
    }
    const targetCondition = targetClauses.length > 0
      ? ` AND (${targetClauses.join(" OR ")})`
      : "";
    const parameters: Array<string | number> = [participantId, afterInboxSeq];
    if (options.roomId) parameters.push(options.roomId);
    parameters.push(...messageIds);
    if (taskIds.length > 0) parameters.push(...taskIds, ...taskIds);
    parameters.push(limit);
    return (this.#options.database.prepare(
      `SELECT inbox.*, event.type AS event_type,
              event.aggregate_type AS event_aggregate_type,
              event.aggregate_id AS event_aggregate_id,
              CASE
                WHEN event.aggregate_type = 'task' THEN event.aggregate_id
                WHEN event.aggregate_type = 'review' THEN json_extract(event.payload_json, '$.taskId')
                ELSE NULL
              END AS target_task_id,
              CASE WHEN event.type = 'review.submitted'
                THEN json_extract(event.payload_json, '$.disposition')
                ELSE NULL
              END AS review_disposition
       FROM room_inbox_items AS inbox
       JOIN room_events AS event ON event.event_id = inbox.event_id
       WHERE inbox.participant_id = ? AND inbox.inbox_seq > ?${roomCondition}${stateCondition}${targetCondition}
       ORDER BY inbox.inbox_seq LIMIT ?`,
    ).all(...parameters) as Row[]).map(inboxFromRow);
  }

  acknowledgeMessage(
    actorId: string,
    rawRequest: AcknowledgeRoomMessageRequest,
  ): RoomMutationResult<RoomInboxItem> {
    const request = this.#validate(() => validateAcknowledgeRoomMessageRequest(rawRequest));
    const command = this.#options.command(actorId, "room.message.acknowledge", request);
    if (command) return this.#messageReplay(actorId, request, command);
    return this.#options.transaction(() => {
      const replay = this.#options.command(actorId, "room.message.acknowledge", request);
      if (replay) return this.#messageReplay(actorId, request, replay);
      this.#options.requireMembership(request.roomId, actorId);
      const row = this.#requireInboxMessage(request.roomId, actorId, request.messageId);
      const currentRoomSeq = this.#options.roomHead(request.roomId);
      const messageRoomSeq = integer(row, "event_seq");
      if (request.basedOnRoomSeq < messageRoomSeq || request.basedOnRoomSeq > currentRoomSeq) {
        throw roomError(
          "stale_context",
          `acknowledgement cursor ${request.basedOnRoomSeq} did not observe message sequence ${messageRoomSeq} at current sequence ${currentRoomSeq}`,
        );
      }
      if (text(row, "state") === "acknowledged") {
        const existing = this.#messageAcknowledgement(request.roomId, actorId, request.messageId);
        if (existing) {
          this.#options.rememberCommand(actorId, "room.message.acknowledge", request, existing);
          return { value: inboxFromRow(row), event: existing, deduplicated: true };
        }
        return this.#appendMessageAcknowledgement(actorId, request, row);
      }
      const acknowledgedAt = this.#timestamp();
      this.#options.database.prepare(
        "UPDATE room_inbox_items SET state = 'acknowledged', acknowledged_at = ? WHERE inbox_item_id = ?",
      ).run(acknowledgedAt, text(row, "inbox_item_id"));
      const value = inboxFromRow({ ...row, state: "acknowledged", acknowledged_at: acknowledgedAt });
      const event = this.#options.appendEvent({
        roomId: request.roomId,
        actorId,
        type: "message.acknowledged",
        aggregateType: "message",
        aggregateId: request.messageId,
        idempotencyKey: request.idempotencyKey,
        createdAt: acknowledgedAt,
        payload: { messageId: request.messageId, participantId: actorId, acknowledgedAt },
      });
      this.#options.rememberCommand(actorId, "room.message.acknowledge", request, event);
      return { value, event, deduplicated: false };
    });
  }

  acknowledgeItem(
    actorId: string,
    rawRequest: AcknowledgeRoomInboxItemRequest,
  ): RoomMutationResult<RoomInboxItem> {
    const request = this.#validate(() => validateAcknowledgeRoomInboxItemRequest(rawRequest));
    const command = this.#options.command(actorId, "room.inbox.acknowledge", request);
    if (command) return this.#itemReplay(actorId, request, command);
    return this.#options.transaction(() => {
      const replay = this.#options.command(actorId, "room.inbox.acknowledge", request);
      if (replay) return this.#itemReplay(actorId, request, replay);
      this.#options.requireMembership(request.roomId, actorId);
      const row = this.#requireInboxItem(
        request.roomId,
        actorId,
        request.inboxItemId,
        request.eventId,
      );
      const currentRoomSeq = this.#options.roomHead(request.roomId);
      const eventSeq = integer(row, "event_seq");
      if (request.basedOnRoomSeq < eventSeq || request.basedOnRoomSeq > currentRoomSeq) {
        throw roomError(
          "stale_context",
          `acknowledgement cursor ${request.basedOnRoomSeq} did not observe Inbox event sequence ${eventSeq} at current sequence ${currentRoomSeq}`,
        );
      }
      if (text(row, "state") === "acknowledged") {
        const existing = this.#itemAcknowledgement(request.roomId, actorId, request.inboxItemId);
        if (existing) {
          this.#options.rememberCommand(actorId, "room.inbox.acknowledge", request, existing);
          return { value: inboxFromRow(row), event: existing, deduplicated: true };
        }
        return this.#appendItemAcknowledgement(actorId, request, row);
      }
      const acknowledgedAt = this.#timestamp();
      this.#options.database.prepare(
        "UPDATE room_inbox_items SET state = 'acknowledged', acknowledged_at = ? WHERE inbox_item_id = ?",
      ).run(acknowledgedAt, request.inboxItemId);
      const value = inboxFromRow({ ...row, state: "acknowledged", acknowledged_at: acknowledgedAt });
      const event = this.#options.appendEvent({
        roomId: request.roomId,
        actorId,
        type: "inbox.acknowledged",
        aggregateType: "inbox",
        aggregateId: request.inboxItemId,
        idempotencyKey: request.idempotencyKey,
        createdAt: acknowledgedAt,
        payload: {
          inboxItemId: request.inboxItemId,
          eventId: request.eventId,
          participantId: actorId,
          acknowledgedAt,
        },
      });
      this.#options.rememberCommand(actorId, "room.inbox.acknowledge", request, event);
      return { value, event, deduplicated: false };
    });
  }

  acknowledgeRoom(
    actorId: string,
    rawRequest: AcknowledgeRoomRequest,
  ): RoomMutationResult<{ acknowledgedCount: number; throughRoomSeq: number }> {
    const request = this.#validate(() => validateAcknowledgeRoomRequest(rawRequest));
    const replay = this.#options.command(actorId, "room.acknowledge", request);
    if (replay) return { value: this.#roomReplayValue(request, replay), event: replay, deduplicated: true };
    return this.#options.transaction(() => {
      const repeated = this.#options.command(actorId, "room.acknowledge", request);
      if (repeated) {
        return { value: this.#roomReplayValue(request, repeated), event: repeated, deduplicated: true };
      }
      this.#options.requireMembership(request.roomId, actorId);
      const current = this.#options.roomHead(request.roomId);
      if (current !== request.basedOnRoomSeq) {
        throw roomError(
          "stale_context",
          `Room ${request.roomId} changed: expected sequence ${request.basedOnRoomSeq}, current sequence is ${current}`,
        );
      }
      const acknowledgedAt = this.#timestamp();
      const result = this.#options.database.prepare(
        `UPDATE room_inbox_items SET state = 'acknowledged', acknowledged_at = ?
         WHERE room_id = ? AND participant_id = ? AND state = 'pending' AND event_seq <= ?`,
      ).run(acknowledgedAt, request.roomId, actorId, request.throughRoomSeq);
      const acknowledgedCount = Number(result.changes);
      const event = this.#options.appendEvent({
        roomId: request.roomId,
        actorId,
        type: "room.acknowledged",
        aggregateType: "room",
        aggregateId: request.roomId,
        idempotencyKey: request.idempotencyKey,
        createdAt: acknowledgedAt,
        payload: {
          participantId: actorId,
          throughRoomSeq: request.throughRoomSeq,
          acknowledgedCount,
          acknowledgedAt,
        },
      });
      this.#options.rememberCommand(actorId, "room.acknowledge", request, event);
      return {
        value: { acknowledgedCount, throughRoomSeq: request.throughRoomSeq },
        event,
        deduplicated: false,
      };
    });
  }

  #messageReplay(
    actorId: string,
    request: AcknowledgeRoomMessageRequest,
    event: RoomEvent,
  ): RoomMutationResult<RoomInboxItem> {
    return {
      value: inboxFromRow(this.#requireInboxMessage(request.roomId, actorId, request.messageId)),
      event,
      deduplicated: true,
    };
  }

  #appendMessageAcknowledgement(
    actorId: string,
    request: AcknowledgeRoomMessageRequest,
    row: Row,
  ): RoomMutationResult<RoomInboxItem> {
    const acknowledgedAt = this.#timestamp();
    const event = this.#options.appendEvent({
      roomId: request.roomId,
      actorId,
      type: "message.acknowledged",
      aggregateType: "message",
      aggregateId: request.messageId,
      idempotencyKey: request.idempotencyKey,
      createdAt: acknowledgedAt,
      payload: { messageId: request.messageId, participantId: actorId, acknowledgedAt },
    });
    this.#options.rememberCommand(actorId, "room.message.acknowledge", request, event);
    return { value: inboxFromRow(row), event, deduplicated: false };
  }

  #appendItemAcknowledgement(
    actorId: string,
    request: AcknowledgeRoomInboxItemRequest,
    row: Row,
  ): RoomMutationResult<RoomInboxItem> {
    const acknowledgedAt = this.#timestamp();
    const event = this.#options.appendEvent({
      roomId: request.roomId,
      actorId,
      type: "inbox.acknowledged",
      aggregateType: "inbox",
      aggregateId: request.inboxItemId,
      idempotencyKey: request.idempotencyKey,
      createdAt: acknowledgedAt,
      payload: {
        inboxItemId: request.inboxItemId,
        eventId: request.eventId,
        participantId: actorId,
        acknowledgedAt,
      },
    });
    this.#options.rememberCommand(actorId, "room.inbox.acknowledge", request, event);
    return { value: inboxFromRow(row), event, deduplicated: false };
  }

  #itemReplay(
    actorId: string,
    request: AcknowledgeRoomInboxItemRequest,
    event: RoomEvent,
  ): RoomMutationResult<RoomInboxItem> {
    return {
      value: inboxFromRow(this.#requireInboxItem(
        request.roomId,
        actorId,
        request.inboxItemId,
        request.eventId,
      )),
      event,
      deduplicated: true,
    };
  }

  #requireInboxItem(
    roomId: string,
    participantId: string,
    inboxItemId: string,
    eventId: string,
  ): Row {
    const row = this.#options.database.prepare(
      `SELECT inbox.*, event.type AS event_type,
              event.aggregate_type AS event_aggregate_type,
              event.aggregate_id AS event_aggregate_id,
              CASE
                WHEN event.aggregate_type = 'task' THEN event.aggregate_id
                WHEN event.aggregate_type = 'review' THEN json_extract(event.payload_json, '$.taskId')
                ELSE NULL
              END AS target_task_id,
              CASE WHEN event.type = 'review.submitted'
                THEN json_extract(event.payload_json, '$.disposition')
                ELSE NULL
              END AS review_disposition
       FROM room_inbox_items AS inbox
       JOIN room_events AS event ON event.event_id = inbox.event_id
       WHERE inbox.room_id = ? AND inbox.participant_id = ?
         AND inbox.inbox_item_id = ? AND inbox.event_id = ?`,
    ).get(roomId, participantId, inboxItemId, eventId) as Row | undefined;
    if (!row) {
      throw roomError("not_found", `Inbox item ${inboxItemId} was not found for principal ${participantId}`);
    }
    return row;
  }

  #requireInboxMessage(roomId: string, participantId: string, messageId: string): Row {
    const row = this.#options.database.prepare(
      `SELECT inbox.*, event.type AS event_type,
              event.aggregate_type AS event_aggregate_type,
              event.aggregate_id AS event_aggregate_id,
              NULL AS target_task_id, NULL AS review_disposition
       FROM room_inbox_items AS inbox
       JOIN room_events AS event ON event.event_id = inbox.event_id
       JOIN room_messages AS message ON message.room_id = inbox.room_id AND message.room_seq = inbox.event_seq
       WHERE inbox.room_id = ? AND inbox.participant_id = ? AND message.message_id = ?`,
    ).get(roomId, participantId, messageId) as Row | undefined;
    if (!row) {
      throw roomError("not_found", `message ${messageId} is not in principal ${participantId}'s Inbox`);
    }
    return row;
  }

  #messageAcknowledgement(roomId: string, actorId: string, messageId: string): RoomEvent | undefined {
    const row = this.#options.database.prepare(
      `SELECT * FROM room_events WHERE room_id = ? AND actor_id = ?
         AND type = 'message.acknowledged' AND aggregate_id = ?
       ORDER BY room_seq LIMIT 1`,
    ).get(roomId, actorId, messageId) as Row | undefined;
    if (!row) return undefined;
    return {
      eventId: text(row, "event_id"),
      roomId: text(row, "room_id"),
      roomSeq: integer(row, "room_seq"),
      type: text(row, "type"),
      actorId: text(row, "actor_id"),
      aggregateType: text(row, "aggregate_type"),
      aggregateId: text(row, "aggregate_id"),
      payload: JSON.parse(text(row, "payload_json")) as Record<string, unknown>,
      idempotencyKey: text(row, "idempotency_key"),
      schemaVersion: 1,
      createdAt: text(row, "created_at"),
    };
  }

  #itemAcknowledgement(roomId: string, actorId: string, inboxItemId: string): RoomEvent | undefined {
    const row = this.#options.database.prepare(
      `SELECT * FROM room_events WHERE room_id = ? AND actor_id = ?
         AND type = 'inbox.acknowledged' AND aggregate_id = ?
       ORDER BY room_seq LIMIT 1`,
    ).get(roomId, actorId, inboxItemId) as Row | undefined;
    if (!row) return undefined;
    return {
      eventId: text(row, "event_id"), roomId: text(row, "room_id"),
      roomSeq: integer(row, "room_seq"), type: text(row, "type"), actorId: text(row, "actor_id"),
      aggregateType: text(row, "aggregate_type"), aggregateId: text(row, "aggregate_id"),
      payload: JSON.parse(text(row, "payload_json")) as Record<string, unknown>,
      idempotencyKey: text(row, "idempotency_key"), schemaVersion: 1,
      createdAt: text(row, "created_at"),
    };
  }

  #roomReplayValue(request: AcknowledgeRoomRequest, event: RoomEvent) {
    return {
      acknowledgedCount: Number(event.payload.acknowledgedCount ?? 0),
      throughRoomSeq: Number(event.payload.throughRoomSeq ?? request.throughRoomSeq),
    };
  }

  #validate<T>(operation: () => T): T {
    try { return operation(); } catch (error) {
      throw roomError("invalid_argument", error instanceof Error ? error.message : "Invalid Inbox command");
    }
  }

  #timestamp(): string {
    return this.#options.now().toISOString();
  }
}
