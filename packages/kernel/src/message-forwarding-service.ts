import type { DatabaseSync } from "node:sqlite";

import {
  ClientMessageForwardRequestSchema,
  ClientMessageForwardResponseSchema,
  ClientMessageForwardTargetsRequestSchema,
  ForwardedMessageBundleSchema,
  type ClientMessageForwardRequest,
  type ClientMessageForwardResponse,
  type ClientMessageForwardTargetsRequest,
  type ForwardedMessageBundle,
  type Principal,
  type Room,
} from "@rah-os/protocol";

import { requireRoomMember } from "./collaboration-policy.ts";
import { activeInstancePrivateBoxPredicate } from "./instance-worker-scope.ts";
import { roomProjectionFromRow } from "./collaboration-projection.ts";
import {
  ForbiddenError,
  IdempotencyConflictError,
  MessageForwardSourceError,
  NotFoundError,
} from "./errors.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import {
  forwardedAttachmentProjectionId,
  type RoomFiles,
} from "./room-files.ts";
import { integer, nullableText, text, type Row } from "./sqlite-row.ts";

type PreparedForward = {
  allowedDestinationRoomIds: string[];
  bundle: ForwardedMessageBundle;
  note: string;
  requestId: string;
  sourceMessageIds: string[];
  sourceRoomId: string;
  workspaceId: string;
};

export class MessageForwardDestinationError extends Error {
  readonly code: "destination_not_available" | "destination_read_only";

  constructor(code: MessageForwardDestinationError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}

export class MessageForwardingService {
  readonly #createId: (prefix: string) => string;
  readonly #database: DatabaseSync;
  readonly #events: RoomEventWriter;
  readonly #files: RoomFiles;
  readonly #now: () => Date;

  constructor(input: {
    createId: (prefix: string) => string;
    database: DatabaseSync;
    events: RoomEventWriter;
    files: RoomFiles;
    now: () => Date;
  }) {
    this.#createId = input.createId;
    this.#database = input.database;
    this.#events = input.events;
    this.#files = input.files;
    this.#now = input.now;
  }

