import { createHash } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import {
  GlobalTasksRequestSchema,
  GlobalTasksResponseSchema,
  WorkspaceSearchRequestSchema,
  WorkspaceSearchResponseSchema,
  MessageContextRequestSchema,
  MessageContextResponseSchema,
  type GlobalTasksRequest,
  type WorkspaceSearchRequest,
  type MessageContextRequest,
} from "@rah-os/protocol";
import { requireRoomMember } from "./collaboration-policy.ts";
import {
  messageProjectionFromRow,
  roomProjectionFromRow,
} from "./collaboration-projection.ts";
import { ForbiddenError } from "./errors.ts";
import { taskProjectionFromRow } from "./task-projection.ts";
import { integer, text } from "./sqlite-row.ts";

export const discoveryVisibleRooms = `r.workspace_id = ? AND r.kind <> 'control' AND r.archived_at IS NULL
  AND EXISTS(SELECT 1 FROM workspaces w WHERE w.workspace_id = r.workspace_id AND w.state = 'active')
  AND EXISTS(SELECT 1 FROM memberships access WHERE access.room_id = r.room_id AND access.principal_id = ?)`;

type Cursor = {
  ceiling: number;
  before: number;
  rank: number;
  binding: string;
};
export function discoveryPage(
  db: DatabaseSync,
  table: "messages" | "tasks" | "human_saved_messages",
  actorId: string,
  input: { cursor?: string | undefined; limit?: number | undefined },
) {
  const { cursor, limit = 50, ...filters } = input;
  const binding = createHash("sha256")
    .update(JSON.stringify([actorId, table, filters]))
    .digest("hex");
  const ceiling = Number(
    db
      .prepare(
        table === "human_saved_messages"
          ? "SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name='human_saved_messages'),0) AS n"
          : `SELECT COALESCE(MAX(rowid), 0) AS n FROM ${table}`,
      )
      .get()!.n,
  );
  let state: Cursor = { ceiling, before: ceiling + 1, rank: 0, binding };
  if (cursor !== undefined) {
    try {
      state = JSON.parse(
        Buffer.from(cursor, "base64url").toString("utf8"),
      ) as Cursor;
      if (
        state.binding !== binding ||
        !Number.isSafeInteger(state.ceiling) ||
        state.ceiling < 0 ||
        state.ceiling > ceiling ||
        !Number.isSafeInteger(state.before) ||
        state.before < 0 ||
        state.before > state.ceiling + 1 ||
        !Number.isSafeInteger(state.rank) ||
        state.rank < 0
      )
        throw new Error();
    } catch {
      throw new Error("invalid discovery cursor or changed query scope");
    }
  }
  return {
    ...state,
    limit,
    next(before: number, rank = 0) {
      return Buffer.from(JSON.stringify({ ...state, before, rank })).toString(
        "base64url",
      );
    },
  };
}

export function requireDiscoveryHuman(db: DatabaseSync, actorId: string) {
  if (
    db
      .prepare("SELECT kind FROM principals WHERE principal_id = ?")
      .get(actorId)?.kind !== "human"
  )
    throw new ForbiddenError("global discovery requires a Human principal");
}

function selectIds(
  where: string[],
  args: SQLInputValue[],
  field: string,
  ids: string[] | undefined,
) {
  if (!ids?.length) return;
  where.push(`${field} IN (${ids.map(() => "?").join(",")})`);
  args.push(...ids);
}

/** Kernel-owned aggregate queries, never browser-side Room history aggregation. */
export class GlobalDiscovery {
  readonly db: DatabaseSync;
  constructor(database: DatabaseSync) {
    this.db = database;
  }

