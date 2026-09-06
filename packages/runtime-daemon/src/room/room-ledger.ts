import { createHash, randomInt, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  type AcknowledgeRoomRequest,
  type AcknowledgeRoomInboxItemRequest,
  type AcknowledgeRoomMessageRequest,
  type AddRoomMemberRequest,
  type CreateRoomRequest,
  type PostRoomMessageRequest,
  type RoomEvent,
  type RoomAttentionReason,
  type RoomInboxItem,
  type RoomInboxDisposition,
  type RoomMembership,
  type RoomMessage,
  type RoomMessagePage,
  type RoomMutationResult,
  type RoomOutboxEntry,
  type RoomPrincipal,
  type RoomRecord,
  type RoomSyncResult,
  type RoomTask,
  type RoomTaskMutationResult,
  type RoomTaskReviewDisposition,
  type RoomTaskReviewMutationResult,
  type RoomTaskSubmissionMutationResult,
  type RoomWorkerExecution,
  type RoomAgentAvatarKey,
  type SyncRoomRequest,
  validateAddRoomMemberRequest,
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
  integer,
  membershipFromRow,
  messageFromRow,
  principalFromRow,
  roomFromRow,
  type RoomSqlRow as Row,
  text,
} from "./room-rows";
import {
  migrateRoomLedgerV1ToV2,
  migrateRoomLedgerV2ToV3,
  migrateRoomLedgerV3ToV4,
  migrateRoomLedgerV4ToV5,
  migrateRoomLedgerV5ToV6,
  migrateRoomLedgerV6ToV7,
  ROOM_LEDGER_SCHEMA,
  ROOM_LEDGER_SCHEMA_VERSION,
} from "./room-schema";
import { RoomOutboxLedger } from "./room-outbox-ledger";
import { RoomInboxService } from "./room-inbox-service";
import {
  RoomMessageReadService,
  withRoomResponseBytes,
} from "./room-message-read-service";
import { RoomPrincipalService } from "./room-principal-service";
import { RoomTaskService } from "./room-task-service";

export interface RoomLedgerOptions {
  createId?: (prefix: string) => string;
  now?: () => Date;
  chooseAvatarIndex?: (size: number) => number;
}

const ROOM_SYNC_RESPONSE_BYTE_LIMIT = 1_048_576;
const ROOM_LIST_LIMIT = 500;
const ROOM_MEMBER_LIMIT = 500;
export class RoomLedger {
  readonly #database: DatabaseSync;
  readonly #createId: (prefix: string) => string;
  readonly #now: () => Date;
  readonly #outbox: RoomOutboxLedger;
  readonly #inbox: RoomInboxService;
  readonly #tasks: RoomTaskService;
  readonly #principals: RoomPrincipalService;
  readonly #messageReads: RoomMessageReadService;
  #closed = false;

