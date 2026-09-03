import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import {
  HumanActivityRequestSchema,
  HumanActivityResponseSchema,
  HumanActivityMarkRequestSchema,
  HumanThreadFollowerRemoveRequestSchema,
  HumanThreadFollowerRestoreRequestSchema,
  HumanThreadFollowersRequestSchema,
  HumanThreadFollowRequestSchema,
  type HumanActivityRequest,
  type HumanActivityMarkRequest,
  type HumanThreadFollowerRemoveRequest,
  type HumanThreadFollowerRestoreRequest,
  type HumanThreadFollowersRequest,
  type HumanThreadFollowRequest,
} from "@rah-os/protocol";
import {
  discoveryPage,
  discoveryVisibleRooms,
  requireDiscoveryHuman,
} from "./global-discovery.ts";
import {
  requireRoomManager,
  requireRoomMember,
  roomRole,
} from "./collaboration-policy.ts";
import { messageProjectionFromRow } from "./collaboration-projection.ts";
import { ForbiddenError } from "./errors.ts";
import { taskProjectionFromRow } from "./task-projection.ts";
import { integer, text } from "./sqlite-row.ts";

// Port of Raft Web Sa: an Activity identity is a conversation or a thread.
export function activityKey(roomId: string, kind: string, threadId?: string) {
  return threadId === undefined ? `${kind}:${roomId}` : `thread:${threadId}`;
}