  tasks(actorId: string, request: GlobalTasksRequest) {
    requireDiscoveryHuman(this.db, actorId);
    const input = GlobalTasksRequestSchema.parse(request);
    const p = discoveryPage(this.db, "tasks", actorId, input);
    const where = [discoveryVisibleRooms, "r.kind = 'channel'", "t.rowid <= ?"];
    const args: SQLInputValue[] = [input.workspaceId, actorId, p.ceiling];
    selectIds(where, args, "t.room_id", input.roomIds);
    selectIds(where, args, "t.creator_id", input.creatorIds);
    if (input.assigneeIds?.length || input.unassigned) {
      const choices: string[] = [];
      if (input.assigneeIds?.length) {
        choices.push(
          `t.assignee_id IN (${input.assigneeIds.map(() => "?").join(",")})`,
        );
        args.push(...input.assigneeIds);
      }
      if (input.unassigned) choices.push("t.assignee_id IS NULL");
      where.push(`(${choices.join(" OR ")})`);
    }
    const from = `FROM tasks t JOIN rooms r ON r.room_id = t.room_id WHERE ${where.join(" AND ")}`;
    const total = Number(
      this.db.prepare(`SELECT COUNT(*) AS n ${from}`).get(...args)!.n,
    );
    const rows = this.db
      .prepare(
        `SELECT t.*, t.rowid AS position, r.name AS room_name ${from} AND t.rowid < ? ORDER BY t.rowid DESC LIMIT ?`,
      )
      .all(...args, p.before, p.limit + 1);
    const taken = rows.slice(0, p.limit);
    return GlobalTasksResponseSchema.parse({
      total,
      tasks: taken.map((row) => ({
        task: taskProjectionFromRow(this.db, row),
        roomName: row.room_name,
        target: {
          kind: "task",
          roomId: row.room_id,
          rootMessageId: row.source_message_id,
          taskId: row.task_id,
          threadId: row.thread_id,
        },
      })),
      ...(rows.length > p.limit
        ? { nextCursor: p.next(integer(taken.at(-1)!, "position")) }
        : {}),
    });
  }

  search(actorId: string, request: WorkspaceSearchRequest) {
    requireDiscoveryHuman(this.db, actorId);
    const input = WorkspaceSearchRequestSchema.parse(request);
    const p = discoveryPage(this.db, "messages", actorId, input);
    const q = input.query.toLowerCase();
    const directory = this.directory(actorId, input.workspaceId, q);
    const filtered = Boolean(
      input.roomIds?.length ||
      input.senderIds?.length ||
      input.senderKind ||
      input.mentionSelf ||
      input.after ||
      input.before ||
      (input.scope && input.scope !== "all"),
    );
    if (!q && !filtered)
      return WorkspaceSearchResponseSchema.parse({
        hits: [],
        ...directory,
        total: 0,
      });
    const where = [
      discoveryVisibleRooms,
      "m.message_order <= ?",
      "instr(rah_casefold(m.body), ?) > 0",
      "m.room_seq IS NOT NULL",
    ];
    const args: SQLInputValue[] = [input.workspaceId, actorId, p.ceiling, q];
    if ([...q].length >= 3) {
      where.push(
        "m.message_order IN (SELECT rowid FROM message_search WHERE message_search MATCH ?)",
      );
      args.push(`"${q.replaceAll('"', '""')}"`);
    }
    selectIds(where, args, "m.room_id", input.roomIds);
    selectIds(where, args, "m.actor_id", input.senderIds);
    if (input.senderKind) {
      where.push("sender.kind = ?");
      args.push(input.senderKind);
    }
    if (input.mentionSelf) {
      where.push(
        "rah_has_mention(m.body, (SELECT handle FROM principals WHERE principal_id = ?)) = 1",
      );
      args.push(actorId);
    }
    if (input.scope === "channel" || input.scope === "direct") {
      where.push("r.kind = ?");
      args.push(input.scope);
    }
    if (input.scope === "thread") where.push("m.thread_id IS NOT NULL");
    if (input.after) {
      where.push("julianday(m.created_at) >= julianday(?)");
      args.push(input.after);
    }
    if (input.before) {
      where.push("julianday(m.created_at) <= julianday(?)");
      args.push(input.before);
    }
    const from = `FROM discovery_messages m JOIN rooms r ON r.room_id = m.room_id JOIN principals sender ON sender.principal_id = m.actor_id LEFT JOIN threads th ON th.thread_id = m.thread_id WHERE ${where.join(" AND ")}`;
    const total = Number(
      this.db.prepare(`SELECT COUNT(*) AS n ${from}`).get(...args)!.n,
    );
    // Raft's server ranker is not distributed. Local deterministic exact/prefix/substring rank.
    const relevance = Boolean(q) && input.sort !== "recent";
    const rank = relevance
      ? "CASE WHEN rah_casefold(m.body) = ? THEN 0 WHEN instr(rah_casefold(m.body), ?) = 1 THEN 1 ELSE 2 END"
      : "0";
    const rankArgs = relevance ? [q, q] : [];
    const rows = this.db
      .prepare(
        `WITH hits AS (SELECT m.*, r.name AS room_name, sender.handle AS sender_name, th.root_message_id, ${rank} AS rank ${from}) SELECT * FROM hits WHERE (rank > ? OR (rank = ? AND message_order < ?)) ORDER BY rank, message_order DESC LIMIT ?`,
      )
      .all(...rankArgs, ...args, p.rank, p.rank, p.before, p.limit + 1);
    const taken = rows.slice(0, p.limit);
    return WorkspaceSearchResponseSchema.parse({
      total,
      ...(filtered ? { rooms: [], principals: [] } : directory),
      hits: taken.map((row) => ({
        message: messageProjectionFromRow(row),
        roomName: row.room_name,
        senderName: row.sender_name,
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
        ...(row.root_message_id === null
          ? {}
          : { rootMessageId: row.root_message_id }),
      })),
      ...(rows.length > p.limit
        ? {
            nextCursor: p.next(
              integer(taken.at(-1)!, "message_order"),
              integer(taken.at(-1)!, "rank"),
            ),
          }
        : {}),
    });
  }