  constructor(databasePath: string, options: RoomLedgerOptions = {}) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.#database = new DatabaseSync(databasePath);
    const schemaVersion = integer(
      this.#database.prepare("PRAGMA user_version").get() as Row,
      "user_version",
    );
    if (
      schemaVersion !== 0 &&
      schemaVersion !== 1 &&
      schemaVersion !== 2 &&
      schemaVersion !== 3 &&
      schemaVersion !== 4 &&
      schemaVersion !== 5 &&
      schemaVersion !== 6 &&
      schemaVersion !== ROOM_LEDGER_SCHEMA_VERSION
    ) {
      this.#database.close();
      throw roomError(
        "conflict",
        `Room ledger schema version ${schemaVersion} is not supported by version ${ROOM_LEDGER_SCHEMA_VERSION}`,
      );
    }
    try {
      if (schemaVersion === 1) {
        migrateRoomLedgerV1ToV2(this.#database);
        migrateRoomLedgerV2ToV3(this.#database);
        migrateRoomLedgerV3ToV4(this.#database);
        migrateRoomLedgerV4ToV5(this.#database);
        migrateRoomLedgerV5ToV6(this.#database);
        migrateRoomLedgerV6ToV7(this.#database);
      } else if (schemaVersion === 2) {
        migrateRoomLedgerV2ToV3(this.#database);
        migrateRoomLedgerV3ToV4(this.#database);
        migrateRoomLedgerV4ToV5(this.#database);
        migrateRoomLedgerV5ToV6(this.#database);
        migrateRoomLedgerV6ToV7(this.#database);
      } else if (schemaVersion === 3) {
        migrateRoomLedgerV3ToV4(this.#database);
        migrateRoomLedgerV4ToV5(this.#database);
        migrateRoomLedgerV5ToV6(this.#database);
        migrateRoomLedgerV6ToV7(this.#database);
      } else if (schemaVersion === 4) {
        migrateRoomLedgerV4ToV5(this.#database);
        migrateRoomLedgerV5ToV6(this.#database);
        migrateRoomLedgerV6ToV7(this.#database);
      } else if (schemaVersion === 5) {
        migrateRoomLedgerV5ToV6(this.#database);
        migrateRoomLedgerV6ToV7(this.#database);
      } else if (schemaVersion === 6) {
        migrateRoomLedgerV6ToV7(this.#database);
      }
      this.#database.exec(ROOM_LEDGER_SCHEMA);
    } catch (error) {
      this.#database.close();
      throw this.#storageError(error);
    }
    this.#createId =
      options.createId ?? ((prefix) => `${prefix}-${randomUUID()}`);
    this.#now = options.now ?? (() => new Date());
    this.#principals = new RoomPrincipalService({
      database: this.#database,
      createId: this.#createId,
      chooseAvatarIndex:
        options.chooseAvatarIndex ?? ((size) => randomInt(size)),
      timestamp: () => this.#timestamp(),
      transaction: <T>(operation: () => T) => this.#transaction(operation),
      storageError: (error) => this.#storageError(error),
    });
    this.#messageReads = new RoomMessageReadService(this.#database);
    try {
      this.#principals.backfillAgentAvatarKeys();
    } catch (error) {
      this.#database.close();
      throw this.#storageError(error);
    }
    this.#outbox = new RoomOutboxLedger({
      database: this.#database,
      createId: this.#createId,
      now: this.#now,
      transaction: <T>(operation: () => T) => this.#transaction(operation),
    });
    this.#inbox = new RoomInboxService({
      database: this.#database,
      now: this.#now,
      transaction: <T>(operation: () => T) => this.#transaction(operation),
      command: (actorId, kind, request) =>
        this.#command(actorId, kind, request),
      rememberCommand: (actorId, kind, request, event) =>
        this.#rememberCommand(actorId, kind, request, event),
      appendEvent: (input) => this.#appendEvent(input),
      requireMembership: (roomId, principalId) =>
        this.#requireMembership(roomId, principalId),
      requirePrincipal: (principalId) => this.#requirePrincipal(principalId),
      roomHead: (roomId) => this.#roomHead(roomId),
      maximumList: ROOM_LIST_LIMIT,
    });
    this.#tasks = new RoomTaskService({
      database: this.#database,
      createId: this.#createId,
      now: this.#now,
      transaction: <T>(operation: () => T) => this.#transaction(operation),
      command: (actorId, kind, request) =>
        this.#command(actorId, kind, request),
      rememberCommand: (actorId, kind, request, event) =>
        this.#rememberCommand(actorId, kind, request, event),
      appendEvent: (input) => this.#appendEvent(input),
      appendAttention: (event, participantId, reason, createdAt, disposition) =>
        this.#appendAttention(
          event,
          participantId,
          reason,
          createdAt,
          disposition,
        ),
      ensureThread: (message, createdAt) =>
        this.#ensureThread(message, createdAt),
      requireMembership: (roomId, principalId) =>
        this.#requireMembership(roomId, principalId),
      requireMessage: (messageId) => this.#requireMessage(messageId),
      roomHead: (roomId) => this.#roomHead(roomId),
    });
  }

  provisionPrincipal(input: {
    principalId: string;
    handle: string;
    kind: RoomPrincipal["kind"];
    displayName?: string;
    avatarKey?: RoomAgentAvatarKey;
  }): RoomPrincipal {
    return this.#principals.provision(input);
  }

  ensureLocalHumanPrincipal(
    input: {
      handle?: string;
      displayName?: string;
    } = {},
  ): RoomPrincipal {
    return this.#principals.ensureLocalHuman(input);
  }

  createRoom(
    actorId: string,
    rawRequest: CreateRoomRequest,
  ): RoomMutationResult<RoomRecord> {
    const request = this.#validate(() => validateCreateRoomRequest(rawRequest));
    const command = this.#command(actorId, "room.create", request);
    if (command) {
      return {
        value: this.#requireRoom(command.aggregateId),
        event: command,
        deduplicated: true,
      };
    }
    const actor = this.#requirePrincipal(actorId);
    if (actor.kind !== "human") {
      throw roomError("forbidden", "Only a Human principal may create a Room");
    }

    return this.#transaction(() => {
      const replay = this.#command(actorId, "room.create", request);
      if (replay) {
        return {
          value: this.#requireRoom(replay.aggregateId),
          event: replay,
          deduplicated: true,
        };
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
    const request = this.#validate(() =>
      validateAddRoomMemberRequest(rawRequest),
    );
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
      if (
        actorMembership.role !== "owner" &&
        actorMembership.role !== "admin"
      ) {
        throw roomError(
          "forbidden",
          "Room membership changes require owner or admin role",
        );
      }
      if (request.role === "owner" && actorMembership.role !== "owner") {
        throw roomError("forbidden", "Only a Room owner may grant owner role");
      }
      const principal = this.#requirePrincipal(request.principalId);
      this.#requireRoomHead(request.roomId, request.basedOnRoomSeq);
      const room = this.#requireRoom(request.roomId);
      const memberCount = this.#roomMembershipPrincipalIds(
        request.roomId,
      ).length;
      if (room.kind === "direct") {
        if (request.role !== "member") {
          throw roomError(
            "invalid_argument",
            "Direct Room participants can only be added as members",
          );
        }
        if (memberCount >= 2) {
          throw roomError(
            "conflict",
            "A Direct Room cannot have more than two participants",
          );
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
        const existingParticipant = this.#roomMembershipPrincipalIds(
          request.roomId,
        )[0]!;
        if (existingParticipant === request.principalId) {
          throw roomError(
            "conflict",
            "A Direct Room requires two distinct participants",
          );
        }
        directPair =
          existingParticipant < request.principalId
            ? [existingParticipant, request.principalId]
            : [request.principalId, existingParticipant];
        const existingDirect = this.#database
          .prepare(
            `SELECT room_id FROM room_direct_pairs
           WHERE workspace_key = ? AND principal_low = ? AND principal_high = ?`,
          )
          .get(room.workspaceKey, directPair[0], directPair[1]) as
          Row | undefined;
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
        this.#database
          .prepare(
            `INSERT INTO room_direct_pairs(
             workspace_key, principal_low, principal_high, room_id
           ) VALUES(?, ?, ?, ?)`,
          )
          .run(room.workspaceKey, directPair[0], directPair[1], room.roomId);
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
    const validatedRequest = this.#validate(() =>
      validatePostRoomMessageRequest(rawRequest),
    );
    this.#requireMembership(validatedRequest.roomId, actorId);
    const request = this.#normalizeMessageIntent(validatedRequest);
    const command = this.#command(actorId, "room.message.post", request);
    if (command) {
      return {
        value: this.#requireMessage(command.aggregateId),
        event: command,
        deduplicated: true,
      };
    }

    return this.#transaction(() => {
      const replay = this.#command(actorId, "room.message.post", request);
      if (replay) {
        return {
          value: this.#requireMessage(replay.aggregateId),
          event: replay,
          deduplicated: true,
        };
      }
      this.#requireMembership(request.roomId, actorId);
      const room = this.#requireRoom(request.roomId);
      const replyTo = request.replyToMessageId
        ? this.#requireMessage(request.replyToMessageId)
        : undefined;
      if (replyTo && replyTo.roomId !== request.roomId) {
        throw roomError(
          "invalid_argument",
          "reply target must belong to the same Room",
        );
      }
      const attention = this.#messageAttention(
        room,
        actorId,
        request.mentionedPrincipalIds ?? [],
      );
      if (
        room.kind !== "direct" &&
        replyTo &&
        replyTo.actorId !== actorId &&
        !attention.some((target) => target.principalId === replyTo.actorId)
      ) {
        attention.push({ principalId: replyTo.actorId, reason: "mention" });
      }
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
      const reference = replyTo
        ? this.#ensureThread(replyTo, createdAt)
        : undefined;
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
          ...(reference
            ? {
                reference: {
                  ...reference,
                  replyToMessageId: replyTo!.messageId,
                },
              }
            : {}),
        },
      });
      const message: RoomMessage = {
        messageId,
        roomId: request.roomId,
        roomSeq: event.roomSeq,
        actorId,
        body: request.body,
        ...(reference
          ? {
              threadId: reference.threadId,
              rootMessageId: reference.rootMessageId,
              replyToMessageId: replyTo!.messageId,
            }
          : {}),
        createdAt,
      };
      this.#database
        .prepare(
          `INSERT INTO room_messages(
             message_id, room_id, room_seq, actor_id, body,
             thread_id, root_message_id, reply_to_message_id, created_at
           ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          message.messageId,
          message.roomId,
          message.roomSeq,
          message.actorId,
          message.body,
          message.threadId ?? null,
          message.rootMessageId ?? null,
          message.replyToMessageId ?? null,
          message.createdAt,
        );
      for (const target of attention) {
        this.#appendAttention(
          event,
          target.principalId,
          target.reason,
          createdAt,
        );
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
    return this.#inbox.acknowledgeMessage(actorId, rawRequest);
  }

  acknowledgeInboxItem(
    actorId: string,
    rawRequest: AcknowledgeRoomInboxItemRequest,
  ): RoomMutationResult<RoomInboxItem> {
    return this.#inbox.acknowledgeItem(actorId, rawRequest);
  }

  acknowledgeRoom(
    actorId: string,
    rawRequest: AcknowledgeRoomRequest,
  ): RoomMutationResult<{ acknowledgedCount: number; throughRoomSeq: number }> {
    return this.#inbox.acknowledgeRoom(actorId, rawRequest);
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
        const snapshot = this.#messageReads.snapshot(request.roomId);
        const candidates = this.#messageReads.recentMessages(
          request.roomId,
          throughSeq,
          limit,
        );
        const emptyBootstrapBytes = Buffer.byteLength(
          JSON.stringify({
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
          }),
        );
        const acceptedNewestFirst: RoomMessage[] = [];
        let timelineBytes = 0;
        for (const message of candidates) {
          const messageBytes = Buffer.byteLength(JSON.stringify(message));
          const separatorBytes = acceptedNewestFirst.length ? 1 : 0;
          if (
            emptyBootstrapBytes +
              timelineBytes +
              separatorBytes +
              messageBytes +
              128 >
            ROOM_SYNC_RESPONSE_BYTE_LIMIT
          )
            break;
          acceptedNewestFirst.push(message);
          timelineBytes += separatorBytes + messageBytes;
        }
        const recentMessages = acceptedNewestFirst.reverse();
        let result = withRoomResponseBytes({
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
          result = withRoomResponseBytes({
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
        throw roomError(
          "invalid_argument",
          "afterSeq cannot exceed throughSeq",
        );
      }
      const candidates = this.#messageReads.eventWindow({
        roomId: request.roomId,
        afterSeq,
        throughSeq,
        limit,
      });
      const events: RoomEvent[] = [];
      const emptyPageBytes = Buffer.byteLength(
        JSON.stringify({
          mode: "event_page",
          cursorBefore: afterSeq,
          cursorAfter: afterSeq,
          latestRoomSeq,
          throughSeq,
          responseBytes: ROOM_SYNC_RESPONSE_BYTE_LIMIT,
          hasMore: afterSeq < throughSeq,
          snapshot: null,
          events: [],
        }),
      );
      let eventBytes = 0;
      for (const event of candidates) {
        const serializedBytes = Buffer.byteLength(JSON.stringify(event));
        const separatorBytes = events.length ? 1 : 0;
        if (
          emptyPageBytes + eventBytes + separatorBytes + serializedBytes + 128 >
          ROOM_SYNC_RESPONSE_BYTE_LIMIT
        )
          break;
        events.push(event);
        eventBytes += separatorBytes + serializedBytes;
      }
      let cursorAfter = events.at(-1)?.roomSeq ?? afterSeq;
      let result = withRoomResponseBytes({
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
      while (
        result.responseBytes > ROOM_SYNC_RESPONSE_BYTE_LIMIT &&
        events.length > 0
      ) {
        events.pop();
        cursorAfter = events.at(-1)?.roomSeq ?? afterSeq;
        result = withRoomResponseBytes({
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
      readRoomCatalog(this.#database, actorId, options, ROOM_LIST_LIMIT),
    );
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
    if (
      options.afterRoomSeq !== undefined &&
      options.beforeRoomSeq !== undefined
    ) {
      throw roomError(
        "invalid_argument",
        "message page cannot mix afterRoomSeq and beforeRoomSeq",
      );
    }
    const throughRoomSeq = options.throughRoomSeq ?? this.#roomHead(roomId);
    this.#requireListWindow(throughRoomSeq, limit, "throughRoomSeq");
    if (throughRoomSeq > this.#roomHead(roomId)) {
      throw roomError(
        "invalid_argument",
        "throughRoomSeq cannot exceed the Room head",
      );
    }
    const backward = options.beforeRoomSeq !== undefined;
    const anchor = backward
      ? options.beforeRoomSeq!
      : (options.afterRoomSeq ?? 0);
    this.#requireListWindow(
      anchor,
      limit,
      backward ? "beforeRoomSeq" : "afterRoomSeq",
    );
    if (backward && (anchor < 1 || anchor > throughRoomSeq + 1)) {
      throw roomError(
        "invalid_argument",
        "beforeRoomSeq must be within the frozen Room window",
      );
    }
    if (!backward && anchor > throughRoomSeq) {
      throw roomError(
        "invalid_argument",
        "afterRoomSeq cannot exceed throughRoomSeq",
      );
    }
    const messages = this.#messageReads.messagePage(
      roomId,
      anchor,
      throughRoomSeq,
      limit,
      backward,
    );
    let cursorAfter = backward
      ? (messages[0]?.roomSeq ?? anchor)
      : (messages.at(-1)?.roomSeq ?? anchor);
    let result = withRoomResponseBytes({
      mode: backward ? ("backward" as const) : ("forward" as const),
      cursorBefore: anchor,
      cursorAfter,
      throughRoomSeq,
      hasMore: this.#messageReads.hasMoreMessages(
        roomId,
        cursorAfter,
        throughRoomSeq,
        backward,
      ),
      responseBytes: 0,
      messages,
    });
    while (
      result.responseBytes > ROOM_SYNC_RESPONSE_BYTE_LIMIT &&
      messages.length > 0
    ) {
      if (backward) messages.shift();
      else messages.pop();
      cursorAfter = backward
        ? (messages[0]?.roomSeq ?? anchor)
        : (messages.at(-1)?.roomSeq ?? anchor);
      result = withRoomResponseBytes({
        ...result,
        cursorAfter,
        hasMore: this.#messageReads.hasMoreMessages(
          roomId,
          cursorAfter,
          throughRoomSeq,
          backward,
        ),
        responseBytes: 0,
        messages,
      });
    }
    return result;
  }

  listInbox(
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
    return this.#inbox.list(participantId, options);
  }

  inboxHead(participantId: string): number {
    return this.#inbox.head(participantId);
  }

  listTasks(actorId: string, roomId: string): RoomTask[] {
    return this.#tasks.list(actorId, roomId);
  }

  listTaskPage(
    actorId: string,
    roomId: string,
    options: Parameters<RoomTaskService["listPage"]>[2] = {},
  ): ReturnType<RoomTaskService["listPage"]> {
    return this.#tasks.listPage(actorId, roomId, options);
  }

  createTask(
    actorId: string,
    input: Parameters<RoomTaskService["create"]>[1],
  ): RoomTaskMutationResult {
    return this.#tasks.create(actorId, input);
  }

  claimTask(
    execution: RoomWorkerExecution,
    input: Parameters<RoomTaskService["claim"]>[1],
  ): RoomTaskMutationResult {
    return this.#tasks.claim(execution, input);
  }

  startTask(
    execution: RoomWorkerExecution,
    input: Parameters<RoomTaskService["start"]>[1],
  ): RoomTaskMutationResult {
    return this.#tasks.start(execution, input);
  }

  submitTask(
    execution: RoomWorkerExecution,
    input: Parameters<RoomTaskService["submit"]>[1],
  ): RoomTaskSubmissionMutationResult {
    return this.#tasks.submit(execution, input);
  }

  reviewTask(
    execution: RoomWorkerExecution,
    input: {
      taskId: string;
      basedOnRoomSeq: number;
      disposition: RoomTaskReviewDisposition;
      summary: string;
      idempotencyKey: string;
    },
  ): RoomTaskReviewMutationResult {
    return this.#tasks.review(execution, input);
  }

  acceptTask(
    actorId: string,
    input: Parameters<RoomTaskService["accept"]>[1],
  ): RoomTaskMutationResult {
    return this.#tasks.accept(actorId, input);
  }

  cancelTask(
    actorId: string,
    input: Parameters<RoomTaskService["cancel"]>[1],
  ): RoomTaskMutationResult {
    return this.#tasks.cancel(actorId, input);
  }

  listOutbox(
    options: { afterOutboxSeq?: number; limit?: number } = {},
  ): RoomOutboxEntry[] {
    return this.#outbox.list(options);
  }

  publishedOutboxHead(): number {
    return this.#outbox.publishedHead();
  }

  claimOutbox(
    workerId: string,
    options: { limit?: number; leaseMs?: number } = {},
  ): RoomOutboxEntry[] {
    return this.#outbox.claim(workerId, options);
  }

  completeOutbox(
    workerId: string,
    outboxSeq: number,
    leaseToken: string,
    deliveryReceipt = leaseToken,
  ): RoomOutboxEntry {
    return this.#outbox.complete(
      workerId,
      outboxSeq,
      leaseToken,
      deliveryReceipt,
    );
  }

  failOutbox(
    workerId: string,
    outboxSeq: number,
    input: {
      error: string;
      retryAt: string;
      leaseToken: string;
      failureClass?: string;
    },
  ): RoomOutboxEntry {
    return this.#outbox.fail(workerId, outboxSeq, input);
  }

  blockOutbox(
    workerId: string,
    outboxSeq: number,
    input: {
      error: string;
      failureClass: string;
      actionRequired: string;
      sticky: boolean;
      leaseToken: string;
    },
  ): RoomOutboxEntry {
    return this.#outbox.block(workerId, outboxSeq, input);
  }

  prunePublishedOutbox(input: {
    throughOutboxSeq: number;
    limit?: number;
  }): number {
    return this.#outbox.prune(input);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#database.close();
  }

  #messageAttention(
    room: RoomRecord,
    actorId: string,
    mentionedPrincipalIds: readonly string[],
  ): Array<{ principalId: string; reason: RoomAttentionReason }> {
    for (const principalId of mentionedPrincipalIds) {
      this.#requireMembership(room.roomId, principalId);
      if (principalId === actorId) {
        throw roomError(
          "invalid_argument",
          "a Room message cannot mention its own actor",
        );
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

  #normalizeMessageIntent(
    request: PostRoomMessageRequest,
  ): PostRoomMessageRequest {
    if (
      this.#requireRoom(request.roomId).kind !== "direct" ||
      !request.mentionedPrincipalIds
    ) {
      return request;
    }
    return {
      roomId: request.roomId,
      body: request.body,
      ...(request.replyToMessageId
        ? { replyToMessageId: request.replyToMessageId }
        : {}),
      idempotencyKey: request.idempotencyKey,
    };
  }

  #ensureThread(
    message: RoomMessage,
    createdAt: string,
  ): { threadId: string; rootMessageId: string } {
    const rootMessageId = message.rootMessageId ?? message.messageId;
    const row = this.#database
      .prepare("SELECT thread_id FROM room_threads WHERE root_message_id = ?")
      .get(rootMessageId) as Row | undefined;
    if (row) return { threadId: text(row, "thread_id"), rootMessageId };
    const threadId = this.#createId("thread");
    this.#database
      .prepare(
        "INSERT INTO room_threads(thread_id, room_id, root_message_id, created_at) VALUES(?, ?, ?, ?)",
      )
      .run(threadId, message.roomId, rootMessageId, createdAt);
    return { threadId, rootMessageId };
  }

  #roomMembershipPrincipalIds(roomId: string): string[] {
    return (
      this.#database
        .prepare(
          "SELECT principal_id FROM room_memberships WHERE room_id = ? ORDER BY principal_id",
        )
        .all(roomId) as Row[]
    ).map((row) => text(row, "principal_id"));
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

  #appendAttention(
    event: RoomEvent,
    participantId: string,
    reason: RoomAttentionReason,
    createdAt = this.#timestamp(),
    disposition: RoomInboxDisposition = "activation",
  ): void {
    if (participantId === event.actorId) return;
    this.#requireMembership(event.roomId, participantId);
    if (
      event.aggregateType !== "message" &&
      event.aggregateType !== "task" &&
      event.aggregateType !== "review"
    ) {
      throw roomError(
        "conflict",
        `event ${event.eventId} cannot target the Room Inbox`,
      );
    }
    const taskId =
      event.aggregateType === "task"
        ? event.aggregateId
        : event.aggregateType === "review" &&
            typeof event.payload.taskId === "string"
          ? event.payload.taskId
          : undefined;
    const reviewDisposition =
      event.type === "review.submitted" &&
      (event.payload.disposition === "approved" ||
        event.payload.disposition === "changes_requested")
        ? event.payload.disposition
        : undefined;
    const inboxItem: Omit<RoomInboxItem, "inboxSeq"> = {
      inboxItemId: this.#createId("inbox"),
      roomId: event.roomId,
      participantId,
      eventId: event.eventId,
      eventSeq: event.roomSeq,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      ...(taskId ? { taskId } : {}),
      ...(reviewDisposition ? { reviewDisposition } : {}),
      reason,
      disposition,
      state: "pending",
      createdAt,
    };
    this.#database
      .prepare(
        `INSERT OR IGNORE INTO room_inbox_items(
           inbox_item_id, room_id, participant_id, event_id, event_seq,
           reason, disposition, state, created_at
         ) VALUES(?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run(
        inboxItem.inboxItemId,
        inboxItem.roomId,
        inboxItem.participantId,
        inboxItem.eventId,
        inboxItem.eventSeq,
        inboxItem.reason,
        inboxItem.disposition,
        inboxItem.createdAt,
      );
    this.#insertOutbox({
      roomId: event.roomId,
      roomSeq: event.roomSeq,
      topic: "inbox.available",
      payload: {
        eventId: event.eventId,
        headCursor: event.roomSeq,
        participantId,
        reason,
        disposition,
        roomId: event.roomId,
      },
    });
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
    if (
      text(row, "command_kind") !== commandKind ||
      text(row, "request_hash") !== requestHash
    ) {
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
    if (!row)
      throw roomError("not_found", `message ${messageId} was not found`);
    return messageFromRow(row);
  }

  #requirePrincipal(principalId: string): RoomPrincipal {
    const row = this.#database
      .prepare("SELECT * FROM room_principals WHERE principal_id = ?")
      .get(principalId) as Row | undefined;
    if (!row)
      throw roomError("not_found", `principal ${principalId} was not found`);
    return principalFromRow(row);
  }

  #membership(roomId: string, principalId: string): RoomMembership | undefined {
    const row = this.#database
      .prepare(
        "SELECT * FROM room_memberships WHERE room_id = ? AND principal_id = ?",
      )
      .get(roomId, principalId) as Row | undefined;
    return row ? membershipFromRow(row) : undefined;
  }

  #requireMembership(roomId: string, principalId: string): RoomMembership {
    const membership = this.#membership(roomId, principalId);
    if (!membership) {
      throw roomError(
        "forbidden",
        `principal ${principalId} is not a Room member`,
      );
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
        error instanceof Error
          ? error.message
          : "Room request validation failed",
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
      return roomError(
        "conflict",
        "Room resource references unavailable state",
      );
    }
    if (/(CHECK|NOT NULL) constraint failed/i.test(message)) {
      return roomError(
        "invalid_argument",
        "Room resource violates a storage constraint",
      );
    }
    if (/(database is locked|database is busy)/i.test(message)) {
      return roomError("unavailable", "Room storage is temporarily busy");
    }
    if (/(database or disk is full|SQLITE_FULL)/i.test(message)) {
      return roomError(
        "resource_exhausted",
        "Room storage has no remaining capacity",
      );
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
