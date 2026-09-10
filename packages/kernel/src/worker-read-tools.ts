import { freshnessHoldContext } from "./freshness-hold-context.ts";
import type { WorkerProfileMetadataPort } from "./worker-profile-metadata-port.ts";
import { visibleWorkerProfile } from "./worker-visible-profile.ts";
import {
  resolveWorkerReadTarget,
  resolveWorkerMessageRoom,
  workerReadThread,
  workerRoomEntry,
  WORKER_VISIBLE_ROOMS,
  type WorkerDirectRoomOpener,
  type WorkerVisibleRoomScope,
} from "./worker-read-targets.ts";
import { boundRows } from "./bounded-read-rows.ts";
import {
  annotateTaskAnchoredMessage,
  annotateTaskAnchoredMessages,
} from "./task-anchor-annotation.ts";
import { recordWorkerTargetReadPosition } from "./worker-target-read-position.ts";
import { readTaskHistory } from "./task-history-projection.ts";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import * as P from "@rah-os/protocol";
import type { AuthenticatedWorkerExecutionContext } from "./auth.ts";
import {
  messageProjectionFromRow,
  roomProjectionFromRow,
} from "./collaboration-projection.ts";
import { ForbiddenError, NotFoundError } from "./errors.ts";
import { discoveryPage, GlobalDiscovery } from "./global-discovery.ts";
import { integer, nullableText, text, type Row } from "./sqlite-row.ts";
import { taskProjectionFromRow } from "./task-projection.ts";
import {
  requireWorkerRoomVisibility,
  requireWorkerTaskVisibility,
} from "./worker-task-scope.ts";

type ReadContext = {
  now?: () => Date;
  database: DatabaseSync;
  /** Present where a held action must render the newer context it withheld. */
  eventFromRow?: (row: Record<string, unknown>) => P.RoomEvent;
  /** Present only where Raft's `resolveChannel` may open a writable DM target. */
  openDirect?: WorkerDirectRoomOpener;
  requireWorker: (
    execution: AuthenticatedWorkerExecutionContext,
  ) => P.ActivationCredentialScope;
  transaction?: <T>(operation: () => T) => T;
};
const MESSAGE_ROWS = `SELECT m.*, e.room_seq AS event_order FROM discovery_messages m
  JOIN room_events e ON e.room_id=m.room_id AND e.room_seq=m.room_seq`;
const PROFILE_ROWS = `SELECT p.*, p.rowid AS principal_order,
  a.agent_definition_id, a.state AS agent_state,
  json_extract(r.definition_json,'$.displayName') AS agent_display_name,
  json_extract(r.definition_json,'$.description') AS agent_description,
  json_extract(r.definition_json,'$.avatarKey') AS agent_avatar_key FROM principals p
  JOIN memberships m ON m.principal_id=p.principal_id
  LEFT JOIN agent_definitions a ON a.participant_id=p.principal_id
  LEFT JOIN agent_definition_revisions r ON r.agent_definition_revision_id=a.current_revision_id`;

/** Read-only joined-Room facade. Reads neither acknowledge delivery nor grant mutation cursors. */
export class WorkerReadService {
  readonly #context: ReadContext;
  readonly #db: DatabaseSync;
  constructor(context: ReadContext) {
    this.#context = context;
    this.#db = context.database;
  }

