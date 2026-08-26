import type { DatabaseSync } from "node:sqlite";

import {
  ActivationReasonSchema,
  MembershipRoleSchema,
  ParticipantKindSchema,
  type ActivationReason,
  type MembershipRole,
  type Room,
  type RoomMembership,
  type Thread,
  type Workspace,
} from "@rah-os/protocol";

import {
  ConflictError,
  ForbiddenError,
  IdempotencyConflictError,
  NotFoundError,
  StaleContextError,
} from "./errors.ts";
import {
  requireHumanRoomOwner,
  requireRoomManager,
  requireRoomMember,
  requireRoomOwner,
} from "./collaboration-policy.ts";
import {
  newLegacyRoom,
  messageProjectionFromRow,
  roomMembershipProjectionFromRow,
  roomProjectionFromRow,
  threadProjectionFromRow,
  workspaceProjectionFromRow,
} from "./collaboration-projection.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import { integer, type Row } from "./sqlite-row.ts";
import type {
  MessageMutationResult,
  MessagePage,
  Principal,
  RoomMembershipMutationResult,
  RoomMembershipRemovalResult,
  ThreadMutationResult,
} from "./types.ts";

export type MessageRecipient = {
  participantId: string;
  reason: ActivationReason;
};

export class CollaborationService {
  readonly #createId: (prefix: string) => string;
  readonly #database: DatabaseSync;
  readonly #events: RoomEventWriter;
  readonly #now: () => Date;

  constructor(input: {
    createId: (prefix: string) => string;
    database: DatabaseSync;
    events: RoomEventWriter;
    now: () => Date;
  }) {
    this.#createId = input.createId;
    this.#database = input.database;
    this.#events = input.events;
    this.#now = input.now;
  }

