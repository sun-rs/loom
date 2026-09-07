import { fromRow as principalFromRow } from "./principal-profile.ts";
import {
  listTaskProjectionPage,
  taskProjectionFromRow,
} from "./task-projection.ts";
import { GlobalDiscovery } from "./global-discovery.ts";
import * as P from "@rah-os/protocol";
import type { AuthenticatedActorContext } from "./auth.ts";
import type { PersonalStateContext } from "./message-social.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import {
  PUBLIC_CHANNEL_METADATA_PREDICATE,
  requirePublicChannelWorkspace,
  requireRoomContentReader,
} from "./collaboration-policy.ts";
import {
  roomProjectionFromRow,
  threadProjectionFromRow,
  messageProjectionFromRow,
  roomMembershipProjectionFromRow,
} from "./collaboration-projection.ts";
import {
  ConflictError,
  ForbiddenError,
  IdempotencyConflictError,
  StaleContextError,
} from "./errors.ts";
import { integer, text } from "./sqlite-row.ts";

/** Collaboration metadata/self-join owner. Membership/history readers stay separate. */
export class HumanPublicChannels {
  private readonly context: PersonalStateContext & { events: RoomEventWriter };
  constructor(context: PersonalStateContext & { events: RoomEventWriter }) {
    this.context = context;
  }
  list(
    auth: AuthenticatedActorContext,
    request: P.PublicChannelDirectoryRequest,
  ): P.PublicChannelDirectoryResponse {
    const input = P.PublicChannelDirectoryRequestSchema.parse(request),
      actorId = this.context.requireActor(auth),
      db = this.context.database;
    return this.context.transaction(() => {
      requirePublicChannelWorkspace(db, input.workspaceId, actorId);
      const rows = db
        .prepare(
          `SELECT r.* FROM rooms r WHERE r.workspace_id=? AND ${PUBLIC_CHANNEL_METADATA_PREDICATE}
        AND (? IS NULL OR r.room_id>?) AND instr(lower(r.name || ' ' || r.slug),lower(?))>0
        ORDER BY r.room_id LIMIT ?`,
        )
        .all(
          input.workspaceId,
          input.afterRoomId ?? null,
          input.afterRoomId ?? null,
          input.query ?? "",
          input.limit + 1,
        );
      const page = rows.slice(0, input.limit);
      return P.PublicChannelDirectoryResponseSchema.parse({
        channels: page.map((row) => {
          const membership = this.#membership(text(row, "room_id"), actorId);
          return {
            room: roomProjectionFromRow(row),
            roomSeq: integer(row, "next_seq") - 1,
            ...(membership ? { membership } : {}),
          };
        }),
        ...(rows.length > input.limit
          ? { nextAfterRoomId: text(page.at(-1)!, "room_id") }
          : {}),
      });
    });
  }
  preview(
    auth: AuthenticatedActorContext,
    request: P.ChannelPreviewRequest,
  ): P.ChannelPreviewResponse {
    const input = P.ChannelPreviewRequestSchema.parse(request),
      actorId = this.context.requireActor(auth),
      db = this.context.database;
    return this.context.transaction(() => {
      requirePublicChannelWorkspace(db, input.workspaceId, actorId);
      requireRoomContentReader(db, input.roomId, actorId);
      const room = db
        .prepare(
          "SELECT * FROM rooms WHERE room_id=? AND workspace_id=? AND kind='channel' AND archived_at IS NULL",
        )
        .get(input.roomId, input.workspaceId);
      if (!room) throw new ForbiddenError("Channel is unavailable");
      const roomSeq = integer(room, "next_seq") - 1,
        ceilingSeq = input.ceilingSeq ?? roomSeq;
      if (ceilingSeq > roomSeq)
        throw new ConflictError(
          "preview ceiling exceeds current Room sequence",
        );
      const root = input.rootMessageId
        ? db
            .prepare(
              "SELECT * FROM discovery_messages WHERE room_id=? AND message_id=? AND thread_id IS NULL AND room_seq<=?",
            )
            .get(input.roomId, input.rootMessageId, ceilingSeq)
        : undefined;
      if (input.rootMessageId && !root)
        throw new ForbiddenError("Root message unavailable in this Channel");
      const threadId =
        input.threadId ??
        (root
          ? (db
              .prepare(
                "SELECT thread_id FROM threads WHERE room_id=? AND root_message_id=?",
              )
              .get(input.roomId, input.rootMessageId!)?.thread_id as
              string | undefined)
          : undefined);
      const thread = threadId
        ? db
            .prepare("SELECT * FROM threads WHERE room_id=? AND thread_id=?")
            .get(input.roomId, threadId)
        : undefined;
      if (threadId && !thread)
        throw new ForbiddenError("Thread unavailable in this Channel");
      const rows = db
        .prepare(
          "SELECT * FROM discovery_messages WHERE room_id=? AND thread_id IS ? AND room_seq<=? AND room_seq<? ORDER BY room_seq DESC LIMIT ?",
        )
        .all(
          input.roomId,
          threadId ?? null,
          ceilingSeq,
          input.beforeSeq ?? ceilingSeq + 1,
          input.limit + 1,
        );
      const selected = rows.slice(0, input.limit),
        membership = this.#membership(input.roomId, actorId);
      const context =
        input.messageId && !threadId
          ? new GlobalDiscovery(db).context(actorId, {
              roomId: input.roomId,
              messageId: input.messageId,
            })
          : undefined;
      const messages =
        root && !threadId
          ? [messageProjectionFromRow(root)]
          : context
            ? [
                ...(context.rootMessage &&
                !context.messages.some(
                  (m) => m.messageId === context.rootMessage?.messageId,
                )
                  ? [context.rootMessage]
                  : []),
                ...context.messages,
              ]
            : selected.reverse().map(messageProjectionFromRow);
      if (thread) {
        const root = db
          .prepare(
            "SELECT * FROM discovery_messages WHERE message_id=? AND room_seq<=?",
          )
          .get(String(thread.root_message_id), ceilingSeq);
        if (root) messages.unshift(messageProjectionFromRow(root));
      }
      const authors = [...new Set(messages.map((message) => message.actorId))]
        .map((id) =>
          db.prepare("SELECT * FROM principals WHERE principal_id=?").get(id),
        )
        .map((row) => principalFromRow(row!));
      const threads = messages.flatMap((message) => {
        const row = db
          .prepare(
            "SELECT * FROM threads WHERE room_id=? AND root_message_id=?",
          )
          .get(input.roomId, message.messageId);
        return row ? [threadProjectionFromRow(row)] : [];
      });
      const taskPage =
        input.view === "tasks"
          ? listTaskProjectionPage(db, input.roomId, {
              limit: input.limit,
              ...(input.beforeTaskNumber
                ? { beforeTaskNumber: input.beforeTaskNumber }
                : {}),
            })
          : undefined;
      return P.ChannelPreviewResponseSchema.parse({
        room: roomProjectionFromRow(room),
        roomSeq,
        ceilingSeq,
        ...(membership ? { membership } : {}),
        messages,
        ...(thread ? { threadId: threadId } : {}),
        authors,
        threads,
        ...(taskPage ?? {
          tasks: messages.slice(0, 50).flatMap((message) => {
            const row = db
              .prepare(
                "SELECT * FROM tasks WHERE room_id=? AND source_message_id=?",
              )
              .get(input.roomId, message.messageId);
            return row ? [taskProjectionFromRow(db, row)] : [];
          }),
        }),
        ...(!context && !input.rootMessageId && rows.length > input.limit
          ? { nextBeforeSeq: integer(selected[0]!, "room_seq") }
          : {}),
      });
    });
  }
  join(
    auth: AuthenticatedActorContext,
    request: P.PublicChannelJoinRequest,
  ): P.PublicChannelJoinResponse {
    const input = P.PublicChannelJoinRequestSchema.parse(request),
      actorId = this.context.requireActor(auth),
      db = this.context.database;
    return this.context.transaction(() => {
      requirePublicChannelWorkspace(db, input.workspaceId, actorId);
      const room = db
        .prepare(
          `SELECT r.* FROM rooms r WHERE r.room_id=? AND r.workspace_id=? AND ${PUBLIC_CHANNEL_METADATA_PREDICATE}`,
        )
        .get(input.roomId, input.workspaceId);
      if (!room) throw new ForbiddenError("public Channel is unavailable");
      const previous = db
        .prepare(
          "SELECT * FROM room_events WHERE room_id=? AND idempotency_key=?",
        )
        .get(input.roomId, input.idempotencyKey);
      if (previous) {
        const event = this.context.events.eventFromRow(previous);
        if (
          event.type !== "membership.added" ||
          event.actorId !== actorId ||
          event.aggregateId !== actorId ||
          event.payload.selfJoin !== true
        )
          throw new IdempotencyConflictError(
            "idempotency key belongs to another membership intent",
          );
        const membership = this.#membership(input.roomId, actorId);
        const removed = db
          .prepare(
            "SELECT 1 FROM room_events WHERE room_id=? AND aggregate_id=? AND type='membership.removed' AND room_seq>? LIMIT 1",
          )
          .get(input.roomId, actorId, event.roomSeq);
        if (!membership || membership.role !== "member" || removed)
          throw new ConflictError(
            "joined membership changed; use a new join intent",
          );
        return { deduplicated: true, event, membership };
      }
      const latest = integer(room, "next_seq") - 1;
      if (input.basedOnRoomSeq !== latest)
        throw new StaleContextError(input.basedOnRoomSeq, latest);
      if (this.#membership(input.roomId, actorId))
        throw new ConflictError("Human is already a Channel member");
      db.prepare(
        "INSERT INTO memberships(room_id,principal_id,role,joined_at) VALUES(?,?,'member',?)",
      ).run(input.roomId, actorId, this.context.now().toISOString());
      const event = this.context.events.append({
        actorId,
        aggregateId: actorId,
        aggregateType: "membership",
        idempotencyKey: input.idempotencyKey,
        roomId: input.roomId,
        type: "membership.added",
        payload: {
          basedOnRoomSeq: input.basedOnRoomSeq,
          participantId: actorId,
          role: "member",
          selfJoin: true,
        },
      });
      return {
        deduplicated: false,
        event,
        membership: this.#membership(input.roomId, actorId)!,
      };
    });
  }
  #membership(roomId: string, actorId: string) {
    const row = this.context.database
      .prepare("SELECT * FROM memberships WHERE room_id=? AND principal_id=?")
      .get(roomId, actorId);
    return row ? roomMembershipProjectionFromRow(row) : undefined;
  }
}