export class HumanActivity {
  readonly db: DatabaseSync;
  constructor(database: DatabaseSync) {
    this.db = database;
  }
  list(actorId: string, request: HumanActivityRequest) {
    requireDiscoveryHuman(this.db, actorId);
    const input = HumanActivityRequestSchema.parse(request);
    const p = discoveryPage(this.db, "messages", actorId, input);
    const handle = String(
      this.db
        .prepare("SELECT handle FROM principals WHERE principal_id = ?")
        .get(actorId)!.handle,
    );
    const cte = `WITH muted_rooms AS MATERIALIZED (
      SELECT substr(pref.value, 6) AS room_id
      FROM human_sidebar_preferences sidebar,
        json_each(sidebar.preferences_json, '$.mutedActivity') pref
      WHERE sidebar.principal_id = ? AND sidebar.workspace_id = ?
        AND pref.value LIKE 'room:%'
    ), thread_access AS MATERIALIZED (
      SELECT th.thread_id FROM threads th JOIN rooms r ON r.room_id = th.room_id
      JOIN messages root ON root.message_id = th.root_message_id
      LEFT JOIN human_thread_follows follow ON follow.thread_id = th.thread_id AND follow.principal_id = ?
      LEFT JOIN human_activity_frontiers frontier ON frontier.room_id = th.room_id AND frontier.scope_id = th.thread_id AND frontier.principal_id = ?
      WHERE ${discoveryVisibleRooms} AND (
        COALESCE(follow.following,
          th.created_by = ? OR root.actor_id = ?
          OR EXISTS(SELECT 1 FROM messages mine WHERE mine.thread_id = th.thread_id AND mine.actor_id = ? AND mine.rowid <= ?)
          OR EXISTS(SELECT 1 FROM tasks t WHERE t.thread_id = th.thread_id AND t.assignee_id = ?)
        ) = 1 OR EXISTS(SELECT 1 FROM discovery_messages ping WHERE ping.thread_id = th.thread_id
          AND ping.message_order <= ? AND ping.room_seq > COALESCE(frontier.read_seq,0)
          AND ping.actor_id <> ? AND rah_has_mention(ping.body, ?) = 1)
      )
    ), eligible AS (
      SELECT m.*, r.name AS room_name, r.kind, COALESCE(m.thread_id,'') AS scope_id,
        COALESCE(f.read_seq,0) AS read_seq, COALESCE(f.done_seq,0) AS done_seq,
        rah_has_mention(m.body, ?) AS mentioned
      FROM discovery_messages m JOIN rooms r ON r.room_id = m.room_id
      LEFT JOIN human_activity_frontiers f ON f.room_id = m.room_id AND f.scope_id = COALESCE(m.thread_id,'') AND f.principal_id = ?
      WHERE ${discoveryVisibleRooms} AND m.message_order <= ? AND m.room_seq IS NOT NULL
        AND (m.thread_id IS NULL OR m.thread_id IN (SELECT thread_id FROM thread_access))
    ), grouped AS (
      SELECT room_id, scope_id, MAX(message_order) AS position, MAX(room_seq) AS latest_seq,
        SUM(CASE WHEN actor_id <> ? AND room_seq > read_seq THEN 1 ELSE 0 END) AS unread_count,
        MAX(CASE WHEN actor_id <> ? AND room_seq > read_seq THEN mentioned ELSE 0 END) AS has_mention,
        MAX(done_seq) AS done_seq,
        MAX(CASE WHEN room_id IN (SELECT room_id FROM muted_rooms) THEN 1 ELSE 0 END) AS muted
      FROM eligible GROUP BY room_id, scope_id
    ), visible AS (SELECT * FROM grouped WHERE latest_seq > done_seq
      AND (muted = 0 OR has_mention = 1)
      ${input.filter === "unread" ? "AND unread_count > 0" : input.filter === "mentions" ? "AND has_mention = 1" : ""})`;
    const eligibilityArguments = (ceiling: number): SQLInputValue[] => [
      actorId,
      input.workspaceId,
      actorId,
      actorId,
      input.workspaceId,
      actorId,
      actorId,
      actorId,
      actorId,
      ceiling,
      actorId,
      ceiling,
      actorId,
      handle,
      handle,
      actorId,
      input.workspaceId,
      actorId,
      ceiling,
      actorId,
      actorId,
    ];
    const args = eligibilityArguments(p.ceiling);
    // Cards page a frozen snapshot; navigation attention always uses the latest
    // frontier, still with exactly the same ACL/follow/read eligibility owner.
    const summaryArgs = eligibilityArguments(
      input.cursor
        ? discoveryPage(this.db, "messages", actorId, {}).ceiling
        : p.ceiling,
    );
    const total = Number(
      this.db.prepare(`${cte} SELECT COUNT(*) AS n FROM visible`).get(...args)!
        .n,
    );
    const rows = this.db
      .prepare(
        `${cte} SELECT g.*, m.*, sender.handle AS sender_name FROM visible g JOIN eligible m ON m.message_order = g.position JOIN principals sender ON sender.principal_id = m.actor_id WHERE g.position < ? ORDER BY g.position DESC LIMIT ?`,
      )
      .all(...args, p.before, p.limit + 1);
    const taken = rows.slice(0, p.limit);
    return HumanActivityResponseSchema.parse({
      total,
      // Same eligibility/read/done rules, evaluated before pagination and visible filters.
      summary: {
        unreadActivityCount: Number(
          this.db
            .prepare(
              `${cte} SELECT COUNT(*) AS n FROM grouped WHERE latest_seq > done_seq AND unread_count > 0 AND (muted = 0 OR has_mention = 1)`,
            )
            .get(...summaryArgs)!.n,
        ),
        rooms: this.db
          .prepare(
            `${cte} SELECT room_id, unread_count, has_mention FROM grouped WHERE scope_id = '' AND unread_count > 0 ORDER BY room_id`,
          )
          .all(...summaryArgs)
          .map((row) => ({
            roomId: row.room_id,
            unreadCount: Number(row.unread_count),
            hasMention: row.has_mention === 1,
          })),
      },
      items: taken.map((row) => {
        const roomId = text(row, "room_id");
        const threadId =
          row.thread_id === null ? undefined : text(row, "thread_id");
        const thread =
          threadId === undefined
            ? undefined
            : this.db
                .prepare(
                  "SELECT th.*, root.body AS title FROM threads th JOIN messages root ON root.message_id = th.root_message_id WHERE th.thread_id = ?",
                )
                .get(threadId);
        const task =
          threadId === undefined
            ? undefined
            : this.db
                .prepare("SELECT * FROM tasks WHERE thread_id = ?")
                .get(threadId);
        return {
          key: activityKey(roomId, text(row, "kind"), threadId),
          roomId,
          roomName: row.room_name,
          kind: threadId ? "thread" : row.kind,
          ...(thread
            ? { threadId, rootMessageId: thread.root_message_id }
            : {}),
          title: thread?.title ?? row.room_name,
          latestMessage: messageProjectionFromRow(row),
          senderName: row.sender_name,
          latestSeq: row.latest_seq,
          unreadCount: row.unread_count,
          hasMention: row.has_mention === 1,
          replyCount: thread?.reply_count ?? 0,
          target: task
            ? {
                kind: "task",
                roomId,
                taskId: text(task, "task_id"),
                threadId,
                rootMessageId: text(thread!, "root_message_id"),
              }
            : thread
              ? {
                  kind: "thread",
                  roomId,
                  threadId,
                  rootMessageId: text(thread, "root_message_id"),
                }
              : { kind: "room", roomId },
          ...(task ? { task: taskProjectionFromRow(this.db, task) } : {}),
        };
      }),
      ...(rows.length > p.limit
        ? { nextCursor: p.next(integer(taken.at(-1)!, "position")) }
        : {}),
    });
  }

