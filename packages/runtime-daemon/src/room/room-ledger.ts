import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  assertRoomTextStorageSafe,
  type AcknowledgeRoomMessageRequest,
  type AddRoomMemberRequest,
  type CreateRoomRequest,
  type PostRoomMessageRequest,
  type RoomEvent,
  type RoomAttentionReason,
  type RoomInboxItem,
  type RoomMembership,
  type RoomMessage,
  type RoomMessagePage,
  type RoomMutationResult,
  type RoomOutboxEntry,
  type RoomPrincipal,
  type RoomRecord,
  type RoomSnapshot,
  type RoomSyncResult,
  type SyncRoomRequest,
  validateAddRoomMemberRequest,
  validateAcknowledgeRoomMessageRequest,
  validateCreateRoomRequest,
  validatePostRoomMessageRequest,
  validateSyncRoomRequest,
} from "@rah/runtime-protocol";
import { RoomDomainError, roomError } from "./room-errors";
import {
  readRoomCatalog,
  type RoomCatalogLedgerPage,
  type RoomCatalogReadOptions,
} from "./room-catalog";
import {
  eventFromRow,
  inboxFromRow,
  integer,
  membershipFromRow,
  messageFromRow,
  optionalText,
  outboxFromRow,
  principalFromRow,
  roomFromRow,
  type RoomSqlRow as Row,
  text,
} from "./room-rows";
import {
  migrateRoomLedgerV1ToV2,
  ROOM_LEDGER_SCHEMA,
  ROOM_LEDGER_SCHEMA_VERSION,
} from "./room-schema";

export interface RoomLedgerOptions {
  createId?: (prefix: string) => string;
  now?: () => Date;
}