  /**
   * The bounded newer-message context Raft renders when it holds an action.
   * Raft's Task claim, status update and amendment all hold this way and exit 0
   * (`dist-UT7IQEHX.js@2818799`, `@2828615`, `@2840513`): the mutation is not
   * applied and, unlike a send, no draft is saved. This deliberately does not
   * advance `worker_target_read_positions` — the send hold's advance cites a
   * specific upstream site in `handleMessageSend`, and whether Raft's server
   * advances a read position on a Task hold is not observable in the extracted
   * client, so it is left undecided rather than assumed symmetric.
   */
  freshnessHold(
    execution: AuthenticatedWorkerExecutionContext,
    input: { basedOnRoomSeq: number; seenUpToSeq: number },
  ): P.WorkerTaskHeldResponse {
    return this.#read(execution, (scope) => {
      const eventFromRow = this.#context.eventFromRow;
      if (eventFromRow === undefined)
        throw new Error("freshness hold rendering requires an event mapper");
      const context = freshnessHoldContext(this.#db, {
        basedOnRoomSeq: input.basedOnRoomSeq,
        eventFromRow,
        roomId: scope.roomId,
        seenUpToSeq: input.seenUpToSeq,
        threadId: "room",
      });
      // The Task fence blocks on a newer event about the Task as well as on a
      // newer message, so a hold can have nothing to show in the message
      // window. Count those events rather than rendering an empty notice that
      // says newer context exists and then shows none of it.
      const newerTaskEvents = integer(
        this.#db
          .prepare(
            `SELECT COUNT(*) AS count FROM room_events
             WHERE room_id = ? AND room_seq > ? AND room_seq <= ?
               AND aggregate_type = 'task'`,
          )
          .get(scope.roomId, input.basedOnRoomSeq, input.seenUpToSeq)!,
        "count",
      );
      return {
        basedOnRoomSeq: input.basedOnRoomSeq,
        ...context,
        newerTaskEventCount: newerTaskEvents,
        reason: "newer_messages_available" as const,
        seenUpToSeq: input.seenUpToSeq,
        state: "held" as const,
      };
    });
  }

  search(
    execution: AuthenticatedWorkerExecutionContext,
    raw: P.WorkerMessageSearchRequest,
  ): P.WorkerMessageSearchResponse {
    return this.#read(execution, (scope) =>
      new GlobalDiscovery(this.#db).searchRunMessages(scope, raw),
    );
  }
  rooms(
    execution: AuthenticatedWorkerExecutionContext,
    raw: P.WorkerRoomListRequest,
  ): P.WorkerRoomListResponse {
    return this.#read(execution, (scope) => {
      const input = P.WorkerRoomListRequestSchema.parse(raw);
      let page;
      try {
        page = discoveryPage(this.#db, "rooms", scope.participantId, {
          ...input,
          bindingVersion: "worker-joined-rooms-v1",
        });
      } catch {
        throw new ForbiddenError("invalid read cursor or changed query scope");
      }
      const rows = this.#db
        .prepare(
          `${WORKER_VISIBLE_ROOMS} WHERE membership.principal_id=? AND r.kind IN ('channel','direct')
        AND r.rowid<=? AND r.rowid<? ORDER BY r.rowid DESC LIMIT ?`,
        )
        .all(scope.participantId, page.ceiling, page.before, input.limit + 1);
      const visible = boundRows(
        rows.slice(0, input.limit),
        (row) => workerRoomEntry(this.#db, scope.participantId, row),
        "last",
      );
      return P.WorkerRoomListResponseSchema.parse({
        projection: "current",
        rooms: visible.map((row) =>
          workerRoomEntry(this.#db, scope.participantId, row),
        ),
        ...(rows.length > visible.length
          ? { nextCursor: page.next(integer(visible.at(-1)!, "room_order")) }
          : {}),
      });
    });
  }
  room(
    execution: AuthenticatedWorkerExecutionContext,
    raw: P.WorkerRoomResolveRequest,
  ): P.WorkerRoomResolveResponse {
    return this.#read(execution, (origin) => {
      const input = P.WorkerRoomResolveRequestSchema.parse(raw);
      const scope = resolveWorkerReadTarget(
        this.#db,
        origin,
        input.channel,
        this.#context.openDirect,
      );
      const row = this.#db
        .prepare(
          `${WORKER_VISIBLE_ROOMS} WHERE membership.principal_id=? AND r.room_id=?`,
        )
        .get(scope.participantId, scope.roomId)!;
      return P.WorkerRoomResolveResponseSchema.parse({
        ...workerRoomEntry(this.#db, scope.participantId, row),
        observedRoomSeq: integer(row, "next_seq") - 1,
        ...(scope.threadId ? { threadId: scope.threadId } : {}),
      });
    });
  }

  uploadCapabilities(
    execution: AuthenticatedWorkerExecutionContext,
    raw: P.WorkerAttachmentUploadCapabilitiesRequest,
  ): P.WorkerAttachmentUploadCapabilitiesResponse {
    return this.#read(execution, () => {
      P.WorkerAttachmentUploadCapabilitiesRequestSchema.parse(raw);
      return P.WorkerAttachmentUploadCapabilitiesResponseSchema.parse({
        directUploadEnabled: false,
        directUploadThresholdBytes: null,
        maxBytes: P.MAX_ATTACHMENT_BYTES,
        sessionExpiresInSeconds: P.ATTACHMENT_UPLOAD_SESSION_EXPIRES_IN_SECONDS,
      });
    });
  }

  history(
    execution: AuthenticatedWorkerExecutionContext,
    raw: P.WorkerHistoryRequest,
  ): P.WorkerHistoryResponse {
    return this.#read(execution, (origin) => {
      const parsed = P.WorkerHistoryRequestSchema.parse(raw);
      const scope = resolveWorkerReadTarget(this.#db, origin, parsed.channel);
      const input = {
        ...parsed,
        threadId: workerReadThread(scope, parsed.threadId),
      };
      const page = this.#page(scope, "room_events", "history", input);
      this.#requireThread(scope, input.threadId);
      const anchorId = input.before ?? input.after ?? input.around;
      const anchor =
        anchorId === undefined
          ? undefined
          : this.#message(scope, anchorId, page.ceiling);
      if (
        anchor &&
        input.threadId !== undefined &&
        (anchor.thread_id ?? null) !== input.threadId
      )
        throw new NotFoundError("message is unavailable in this Thread");
      const where = ["m.room_id=?", "e.room_seq<=?"];
      const args: SQLInputValue[] = [scope.roomId, page.ceiling];
      if (input.threadId !== undefined) {
        where.push("m.thread_id IS ?");
        args.push(input.threadId);
      }
      if (anchor && input.before !== undefined) {
        where.push("e.room_seq<?");
        args.push(integer(anchor, "event_order"));
      }
      if (anchor && input.after !== undefined) {
        where.push("e.room_seq>?");
        args.push(integer(anchor, "event_order"));
      }
      const select = (
        direction: "before" | "after",
        boundary: number,
        limit: number,
      ): Row[] =>
        this.#db
          .prepare(
            `${MESSAGE_ROWS} WHERE ${where.join(" AND ")} AND e.room_seq ${direction === "before" ? "<" : ">"} ?
          ORDER BY e.room_seq ${direction === "before" ? "DESC" : "ASC"} LIMIT ?`,
          )
          .all(...args, boundary, limit);
      let rows: Row[];
      let direction: "before" | "after" =
        input.after !== undefined ? "after" : "before";
      if (input.cursor !== undefined) {
        if (page.rank !== 0 && page.rank !== 1)
          throw new ForbiddenError("invalid history cursor direction");
        direction = page.rank === 1 ? "after" : "before";
        rows = select(direction, page.before, input.limit);
        if (direction === "before") rows.reverse();
      } else if (input.around !== undefined) {
        const order = integer(anchor!, "event_order");
        const olderCount = Math.floor((input.limit - 1) / 2);
        rows = [
          ...select("before", order, olderCount).reverse(),
          anchor!,
          ...select("after", order, input.limit - olderCount - 1),
        ];
      } else {
        const boundary = anchor
          ? integer(anchor, "event_order")
          : direction === "before"
            ? page.ceiling + 1
            : 0;
        rows = select(direction, boundary, input.limit);
        if (direction === "before") rows.reverse();
      }
      rows = boundRows(
        rows,
        messageProjectionFromRow,
        direction === "before" ? "first" : "last",
        input.cursor === undefined && input.around && anchor
          ? text(anchor, "message_id")
          : undefined,
      );
      const olderCursor =
        rows.length > 0 &&
        select("before", integer(rows[0]!, "event_order"), 1).length
          ? page.next(integer(rows[0]!, "event_order"), 0)
          : undefined;
      const newerCursor =
        rows.length > 0 &&
        select("after", integer(rows.at(-1)!, "event_order"), 1).length
          ? page.next(integer(rows.at(-1)!, "event_order"), 1)
          : undefined;
      const nextCursor = direction === "before" ? olderCursor : newerCursor;
      // Raft's `recordConsumedSeqs` runs on a read: the server now owns what it
      // last showed this participant for this target, so the Agent never has to
      // carry it back on a send. MAX() semantics mean an older page never
      // rewinds the position, and a Thread page never advances its Room.
      recordWorkerTargetReadPosition(this.#db, {
        participantId: scope.participantId,
        roomId: scope.roomId,
        ...(input.threadId === undefined || input.threadId === null
          ? {}
          : { threadId: input.threadId }),
        throughRoomSeq: rows.reduce(
          (highest, row) => Math.max(highest, integer(row, "event_order")),
          0,
        ),
        updatedAt: (this.#context.now?.() ?? new Date()).toISOString(),
      });
      return P.WorkerHistoryResponseSchema.parse({
        // Raft: "`raft message read` shows messages in their current state. If
        // a message was later converted to a task, it will show the
        // `[task #N ...]` suffix" (agent-prompt-compiler.js line 172).
        messages: annotateTaskAnchoredMessages(
          this.#db,
          rows.map(messageProjectionFromRow),
        ),
        frozenThroughRoomSeq: page.ceiling,
        ...(olderCursor ? { olderCursor } : {}),
        ...(newerCursor ? { newerCursor } : {}),
        ...(nextCursor ? { nextCursor } : {}),
      });
    });
  }

  resolve(
    execution: AuthenticatedWorkerExecutionContext,
    raw: P.WorkerMessageResolveRequest,
  ): P.WorkerMessageResolveResponse {
    return this.#read(execution, (origin) => {
      const input = P.WorkerMessageResolveRequestSchema.parse(raw);
      const scope =
        input.channel === undefined
          ? resolveWorkerMessageRoom(this.#db, origin, input.messageId)
          : resolveWorkerReadTarget(this.#db, origin, input.channel);
      const row = this.#message(scope, input.messageId);
      if (
        scope.threadId !== undefined &&
        row.thread_id !== scope.threadId &&
        !this.#db
          .prepare(
            "SELECT 1 FROM threads WHERE thread_id=? AND root_message_id=?",
          )
          .get(scope.threadId, row.message_id!)
      )
        throw new NotFoundError("message is unavailable in this Thread");
      const thread = this.#db
        .prepare(
          `SELECT * FROM threads WHERE room_id=? AND (thread_id=? OR root_message_id=?) LIMIT 1`,
        )
        .get(scope.roomId, row.thread_id ?? null, row.message_id!);
      return P.WorkerMessageResolveResponseSchema.parse({
        message: annotateTaskAnchoredMessage(
          this.#db,
          messageProjectionFromRow(row),
        ),
        ...(thread
          ? {
              threadId: thread.thread_id,
              rootMessage: annotateTaskAnchoredMessage(
                this.#db,
                messageProjectionFromRow(
                  this.#message(scope, text(thread, "root_message_id")),
                ),
              ),
            }
          : {}),
      });
    });
  }

  whoami(
    execution: AuthenticatedWorkerExecutionContext,
    raw: unknown,
  ): P.WorkerWhoamiResponse {
    P.WorkerIntrospectionRequestSchema.parse(raw);
    return this.#read(execution, (scope) => {
      requireWorkerRoomVisibility(this.#db, scope);
      return P.WorkerWhoamiResponseSchema.parse({
        authenticated: true,
        credentialKind: "activation",
        token: "[REDACTED]",
        ...scope,
      });
    });
  }
  members(
    execution: AuthenticatedWorkerExecutionContext,
    raw: P.WorkerMembersRequest,
    metadata?: WorkerProfileMetadataPort,
  ): P.WorkerMembersResponse {
    return this.#read(execution, (origin) => {
      const input = P.WorkerMembersRequestSchema.parse(raw);
      return this.#members(
        resolveWorkerReadTarget(this.#db, origin, input.channel),
        input,
        metadata,
      );
    });
  }
  serverInfo(
    execution: AuthenticatedWorkerExecutionContext,
    raw: P.WorkerMembersRequest,
    metadata?: WorkerProfileMetadataPort,
  ): P.WorkerServerInfoResponse {
    return this.#read(execution, (origin) => {
      const input = P.WorkerMembersRequestSchema.parse(raw);
      const scope = resolveWorkerReadTarget(this.#db, origin, input.channel);
      const row = this.#db
        .prepare(`${PROFILE_ROWS} WHERE m.room_id=? AND p.principal_id=?`)
        .get(scope.roomId, scope.participantId)!;
      const runtimeContext = visibleWorkerProfile(
        this.#db,
        scope,
        row,
        this.#context.now?.() ?? new Date(),
        metadata,
        { createdAgentsLimit: 1 },
      );
      const room = roomProjectionFromRow(
        this.#db
          .prepare(
            `${WORKER_VISIBLE_ROOMS} WHERE membership.principal_id=? AND r.room_id=?`,
          )
          .get(scope.participantId, scope.roomId)!,
      );
      const envelope = {
        scope:
          scope.roomId === origin.roomId ? "current_room" : "selected_room",
        selfParticipantId: scope.participantId,
        runtimeContext,
        room,
      };
      return P.WorkerServerInfoResponseSchema.parse({
        ...this.#members(
          scope,
          input,
          metadata,
          Buffer.byteLength(JSON.stringify(envelope)),
        ),
        ...envelope,
      });
    });
  }

  profile(
    execution: AuthenticatedWorkerExecutionContext,
    raw: P.WorkerProfileReadRequest,
    metadata?: WorkerProfileMetadataPort,
  ): P.WorkerVisibleProfile {
    return this.#read(execution, (origin) => {
      const parsed = P.WorkerProfileReadRequestSchema.parse(raw);
      const scope = resolveWorkerReadTarget(this.#db, origin, parsed.channel);
      const input = parsed;
      const target = input.target ?? scope.participantId;
      const rows = this.#db
        .prepare(
          `${PROFILE_ROWS} WHERE m.room_id=? AND p.kind IN ('human','agent')
        AND (p.principal_id=? OR p.handle=?) LIMIT 2`,
        )
        .all(scope.roomId, target, target.replace(/^@/u, ""));
      if (rows.length !== 1)
        throw new NotFoundError("profile is unavailable in this Room");
      return visibleWorkerProfile(
        this.#db,
        scope,
        rows[0]!,
        this.#context.now?.() ?? new Date(),
        metadata,
        input,
      );
    });
  }

  tasks(
    execution: AuthenticatedWorkerExecutionContext,
    raw: P.WorkerTaskListRequest,
  ): P.WorkerTaskListResponse {
    return this.#read(execution, (origin) => {
      const parsed = P.WorkerTaskListRequestSchema.parse(raw);
      const scope = resolveWorkerReadTarget(this.#db, origin, parsed.channel);
      const input = parsed;
      const page = this.#page(scope, "room_events", "task-list", input);
      const where = ["t.room_id=?", "e.room_seq<=?", "e.room_seq<?"];
      const args: SQLInputValue[] = [scope.roomId, page.ceiling, page.before];
      if (input.mine) {
        where.push("t.assignee_id=?");
        args.push(scope.participantId);
      }
      if (input.status !== undefined) {
        where.push("t.workflow_status=?");
        args.push(input.status);
      }
      const rows = this.#db
        .prepare(
          `SELECT t.*, e.room_seq AS task_order FROM tasks t JOIN room_events e
          ON e.room_id=t.room_id AND e.aggregate_id=t.task_id AND e.aggregate_type='task' AND e.type='task.created'
          WHERE ${where.join(" AND ")} ORDER BY e.room_seq DESC LIMIT ?`,
        )
        .all(...args, input.limit + 1);
      const visible = boundRows(
        rows.slice(0, input.limit),
        (row) => taskProjectionFromRow(this.#db, row),
        "last",
      );
      return P.WorkerTaskListResponseSchema.parse({
        projection: "current",
        tasks: visible.map((row) => taskProjectionFromRow(this.#db, row)),
        ...(rows.length > visible.length
          ? { nextCursor: page.next(integer(visible.at(-1)!, "task_order")) }
          : {}),
      });
    });
  }
  taskHistory(
    execution: AuthenticatedWorkerExecutionContext,
    raw: P.WorkerTaskHistoryRequest,
  ): P.WorkerTaskHistoryResponse {
    return this.#read(
      execution,
      (origin) => {
        const parsed = P.WorkerTaskHistoryRequestSchema.parse(raw);
        const scope = resolveWorkerReadTarget(this.#db, origin, parsed.channel);
        const input = parsed;
        requireWorkerTaskVisibility(this.#db, scope, input.taskId);
        return readTaskHistory(
          this.#db,
          scope.participantId,
          scope.roomId,
          input,
          `worker-read-v1:task-history:${scope.roomId}`,
        );
      },
      P.TASK_CARD_TRANSPORT_MAX_BYTES,
    );
  }

  #read<T>(
    execution: AuthenticatedWorkerExecutionContext,
    operation: (scope: P.ActivationCredentialScope) => T,
    maxBytes = 512 * 1024,
  ): T {
    const run = () => {
      const scope = this.#context.requireWorker(execution);
      requireWorkerRoomVisibility(this.#db, scope);
      const response = operation(scope);
      if (Buffer.byteLength(JSON.stringify(response), "utf8") > maxBytes)
        throw new ForbiddenError(
          "Worker read response exceeds the complete UTF-8 JSON limit",
        );
      return response;
    };
    return this.#context.transaction ? this.#context.transaction(run) : run();
  }
  #page(
    scope: WorkerVisibleRoomScope,
    table: "room_events" | "tasks" | "principals",
    kind: string,
    input: { cursor?: string | undefined; limit: number },
  ) {
    try {
      return discoveryPage(this.#db, table, scope.participantId, {
        ...input,
        bindingVersion: `worker-read-v1:${kind}:${scope.roomId}`,
        ...(table === "room_events" ? { sequenceRoomId: scope.roomId } : {}),
      });
    } catch {
      throw new ForbiddenError("invalid read cursor or changed query scope");
    }
  }
  #message(
    scope: WorkerVisibleRoomScope,
    id: string,
    ceiling = Number.MAX_SAFE_INTEGER,
  ): Row {
    const exact = this.#db
      .prepare(
        `${MESSAGE_ROWS} WHERE m.room_id=? AND m.message_id=? AND e.room_seq<=?`,
      )
      .get(scope.roomId, id, ceiling);
    if (exact) return exact;
    if (id.length >= 8) {
      const candidates = this.#db
        .prepare(
          `${MESSAGE_ROWS} WHERE m.room_id=? AND substr(m.message_id,1,length(?))=? AND e.room_seq<=? LIMIT 2`,
        )
        .all(scope.roomId, id, id, ceiling);
      if (candidates.length === 1) return candidates[0]!;
    }
    throw new NotFoundError("message is unavailable in this Room");
  }
  #requireThread(
    scope: WorkerVisibleRoomScope,
    threadId: string | null | undefined,
  ): void {
    if (
      typeof threadId === "string" &&
      !this.#db
        .prepare("SELECT 1 FROM threads WHERE room_id=? AND thread_id=?")
        .get(scope.roomId, threadId)
    )
      throw new NotFoundError("Thread is unavailable in this Room");
  }
  #members(
    scope: WorkerVisibleRoomScope,
    raw: P.WorkerMembersRequest,
    metadata?: WorkerProfileMetadataPort,
    envelopeBytes = 0,
  ): P.WorkerMembersResponse {
    const input = P.WorkerMembersRequestSchema.parse(raw);
    const page = this.#page(scope, "principals", "members", input);
    const rows = this.#db
      .prepare(
        `${PROFILE_ROWS} WHERE m.room_id=? AND p.kind IN ('human','agent') AND p.rowid<=? AND p.rowid<? ORDER BY p.rowid DESC LIMIT ?`,
      )
      .all(scope.roomId, page.ceiling, page.before, input.limit + 1);
    const visible = boundRows(
      rows.slice(0, input.limit),
      (row) => this.#profile(scope, row, metadata),
      "last",
    );
    const members = visible.map((row) => this.#profile(scope, row, metadata));
    let bytes =
      Buffer.byteLength(JSON.stringify(members)) + envelopeBytes + 4096;
    while (members.length > 1 && bytes > 512 * 1024) {
      bytes -= Buffer.byteLength(JSON.stringify(members.pop()!)) + 1;
      visible.pop();
    }
    if (bytes > 512 * 1024)
      throw new ForbiddenError(
        "one member plus runtime context exceeds the Worker read response limit",
      );
    return P.WorkerMembersResponseSchema.parse({
      roomId: scope.roomId,
      members,
      ...(rows.length > visible.length
        ? { nextCursor: page.next(integer(visible.at(-1)!, "principal_order")) }
        : {}),
    });
  }
  #profile(
    scope: WorkerVisibleRoomScope,
    row: Row,
    metadata?: WorkerProfileMetadataPort,
  ): P.WorkerVisibleProfile {
    return visibleWorkerProfile(
      this.#db,
      scope,
      row,
      this.#context.now?.() ?? new Date(),
      metadata,
    );
  }
}