  mark(actorId: string, request: HumanActivityMarkRequest) {
    requireDiscoveryHuman(this.db, actorId);
    const input = HumanActivityMarkRequestSchema.parse(request);
    this.requireScope(actorId, input.roomId, input.threadId);
    // Port of Raft markDone(throughActivitySeq): never substitute the newest server head.
    const scope = input.threadId ?? "";
    const max = Number(
      this.db
        .prepare(
          "SELECT COALESCE(MAX(room_seq),0) AS n FROM discovery_messages WHERE room_id = ? AND thread_id IS ?",
        )
        .get(input.roomId, input.threadId ?? null)!.n,
    );
    if (input.throughSeq > max)
      throw new Error("activity frontier exceeds visible message sequence");
    const restored = this.db
      .prepare(
        `INSERT INTO human_activity_frontiers(principal_id, room_id, scope_id, read_seq, done_seq) VALUES(?,?,?,?,?) ON CONFLICT(principal_id, room_id, scope_id) DO UPDATE SET read_seq = MAX(read_seq, excluded.read_seq), done_seq = MAX(done_seq, excluded.done_seq)`,
      )
      .run(
        actorId,
        input.roomId,
        scope,
        input.throughSeq,
        input.action === "done" ? input.throughSeq : 0,
      );
    const row = this.db
      .prepare(
        "SELECT * FROM human_activity_frontiers WHERE principal_id = ? AND room_id = ? AND scope_id = ?",
      )
      .get(actorId, input.roomId, scope)!;
    return {
      readThroughSeq: integer(row, "read_seq"),
      doneThroughSeq: integer(row, "done_seq"),
    };
  }
  follow(actorId: string, request: HumanThreadFollowRequest) {
    requireDiscoveryHuman(this.db, actorId);
    const input = HumanThreadFollowRequestSchema.parse(request);
    this.requireScope(actorId, input.roomId, input.threadId);
    this.db
      .prepare(
        "INSERT INTO human_thread_follows(principal_id, thread_id, following) VALUES(?,?,?) ON CONFLICT(principal_id, thread_id) DO UPDATE SET following = excluded.following",
      )
      .run(actorId, input.threadId, Number(input.following));
    return { following: input.following };
  }
  followers(actorId: string, request: HumanThreadFollowersRequest) {
    requireDiscoveryHuman(this.db, actorId);
    const input = HumanThreadFollowersRequestSchema.parse(request);
    this.requireScope(actorId, input.roomId, input.threadId);
    const explicit = this.db
      .prepare(
        "SELECT following FROM human_thread_follows WHERE principal_id = ? AND thread_id = ?",
      )
      .get(actorId, input.threadId);
    const implicit = this.db
      .prepare(
        `SELECT 1
         FROM threads
         JOIN messages AS root ON root.message_id = threads.root_message_id
         WHERE threads.thread_id = ?
           AND (threads.created_by = ? OR root.actor_id = ? OR EXISTS(
             SELECT 1 FROM messages AS reply
             WHERE reply.thread_id = threads.thread_id AND reply.actor_id = ?
           ))`,
      )
      .get(input.threadId, actorId, actorId, actorId);
    return {
      agentParticipantIds: this.db
        .prepare(
          `SELECT follows.participant_id
           FROM agent_thread_follows AS follows
           JOIN threads ON threads.thread_id = follows.thread_id
           JOIN memberships
             ON memberships.room_id = threads.room_id
            AND memberships.principal_id = follows.participant_id
           JOIN principals
             ON principals.principal_id = follows.participant_id
           LEFT JOIN agent_definitions
             ON agent_definitions.participant_id = follows.participant_id
           WHERE follows.thread_id = ?
             AND follows.following = 1
             AND principals.kind = 'agent'
             AND (agent_definitions.state IS NULL OR agent_definitions.state = 'enabled')
           ORDER BY COALESCE(principals.display_name, principals.handle), follows.participant_id`,
        )
        .all(input.threadId)
        .map((row) => text(row, "participant_id")),
      canManage: ["owner", "admin"].includes(
        roomRole(this.db, input.roomId, actorId),
      ),
      following:
        explicit === undefined
          ? implicit !== undefined
          : explicit.following === 1,
    };
  }
  removeAgentFollower(
    actorId: string,
    request: HumanThreadFollowerRemoveRequest,
    operation: { undoExpiresAt: string; undoToken: string; updatedAt: string },
  ) {
    requireDiscoveryHuman(this.db, actorId);
    const input = HumanThreadFollowerRemoveRequestSchema.parse(request);
    this.requireScope(actorId, input.roomId, input.threadId);
    requireRoomManager(this.db, input.roomId, actorId);
    this.db
      .prepare("DELETE FROM agent_thread_follower_undo WHERE expires_at <= ?")
      .run(operation.updatedAt);
    const previous = this.db
      .prepare(
        `SELECT source FROM agent_thread_follows
         WHERE thread_id = ? AND participant_id = ? AND following = 1`,
      )
      .get(input.threadId, input.participantId);
    if (previous === undefined) return { removed: false as const };
    const result = this.db
      .prepare(
        `UPDATE agent_thread_follows
         SET following = 0, source = 'explicit_unfollow', updated_at = ?
         WHERE thread_id = ? AND participant_id = ? AND following = 1`,
      )
      .run(operation.updatedAt, input.threadId, input.participantId);
    if (result.changes !== 1) return { removed: false as const };
    this.db
      .prepare(
        `INSERT INTO agent_thread_follower_undo(
           undo_token, actor_id, participant_id, thread_id,
           previous_source, expires_at, created_at
         ) VALUES(?,?,?,?,?,?,?)`,
      )
      .run(
        operation.undoToken,
        actorId,
        input.participantId,
        input.threadId,
        text(previous, "source"),
        operation.undoExpiresAt,
        operation.updatedAt,
      );
    return {
      removed: true as const,
      undoExpiresAt: operation.undoExpiresAt,
      undoToken: operation.undoToken,
    };
  }
  restoreAgentFollower(
    actorId: string,
    request: HumanThreadFollowerRestoreRequest,
    updatedAt: string,
  ) {
    requireDiscoveryHuman(this.db, actorId);
    const input = HumanThreadFollowerRestoreRequestSchema.parse(request);
    this.requireScope(actorId, input.roomId, input.threadId);
    requireRoomManager(this.db, input.roomId, actorId);
    const undo = this.db
      .prepare(
        `SELECT previous_source FROM agent_thread_follower_undo
         WHERE undo_token = ? AND actor_id = ? AND participant_id = ?
           AND thread_id = ? AND expires_at > ?`,
      )
      .get(
        input.undoToken,
        actorId,
        input.participantId,
        input.threadId,
        updatedAt,
      );
    if (undo === undefined) return { restored: false };
    const eligible = this.db
      .prepare(
        `SELECT 1 FROM threads
         JOIN memberships
           ON memberships.room_id = threads.room_id
          AND memberships.principal_id = ?
         JOIN principals ON principals.principal_id = memberships.principal_id
         LEFT JOIN agent_definitions
           ON agent_definitions.participant_id = principals.principal_id
         WHERE threads.thread_id = ? AND threads.room_id = ?
           AND principals.kind = 'agent'
           AND (agent_definitions.state IS NULL OR agent_definitions.state = 'enabled')`,
      )
      .get(input.participantId, input.threadId, input.roomId);
    if (eligible === undefined) return { restored: false };
    const restored = this.db
      .prepare(
        `UPDATE agent_thread_follows SET following = 1, source = ?, updated_at = ?
         WHERE thread_id = ? AND participant_id = ? AND following = 0`,
      )
      .run(
        text(undo, "previous_source"),
        updatedAt,
        input.threadId,
        input.participantId,
      );
    this.db
      .prepare("DELETE FROM agent_thread_follower_undo WHERE undo_token = ?")
      .run(input.undoToken);
    return { restored: restored.changes === 1 };
  }
  private requireScope(actorId: string, roomId: string, threadId?: string) {
    requireRoomMember(this.db, roomId, actorId);
    if (
      threadId !== undefined &&
      !this.db
        .prepare("SELECT 1 FROM threads WHERE room_id = ? AND thread_id = ?")
        .get(roomId, threadId)
    )
      throw new ForbiddenError("thread is unavailable in this Room");
  }
}