const ROOM_SYNC_RESPONSE_BYTE_LIMIT = 1_048_576;
const ROOM_LIST_LIMIT = 500;
const ROOM_MEMBER_LIMIT = 500;
const STABLE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export class RoomLedger {
  readonly #database: DatabaseSync;
  readonly #createId: (prefix: string) => string;
  readonly #now: () => Date;
  #closed = false;

  constructor(databasePath: string, options: RoomLedgerOptions = {}) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.#database = new DatabaseSync(databasePath);
    const schemaVersion = integer(
      this.#database.prepare("PRAGMA user_version").get() as Row,
      "user_version",
    );
    if (schemaVersion !== 0 && schemaVersion !== 1 && schemaVersion !== ROOM_LEDGER_SCHEMA_VERSION) {
      this.#database.close();
      throw roomError(
        "conflict",
        `Room ledger schema version ${schemaVersion} is not supported by version ${ROOM_LEDGER_SCHEMA_VERSION}`,
      );
    }
    try {
      if (schemaVersion === 1) migrateRoomLedgerV1ToV2(this.#database);
      this.#database.exec(ROOM_LEDGER_SCHEMA);
    } catch (error) {
      this.#database.close();
      throw this.#storageError(error);
    }
    this.#createId = options.createId ?? ((prefix) => `${prefix}-${randomUUID()}`);
    this.#now = options.now ?? (() => new Date());
  }

  provisionPrincipal(input: {
    principalId: string;
    handle: string;
    kind: RoomPrincipal["kind"];
    displayName?: string;
  }): RoomPrincipal {
    if (!STABLE_IDENTIFIER.test(input.principalId)) {
      throw roomError("invalid_argument", "principalId must be a stable identifier");
    }
    if (!STABLE_IDENTIFIER.test(input.handle)) {
      throw roomError("invalid_argument", "handle must be a stable identifier");
    }
    if (input.kind !== "human" && input.kind !== "agent" && input.kind !== "service") {
      throw roomError("invalid_argument", "principal kind must be human, agent, or service");
    }
    const displayName = input.displayName?.trim();
    if (displayName !== undefined && (displayName.length < 1 || displayName.length > 120)) {
      throw roomError("invalid_argument", "displayName must contain 1 to 120 characters");
    }
    if (displayName !== undefined) {
      try {
        assertRoomTextStorageSafe(displayName, "displayName");
      } catch (error) {
        throw roomError(
          "invalid_argument",
          error instanceof Error ? error.message : "displayName is not storage-safe",
        );
      }
    }
    const existing = this.#database
      .prepare("SELECT * FROM room_principals WHERE principal_id = ?")
      .get(input.principalId) as Row | undefined;
    if (existing) {
      const principal = principalFromRow(existing);
      if (
        principal.handle !== input.handle ||
        principal.kind !== input.kind ||
        principal.displayName !== displayName
      ) {
        throw roomError(
          "conflict",
          `principal ${input.principalId} already has a different definition`,
        );
      }
      return principal;
    }
    const handleOwner = this.#principalByHandle(input.handle);
    if (handleOwner) {
      throw roomError("conflict", `handle ${input.handle} is already in use`);
    }
    const createdAt = this.#timestamp();
    try {
      this.#database
        .prepare(
          "INSERT INTO room_principals(principal_id, handle, kind, display_name, created_at) VALUES(?, ?, ?, ?, ?)",
        )
        .run(input.principalId, input.handle, input.kind, displayName ?? null, createdAt);
    } catch (error) {
      throw this.#storageError(error);
    }
    return {
      principalId: input.principalId,
      handle: input.handle,
      kind: input.kind,
      ...(displayName ? { displayName } : {}),
      createdAt,
    };
  }

  ensureLocalHumanPrincipal(input: {
    handle?: string;
    displayName?: string;
  } = {}): RoomPrincipal {
    const existing = this.#database
      .prepare("SELECT value FROM room_metadata WHERE key = 'local_human_principal_id'")
      .get() as Row | undefined;
    if (existing) return this.#requirePrincipal(text(existing, "value"));
    return this.#transaction(() => {
      const raced = this.#database
        .prepare("SELECT value FROM room_metadata WHERE key = 'local_human_principal_id'")
        .get() as Row | undefined;
      if (raced) return this.#requirePrincipal(text(raced, "value"));
      const principalId = this.#createId("principal");
      const preferredHandle = input.handle ?? "owner";
      const handle = this.#principalByHandle(preferredHandle)
        ? `${preferredHandle.slice(0, 110)}-${createHash("sha256")
            .update(principalId)
            .digest("hex")
            .slice(0, 12)}`
        : preferredHandle;
      const principal = this.provisionPrincipal({
        principalId,
        handle,
        kind: "human",
        displayName: input.displayName ?? "Owner",
      });
      this.#database
        .prepare(
          "INSERT INTO room_metadata(key, value) VALUES('local_human_principal_id', ?)",
        )
        .run(principal.principalId);
      return principal;
    });
  }

  createRoom(
    actorId: string,
    rawRequest: CreateRoomRequest,
  ): RoomMutationResult<RoomRecord> {
    const request = this.#validate(() => validateCreateRoomRequest(rawRequest));
    const command = this.#command(actorId, "room.create", request);
    if (command) {
      return { value: this.#requireRoom(command.aggregateId), event: command, deduplicated: true };
    }
    const actor = this.#requirePrincipal(actorId);
    if (actor.kind !== "human") {
      throw roomError("forbidden", "Only a Human principal may create a Room");
    }

    return this.#transaction(() => {
      const replay = this.#command(actorId, "room.create", request);
      if (replay) {
        return { value: this.#requireRoom(replay.aggregateId), event: replay, deduplicated: true };
      }
      const createdAt = this.#timestamp();
      const room: RoomRecord = {
        roomId: request.roomId ?? this.#createId("room"),
        workspaceKey: request.workspaceKey,
        kind: request.kind,
        slug: request.slug,
        name: request.name.trim(),
        visibility: request.visibility ?? "private",
        createdAt,
      };
      const ownerMembership: RoomMembership = {
        roomId: room.roomId,
        principalId: actor.principalId,
        role: "owner",
        joinedAt: createdAt,
      };
      this.#database
        .prepare(
          "INSERT INTO rooms(room_id, workspace_key, kind, slug, name, visibility, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          room.roomId,
          room.workspaceKey,
          room.kind,
          room.slug,
          room.name,
          room.visibility,
          room.createdAt,
        );
      this.#database
        .prepare(
          "INSERT INTO room_memberships(room_id, principal_id, role, joined_at) VALUES(?, ?, 'owner', ?)",
        )
        .run(
          ownerMembership.roomId,
          ownerMembership.principalId,
          ownerMembership.joinedAt,
        );
      this.#database
        .prepare(
          "INSERT INTO room_catalog_memberships(room_id, principal_id) VALUES(?, ?)",
        )
        .run(ownerMembership.roomId, ownerMembership.principalId);
      const event = this.#appendEvent({
        roomId: room.roomId,
        actorId,
        type: "room.created",
        aggregateType: "room",
        aggregateId: room.roomId,
        idempotencyKey: request.idempotencyKey,
        createdAt,
        payload: { room, ownerMembership, ownerPrincipal: actor },
      });
      const result: RoomMutationResult<RoomRecord> = {
        value: room,
        event,
        deduplicated: false,
      };
      this.#rememberCommand(actorId, "room.create", request, event);
      return result;
    });
  }

  addMember(
    actorId: string,
    rawRequest: AddRoomMemberRequest,
  ): RoomMutationResult<RoomMembership> {
    const request = this.#validate(() => validateAddRoomMemberRequest(rawRequest));
    const command = this.#command(actorId, "room.member.add", request);
    if (command) {
      return {
        value: this.#requireMembership(request.roomId, command.aggregateId),
        event: command,
        deduplicated: true,
      };
    }

    return this.#transaction(() => {
      const replay = this.#command(actorId, "room.member.add", request);
      if (replay) {
        return {
          value: this.#requireMembership(request.roomId, replay.aggregateId),
          event: replay,
          deduplicated: true,
        };
      }
      const actorMembership = this.#requireMembership(request.roomId, actorId);
      if (actorMembership.role !== "owner" && actorMembership.role !== "admin") {
        throw roomError("forbidden", "Room membership changes require owner or admin role");
      }
      if (request.role === "owner" && actorMembership.role !== "owner") {
        throw roomError("forbidden", "Only a Room owner may grant owner role");
      }
      const principal = this.#requirePrincipal(request.principalId);
      this.#requireRoomHead(request.roomId, request.basedOnRoomSeq);
      const room = this.#requireRoom(request.roomId);
      const memberCount = this.#roomMembershipPrincipalIds(request.roomId).length;
      if (room.kind === "direct") {
        if (request.role !== "member") {
          throw roomError(
            "invalid_argument",
            "Direct Room participants can only be added as members",
          );
        }
        if (memberCount >= 2) {
          throw roomError("conflict", "A Direct Room cannot have more than two participants");
        }
      }
      if (memberCount >= ROOM_MEMBER_LIMIT) {
        throw roomError(
          "resource_exhausted",
          `A Room cannot have more than ${ROOM_MEMBER_LIMIT} participants`,
        );
      }
      if (this.#membership(request.roomId, request.principalId)) {
        throw roomError(
          "conflict",
          `principal ${request.principalId} is already a Room member`,
        );
      }
      let directPair: [string, string] | undefined;
      if (room.kind === "direct" && memberCount === 1) {
        const existingParticipant = this.#roomMembershipPrincipalIds(request.roomId)[0]!;
        if (existingParticipant === request.principalId) {
          throw roomError("conflict", "A Direct Room requires two distinct participants");
        }
        directPair = existingParticipant < request.principalId
          ? [existingParticipant, request.principalId]
          : [request.principalId, existingParticipant];
        const existingDirect = this.#database.prepare(
          `SELECT room_id FROM room_direct_pairs
           WHERE workspace_key = ? AND principal_low = ? AND principal_high = ?`,
        ).get(room.workspaceKey, directPair[0], directPair[1]) as Row | undefined;
        if (existingDirect) {
          throw roomError(
            "conflict",
            "A Direct Room already exists for these workspace participants",
          );
        }
      }
      const membership: RoomMembership = {
        roomId: request.roomId,
        principalId: request.principalId,
        role: request.role,
        joinedAt: this.#timestamp(),
      };
      this.#database
        .prepare(
          "INSERT INTO room_memberships(room_id, principal_id, role, joined_at) VALUES(?, ?, ?, ?)",
        )
        .run(
          membership.roomId,
          membership.principalId,
          membership.role,
          membership.joinedAt,
        );
      this.#database
        .prepare(
          "INSERT INTO room_catalog_memberships(room_id, principal_id) VALUES(?, ?)",
        )
        .run(membership.roomId, membership.principalId);
      if (directPair) {
        this.#database.prepare(
          `INSERT INTO room_direct_pairs(
             workspace_key, principal_low, principal_high, room_id
           ) VALUES(?, ?, ?, ?)`,
        ).run(room.workspaceKey, directPair[0], directPair[1], room.roomId);
      }
      const event = this.#appendEvent({
        roomId: request.roomId,
        actorId,
        type: "membership.added",
        aggregateType: "membership",
        aggregateId: request.principalId,
        idempotencyKey: request.idempotencyKey,
        createdAt: membership.joinedAt,
        payload: { membership, principal },
      });
      const result: RoomMutationResult<RoomMembership> = {
        value: membership,
        event,
        deduplicated: false,
      };
      this.#rememberCommand(actorId, "room.member.add", request, event);
      return result;
    });
  }

  postMessage(
    actorId: string,
    rawRequest: PostRoomMessageRequest,
  ): RoomMutationResult<RoomMessage> {
    const validatedRequest = this.#validate(() => validatePostRoomMessageRequest(rawRequest));
    this.#requireMembership(validatedRequest.roomId, actorId);
    const request = this.#normalizeMessageIntent(validatedRequest);
    const command = this.#command(actorId, "room.message.post", request);
    if (command) {
      return { value: this.#requireMessage(command.aggregateId), event: command, deduplicated: true };
    }

    return this.#transaction(() => {
      const replay = this.#command(actorId, "room.message.post", request);
      if (replay) {
        return { value: this.#requireMessage(replay.aggregateId), event: replay, deduplicated: true };
      }
      this.#requireMembership(request.roomId, actorId);
      const room = this.#requireRoom(request.roomId);
      const attention = this.#messageAttention(room, actorId, request.mentionedPrincipalIds ?? []);
      for (const target of attention) {
        if (target.principalId === actorId) {
          throw roomError(
            "invalid_argument",
            "a Room message cannot create attention for its own actor",
          );
        }
      }
      const createdAt = this.#timestamp();
      const messageId = this.#createId("message");
      const event = this.#appendEvent({
        roomId: request.roomId,
        actorId,
        type: "message.posted",
        aggregateType: "message",
        aggregateId: messageId,
        idempotencyKey: request.idempotencyKey,
        createdAt,
        payload: {
          body: request.body,
          attention,
          createdAt,
        },
      });
      const message: RoomMessage = {
        messageId,
        roomId: request.roomId,
        roomSeq: event.roomSeq,
        actorId,
        body: request.body,
        createdAt,
      };
      this.#database
        .prepare(
          "INSERT INTO room_messages(message_id, room_id, room_seq, actor_id, body, created_at) VALUES(?, ?, ?, ?, ?, ?)",
        )
        .run(
          message.messageId,
          message.roomId,
          message.roomSeq,
          message.actorId,
          message.body,
          message.createdAt,
        );
      for (const target of attention) {
        const inboxItem: Omit<RoomInboxItem, "inboxSeq"> = {
          inboxItemId: this.#createId("inbox"),
          roomId: request.roomId,
          participantId: target.principalId,
          eventId: event.eventId,
          eventSeq: event.roomSeq,
          reason: target.reason,
          state: "pending",
          createdAt,
        };
        this.#database
          .prepare(
            "INSERT INTO room_inbox_items(inbox_item_id, room_id, participant_id, event_id, event_seq, reason, state, created_at) VALUES(?, ?, ?, ?, ?, ?, 'pending', ?)",
          )
          .run(
            inboxItem.inboxItemId,
            inboxItem.roomId,
            inboxItem.participantId,
            inboxItem.eventId,
            inboxItem.eventSeq,
            inboxItem.reason,
            inboxItem.createdAt,
          );
        this.#insertOutbox({
          roomId: request.roomId,
          roomSeq: event.roomSeq,
          topic: "inbox.available",
          payload: {
            eventId: event.eventId,
            headCursor: event.roomSeq,
            participantId: target.principalId,
            reason: target.reason,
            roomId: request.roomId,
          },
        });
      }
      const result: RoomMutationResult<RoomMessage> = {
        value: message,
        event,
        deduplicated: false,
      };
      this.#rememberCommand(actorId, "room.message.post", request, event);
      return result;
    });
  }

  acknowledgeMessage(
    actorId: string,
    rawRequest: AcknowledgeRoomMessageRequest,
  ): RoomMutationResult<RoomInboxItem> {
    const request = this.#validate(() => validateAcknowledgeRoomMessageRequest(rawRequest));
    const command = this.#command(actorId, "room.message.acknowledge", request);
    if (command) {
      return {
        value: this.#requireInboxMessage(request.roomId, actorId, request.messageId),
        event: command,
        deduplicated: true,
      };
    }

    return this.#transaction(() => {
      const replay = this.#command(actorId, "room.message.acknowledge", request);
      if (replay) {
        return {
          value: this.#requireInboxMessage(request.roomId, actorId, request.messageId),
          event: replay,
          deduplicated: true,
        };
      }
      this.#requireMembership(request.roomId, actorId);
      const row = this.#database
        .prepare(
          `SELECT inbox.*
           FROM room_inbox_items AS inbox
           JOIN room_messages AS message
             ON message.room_id = inbox.room_id
            AND message.room_seq = inbox.event_seq
           WHERE inbox.room_id = ?
             AND inbox.participant_id = ?
             AND message.message_id = ?`,
        )
        .get(request.roomId, actorId, request.messageId) as Row | undefined;
      if (!row) {
        throw roomError(
          "not_found",
          `message ${request.messageId} is not pending in principal ${actorId}'s Inbox`,
        );
      }
      const currentRoomSeq = this.#roomHead(request.roomId);
      const messageRoomSeq = integer(row, "event_seq");
      if (request.basedOnRoomSeq < messageRoomSeq || request.basedOnRoomSeq > currentRoomSeq) {
        throw roomError(
          "stale_context",
          `acknowledgement cursor ${request.basedOnRoomSeq} did not observe message sequence ${messageRoomSeq} at current sequence ${currentRoomSeq}`,
        );
      }
      if (text(row, "state") === "acknowledged") {
        const event = this.#requireAcknowledgementEvent(
          request.roomId,
          actorId,
          request.messageId,
        );
        const inboxItem = inboxFromRow(row);
        this.#rememberCommand(actorId, "room.message.acknowledge", request, event);
        return { value: inboxItem, event, deduplicated: true };
      }
      const acknowledgedAt = this.#timestamp();
      this.#database
        .prepare(
          "UPDATE room_inbox_items SET state = 'acknowledged', acknowledged_at = ? WHERE inbox_item_id = ?",
        )
        .run(acknowledgedAt, text(row, "inbox_item_id"));
      const inboxItem = inboxFromRow({
        ...row,
        state: "acknowledged",
        acknowledged_at: acknowledgedAt,
      });
      const event = this.#appendEvent({
        roomId: request.roomId,
        actorId,
        type: "message.acknowledged",
        aggregateType: "message",
        aggregateId: request.messageId,
        idempotencyKey: request.idempotencyKey,
        createdAt: acknowledgedAt,
        payload: {
          messageId: request.messageId,
          participantId: actorId,
          acknowledgedAt,
        },
      });
      const result: RoomMutationResult<RoomInboxItem> = {
        value: inboxItem,
        event,
        deduplicated: false,
      };
      this.#rememberCommand(actorId, "room.message.acknowledge", request, event);
      return result;
    });
  }

  syncRoom(actorId: string, rawRequest: SyncRoomRequest): RoomSyncResult {
    const request = this.#validate(() => validateSyncRoomRequest(rawRequest));
    this.#requireMembership(request.roomId, actorId);
    return this.#readTransaction(() => {
      const latestRoomSeq = this.#roomHead(request.roomId);
      const throughSeq = request.throughSeq ?? latestRoomSeq;
      if (throughSeq > latestRoomSeq) {
        throw roomError(
          "invalid_argument",
          "throughSeq cannot exceed the latest Room sequence",
        );
      }
      const limit = request.limit ?? ROOM_LIST_LIMIT;
      if (request.bootstrap === "latest") {
        const snapshot = this.#snapshot(request.roomId);
        const candidates = this.#readRecentMessages(request.roomId, throughSeq, limit);
        const emptyBootstrapBytes = Buffer.byteLength(JSON.stringify({
          mode: "latest_bootstrap",
          cursorBefore: throughSeq,
          cursorAfter: throughSeq,
          latestRoomSeq,
          throughSeq,
          responseBytes: ROOM_SYNC_RESPONSE_BYTE_LIMIT,
          messageFloorSeq: throughSeq,
          snapshotSeq: throughSeq,
          snapshot,
          recentMessages: [],
        }));
        const acceptedNewestFirst: RoomMessage[] = [];
        let timelineBytes = 0;
        for (const message of candidates) {
          const messageBytes = Buffer.byteLength(JSON.stringify(message));
          const separatorBytes = acceptedNewestFirst.length ? 1 : 0;
          if (
            emptyBootstrapBytes + timelineBytes + separatorBytes + messageBytes + 128 >
            ROOM_SYNC_RESPONSE_BYTE_LIMIT
          ) break;
          acceptedNewestFirst.push(message);
          timelineBytes += separatorBytes + messageBytes;
        }
        const recentMessages = acceptedNewestFirst.reverse();
        let result = this.#withResponseBytes({
          mode: "latest_bootstrap" as const,
          cursorBefore: recentMessages[0]?.roomSeq
            ? recentMessages[0].roomSeq - 1
            : throughSeq,
          cursorAfter: throughSeq,
          latestRoomSeq,
          throughSeq,
          responseBytes: 0,
          messageFloorSeq: recentMessages[0]?.roomSeq
            ? recentMessages[0].roomSeq - 1
            : throughSeq,
          snapshotSeq: throughSeq,
          snapshot,
          recentMessages,
        });
        while (
          result.responseBytes > ROOM_SYNC_RESPONSE_BYTE_LIMIT &&
          recentMessages.length > 0
        ) {
          recentMessages.shift();
          result = this.#withResponseBytes({
            ...result,
            cursorBefore: recentMessages[0]?.roomSeq
              ? recentMessages[0].roomSeq - 1
              : throughSeq,
            messageFloorSeq: recentMessages[0]?.roomSeq
              ? recentMessages[0].roomSeq - 1
              : throughSeq,
            responseBytes: 0,
            recentMessages,
          });
        }
        if (result.responseBytes > ROOM_SYNC_RESPONSE_BYTE_LIMIT) {
          throw roomError(
            "resource_exhausted",
            "Room snapshot exceeds the sync response byte budget",
          );
        }
        return result;
      }

      const afterSeq = request.afterSeq ?? 0;
      if (afterSeq > throughSeq) {
        throw roomError("invalid_argument", "afterSeq cannot exceed throughSeq");
      }
      const candidates = this.#readEventWindow({
        roomId: request.roomId,
        afterSeq,
        throughSeq,
        limit,
      });
      const events: RoomEvent[] = [];
      const emptyPageBytes = Buffer.byteLength(JSON.stringify({
        mode: "event_page",
        cursorBefore: afterSeq,
        cursorAfter: afterSeq,
        latestRoomSeq,
        throughSeq,
        responseBytes: ROOM_SYNC_RESPONSE_BYTE_LIMIT,
        hasMore: afterSeq < throughSeq,
        snapshot: null,
        events: [],
      }));
      let eventBytes = 0;
      for (const event of candidates) {
        const serializedBytes = Buffer.byteLength(JSON.stringify(event));
        const separatorBytes = events.length ? 1 : 0;
        if (
          emptyPageBytes + eventBytes + separatorBytes + serializedBytes + 128 >
          ROOM_SYNC_RESPONSE_BYTE_LIMIT
        ) break;
        events.push(event);
        eventBytes += separatorBytes + serializedBytes;
      }
      let cursorAfter = events.at(-1)?.roomSeq ?? afterSeq;
      let result = this.#withResponseBytes({
        mode: "event_page" as const,
        cursorBefore: afterSeq,
        cursorAfter,
        latestRoomSeq,
        throughSeq,
        responseBytes: 0,
        hasMore: cursorAfter < throughSeq,
        snapshot: null,
        events,
      });
      while (result.responseBytes > ROOM_SYNC_RESPONSE_BYTE_LIMIT && events.length > 0) {
        events.pop();
        cursorAfter = events.at(-1)?.roomSeq ?? afterSeq;
        result = this.#withResponseBytes({
          ...result,
          cursorAfter,
          hasMore: cursorAfter < throughSeq,
          responseBytes: 0,
          events,
        });
      }
      return result;
    });
  }

  listRooms(
    actorId: string,
    options: RoomCatalogReadOptions = {},
  ): RoomCatalogLedgerPage {
    this.#requirePrincipal(actorId);
    return this.#readTransaction(() =>
      readRoomCatalog(this.#database, actorId, options, ROOM_LIST_LIMIT));
  }

  listMessages(
    actorId: string,
    roomId: string,
    options: {
      afterRoomSeq?: number;
      beforeRoomSeq?: number;
      throughRoomSeq?: number;
      limit?: number;
    } = {},
  ): RoomMessagePage {
    this.#requireMembership(roomId, actorId);
    const limit = options.limit ?? ROOM_LIST_LIMIT;
    if (options.afterRoomSeq !== undefined && options.beforeRoomSeq !== undefined) {
      throw roomError("invalid_argument", "message page cannot mix afterRoomSeq and beforeRoomSeq");
    }
    const throughRoomSeq = options.throughRoomSeq ?? this.#roomHead(roomId);
    this.#requireListWindow(throughRoomSeq, limit, "throughRoomSeq");
    if (throughRoomSeq > this.#roomHead(roomId)) {
      throw roomError("invalid_argument", "throughRoomSeq cannot exceed the Room head");
    }
    const backward = options.beforeRoomSeq !== undefined;
    const anchor = backward ? options.beforeRoomSeq! : options.afterRoomSeq ?? 0;
    this.#requireListWindow(anchor, limit, backward ? "beforeRoomSeq" : "afterRoomSeq");
    if (backward && (anchor < 1 || anchor > throughRoomSeq + 1)) {
      throw roomError("invalid_argument", "beforeRoomSeq must be within the frozen Room window");
    }
    if (!backward && anchor > throughRoomSeq) {
      throw roomError("invalid_argument", "afterRoomSeq cannot exceed throughRoomSeq");
    }
    const messages = this.#readMessagePage(roomId, anchor, throughRoomSeq, limit, backward);
    let cursorAfter = backward
      ? messages[0]?.roomSeq ?? anchor
      : messages.at(-1)?.roomSeq ?? anchor;
    let result = this.#withResponseBytes({
      mode: backward ? "backward" as const : "forward" as const,
      cursorBefore: anchor,
      cursorAfter,
      throughRoomSeq,
      hasMore: this.#hasMoreMessages(roomId, cursorAfter, throughRoomSeq, backward),
      responseBytes: 0,
      messages,
    });
    while (result.responseBytes > ROOM_SYNC_RESPONSE_BYTE_LIMIT && messages.length > 0) {
      if (backward) messages.shift();
      else messages.pop();
      cursorAfter = backward ? messages[0]?.roomSeq ?? anchor : messages.at(-1)?.roomSeq ?? anchor;
      result = this.#withResponseBytes({
        ...result,
        cursorAfter,
        hasMore: this.#hasMoreMessages(roomId, cursorAfter, throughRoomSeq, backward),
        responseBytes: 0,
        messages,
      });
    }
    return result;
  }

  listInbox(
    participantId: string,
    options: { afterInboxSeq?: number; limit?: number } = {},
  ): RoomInboxItem[] {
    this.#requirePrincipal(participantId);
    const afterInboxSeq = options.afterInboxSeq ?? 0;
    const limit = options.limit ?? ROOM_LIST_LIMIT;
    this.#requireListWindow(afterInboxSeq, limit, "afterInboxSeq");
    return (this.#database
      .prepare(
        "SELECT * FROM room_inbox_items WHERE participant_id = ? AND inbox_seq > ? ORDER BY inbox_seq LIMIT ?",
      )
      .all(participantId, afterInboxSeq, limit) as Row[]).map(inboxFromRow);
  }

  listOutbox(options: { afterOutboxSeq?: number; limit?: number } = {}): RoomOutboxEntry[] {
    const afterOutboxSeq = options.afterOutboxSeq ?? 0;
    const limit = options.limit ?? ROOM_LIST_LIMIT;
    if (!Number.isInteger(afterOutboxSeq) || afterOutboxSeq < 0) {
      throw roomError("invalid_argument", "afterOutboxSeq must be a non-negative integer");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > ROOM_LIST_LIMIT) {
      throw roomError(
        "invalid_argument",
        `outbox limit must be between 1 and ${ROOM_LIST_LIMIT}`,
      );
    }
    return (this.#database
      .prepare("SELECT * FROM room_outbox WHERE outbox_seq > ? ORDER BY outbox_seq LIMIT ?")
      .all(afterOutboxSeq, limit) as Row[]).map(outboxFromRow);
  }

  claimOutbox(
    workerId: string,
    options: { limit?: number; leaseMs?: number } = {},
  ): RoomOutboxEntry[] {
    this.#requireWorkerId(workerId);
    const limit = options.limit ?? 100;
    const leaseMs = options.leaseMs ?? 30_000;
    if (!Number.isInteger(limit) || limit < 1 || limit > ROOM_LIST_LIMIT) {
      throw roomError("invalid_argument", `claim limit must be between 1 and ${ROOM_LIST_LIMIT}`);
    }
    if (!Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 300_000) {
      throw roomError("invalid_argument", "leaseMs must be between 1000 and 300000");
    }
    return this.#transaction(() => {
      const now = this.#now();
      const nowText = now.toISOString();
      const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
      const rows = this.#database
        .prepare(
          `SELECT outbox_seq, attempt_count FROM room_outbox
           WHERE published_at IS NULL
             AND available_at <= ?
             AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
           ORDER BY outbox_seq
           LIMIT ?`,
        )
        .all(nowText, nowText, limit) as Row[];
      const claimed: RoomOutboxEntry[] = [];
      for (const row of rows) {
        const outboxSeq = integer(row, "outbox_seq");
        const leaseToken = `lease-${outboxSeq}-${integer(row, "attempt_count") + 1}`;
        this.#database
          .prepare(
            `UPDATE room_outbox
             SET lease_owner = ?, lease_token = ?, lease_expires_at = ?,
                 attempt_count = attempt_count + 1
             WHERE outbox_seq = ?`,
          )
          .run(workerId, leaseToken, leaseExpiresAt, outboxSeq);
        claimed.push(this.#requireOutbox(outboxSeq));
      }
      return claimed;
    });
  }

  completeOutbox(workerId: string, outboxSeq: number, leaseToken: string): RoomOutboxEntry {
    this.#requireWorkerId(workerId);
    this.#requireLeaseToken(leaseToken);
    this.#requireListWindow(outboxSeq, 1, "outboxSeq");
    if (outboxSeq === 0) throw roomError("invalid_argument", "outboxSeq must be positive");
    return this.#transaction(() => {
      const entry = this.#requireOutbox(outboxSeq);
      if (entry.publishedAt) {
        if (
          entry.publishedBy === workerId &&
          this.#publishedLeaseToken(outboxSeq) === leaseToken
        ) return entry;
        throw roomError("conflict", `outbox entry ${outboxSeq} was completed by another worker`);
      }
      this.#requireActiveOutboxLease(entry, workerId, leaseToken);
      this.#database
        .prepare(
          `UPDATE room_outbox
           SET published_at = ?, published_by = ?, published_lease_token = lease_token,
               lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
               last_error = NULL
           WHERE outbox_seq = ?`,
        )
        .run(this.#timestamp(), workerId, outboxSeq);
      return this.#requireOutbox(outboxSeq);
    });
  }

  failOutbox(
    workerId: string,
    outboxSeq: number,
    input: { error: string; retryAt: string; leaseToken: string },
  ): RoomOutboxEntry {
    this.#requireWorkerId(workerId);
    this.#requireLeaseToken(input.leaseToken);
    this.#requireListWindow(outboxSeq, 1, "outboxSeq");
    if (outboxSeq === 0) throw roomError("invalid_argument", "outboxSeq must be positive");
    const retryAt = new Date(input.retryAt);
    if (!Number.isFinite(retryAt.getTime())) {
      throw roomError("invalid_argument", "retryAt must be an ISO timestamp");
    }
    if (!input.error.trim()) throw roomError("invalid_argument", "error must not be empty");
    return this.#transaction(() => {
      const entry = this.#requireOutbox(outboxSeq);
      if (entry.publishedAt) {
        throw roomError("conflict", `outbox entry ${outboxSeq} is already complete`);
      }
      this.#requireActiveOutboxLease(entry, workerId, input.leaseToken);
      this.#database
        .prepare(
          `UPDATE room_outbox
           SET available_at = ?, lease_owner = NULL, lease_token = NULL,
               lease_expires_at = NULL, last_error = ?
           WHERE outbox_seq = ?`,
        )
        .run(retryAt.toISOString(), input.error.trim().slice(0, 2_000), outboxSeq);
      return this.#requireOutbox(outboxSeq);
    });
  }

  prunePublishedOutbox(input: { throughOutboxSeq: number; limit?: number }): number {
    const limit = input.limit ?? ROOM_LIST_LIMIT;
    if (!Number.isInteger(input.throughOutboxSeq) || input.throughOutboxSeq < 1) {
      throw roomError("invalid_argument", "throughOutboxSeq must be a positive integer");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > ROOM_LIST_LIMIT) {
      throw roomError(
        "invalid_argument",
        `prune limit must be between 1 and ${ROOM_LIST_LIMIT}`,
      );
    }
    return this.#transaction(() => {
      const result = this.#database
        .prepare(
          `DELETE FROM room_outbox
           WHERE outbox_seq IN (
             SELECT outbox_seq FROM room_outbox
             WHERE published_at IS NOT NULL AND outbox_seq <= ?
             ORDER BY outbox_seq
             LIMIT ?
           )`,
        )
        .run(input.throughOutboxSeq, limit);
      return Number(result.changes);
    });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#database.close();
  }

  #snapshot(roomId: string): RoomSnapshot {
    const roomRow = this.#database
      .prepare("SELECT * FROM rooms WHERE room_id = ?")
      .get(roomId) as Row | undefined;
    if (!roomRow) throw roomError("not_found", `Room ${roomId} was not found`);
    const memberships = (this.#database
      .prepare(
        "SELECT * FROM room_memberships WHERE room_id = ? ORDER BY joined_at, principal_id",
      )
      .all(roomId) as Row[]).map(membershipFromRow);
    const principals = (this.#database
      .prepare(
        "SELECT p.* FROM room_principals p JOIN room_memberships m ON m.principal_id = p.principal_id WHERE m.room_id = ? ORDER BY m.joined_at, p.principal_id",
      )
      .all(roomId) as Row[]).map(principalFromRow);
    return { room: roomFromRow(roomRow), memberships, principals };
  }

  #readEventWindow(input: {
    roomId: string;
    afterSeq: number;
    throughSeq: number;
    limit: number;
  }): RoomEvent[] {
    return (this.#database
      .prepare(
        `SELECT * FROM (
           SELECT candidate.*,
             SUM(length(CAST(candidate.payload_json AS BLOB)) + 1024)
               OVER (ORDER BY candidate.room_seq) AS cumulative_bytes
           FROM (
             SELECT * FROM room_events
             WHERE room_id = ? AND room_seq > ? AND room_seq <= ?
             ORDER BY room_seq
             LIMIT ?
           ) AS candidate
         ) WHERE cumulative_bytes <= ?
         ORDER BY room_seq`,
      )
      .all(
        input.roomId,
        input.afterSeq,
        input.throughSeq,
        input.limit,
        ROOM_SYNC_RESPONSE_BYTE_LIMIT,
      ) as Row[]).map(eventFromRow);
  }

  #readRecentMessages(roomId: string, throughSeq: number, limit: number): RoomMessage[] {
    return (this.#database
      .prepare(
        `SELECT * FROM (
           SELECT candidate.*,
             SUM(length(CAST(json_quote(candidate.body) AS BLOB)) + 512)
               OVER (ORDER BY candidate.room_seq DESC) AS cumulative_bytes
           FROM (
             SELECT * FROM room_messages
             WHERE room_id = ? AND room_seq <= ?
             ORDER BY room_seq DESC
             LIMIT ?
           ) AS candidate
         ) WHERE cumulative_bytes <= ?
         ORDER BY room_seq DESC`,
      )
      .all(roomId, throughSeq, limit, ROOM_SYNC_RESPONSE_BYTE_LIMIT) as Row[]).map(messageFromRow);
  }

  #readMessagePage(
    roomId: string,
    anchor: number,
    throughRoomSeq: number,
    limit: number,
    backward: boolean,
  ): RoomMessage[] {
    const comparison = backward ? "<" : ">";
    const direction = backward ? "DESC" : "ASC";
    const rows = this.#database.prepare(
      `SELECT * FROM (
         SELECT candidate.*,
           SUM(length(CAST(json_quote(candidate.body) AS BLOB)) + 512)
             OVER (ORDER BY candidate.room_seq ${direction}) AS cumulative_bytes
         FROM (
           SELECT * FROM room_messages
           WHERE room_id = ? AND room_seq ${comparison} ? AND room_seq <= ?
           ORDER BY room_seq ${direction}
           LIMIT ?
         ) AS candidate
       ) WHERE cumulative_bytes <= ?
       ORDER BY room_seq ${direction}`,
    ).all(roomId, anchor, throughRoomSeq, limit, ROOM_SYNC_RESPONSE_BYTE_LIMIT) as Row[];
    if (backward) rows.reverse();
    return rows.map(messageFromRow);
  }

  #hasMoreMessages(
    roomId: string,
    cursor: number,
    throughRoomSeq: number,
    backward: boolean,
  ): boolean {
    const comparison = backward ? "<" : ">";
    return Boolean(this.#database.prepare(
      `SELECT 1 FROM room_messages
       WHERE room_id = ? AND room_seq ${comparison} ? AND room_seq <= ?
       LIMIT 1`,
    ).get(roomId, cursor, throughRoomSeq));
  }

  #withResponseBytes<T extends { responseBytes: number }>(input: T): T {
    let result = { ...input, responseBytes: 0 };
    for (let pass = 0; pass < 8; pass += 1) {
      const responseBytes = Buffer.byteLength(JSON.stringify(result));
      if (responseBytes === result.responseBytes) return result;
      result = { ...result, responseBytes };
    }
    return result;
  }

  #messageAttention(
    room: RoomRecord,
    actorId: string,
    mentionedPrincipalIds: readonly string[],
  ): Array<{ principalId: string; reason: RoomAttentionReason }> {
    for (const principalId of mentionedPrincipalIds) {
      this.#requireMembership(room.roomId, principalId);
      if (principalId === actorId) {
        throw roomError("invalid_argument", "a Room message cannot mention its own actor");
      }
    }
    if (room.kind === "direct") {
      return this.#roomMembershipPrincipalIds(room.roomId)
        .filter((principalId) => principalId !== actorId)
        .map((principalId) => ({ principalId, reason: "direct_message" }));
    }
    return mentionedPrincipalIds.map((principalId) => ({
      principalId,
      reason: "mention",
    }));
  }

  #normalizeMessageIntent(request: PostRoomMessageRequest): PostRoomMessageRequest {
    if (this.#requireRoom(request.roomId).kind !== "direct" || !request.mentionedPrincipalIds) {
      return request;
    }
    return {
      roomId: request.roomId,
      body: request.body,
      idempotencyKey: request.idempotencyKey,
    };
  }

  #roomMembershipPrincipalIds(roomId: string): string[] {
    return (this.#database
      .prepare(
        "SELECT principal_id FROM room_memberships WHERE room_id = ? ORDER BY principal_id",
      )
      .all(roomId) as Row[]).map((row) => text(row, "principal_id"));
  }

  #appendEvent(input: {
    roomId: string;
    actorId: string;
    type: string;
    aggregateType: string;
    aggregateId: string;
    payload: Record<string, unknown>;
    idempotencyKey: string;
    createdAt: string;
  }): RoomEvent {
    const roomSeq = this.#roomHead(input.roomId) + 1;
    const event: RoomEvent = {
      eventId: this.#createId("event"),
      roomId: input.roomId,
      roomSeq,
      type: input.type,
      actorId: input.actorId,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      schemaVersion: 1,
      createdAt: input.createdAt,
    };
    this.#database
      .prepare("UPDATE rooms SET next_seq = next_seq + 1 WHERE room_id = ?")
      .run(input.roomId);
    this.#database
      .prepare(
        "INSERT INTO room_events(event_id, room_id, room_seq, type, actor_id, aggregate_type, aggregate_id, payload_json, idempotency_key, schema_version, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)",
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
        event.createdAt,
      );
    this.#insertOutbox({
      roomId: event.roomId,
      roomSeq: event.roomSeq,
      topic: "room.event",
      payload: {
        eventId: event.eventId,
        roomId: event.roomId,
        roomSeq: event.roomSeq,
        type: event.type,
      },
    });
    return event;
  }

  #insertOutbox(input: {
    roomId: string;
    roomSeq: number;
    topic: RoomOutboxEntry["topic"];
    payload: Record<string, unknown>;
  }): void {
    const createdAt = this.#timestamp();
    this.#database
      .prepare(
        "INSERT INTO room_outbox(outbox_id, room_id, room_seq, topic, payload_json, created_at, available_at) VALUES(?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        this.#createId("outbox"),
        input.roomId,
        input.roomSeq,
        input.topic,
        JSON.stringify(input.payload),
        createdAt,
        createdAt,
      );
  }

  #command(
    actorId: string,
    commandKind: string,
    request: { idempotencyKey: string },
  ): RoomEvent | undefined {
    const row = this.#database
      .prepare(
        `SELECT command.command_kind, command.request_hash, event.*
         FROM room_commands AS command
         JOIN room_events AS event ON event.event_id = command.event_id
         WHERE command.actor_id = ? AND command.idempotency_key = ?`,
      )
      .get(actorId, request.idempotencyKey) as Row | undefined;
    if (!row) return undefined;
    const requestHash = canonicalHash(request);
    if (text(row, "command_kind") !== commandKind || text(row, "request_hash") !== requestHash) {
      throw roomError(
        "idempotency_conflict",
        `idempotency key ${request.idempotencyKey} was already used for a different intent`,
      );
    }
    return eventFromRow(row);
  }

  #rememberCommand(
    actorId: string,
    commandKind: string,
    request: { idempotencyKey: string },
    event: RoomEvent,
  ): void {
    this.#database
      .prepare(
        "INSERT INTO room_commands(actor_id, idempotency_key, command_kind, request_hash, event_id, created_at) VALUES(?, ?, ?, ?, ?, ?)",
      )
      .run(
        actorId,
        request.idempotencyKey,
        commandKind,
        canonicalHash(request),
        event.eventId,
        this.#timestamp(),
      );
  }

  #requireRoom(roomId: string): RoomRecord {
    const row = this.#database
      .prepare("SELECT * FROM rooms WHERE room_id = ?")
      .get(roomId) as Row | undefined;
    if (!row) throw roomError("not_found", `Room ${roomId} was not found`);
    return roomFromRow(row);
  }

  #requireMessage(messageId: string): RoomMessage {
    const row = this.#database
      .prepare("SELECT * FROM room_messages WHERE message_id = ?")
      .get(messageId) as Row | undefined;
    if (!row) throw roomError("not_found", `message ${messageId} was not found`);
    return messageFromRow(row);
  }

  #requireInboxMessage(
    roomId: string,
    participantId: string,
    messageId: string,
  ): RoomInboxItem {
    const row = this.#database
      .prepare(
        `SELECT inbox.*
         FROM room_inbox_items AS inbox
         JOIN room_messages AS message
           ON message.room_id = inbox.room_id
          AND message.room_seq = inbox.event_seq
         WHERE inbox.room_id = ?
           AND inbox.participant_id = ?
           AND message.message_id = ?`,
      )
      .get(roomId, participantId, messageId) as Row | undefined;
    if (!row) {
      throw roomError(
        "not_found",
        `message ${messageId} is not in principal ${participantId}'s Inbox`,
      );
    }
    return inboxFromRow(row);
  }

  #requireAcknowledgementEvent(
    roomId: string,
    actorId: string,
    messageId: string,
  ): RoomEvent {
    const row = this.#database
      .prepare(
        `SELECT * FROM room_events
         WHERE room_id = ?
           AND actor_id = ?
           AND type = 'message.acknowledged'
           AND aggregate_id = ?
         ORDER BY room_seq
         LIMIT 1`,
      )
      .get(roomId, actorId, messageId) as Row | undefined;
    if (!row) {
      throw roomError("not_found", `message ${messageId} has no acknowledgement event`);
    }
    return eventFromRow(row);
  }

  #requireOutbox(outboxSeq: number): RoomOutboxEntry {
    const row = this.#database
      .prepare("SELECT * FROM room_outbox WHERE outbox_seq = ?")
      .get(outboxSeq) as Row | undefined;
    if (!row) throw roomError("not_found", `outbox entry ${outboxSeq} was not found`);
    return outboxFromRow(row);
  }

  #requireWorkerId(workerId: string): void {
    if (!STABLE_IDENTIFIER.test(workerId)) {
      throw roomError("invalid_argument", "workerId must be a stable identifier");
    }
  }

  #requireLeaseToken(leaseToken: string): void {
    if (!STABLE_IDENTIFIER.test(leaseToken)) {
      throw roomError("invalid_argument", "leaseToken must be a stable identifier");
    }
  }

  #publishedLeaseToken(outboxSeq: number): string | undefined {
    const row = this.#database
      .prepare("SELECT published_lease_token FROM room_outbox WHERE outbox_seq = ?")
      .get(outboxSeq) as Row | undefined;
    return row ? optionalText(row, "published_lease_token") : undefined;
  }

  #requireActiveOutboxLease(
    entry: RoomOutboxEntry,
    workerId: string,
    leaseToken: string,
  ): void {
    if (entry.leaseOwner !== workerId) {
      throw roomError(
        "conflict",
        `outbox entry ${entry.outboxSeq} is not leased by ${workerId}`,
      );
    }
    if (entry.leaseToken !== leaseToken) {
      throw roomError(
        "conflict",
        `outbox entry ${entry.outboxSeq} is fenced by a newer claim`,
      );
    }
    if (!entry.leaseExpiresAt || entry.leaseExpiresAt <= this.#timestamp()) {
      throw roomError("conflict", `outbox entry ${entry.outboxSeq} lease has expired`);
    }
  }

  #requirePrincipal(principalId: string): RoomPrincipal {
    const row = this.#database
      .prepare("SELECT * FROM room_principals WHERE principal_id = ?")
      .get(principalId) as Row | undefined;
    if (!row) throw roomError("not_found", `principal ${principalId} was not found`);
    return principalFromRow(row);
  }

  #principalByHandle(handle: string): RoomPrincipal | undefined {
    const row = this.#database
      .prepare("SELECT * FROM room_principals WHERE handle = ?")
      .get(handle) as Row | undefined;
    return row ? principalFromRow(row) : undefined;
  }

  #membership(roomId: string, principalId: string): RoomMembership | undefined {
    const row = this.#database
      .prepare("SELECT * FROM room_memberships WHERE room_id = ? AND principal_id = ?")
      .get(roomId, principalId) as Row | undefined;
    return row ? membershipFromRow(row) : undefined;
  }

  #requireMembership(roomId: string, principalId: string): RoomMembership {
    const membership = this.#membership(roomId, principalId);
    if (!membership) {
      throw roomError("forbidden", `principal ${principalId} is not a Room member`);
    }
    return membership;
  }

  #roomHead(roomId: string): number {
    const row = this.#database
      .prepare("SELECT next_seq FROM rooms WHERE room_id = ?")
      .get(roomId) as Row | undefined;
    if (!row) throw roomError("not_found", `Room ${roomId} was not found`);
    return integer(row, "next_seq") - 1;
  }

  #requireRoomHead(roomId: string, basedOnRoomSeq: number): void {
    const current = this.#roomHead(roomId);
    if (current !== basedOnRoomSeq) {
      throw roomError(
        "stale_context",
        `Room ${roomId} changed: expected sequence ${basedOnRoomSeq}, current sequence is ${current}`,
      );
    }
  }

  #requireListWindow(after: number, limit: number, cursorName: string): void {
    if (!Number.isInteger(after) || after < 0) {
      throw roomError(
        "invalid_argument",
        `${cursorName} must be a non-negative integer`,
      );
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > ROOM_LIST_LIMIT) {
      throw roomError(
        "invalid_argument",
        `list limit must be between 1 and ${ROOM_LIST_LIMIT}`,
      );
    }
  }

  #validate<T>(validation: () => T): T {
    try {
      return validation();
    } catch (error) {
      if (error instanceof RoomDomainError) throw error;
      throw roomError(
        "invalid_argument",
        error instanceof Error ? error.message : "Room request validation failed",
      );
    }
  }

  #transaction<T>(operation: () => T): T {
    try {
      this.#database.exec("BEGIN IMMEDIATE");
    } catch (error) {
      throw this.#storageError(error);
    }
    try {
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK");
      } catch {
        // Preserve the operation failure; rollback failure must not replace the
        // domain/storage error that caused the transaction to abort.
      }
      throw this.#storageError(error);
    }
  }

  #readTransaction<T>(operation: () => T): T {
    try {
      this.#database.exec("BEGIN");
    } catch (error) {
      throw this.#storageError(error);
    }
    try {
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK");
      } catch {
        // Preserve the original read failure for the application boundary.
      }
      throw this.#storageError(error);
    }
  }

  #storageError(error: unknown): Error {
    if (error instanceof RoomDomainError) return error;
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE constraint failed/i.test(message)) {
      return roomError("conflict", "Room resource already exists");
    }
    if (/FOREIGN KEY constraint failed/i.test(message)) {
      return roomError("conflict", "Room resource references unavailable state");
    }
    if (/(CHECK|NOT NULL) constraint failed/i.test(message)) {
      return roomError("invalid_argument", "Room resource violates a storage constraint");
    }
    if (/(database is locked|database is busy)/i.test(message)) {
      return roomError("unavailable", "Room storage is temporarily busy");
    }
    if (/(database or disk is full|SQLITE_FULL)/i.test(message)) {
      return roomError("resource_exhausted", "Room storage has no remaining capacity");
    }
    return error instanceof Error ? error : new Error(message);
  }

  #timestamp(): string {
    return this.#now().toISOString();
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
