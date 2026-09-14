import { boundRows } from "./bounded-read-rows.ts";
import {
  resolveWorkerReadTarget,
  type WorkerVisibleRoomScope,
} from "./worker-read-targets.ts";
import { requireWorkerRoomVisibility } from "./worker-task-scope.ts";
import { createHash } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import {
  WorkerMessageSearchRequestSchema,
  type WorkerMessageSearchRequest,
  WorkerMessageSearchResponseSchema,
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
import {
  requireRoomMember,
  requireRoomContentReader,
  ROOM_CONTENT_READER_PREDICATE,
  roomRole,
} from "./collaboration-policy.ts";
import {
  messageProjectionFromRow,
  roomProjectionFromRow,
} from "./collaboration-projection.ts";
import { ForbiddenError } from "./errors.ts";
import { taskProjectionFromRow } from "./task-projection.ts";
import { integer, text } from "./sqlite-row.ts";

export const discoveryVisibleRooms = `r.workspace_id = ? AND r.kind <> 'control' AND r.archived_at IS NULL AND r.system_hidden=0
  AND EXISTS(SELECT 1 FROM workspaces w WHERE w.workspace_id = r.workspace_id AND w.state = 'active')
  AND EXISTS(SELECT 1 FROM memberships access WHERE access.room_id = r.room_id AND access.principal_id = ?)`;

// Content eligibility shared by Search and followed Thread Activity. Task reads retain membership.
export const discoveryReadableRooms = `r.workspace_id=? AND r.kind<>'control' AND r.archived_at IS NULL AND r.system_hidden=0
 AND EXISTS(SELECT 1 FROM workspaces w WHERE w.workspace_id=r.workspace_id AND w.state='active')
 AND ${ROOM_CONTENT_READER_PREDICATE}`;

type Cursor = {
  ceiling: number;
  before: number;
  rank: number;
  binding: string;
  roomSeqCeilings?: Array<[string, number]>;
};
const SEARCH_RANK_BINDING = "raft-token-or-v1";
const MAX_SEARCH_TERMS = 64;

function searchTerms(query: string) {
  const seen = new Set<string>();
  return query
    .trim()
    .split(/\s+/u)
    .map((term) => term.toLowerCase())
    .filter((term) => {
      if (!term || seen.has(term) || seen.size >= MAX_SEARCH_TERMS)
        return false;
      seen.add(term);
      return true;
    });
}

function messageSearchRank(
  query: string,
  terms: string[],
  sort?: "recent" | "relevance",
) {
  const relevance = Boolean(query) && sort !== "recent";
  return {
    rank: relevance
      ? `CASE WHEN rah_casefold(m.body) = ? THEN 0 WHEN instr(rah_casefold(m.body), ?) = 1 THEN 1 WHEN instr(rah_casefold(m.body), ?) > 0 THEN 2 ELSE 3 + (${terms.length} - (${terms.map(() => "CASE WHEN instr(rah_casefold(m.body), ?) > 0 THEN 1 ELSE 0 END").join(" + ")})) END`
      : "0",
    rankArgs: relevance ? [query, query, query, ...terms] : [],
  };
}

export function discoveryPage(
  db: DatabaseSync,
  table:
    | "messages"
    | "tasks"
    | "human_saved_messages"
    | "room_events"
    | "principals"
    | "rooms",
  actorId: string,
  input: {
    cursor?: string | undefined;
    limit?: number | undefined;
    bindingVersion?: string | undefined;
    sequenceRoomId?: string | undefined;
    sequenceRoomIds?: string[] | undefined;
  },
) {
  const { cursor, limit = 50, ...filters } = input;
  const binding = createHash("sha256")
    .update(JSON.stringify([actorId, table, filters]))
    .digest("hex");
  if (input.sequenceRoomId !== undefined && table !== "room_events")
    throw new Error("Room sequence paging requires the Room event owner");
  const roomSeqCeilings =
    input.sequenceRoomIds === undefined
      ? undefined
      : db
          .prepare(
            "SELECT room_id,next_seq-1 AS head FROM rooms WHERE room_id IN (SELECT value FROM json_each(?)) ORDER BY room_id",
          )
          .all(JSON.stringify(input.sequenceRoomIds))
          .map(
            (row) =>
              [text(row, "room_id"), integer(row, "head")] as [string, number],
          );
  const ceiling = Number(
    input.sequenceRoomId !== undefined
      ? db
          .prepare("SELECT next_seq-1 AS n FROM rooms WHERE room_id=?")
          .get(input.sequenceRoomId)!.n
      : db
          .prepare(
            table === "human_saved_messages"
              ? "SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name='human_saved_messages'),0) AS n"
              : `SELECT COALESCE(MAX(rowid), 0) AS n FROM ${table}`,
          )
          .get()!.n,
  );
  let state: Cursor = {
    ceiling,
    before: ceiling + 1,
    rank: 0,
    binding,
    ...(roomSeqCeilings ? { roomSeqCeilings } : {}),
  };
  if (cursor !== undefined) {
    try {
      state = JSON.parse(
        Buffer.from(cursor, "base64url").toString("utf8"),
      ) as Cursor;
      if (
        state.binding !== binding ||
        (roomSeqCeilings !== undefined &&
          (!Array.isArray(state.roomSeqCeilings) ||
            state.roomSeqCeilings.length !== roomSeqCeilings.length ||
            state.roomSeqCeilings.some(
              (pair, index) =>
                !Array.isArray(pair) ||
                pair.length !== 2 ||
                pair[0] !== roomSeqCeilings[index]![0] ||
                !Number.isSafeInteger(pair[1]) ||
                pair[1] < 0 ||
                pair[1] > roomSeqCeilings[index]![1],
            ))) ||
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
        canManageAnyTask: ["owner", "admin"].includes(
          roomRole(this.db, text(row, "room_id"), actorId),
        ),
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

  searchRunMessages(
    origin: WorkerVisibleRoomScope,
    request: WorkerMessageSearchRequest,
  ) {
    requireWorkerRoomVisibility(this.db, origin);
    const input = WorkerMessageSearchRequestSchema.parse(request);
    const scope =
      input.channel === undefined
        ? undefined
        : resolveWorkerReadTarget(this.db, origin, input.channel);
    const rooms = scope
      ? undefined
      : this.db
          .prepare(
            "SELECT r.room_id FROM rooms r JOIN memberships m ON m.room_id=r.room_id WHERE m.principal_id=? AND r.kind IN ('channel','direct') ORDER BY r.room_id LIMIT 501",
          )
          .all(origin.participantId)
          .map((row) => text(row, "room_id"));
    if (rooms && rooms.length > 500)
      throw new ForbiddenError(
        "global Worker search supports at most 500 joined Rooms; select a target",
      );
    let p: ReturnType<typeof discoveryPage>;
    try {
      p = discoveryPage(
        this.db,
        scope ? "room_events" : "messages",
        origin.participantId,
        {
          ...input,
          bindingVersion: scope
            ? `worker-search-current-v2:${scope.roomId}:${scope.threadId ?? "all"}`
            : "worker-search-joined-v1",
          ...(scope
            ? { sequenceRoomId: scope.roomId }
            : { sequenceRoomIds: rooms! }),
        },
      );
    } catch {
      throw new ForbiddenError("invalid search cursor or changed query scope");
    }
    const query = (input.query ?? "").toLowerCase(),
      terms = searchTerms(query);
    const where: string[] = [],
      args: SQLInputValue[] = [];
    if (scope) {
      where.push("m.room_id=?", "m.room_seq<=?");
      args.push(scope.roomId, p.ceiling);
    } else {
      const ceilings = p.roomSeqCeilings!;
      where.push(
        ceilings.length
          ? `(${ceilings.map(() => "(m.room_id=? AND m.room_seq<=?)").join(" OR ")})`
          : "0",
        "m.message_order<=?",
      );
      args.push(...ceilings.flat(), p.ceiling);
    }
    if (scope?.threadId !== undefined) {
      where.push("m.thread_id=?");
      args.push(scope.threadId);
    }
    if (terms.length) {
      where.push(
        `(${terms.map(() => "instr(rah_casefold(m.body), ?) > 0").join(" OR ")})`,
      );
      args.push(...terms);
    }
    if (input.senderId !== undefined) {
      where.push("m.actor_id=?");
      args.push(input.senderId);
    }
    if (input.sender !== undefined) {
      where.push("(m.actor_id=? OR sender.handle=?)");
      args.push(input.sender, input.sender.replace(/^@/u, ""));
    }
    if (input.after) {
      where.push("julianday(m.created_at) >= julianday(?)");
      args.push(input.after);
    }
    if (input.before) {
      where.push("julianday(m.created_at) <= julianday(?)");
      args.push(input.before);
    }
    const { rank, rankArgs } = messageSearchRank(query, terms, input.sort);
    const rows = this.db
      .prepare(
        `WITH hits AS (SELECT m.*, ${rank} AS rank FROM discovery_messages m
      JOIN principals sender ON sender.principal_id=m.actor_id WHERE ${where.join(" AND ")})
      SELECT * FROM hits WHERE (rank>? OR (rank=? AND ${scope ? "room_seq" : "message_order"}<?)) ORDER BY rank,${scope ? "room_seq" : "message_order"} DESC LIMIT ?`,
      )
      .all(...rankArgs, ...args, p.rank, p.rank, p.before, p.limit + 1);
    const page = boundRows(
      rows.slice(0, p.limit),
      messageProjectionFromRow,
      "last",
    );
    return WorkerMessageSearchResponseSchema.parse({
      messages: page.map(messageProjectionFromRow),
      ...(scope
        ? { frozenThroughRoomSeq: p.ceiling }
        : { frozenRoomCount: p.roomSeqCeilings!.length }),
      ...(rows.length > page.length
        ? {
            nextCursor: p.next(
              integer(page.at(-1)!, scope ? "room_seq" : "message_order"),
              integer(page.at(-1)!, "rank"),
            ),
          }
        : {}),
    });
  }
  search(actorId: string, request: WorkspaceSearchRequest) {
    requireDiscoveryHuman(this.db, actorId);
    const input = WorkspaceSearchRequestSchema.parse(request);
    const p = discoveryPage(this.db, "messages", actorId, {
      ...input,
      bindingVersion: SEARCH_RANK_BINDING,
    });
    const q = input.query.toLowerCase();
    const terms = searchTerms(q);
    const directory = this.directory(actorId, input.workspaceId, q);
    const filtered = Boolean(
      input.roomIds?.length ||
      input.threadIds?.length ||
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
      discoveryReadableRooms,
      "m.message_order <= ?",
      "m.room_seq IS NOT NULL",
    ];
    const args: SQLInputValue[] = [input.workspaceId, actorId, p.ceiling];
    if (terms.length) {
      where.push(
        `(${terms.map(() => "instr(rah_casefold(m.body), ?) > 0").join(" OR ")})`,
      );
      args.push(...terms);
    }
    if (terms.length === 1 && [...terms[0]!].length >= 3) {
      where.push(
        "m.message_order IN (SELECT rowid FROM message_search WHERE message_search MATCH ?)",
      );
      args.push(`"${terms[0]!.replaceAll('"', '""')}"`);
    }
    selectIds(where, args, "m.room_id", input.roomIds);
    selectIds(where, args, "m.thread_id", input.threadIds);
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
    // Raft's server ranker is not distributed. Preserve its observable full-term-before-partial
    // contract with a deterministic local exact/prefix/phrase/distinct-term rank.
    const { rank, rankArgs } = messageSearchRank(q, terms, input.sort);
    const rows = this.db
      .prepare(
        `WITH hits AS (SELECT m.*, r.name AS room_name, sender.handle AS sender_name, th.root_message_id, (SELECT substr(root.body, 1, 160) FROM messages root WHERE root.message_id = th.root_message_id AND root.room_id = m.room_id) AS root_preview, ${rank} AS rank ${from}) SELECT * FROM hits WHERE (rank > ? OR (rank = ? AND message_order < ?)) ORDER BY rank, message_order DESC LIMIT ?`,
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
          : {
              rootMessageId: row.root_message_id,
              ...(typeof row.root_preview === "string"
                ? { rootMessagePreview: row.root_preview.slice(0, 160) }
                : {}),
            }),
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
        `SELECT r.*, pair.left_principal_id, pair.right_principal_id FROM rooms r LEFT JOIN direct_room_pairs pair ON pair.room_id = r.room_id WHERE ${discoveryReadableRooms} AND instr(rah_casefold(r.name), ?) > 0 ORDER BY r.name LIMIT 100`,
      )
      .all(workspaceId, actorId, query)
      .map(roomProjectionFromRow);
    const principals = this.db
      .prepare(
        `SELECT DISTINCT p.principal_id AS principalId, p.handle, p.kind FROM principals p JOIN memberships peer ON peer.principal_id = p.principal_id JOIN rooms r ON r.room_id = peer.room_id WHERE r.workspace_id = ? AND r.archived_at IS NULL AND r.system_hidden=0 AND EXISTS(SELECT 1 FROM memberships access WHERE access.room_id = r.room_id AND access.principal_id = ?) AND p.kind IN ('human','agent') AND instr(rah_casefold(p.handle), ?) > 0 ORDER BY p.handle LIMIT 100`,
      )
      .all(workspaceId, actorId, query);
    return { rooms, principals };
  }

  context(actorId: string, request: MessageContextRequest) {
    requireDiscoveryHuman(this.db, actorId);
    const input = MessageContextRequestSchema.parse(request);
    if (input.roomId) requireRoomContentReader(this.db, input.roomId, actorId);
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
    requireRoomContentReader(this.db, text(row, "room_id"), actorId);
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