  private directory(actorId: string, workspaceId: string, query: string) {
    const rooms = this.db
      .prepare(
        `SELECT r.* FROM rooms r WHERE ${discoveryVisibleRooms} AND instr(rah_casefold(r.name), ?) > 0 ORDER BY r.name LIMIT 100`,
      )
      .all(workspaceId, actorId, query)
      .map(roomProjectionFromRow);
    const principals = this.db
      .prepare(
        `SELECT DISTINCT p.principal_id AS principalId, p.handle, p.kind FROM principals p JOIN memberships peer ON peer.principal_id = p.principal_id JOIN rooms r ON r.room_id = peer.room_id WHERE r.workspace_id = ? AND r.archived_at IS NULL AND EXISTS(SELECT 1 FROM memberships access WHERE access.room_id = r.room_id AND access.principal_id = ?) AND p.kind IN ('human','agent') AND instr(rah_casefold(p.handle), ?) > 0 ORDER BY p.handle LIMIT 100`,
      )
      .all(workspaceId, actorId, query);
    return { rooms, principals };
  }

  context(actorId: string, request: MessageContextRequest) {
    requireDiscoveryHuman(this.db, actorId);
    const input = MessageContextRequestSchema.parse(request);
    if (input.roomId) requireRoomMember(this.db, input.roomId, actorId);
    let row = this.db
      .prepare("SELECT * FROM discovery_messages WHERE message_id = ?")
      .get(input.messageId);
    if (row && input.roomId && row.room_id !== input.roomId)
      throw new ForbiddenError("message is unavailable");
    if (!row && input.roomId && input.messageId.length >= 8) {
      // Literal prefix, bounded to one authorized Room; ambiguity never picks an arbitrary message.
      const candidates = this.db
        .prepare(
          "SELECT * FROM discovery_messages WHERE room_id = ? AND substr(message_id, 1, length(?)) = ? LIMIT 2",
        )
        .all(input.roomId, input.messageId, input.messageId);
      if (candidates.length === 1) row = candidates[0];
    }
    if (!row) throw new ForbiddenError("message is unavailable");
    requireRoomMember(this.db, text(row, "room_id"), actorId);
    const message = messageProjectionFromRow(row);
    const args = [message.roomId, message.threadId ?? null, message.roomSeq];
    const before = this.db
      .prepare(
        "SELECT * FROM discovery_messages WHERE room_id = ? AND thread_id IS ? AND room_seq < ? ORDER BY room_seq DESC LIMIT 20",
      )
      .all(...args)
      .reverse();
    const after = this.db
      .prepare(
        "SELECT * FROM discovery_messages WHERE room_id = ? AND thread_id IS ? AND room_seq > ? ORDER BY room_seq LIMIT 20",
      )
      .all(...args);
    const ownedThread =
      message.threadId === undefined
        ? this.db
            .prepare(
              "SELECT thread_id FROM threads WHERE root_message_id = ? AND room_id = ?",
            )
            .get(message.messageId, message.roomId)
        : undefined;
    const root =
      message.threadId === undefined
        ? ownedThread
          ? row
          : undefined
        : this.db
            .prepare(
              "SELECT m.* FROM discovery_messages m JOIN threads th ON th.root_message_id = m.message_id WHERE th.thread_id = ?",
            )
            .get(message.threadId);
    return MessageContextResponseSchema.parse({
      message,
      messages: [...before, row, ...after].map(messageProjectionFromRow),
      ...(root
        ? {
            rootMessageId: root.message_id,
            rootMessage: messageProjectionFromRow(root),
          }
        : {}),
    });
  }
}