  listTargets(
    actor: Principal,
    untrustedInput: ClientMessageForwardTargetsRequest,
  ): Room[] {
    const input =
      ClientMessageForwardTargetsRequestSchema.parse(untrustedInput);
    requireRoomMember(this.#database, input.sourceRoomId, actor.principalId);
    const source = this.#database
      .prepare("SELECT workspace_id FROM rooms WHERE room_id = ?")
      .get(input.sourceRoomId);
    if (source === undefined) {
      throw new ForbiddenError(`room ${input.sourceRoomId} is unavailable`);
    }
    const query = `%${escapeLike(input.query.toLocaleLowerCase())}%`;
    return this.#database
      .prepare(
        `SELECT rooms.*, direct_room_pairs.left_principal_id,
                direct_room_pairs.right_principal_id
         FROM rooms
         JOIN memberships ON memberships.room_id = rooms.room_id
         LEFT JOIN direct_room_pairs ON direct_room_pairs.room_id = rooms.room_id
         WHERE memberships.principal_id = ?
           AND rooms.workspace_id = ?
           AND rooms.room_id <> ?
           AND rooms.archived_at IS NULL
           AND rooms.kind IN ('channel', 'direct')
           AND (
             lower(rooms.name) LIKE ? ESCAPE '\\'
             OR lower(rooms.slug) LIKE ? ESCAPE '\\'
           )
         ORDER BY lower(rooms.name), rooms.slug, rooms.room_id
         LIMIT ?`,
      )
      .all(
        actor.principalId,
        text(source, "workspace_id"),
        input.sourceRoomId,
        query,
        query,
        input.limit,
      )
      .map((row) => roomProjectionFromRow(row));
  }

  prepare(
    actor: Principal,
    untrustedInput: ClientMessageForwardRequest,
  ): PreparedForward {
    const input = ClientMessageForwardRequestSchema.parse(untrustedInput);
    requireRoomMember(this.#database, input.sourceRoomId, actor.principalId);
    const sourceRoomRow = this.#database
      .prepare("SELECT * FROM rooms WHERE room_id = ?")
      .get(input.sourceRoomId);
    if (sourceRoomRow === undefined) {
      throw new ForbiddenError(`room ${input.sourceRoomId} is unavailable`);
    }
    const note = input.note?.trim() ?? "";
    const sourceMessageIds = [...input.sourceMessageIds].sort();
    const previousRequest = this.#database
      .prepare(
        `SELECT * FROM message_forward_requests
         WHERE actor_id = ? AND request_id = ?`,
      )
      .get(actor.principalId, input.requestId);
    if (previousRequest !== undefined) {
      const previousSourceIds = stringArray(
        text(previousRequest, "source_message_ids_json"),
      );
      const allowedDestinationRoomIds = stringArray(
        text(previousRequest, "destination_room_ids_json"),
      );
      if (
        text(previousRequest, "source_room_id") !== input.sourceRoomId ||
        text(previousRequest, "workspace_id") !==
          text(sourceRoomRow, "workspace_id") ||
        text(previousRequest, "note") !== note ||
        JSON.stringify(previousSourceIds) !==
          JSON.stringify(sourceMessageIds) ||
        input.destinationRoomIds.some(
          (roomId) => !allowedDestinationRoomIds.includes(roomId),
        )
      ) {
        throw new IdempotencyConflictError(
          `forward request ${input.requestId} conflicts with its frozen source or destinations`,
        );
      }
      return {
        allowedDestinationRoomIds,
        bundle: ForwardedMessageBundleSchema.parse(
          JSON.parse(text(previousRequest, "forwarded_bundle_json")),
        ),
        note,
        requestId: input.requestId,
        sourceMessageIds: previousSourceIds,
        sourceRoomId: input.sourceRoomId,
        workspaceId: text(previousRequest, "workspace_id"),
      };
    }
    const placeholders = input.sourceMessageIds.map(() => "?").join(", ");
    const rows = this.#database
      .prepare(
        `SELECT messages.*, room_events.room_seq, room_events.type AS event_type,
                principals.handle, principals.kind AS actor_kind,
                principals.display_name, principals.avatar_key,
                threads.root_message_id,
                tasks.task_id
         FROM messages
         JOIN room_events
           ON room_events.room_id = messages.room_id
          AND room_events.aggregate_id = messages.message_id
         JOIN principals ON principals.principal_id = messages.actor_id
         LEFT JOIN threads ON threads.thread_id = messages.thread_id
         LEFT JOIN tasks ON tasks.source_message_id = messages.message_id
         WHERE messages.room_id = ?
           AND messages.message_id IN (${placeholders})
         ORDER BY room_events.room_seq, messages.message_id`,
      )
      .all(input.sourceRoomId, ...input.sourceMessageIds);
    if (rows.length !== input.sourceMessageIds.length) {
      throw new NotFoundError(
        "one or more source messages were not found in the source Room",
      );
    }
    for (const row of rows) this.#assertForwardableSource(row);
    const bundle = ForwardedMessageBundleSchema.parse({
      items: rows.map((row) => {
        const threadId = nullableText(row, "thread_id");
        const displayName = nullableText(row, "display_name");
        const avatarKey = nullableText(row, "avatar_key");
        const attachmentsJson = nullableText(row, "attachments_json");
        return {
          actor: {
            ...(avatarKey === null ? {} : { avatarKey }),
            ...(displayName === null ? {} : { displayName }),
            handle: text(row, "handle"),
            kind: text(row, "actor_kind"),
            principalId: text(row, "actor_id"),
          },
          attachments:
            attachmentsJson === null ? [] : JSON.parse(attachmentsJson),
          body: text(row, "body"),
          mentions: JSON.parse(String(row.mentions_json ?? "[]")),
          createdAt: text(row, "created_at"),
          isThreadChild: threadId !== null,
          sourceMessageId: text(row, "message_id"),
          sourceRoomSeq: integer(row, "room_seq"),
          ...(threadId === null
            ? {}
            : {
                sourceRootMessageId: text(row, "root_message_id"),
                sourceThreadId: threadId,
              }),
        };
      }),
      kind: "forwarded-bundle",
      sourceRoom: {
        kind: text(sourceRoomRow, "kind"),
        name: text(sourceRoomRow, "name"),
        roomId: input.sourceRoomId,
        slug: text(sourceRoomRow, "slug"),
      },
      version: 1,
    });
    const allowedDestinationRoomIds = [...input.destinationRoomIds].sort();
    this.#database
      .prepare(
        `INSERT INTO message_forward_requests(
           actor_id,request_id,source_room_id,workspace_id,
           source_message_ids_json,destination_room_ids_json,note,
           forwarded_bundle_json,created_at
         ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        actor.principalId,
        input.requestId,
        input.sourceRoomId,
        text(sourceRoomRow, "workspace_id"),
        JSON.stringify(sourceMessageIds),
        JSON.stringify(allowedDestinationRoomIds),
        note,
        JSON.stringify(bundle),
        this.#now().toISOString(),
      );
    return {
      allowedDestinationRoomIds,
      bundle,
      note,
      requestId: input.requestId,
      sourceMessageIds,
      sourceRoomId: input.sourceRoomId,
      workspaceId: text(sourceRoomRow, "workspace_id"),
    };
  }

  deliver(
    actor: Principal,
    prepared: PreparedForward,
    destinationRoomId: string,
  ): { deduplicated: boolean; messageId: string } {
    if (!prepared.allowedDestinationRoomIds.includes(destinationRoomId)) {
      throw new MessageForwardDestinationError(
        "destination_not_available",
        "destination Room was not part of the frozen forward request",
      );
    }
    const destination = this.#database
      .prepare(
        `SELECT rooms.*, memberships.principal_id AS member_principal_id
         FROM rooms
         LEFT JOIN memberships
           ON memberships.room_id = rooms.room_id
          AND memberships.principal_id = ?
         WHERE rooms.room_id = ?`,
      )
      .get(actor.principalId, destinationRoomId);
    if (
      destination === undefined ||
      nullableText(destination, "member_principal_id") === null ||
      text(destination, "workspace_id") !== prepared.workspaceId ||
      !["channel", "direct"].includes(text(destination, "kind"))
    ) {
      throw new MessageForwardDestinationError(
        "destination_not_available",
        "destination Room is not available",
      );
    }
    if (nullableText(destination, "archived_at") !== null) {
      throw new MessageForwardDestinationError(
        "destination_read_only",
        "destination Room is archived and read-only",
      );
    }
    const idempotencyKey = `message.forward:${actor.principalId}:${prepared.requestId}`;
    const previous = this.#database
      .prepare(
        "SELECT * FROM room_events WHERE room_id = ? AND idempotency_key = ?",
      )
      .get(destinationRoomId, idempotencyKey);
    const requestSnapshot = {
      note: prepared.note,
      sourceMessageIds: prepared.sourceMessageIds,
      sourceRoomId: prepared.sourceRoomId,
    };
    const projectedBundle = this.#projectedBundle(
      actor,
      prepared,
      destinationRoomId,
    );
    if (previous !== undefined) {
      const event = this.#events.eventFromRow(previous);
      if (
        event.type !== "message.posted" ||
        event.actorId !== actor.principalId ||
        JSON.stringify(event.payload.forwardRequest) !==
          JSON.stringify(requestSnapshot) ||
        JSON.stringify(event.payload.forwardedBundle) !==
          JSON.stringify(projectedBundle)
      ) {
        throw new IdempotencyConflictError(
          `forward request ${prepared.requestId} conflicts in destination Room`,
        );
      }
      return { deduplicated: true, messageId: event.aggregateId };
    }
    if (
      !this.#database
        .prepare(`SELECT 1 WHERE ${activeInstancePrivateBoxPredicate("?")}`)
        .get(destinationRoomId)
    )
      throw new MessageForwardDestinationError(
        "destination_not_available",
        "Instance private box is inactive: source channel membership removed",
      );
    const messageId = this.#createId("message");
    const createdAt = this.#now().toISOString();
    let projectedAttachmentIds: string[] = [];
    try {
      this.#database
        .prepare(
          `INSERT INTO messages(
             message_id, room_id, actor_id, body, forwarded_bundle_json, created_at,
             attachments_json
           ) VALUES(?, ?, ?, ?, ?, ?, '[]')`,
        )
        .run(
          messageId,
          destinationRoomId,
          actor.principalId,
          prepared.note,
          JSON.stringify(projectedBundle),
          createdAt,
        );
      projectedAttachmentIds = this.#files.projectForwardedAttachments({
        actorId: actor.principalId,
        createdAt,
        destinationMessageId: messageId,
        destinationRoomId,
        requestId: prepared.requestId,
        sourceRoomId: prepared.sourceRoomId,
        sources: prepared.bundle.items.flatMap((item) =>
          item.attachments.map((attachment) => ({
            attachment,
            sourceMessageId: item.sourceMessageId,
          })),
        ),
      });
      this.#events.append({
        actorId: actor.principalId,
        aggregateId: messageId,
        aggregateType: "message",
        idempotencyKey,
        payload: {
          body: prepared.note,
          forwardRequest: requestSnapshot,
          forwardedBundle: projectedBundle,
          messageId,
          recipientIds: [],
          recipients: [],
        },
        roomId: destinationRoomId,
        type: "message.posted",
      });
    } catch (error) {
      this.#files.rollbackUncommittedForwardProjection(projectedAttachmentIds);
      throw error;
    }
    return { deduplicated: false, messageId };
  }

  response(
    requestId: string,
    results: ClientMessageForwardResponse["results"],
  ): ClientMessageForwardResponse {
    return ClientMessageForwardResponseSchema.parse({ requestId, results });
  }

  #assertForwardableSource(row: Row): void {
    if (nullableText(row, "forwarded_bundle_json") !== null) {
      throw new MessageForwardSourceError(
        "forwarded_source_not_supported",
        "forwarded source is not supported",
      );
    }
    if (nullableText(row, "task_id") !== null) {
      throw new MessageForwardSourceError(
        "action_source_not_supported",
        "action source is not supported",
      );
    }
    if (
      text(row, "event_type") !== "message.posted" ||
      text(row, "actor_kind") === "service"
    ) {
      throw new MessageForwardSourceError(
        "system_source_not_supported",
        "system source is not supported",
      );
    }
  }

  #projectedBundle(
    actor: Principal,
    prepared: PreparedForward,
    destinationRoomId: string,
  ): ForwardedMessageBundle {
    return ForwardedMessageBundleSchema.parse({
      ...prepared.bundle,
      items: prepared.bundle.items.map((item) =>
        item.attachments.length === 0
          ? item
          : {
              ...item,
              attachmentPolicy: "projected",
              attachments: item.attachments.map((attachment) => ({
                ...attachment,
                attachmentId: forwardedAttachmentProjectionId({
                  actorId: actor.principalId,
                  destinationRoomId,
                  requestId: prepared.requestId,
                  sourceAttachmentId: attachment.attachmentId,
                }),
              })),
              provenanceState: "available",
            },
      ),
    });
  }
}

function stringArray(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => typeof item !== "string")
  ) {
    throw new Error("stored forward request identity is invalid");
  }
  return [...parsed];
}

function escapeLike(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}
