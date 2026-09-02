import type { DatabaseSync } from "node:sqlite";
import * as P from "@rah-os/protocol";
import type { AuthenticatedActorContext } from "./auth.ts";
import { requireRoomMember } from "./collaboration-policy.ts";
import { messageProjectionFromRow } from "./collaboration-projection.ts";
import {
  requireDiscoveryHuman,
  discoveryVisibleRooms,
  discoveryPage,
} from "./global-discovery.ts";
import { ForbiddenError, IdempotencyConflictError } from "./errors.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import { text, type Row } from "./sqlite-row.ts";

export type PersonalStateContext = {
  database: DatabaseSync;
  requireActor: (actor: AuthenticatedActorContext) => string;
  transaction: <T>(operation: () => T) => T;
  now: () => Date;
};

export function initializePersonalState(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS message_reactions(message_id TEXT NOT NULL REFERENCES messages(message_id), principal_id TEXT NOT NULL REFERENCES principals(principal_id),emoji TEXT NOT NULL,PRIMARY KEY(message_id,principal_id,emoji)) STRICT;
 CREATE TABLE IF NOT EXISTS human_saved_messages(save_order INTEGER PRIMARY KEY AUTOINCREMENT, principal_id TEXT NOT NULL REFERENCES principals(principal_id),message_id TEXT NOT NULL REFERENCES messages(message_id),saved_at TEXT NOT NULL,UNIQUE(principal_id,message_id)) STRICT;
 CREATE TABLE IF NOT EXISTS human_sidebar_preferences(principal_id TEXT NOT NULL REFERENCES principals(principal_id),workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),preferences_json TEXT NOT NULL,PRIMARY KEY(principal_id,workspace_id)) STRICT;
 CREATE TABLE IF NOT EXISTS human_notification_dismissals(dismiss_order INTEGER PRIMARY KEY AUTOINCREMENT,principal_id TEXT NOT NULL REFERENCES principals(principal_id),workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),notification_id TEXT NOT NULL,dismissed_at TEXT NOT NULL,UNIQUE(principal_id,workspace_id,notification_id)) STRICT;
 CREATE INDEX IF NOT EXISTS idx_human_notification_dismissals_scope ON human_notification_dismissals(principal_id,workspace_id,dismiss_order);
 CREATE TABLE IF NOT EXISTS personal_command_receipts(principal_id TEXT NOT NULL REFERENCES principals(principal_id),scope TEXT NOT NULL,request_key TEXT NOT NULL,request_json TEXT NOT NULL,PRIMARY KEY(principal_id,scope,request_key)) STRICT;`);
}
// Called inside the owner's transaction. A later retry cannot reverse newer work.
export function personalCommandReplay(
  db: DatabaseSync,
  actorId: string,
  scope: string,
  key: string,
  input: unknown,
) {
  const request = JSON.stringify(input);
  const old = db
    .prepare(
      "SELECT request_json FROM personal_command_receipts WHERE principal_id=? AND scope=? AND request_key=?",
    )
    .get(actorId, scope, key);
  if (old) {
    if (old.request_json !== request)
      throw new IdempotencyConflictError(
        "idempotency key already used for another intent",
      );
    return true;
  }
  db.prepare("INSERT INTO personal_command_receipts VALUES(?,?,?,?)").run(
    actorId,
    scope,
    key,
    request,
  );
  return false;
}
export class MessageSocial {
  private readonly context: PersonalStateContext & { events: RoomEventWriter };
  constructor(context: PersonalStateContext & { events: RoomEventWriter }) {
    this.context = context;
  }
  private actor(auth: AuthenticatedActorContext) {
    const id = this.context.requireActor(auth);
    requireDiscoveryHuman(this.context.database, id);
    return id;
  }
  private message(actorId: string, roomId: string, messageId: string): Row {
    const db = this.context.database;
    requireRoomMember(db, roomId, actorId);
    const row = db
      .prepare("SELECT * FROM messages WHERE message_id=? AND room_id=?")
      .get(messageId, roomId);
    if (!row) throw new ForbiddenError("message unavailable in this Room");
    return row;
  }
  private item(actorId: string, messageId: string) {
    const db = this.context.database;
    const groups = db
      .prepare(
        "SELECT emoji,COUNT(*) AS n,MAX(principal_id=?) AS mine FROM message_reactions WHERE message_id=? GROUP BY emoji ORDER BY emoji",
      )
      .all(actorId, messageId);
    return P.MessageSocialItemSchema.parse({
      messageId,
      version: Number(
        db
          .prepare(
            "SELECT COALESCE(MAX(room_seq),0) AS v FROM room_events WHERE room_id=(SELECT room_id FROM messages WHERE message_id=?) AND aggregate_type='message' AND aggregate_id=? AND type='message.reaction_changed'",
          )
          .get(messageId, messageId)!.v,
      ),
      saved: !!db
        .prepare(
          "SELECT 1 FROM human_saved_messages WHERE principal_id=? AND message_id=?",
        )
        .get(actorId, messageId),
      reactions: groups.map((row) => ({
        emoji: row.emoji,
        count: row.n,
        mine: row.mine === 1,
        actors: db
          .prepare(
            "SELECT p.principal_id,p.handle FROM message_reactions r JOIN principals p ON p.principal_id=r.principal_id WHERE r.message_id=? AND r.emoji=? ORDER BY (p.principal_id=?) DESC,p.handle,p.principal_id LIMIT 20",
          )
          .all(messageId, String(row.emoji), actorId)
          .map((p) => ({ principalId: p.principal_id, name: p.handle })),
      })),
    });
  }
  list(auth: AuthenticatedActorContext, request: P.MessageSocialRequest) {
    const actorId = this.actor(auth),
      input = P.MessageSocialRequestSchema.parse(request);
    return {
      items: [...new Set(input.messageIds)].map((id) => {
        this.message(actorId, input.roomId, id);
        return this.item(actorId, id);
      }),
    };
  }
  react(auth: AuthenticatedActorContext, request: P.MessageReactionRequest) {
    const actorId = this.actor(auth),
      input = P.MessageReactionRequestSchema.parse(request),
      { database: db } = this.context;
    return this.context.transaction(() => {
      this.message(actorId, input.roomId, input.messageId);
      if (
        personalCommandReplay(
          db,
          actorId,
          "reaction",
          input.idempotencyKey,
          input,
        )
      )
        return this.item(actorId, input.messageId);
      const head = Number(
        db
          .prepare("SELECT next_seq-1 AS head FROM rooms WHERE room_id=?")
          .get(input.roomId)!.head,
      );
      if (input.basedOnRoomSeq > head)
        throw new ForbiddenError("reaction frontier exceeds Room head");
      const present = !!db
        .prepare(
          "SELECT 1 FROM message_reactions WHERE message_id=? AND principal_id=? AND emoji=?",
        )
        .get(input.messageId, actorId, input.emoji);
      if (present !== input.active) {
        if (input.active)
          db.prepare("INSERT INTO message_reactions VALUES(?,?,?)").run(
            input.messageId,
            actorId,
            input.emoji,
          );
        else
          db.prepare(
            "DELETE FROM message_reactions WHERE message_id=? AND principal_id=? AND emoji=?",
          ).run(input.messageId, actorId, input.emoji);
        this.context.events.append({
          actorId,
          roomId: input.roomId,
          aggregateId: input.messageId,
          aggregateType: "message",
          type: "message.reaction_changed",
          idempotencyKey: `reaction:${actorId}:${input.idempotencyKey}`,
          payload: {
            messageId: input.messageId,
            emoji: input.emoji,
            active: input.active,
          },
        });
      }
      return this.item(actorId, input.messageId);
    });
  }
  save(auth: AuthenticatedActorContext, request: P.MessageSaveRequest) {
    const actorId = this.actor(auth),
      input = P.MessageSaveRequestSchema.parse(request),
      { database: db } = this.context;
    return this.context.transaction(() => {
      this.message(actorId, input.roomId, input.messageId);
      if (
        !personalCommandReplay(
          db,
          actorId,
          "saved",
          input.idempotencyKey,
          input,
        )
      ) {
        if (input.saved)
          db.prepare(
            "INSERT OR IGNORE INTO human_saved_messages(principal_id,message_id,saved_at) VALUES(?,?,?)",
          ).run(actorId, input.messageId, this.context.now().toISOString());
        else
          db.prepare(
            "DELETE FROM human_saved_messages WHERE principal_id=? AND message_id=?",
          ).run(actorId, input.messageId);
      }
      return this.item(actorId, input.messageId);
    });
  }
  saved(auth: AuthenticatedActorContext, request: P.SavedMessagesRequest) {
    const actorId = this.actor(auth),
      input = P.SavedMessagesRequestSchema.parse(request),
      { database: db } = this.context;
    const p = discoveryPage(db, "human_saved_messages", actorId, input);
    const base = `FROM human_saved_messages s JOIN discovery_messages m ON m.message_id=s.message_id JOIN rooms r ON r.room_id=m.room_id JOIN principals sender ON sender.principal_id=m.actor_id WHERE s.principal_id=? AND ${discoveryVisibleRooms} AND s.save_order<=?`;
    const baseArgs = [actorId, input.workspaceId, actorId, p.ceiling];
    const filters: string[] = [];
    const filterArgs: Array<string> = [];
    if (input.query) {
      filters.push("instr(rah_casefold(m.body), ?) > 0");
      filterArgs.push(input.query.toLowerCase());
    }
    if (input.channelId) {
      filters.push("m.room_id = ?");
      filterArgs.push(input.channelId);
    }
    const from = `${base}${filters.length ? ` AND ${filters.join(" AND ")}` : ""}`;
    const args = [...baseArgs, ...filterArgs];
    const ascending = input.sortDirection === "asc";
    const pageBoundary = ascending ? "s.save_order>?" : "s.save_order<?";
    const pagePosition = ascending ? p.rank : p.before;
    const order = ascending ? "ASC" : "DESC";
    const rows = db
      .prepare(
        `SELECT m.*,s.saved_at,s.save_order,r.name AS room_name,r.kind AS room_kind,sender.principal_id AS sender_principal_id,sender.handle AS sender_handle,sender.kind AS sender_kind,sender.display_name AS sender_display_name,sender.avatar_key AS sender_avatar_key,(SELECT root_message_id FROM threads WHERE thread_id=m.thread_id) AS root_message_id ${from} AND ${pageBoundary} ORDER BY s.save_order ${order} LIMIT ?`,
      )
      .all(...args, pagePosition, p.limit + 1);
    const taken = rows.slice(0, p.limit);
    return P.SavedMessagesResponseSchema.parse({
      total: Number(db.prepare(`SELECT COUNT(*) AS n ${from}`).get(...args)!.n),
      globalTotal: Number(
        db.prepare(`SELECT COUNT(*) AS n ${base}`).get(...baseArgs)!.n,
      ),
      items: taken.map((row) => ({
        message: messageProjectionFromRow(row),
        roomName: row.room_name,
        roomKind: row.room_kind,
        senderName: row.sender_display_name ?? row.sender_handle,
        sender: {
          principalId: row.sender_principal_id,
          handle: row.sender_handle,
          kind: row.sender_kind,
          ...(row.sender_display_name === null
            ? {}
            : { displayName: row.sender_display_name }),
          ...(row.sender_avatar_key === null
            ? {}
            : { avatarKey: row.sender_avatar_key }),
        },
        target: {
          kind: "message",
          roomId: row.room_id,
          messageId: row.message_id,
          ...(row.thread_id === null
            ? {}
            : {
                threadId: row.thread_id,
                rootMessageId: row.root_message_id,
              }),
        },
        savedAt: row.saved_at,
        ...(row.root_message_id ? { rootMessageId: row.root_message_id } : {}),
      })),
      ...(rows.length > p.limit
        ? {
            nextCursor: ascending
              ? p.next(p.before, Number(taken.at(-1)!.save_order))
              : p.next(Number(taken.at(-1)!.save_order)),
          }
        : {}),
    });
  }
}