  createRoom(actor: Principal, input: { name: string; slug: string }): Room {
    requireHumanRoomOwner(actor);
    const room = newLegacyRoom(
      this.#createId("room"),
      input,
      this.#timestamp(),
    );
    this.#database
      .prepare(
        "INSERT INTO rooms(room_id, workspace_id, kind, slug, name, next_seq, created_at) VALUES(?, ?, ?, ?, ?, 1, ?)",
      )
      .run(
        room.roomId,
        room.workspaceId,
        room.kind,
        room.slug,
        room.name,
        room.createdAt,
      );
    this.#database
      .prepare(
        "INSERT INTO memberships(room_id, principal_id, role, joined_at) VALUES(?, ?, 'owner', ?)",
      )
      .run(room.roomId, actor.principalId, room.createdAt);
    this.#events.append({
      actorId: actor.principalId,
      aggregateId: room.roomId,
      aggregateType: "room",
      idempotencyKey: `room.create:${room.roomId}`,
      payload: {
        kind: room.kind,
        name: room.name,
        slug: room.slug,
        workspaceId: room.workspaceId,
      },
      roomId: room.roomId,
      type: "room.created",
    });
    return room;
  }

  addMember(
    actorId: string,
    input: { principalId: string; roomId: string },
  ): void {
    requireRoomManager(this.#database, input.roomId, actorId);
    this.#requirePrincipal(input.principalId);
    const joinedAt = this.#timestamp();
    const result = this.#database
      .prepare(
        "INSERT OR IGNORE INTO memberships(room_id, principal_id, role, joined_at) VALUES(?, ?, 'member', ?)",
      )
      .run(input.roomId, input.principalId, joinedAt);
    if (Number(result.changes) === 0) return;
    this.#events.append({
      actorId,
      aggregateId: input.principalId,
      aggregateType: "membership",
      idempotencyKey: `membership.add:${input.principalId}`,
      payload: { participantId: input.principalId },
      roomId: input.roomId,
      type: "membership.added",
    });
  }

  listWorkspaces(actorId: string): Workspace[] {
    return this.#database
      .prepare(
        `SELECT DISTINCT
           workspaces.workspace_id,
           workspaces.slug AS workspace_slug,
           workspaces.name AS workspace_name,
           workspaces.state AS workspace_state,
           workspaces.created_at AS workspace_created_at,
           workspaces.archived_at AS workspace_archived_at
         FROM workspaces
         JOIN rooms ON rooms.workspace_id = workspaces.workspace_id
         JOIN memberships ON memberships.room_id = rooms.room_id
         WHERE memberships.principal_id = ?
         ORDER BY workspaces.slug, workspaces.workspace_id`,
      )
      .all(actorId)
      .map((row) => workspaceProjectionFromRow(row));
  }

  listRooms(actorId: string, input: { workspaceId?: string } = {}): Room[] {
    return this.#database
      .prepare(
        `SELECT rooms.*
         FROM rooms
         JOIN memberships ON memberships.room_id = rooms.room_id
         WHERE memberships.principal_id = ?
           AND (? IS NULL OR rooms.workspace_id = ?)
         ORDER BY rooms.slug, rooms.room_id`,
      )
      .all(actorId, input.workspaceId ?? null, input.workspaceId ?? null)
      .map((row) => roomProjectionFromRow(row));
  }

  listRoomMemberships(actorId: string, roomId: string): RoomMembership[] {
    requireRoomMember(this.#database, roomId, actorId);
    return this.#database
      .prepare(
        "SELECT * FROM memberships WHERE room_id = ? ORDER BY role, principal_id",
      )
      .all(roomId)
      .map((row) => roomMembershipProjectionFromRow(row));
  }

  addRoomMember(
    actor: Principal,
    input: {
      basedOnRoomSeq: number;
      idempotencyKey: string;
      principalId: string;
      role: MembershipRole;
      roomId: string;
    },
  ): RoomMembershipMutationResult {
    const actorRole = requireRoomManager(
      this.#database,
      input.roomId,
      actor.principalId,
    );
    const role = MembershipRoleSchema.parse(input.role);
    if (role !== "member" && actorRole !== "owner") {
      throw new ForbiddenError("only a Room owner can grant elevated roles");
    }
    this.#requireRolePrincipal(input.principalId, role);
    const replay = this.#membershipReplay(actor.principalId, input, {
      eventType: "membership.added",
      payload: { participantId: input.principalId, role },
    });
    if (replay !== null) return replay;
    this.#assertFreshContext(input.roomId, actor, input.basedOnRoomSeq);
    if (this.#membershipRow(input.roomId, input.principalId) !== undefined) {
      throw new ConflictError(
        `principal ${input.principalId} is already a member of Room ${input.roomId}`,
      );
    }
    const joinedAt = this.#timestamp();
    this.#database
      .prepare(
        "INSERT INTO memberships(room_id, principal_id, role, joined_at) VALUES(?, ?, ?, ?)",
      )
      .run(input.roomId, input.principalId, role, joinedAt);
    const event = this.#events.append({
      actorId: actor.principalId,
      aggregateId: input.principalId,
      aggregateType: "membership",
      idempotencyKey: input.idempotencyKey,
      payload: {
        basedOnRoomSeq: input.basedOnRoomSeq,
        participantId: input.principalId,
        role,
      },
      roomId: input.roomId,
      type: "membership.added",
    });
    return {
      deduplicated: false,
      event,
      membership: this.#membershipFromIds(input.roomId, input.principalId),
    };
  }

  setRoomMemberRole(
    actor: Principal,
    input: {
      basedOnRoomSeq: number;
      idempotencyKey: string;
      principalId: string;
      role: MembershipRole;
      roomId: string;
    },
  ): RoomMembershipMutationResult {
    requireRoomOwner(this.#database, input.roomId, actor.principalId);
    const role = MembershipRoleSchema.parse(input.role);
    this.#requireRolePrincipal(input.principalId, role);
    const replay = this.#membershipReplay(actor.principalId, input, {
      eventType: "membership.role_changed",
      payload: { participantId: input.principalId, role },
    });
    if (replay !== null) return replay;
    this.#assertFreshContext(input.roomId, actor, input.basedOnRoomSeq);
    const membership = this.#membershipFromIds(input.roomId, input.principalId);
    if (membership.role === "owner" && role !== "owner") {
      const ownerCount = this.#database
        .prepare(
          "SELECT COUNT(*) AS count FROM memberships WHERE room_id = ? AND role = 'owner'",
        )
        .get(input.roomId);
      if (integer(ownerCount!, "count") <= 1) {
        throw new ConflictError("cannot demote the last owner of a Room");
      }
    }
    this.#database
      .prepare(
        "UPDATE memberships SET role = ? WHERE room_id = ? AND principal_id = ?",
      )
      .run(role, input.roomId, input.principalId);
    const event = this.#events.append({
      actorId: actor.principalId,
      aggregateId: input.principalId,
      aggregateType: "membership",
      idempotencyKey: input.idempotencyKey,
      payload: {
        basedOnRoomSeq: input.basedOnRoomSeq,
        participantId: input.principalId,
        previousRole: membership.role,
        role,
      },
      roomId: input.roomId,
      type: "membership.role_changed",
    });
    return {
      deduplicated: false,
      event,
      membership: this.#membershipFromIds(input.roomId, input.principalId),
    };
  }

  removeRoomMember(
    actor: Principal,
    input: {
      basedOnRoomSeq: number;
      idempotencyKey: string;
      principalId: string;
      roomId: string;
    },
  ): RoomMembershipRemovalResult {
    const previous = this.#findEvent(input.roomId, input.idempotencyKey);
    if (previous !== undefined) {
      const event = this.#events.eventFromRow(previous);
      if (
        event.type !== "membership.removed" ||
        event.actorId !== actor.principalId ||
        event.aggregateType !== "membership" ||
        event.aggregateId !== input.principalId ||
        event.payload.participantId !== input.principalId
      ) {
        throw this.#idempotencyConflict(input.idempotencyKey);
      }
      return {
        deduplicated: true,
        event,
        removedPrincipalId: input.principalId,
      };
    }

    const actorRole = requireRoomManager(
      this.#database,
      input.roomId,
      actor.principalId,
    );
    this.#assertFreshContext(input.roomId, actor, input.basedOnRoomSeq);
    const membership = this.#membershipFromIds(input.roomId, input.principalId);
    if (membership.role !== "member" && actorRole !== "owner") {
      throw new ForbiddenError(
        "only a Room owner can remove an owner or admin",
      );
    }
    if (membership.role === "owner") {
      const ownerCount = this.#database
        .prepare(
          "SELECT COUNT(*) AS count FROM memberships WHERE room_id = ? AND role = 'owner'",
        )
        .get(input.roomId);
      if (integer(ownerCount!, "count") <= 1) {
        throw new ConflictError("cannot remove the last owner of a Room");
      }
    }
    this.#assertNoActiveMembershipWork(input.roomId, input.principalId);
    const event = this.#events.append({
      actorId: actor.principalId,
      aggregateId: input.principalId,
      aggregateType: "membership",
      idempotencyKey: input.idempotencyKey,
      payload: {
        basedOnRoomSeq: input.basedOnRoomSeq,
        participantId: input.principalId,
        previousRole: membership.role,
      },
      roomId: input.roomId,
      type: "membership.removed",
    });
    this.#database
      .prepare("DELETE FROM memberships WHERE room_id = ? AND principal_id = ?")
      .run(input.roomId, input.principalId);
    return {
      deduplicated: false,
      event,
      removedPrincipalId: input.principalId,
    };
  }

  listThreads(actorId: string, roomId: string): Thread[] {
    requireRoomMember(this.#database, roomId, actorId);
    return this.#database
      .prepare(
        "SELECT * FROM threads WHERE room_id = ? ORDER BY created_at, thread_id",
      )
      .all(roomId)
      .map((row) => threadProjectionFromRow(row));
  }

  listMessages(
    actorId: string,
    input: {
      afterSeq?: number;
      limit?: number;
      roomId: string;
      threadId?: string;
    },
  ): MessagePage {
    requireRoomMember(this.#database, input.roomId, actorId);
    const afterSeq = input.afterSeq ?? 0;
    const limit = input.limit ?? 100;
    if (!Number.isInteger(afterSeq) || afterSeq < 0) {
      throw new Error("afterSeq must be a non-negative integer");
    }
    if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
      throw new Error("limit must be between 1 and 500");
    }
    const rows = this.#database
      .prepare(
        `SELECT messages.*, room_events.room_seq FROM messages
         JOIN room_events
           ON room_events.room_id = messages.room_id
          AND room_events.aggregate_type = 'message'
          AND room_events.aggregate_id = messages.message_id
          AND room_events.type = 'message.posted'
         WHERE messages.room_id = ?
           AND room_events.room_seq > ?
           AND (? IS NULL OR messages.thread_id = ?)
         ORDER BY room_events.room_seq, messages.message_id
         LIMIT ?`,
      )
      .all(
        input.roomId,
        afterSeq,
        input.threadId ?? null,
        input.threadId ?? null,
        limit + 1,
      );
    const pageRows = rows.slice(0, limit);
    const messages = pageRows.map((row) => messageProjectionFromRow(row));
    return {
      cursorAfter: messages.at(-1)?.roomSeq ?? afterSeq,
      hasMore: rows.length > limit,
      messages,
    };
  }

  createThread(
    actor: Principal,
    input: {
      basedOnRoomSeq: number;
      idempotencyKey: string;
      recipientIds: string[];
      roomId: string;
      rootMessageId: string;
    },
  ): ThreadMutationResult {
    requireRoomMember(this.#database, input.roomId, actor.principalId);
    const recipientIds = this.#normalizeRecipientIds(
      input.roomId,
      actor.principalId,
      input.recipientIds,
    );
    const previous = this.#findEvent(input.roomId, input.idempotencyKey);
    if (previous !== undefined) {
      const event = this.#events.eventFromRow(previous);
      if (
        event.type !== "thread.created" ||
        event.actorId !== actor.principalId ||
        event.payload.rootMessageId !== input.rootMessageId ||
        JSON.stringify(event.payload.recipientIds) !==
          JSON.stringify(recipientIds)
      ) {
        throw this.#idempotencyConflict(input.idempotencyKey);
      }
      return {
        activationIds: [],
        deduplicated: true,
        event,
        thread: this.#threadFromId(event.aggregateId),
      };
    }
    this.#assertFreshContext(input.roomId, actor, input.basedOnRoomSeq);
    const root = this.#database
      .prepare("SELECT * FROM messages WHERE message_id = ? AND room_id = ?")
      .get(input.rootMessageId, input.roomId);
    if (root === undefined) {
      throw new NotFoundError(
        `root Message ${input.rootMessageId} was not found in Room ${input.roomId}`,
      );
    }
    if (
      this.#database
        .prepare("SELECT 1 FROM threads WHERE root_message_id = ?")
        .get(input.rootMessageId)
    ) {
      throw new ConflictError(
        `Message ${input.rootMessageId} already has a Thread`,
      );
    }
    const threadId = this.#createId("thread");
    const createdAt = this.#timestamp();
    this.#database
      .prepare(
        "INSERT INTO threads(thread_id, room_id, root_message_id, created_by, reply_count, created_at) VALUES(?, ?, ?, ?, 0, ?)",
      )
      .run(
        threadId,
        input.roomId,
        input.rootMessageId,
        actor.principalId,
        createdAt,
      );
    const event = this.#events.append({
      actorId: actor.principalId,
      aggregateId: threadId,
      aggregateType: "thread",
      idempotencyKey: input.idempotencyKey,
      payload: {
        basedOnRoomSeq: input.basedOnRoomSeq,
        recipientIds,
        rootMessageId: input.rootMessageId,
        threadId,
      },
      roomId: input.roomId,
      type: "thread.created",
    });
    return {
      activationIds: this.#events.deriveAttention(
        event,
        recipientIds.map((participantId) => ({
          participantId,
          reason: "thread_subscription",
        })),
        createdAt,
      ),
      deduplicated: false,
      event,
      thread: this.#threadFromId(threadId),
    };
  }

  replyThread(
    actor: Principal,
    input: {
      basedOnRoomSeq: number;
      body: string;
      idempotencyKey: string;
      recipientIds: string[];
      roomId: string;
      threadId: string;
    },
  ): MessageMutationResult {
    requireRoomMember(this.#database, input.roomId, actor.principalId);
    const body = input.body.trim();
    if (body.length === 0) throw new Error("message body is required");
    const recipientIds = this.#normalizeRecipientIds(
      input.roomId,
      actor.principalId,
      input.recipientIds,
    );
    const previous = this.#findEvent(input.roomId, input.idempotencyKey);
    if (previous !== undefined) {
      const event = this.#events.eventFromRow(previous);
      if (
        event.type !== "message.posted" ||
        event.actorId !== actor.principalId ||
        event.payload.body !== body ||
        event.payload.threadId !== input.threadId ||
        JSON.stringify(event.payload.recipientIds) !==
          JSON.stringify(recipientIds)
      ) {
        throw this.#idempotencyConflict(input.idempotencyKey);
      }
      return { activationIds: [], deduplicated: true, event };
    }
    this.#assertFreshContext(input.roomId, actor, input.basedOnRoomSeq);
    this.#threadFromRoom(input.threadId, input.roomId);
    const messageId = this.#createId("message");
    const createdAt = this.#timestamp();
    this.#database
      .prepare(
        "INSERT INTO messages(message_id, room_id, actor_id, thread_id, body, created_at) VALUES(?, ?, ?, ?, ?, ?)",
      )
      .run(
        messageId,
        input.roomId,
        actor.principalId,
        input.threadId,
        body,
        createdAt,
      );
    this.#database
      .prepare(
        "UPDATE threads SET reply_count = reply_count + 1, last_reply_at = ? WHERE thread_id = ?",
      )
      .run(createdAt, input.threadId);
    const event = this.#events.append({
      actorId: actor.principalId,
      aggregateId: messageId,
      aggregateType: "message",
      idempotencyKey: input.idempotencyKey,
      payload: {
        basedOnRoomSeq: input.basedOnRoomSeq,
        body,
        messageId,
        recipientIds,
        recipients: recipientIds.map((participantId) => ({
          participantId,
          reason: "thread_subscription",
        })),
        threadId: input.threadId,
      },
      roomId: input.roomId,
      type: "message.posted",
    });
    return {
      activationIds: this.#events.deriveAttention(
        event,
        recipientIds.map((participantId) => ({
          participantId,
          reason: "thread_subscription",
        })),
        createdAt,
      ),
      deduplicated: false,
      event,
    };
  }

  postMessage(
    actor: Principal,
    input: {
      basedOnRoomSeq?: number;
      body: string;
      idempotencyKey: string;
      recipients: MessageRecipient[];
      roomId: string;
    },
  ): MessageMutationResult {
    requireRoomMember(this.#database, input.roomId, actor.principalId);
    const body = input.body.trim();
    if (body.length === 0) throw new Error("message body is required");
    if (input.idempotencyKey.trim().length === 0) {
      throw new Error("idempotencyKey is required");
    }
    const recipients = this.#normalizeRecipients(
      input.roomId,
      actor.principalId,
      input.recipients,
    );
    const recipientPayload = recipients.map((recipient) => ({
      participantId: recipient.participantId,
      reason: recipient.reason,
    }));
    const previous = this.#database
      .prepare(
        "SELECT * FROM room_events WHERE room_id = ? AND idempotency_key = ?",
      )
      .get(input.roomId, input.idempotencyKey);
    if (previous) {
      const event = this.#events.eventFromRow(previous);
      if (
        event.type !== "message.posted" ||
        event.actorId !== actor.principalId ||
        event.payload.threadId !== undefined ||
        event.payload.body !== body ||
        JSON.stringify(event.payload.recipients) !==
          JSON.stringify(recipientPayload)
      ) {
        throw new IdempotencyConflictError(
          `idempotency key ${input.idempotencyKey} was already used for another mutation`,
        );
      }
      return { activationIds: [], deduplicated: true, event };
    }
    this.#assertFreshContext(input.roomId, actor, input.basedOnRoomSeq);
    const messageId = this.#createId("message");
    const createdAt = this.#timestamp();
    this.#database
      .prepare(
        "INSERT INTO messages(message_id, room_id, actor_id, body, created_at) VALUES(?, ?, ?, ?, ?)",
      )
      .run(messageId, input.roomId, actor.principalId, body, createdAt);
    const event = this.#events.append({
      actorId: actor.principalId,
      aggregateId: messageId,
      aggregateType: "message",
      idempotencyKey: input.idempotencyKey,
      payload: {
        body,
        messageId,
        ...(input.basedOnRoomSeq === undefined
          ? {}
          : { basedOnRoomSeq: input.basedOnRoomSeq }),
        recipientIds: recipients.map((recipient) => recipient.participantId),
        recipients: recipientPayload,
      },
      roomId: input.roomId,
      type: "message.posted",
    });
    return {
      activationIds: this.#events.deriveAttention(event, recipients, createdAt),
      deduplicated: false,
      event,
    };
  }

  #findEvent(roomId: string, idempotencyKey: string): Row | undefined {
    return this.#database
      .prepare(
        "SELECT * FROM room_events WHERE room_id = ? AND idempotency_key = ?",
      )
      .get(roomId, idempotencyKey);
  }

  #idempotencyConflict(idempotencyKey: string): IdempotencyConflictError {
    return new IdempotencyConflictError(
      `idempotency key ${idempotencyKey} was already used for another mutation`,
    );
  }

  #membershipFromIds(roomId: string, principalId: string): RoomMembership {
    const membership = this.#membershipRow(roomId, principalId);
    if (membership === undefined) {
      throw new NotFoundError(
        `principal ${principalId} is not a member of Room ${roomId}`,
      );
    }
    return roomMembershipProjectionFromRow(membership);
  }

  #membershipReplay(
    actorId: string,
    input: {
      idempotencyKey: string;
      principalId: string;
      roomId: string;
    },
    expected: {
      eventType: "membership.added" | "membership.role_changed";
      payload: { participantId: string; role: MembershipRole };
    },
  ): RoomMembershipMutationResult | null {
    const previous = this.#findEvent(input.roomId, input.idempotencyKey);
    if (previous === undefined) return null;
    const event = this.#events.eventFromRow(previous);
    if (
      event.type !== expected.eventType ||
      event.actorId !== actorId ||
      event.aggregateType !== "membership" ||
      event.aggregateId !== input.principalId ||
      event.payload.participantId !== expected.payload.participantId ||
      event.payload.role !== expected.payload.role
    ) {
      throw this.#idempotencyConflict(input.idempotencyKey);
    }
    return {
      deduplicated: true,
      event,
      membership: this.#membershipFromIds(input.roomId, input.principalId),
    };
  }

  #membershipRow(roomId: string, principalId: string): Row | undefined {
    return this.#database
      .prepare(
        "SELECT * FROM memberships WHERE room_id = ? AND principal_id = ?",
      )
      .get(roomId, principalId);
  }

  #normalizeRecipientIds(
    roomId: string,
    actorId: string,
    recipientIds: string[],
  ): string[] {
    const normalized = [...new Set(recipientIds)]
      .filter((participantId) => participantId !== actorId)
      .sort();
    for (const participantId of normalized) {
      requireRoomMember(this.#database, roomId, participantId);
    }
    return normalized;
  }

  #requireRolePrincipal(principalId: string, role: MembershipRole): void {
    const principal = this.#requirePrincipalRow(principalId);
    const kind = ParticipantKindSchema.parse(principal.kind);
    if (role !== "member" && kind !== "human") {
      throw new ForbiddenError("elevated Room roles require a Human principal");
    }
  }

  #threadFromId(threadId: string): Thread {
    const thread = this.#database
      .prepare("SELECT * FROM threads WHERE thread_id = ?")
      .get(threadId);
    if (thread === undefined) {
      throw new NotFoundError(`Thread ${threadId} was not found`);
    }
    return threadProjectionFromRow(thread);
  }

  #threadFromRoom(threadId: string, roomId: string): Thread {
    const thread = this.#database
      .prepare("SELECT * FROM threads WHERE thread_id = ? AND room_id = ?")
      .get(threadId, roomId);
    if (thread === undefined) {
      throw new NotFoundError(
        `Thread ${threadId} was not found in Room ${roomId}`,
      );
    }
    return threadProjectionFromRow(thread);
  }

  #assertFreshContext(
    roomId: string,
    actor: Principal,
    basedOnRoomSeq: number | undefined,
  ): void {
    const room = this.#requireRoom(roomId);
    const latestRoomSeq = integer(room, "next_seq") - 1;
    if (basedOnRoomSeq === undefined) {
      if (actor.kind === "human") return;
      throw new StaleContextError(undefined, latestRoomSeq);
    }
    if (!Number.isInteger(basedOnRoomSeq) || basedOnRoomSeq < 0) {
      throw new Error("basedOnRoomSeq must be a non-negative integer");
    }
    if (basedOnRoomSeq !== latestRoomSeq) {
      throw new StaleContextError(basedOnRoomSeq, latestRoomSeq);
    }
  }

  #assertNoActiveMembershipWork(roomId: string, principalId: string): void {
    const activeTask = this.#database
      .prepare(
        `SELECT 1 AS present FROM tasks
         WHERE room_id = ?
           AND state NOT IN ('completed', 'cancelled')
           AND (assignee_id = ? OR claimed_by = ?)
         LIMIT 1`,
      )
      .get(roomId, principalId, principalId);
    const activeInput = this.#database
      .prepare(
        `SELECT 1 AS present FROM input_requests
         WHERE room_id = ? AND state = 'pending'
           AND (requester_id = ? OR responder_id = ?)
         LIMIT 1`,
      )
      .get(roomId, principalId, principalId);
    const activeActivation = this.#database
      .prepare(
        `SELECT 1 AS present FROM activations
         WHERE room_id = ? AND participant_id = ?
           AND state IN ('queued', 'leased', 'quarantined')
         LIMIT 1`,
      )
      .get(roomId, principalId);
    const activeProcess = this.#database
      .prepare(
        `SELECT 1 AS present FROM runtime_processes
         WHERE room_id = ? AND participant_id = ?
           AND state IN ('prepared', 'active', 'orphaned')
         LIMIT 1`,
      )
      .get(roomId, principalId);
    if (
      activeTask !== undefined ||
      activeInput !== undefined ||
      activeActivation !== undefined ||
      activeProcess !== undefined
    ) {
      throw new ConflictError(
        `principal ${principalId} has active collaboration work in Room ${roomId}`,
      );
    }
  }

  #normalizeRecipients(
    roomId: string,
    actorId: string,
    recipients: MessageRecipient[],
  ): MessageRecipient[] {
    const normalized = new Map<string, MessageRecipient>();
    for (const recipient of recipients) {
      if (recipient.participantId === actorId) continue;
      requireRoomMember(this.#database, roomId, recipient.participantId);
      normalized.set(recipient.participantId, {
        participantId: recipient.participantId,
        reason: ActivationReasonSchema.parse(recipient.reason),
      });
    }
    return [...normalized.values()].sort((left, right) =>
      left.participantId.localeCompare(right.participantId),
    );
  }

  #requirePrincipal(principalId: string): void {
    this.#requirePrincipalRow(principalId);
  }

  #requirePrincipalRow(principalId: string): Row {
    const principal = this.#database
      .prepare("SELECT * FROM principals WHERE principal_id = ?")
      .get(principalId);
    if (principal === undefined) {
      throw new NotFoundError(`principal ${principalId} was not found`);
    }
    return principal;
  }

  #requireRoom(roomId: string): Row {
    const room = this.#database
      .prepare("SELECT * FROM rooms WHERE room_id = ?")
      .get(roomId);
    if (room === undefined) {
      throw new NotFoundError(`room ${roomId} was not found`);
    }
    return room;
  }

  #timestamp(): string {
    return this.#now().toISOString();
  }
}
