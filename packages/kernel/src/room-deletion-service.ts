import type { DatabaseSync } from "node:sqlite";

import {
  ClientRoomDeleteRequestSchema,
  ClientRoomDeleteResponseSchema,
  type ClientRoomDeleteRequest,
  type ClientRoomDeleteResponse,
} from "@rah-os/protocol";

import type { AuthenticatedActorContext } from "./auth.ts";
import { requireRoomManager } from "./collaboration-policy.ts";
import {
  ConflictError,
  ForbiddenError,
  IdempotencyConflictError,
  NotFoundError,
  StaleContextError,
} from "./errors.ts";
import type { RoomFiles } from "./room-files.ts";
import {
  assertPermanentChannelChange,
  assertNoActiveRoomWork,
} from "./room-lifecycle-policy.ts";
import { integer, text, type Row } from "./sqlite-row.ts";

/**
 * Ratchet derived from PRAGMA foreign_key_list after complete Kernel
 * initialization, plus FK-less tables carrying a room_id column (except the
 * deletion tombstone). A new table whose FK path reaches rooms, or that is
 * keyed by room_id, must be explicitly erased or protected by a kind invariant
 * before this set can change.
 */
export const ROOM_DELETION_REFERENCED_TABLES = new Set([
  "activation_cancellation_requests",
  "activation_delivery_windows",
  "activation_task_reads",
  "activation_obligations",
  "activation_presented_windows",
  "activation_retry_fences",
  "activations",
  "agent_definition_revisions",
  "agent_definitions",
  "agent_channel_attention",
  "agent_thread_follower_undo",
  "agent_thread_follows",
  "attachment_comment_links",
  "context_manifests",
  "direct_room_pairs",
  "execution_policies",
  "execution_policy_revisions",
  "held_message_drafts",
  "human_activity_frontiers",
  "human_saved_messages",
  "human_thread_follows",
  "inbox_items",
  "input_requests",
  "instance_wake_chain",
  "instance_wake_guards",
  "managed_mcp_assignment_revisions",
  "managed_mcp_assignments",
  "managed_mcp_calls",
  "managed_mcp_server_revisions",
  "managed_mcp_servers",
  "memberships",
  "memory_access_overrides",
  "memory_access_policies",
  "memory_entries",
  "memory_index_marks",
  "memory_revisions",
  "message_reactions",
  "messages",
  "outbox",
  "placement_capacity_reservations",
  "placements",
  "reminder_events",
  "reminder_fire_receipts",
  "reminders",
  "room_agent_sos_holds",
  "room_agent_sos_operations",
  "room_agent_sos_targets",
  "room_events",
  "role_instance_sessions",
  "role_instances",
  "role_revisions",
  "role_templates",
  "room_files",
  "rooms",
  "run_attempt_cli_costs",
  "run_attempt_final_replies",
  "worker_run_message_writes",
  "run_attempt_usage_aggregates",
  "run_attempt_usage",
  "run_attempt_usage_gaps",
  "runtime_process_cleanups",
  "run_attempts",
  "run_trajectory_entries",
  "runtime_processes",
  "subscription_cursors",
  "task_batch_command_receipts",
  "task_dependencies",
  "task_participants",
  "task_reassignment_operations",
  "task_reviews",
  "task_submission_artifacts",
  "task_submissions",
  "tasks",
  "threads",
  "worker_message_presentations",
  "worker_run_read_receipts",
  "worker_target_context_windows",
  "worker_target_read_positions",
  "worker_task_history_read_positions",
  "workspace_leases",
]);

const CONTROL_ROOM_ONLY_REFERENCES = [
  ["agent_definitions", "control_room_id"],
  ["role_templates", "control_room_id"],
  ["execution_policies", "control_room_id"],
  ["execution_policy_revisions", "control_room_id"],
  ["managed_mcp_servers", "control_room_id"],
] as const;

export class RoomDeletionService {
  readonly #createId: (prefix: string) => string;
  readonly #database: DatabaseSync;
  readonly #files: RoomFiles;
  readonly #now: () => Date;
  readonly #requireActor: (actor: AuthenticatedActorContext) => string;
  readonly #transaction: <T>(operation: () => T) => T;

  constructor(options: {
    createId: (prefix: string) => string;
    database: DatabaseSync;
    files: RoomFiles;
    now: () => Date;
    requireActor: (actor: AuthenticatedActorContext) => string;
    transaction: <T>(operation: () => T) => T;
  }) {
    this.#createId = options.createId;
    this.#database = options.database;
    this.#files = options.files;
    this.#now = options.now;
    this.#requireActor = options.requireActor;
    this.#transaction = options.transaction;
  }

  delete(
    actor: AuthenticatedActorContext,
    request: ClientRoomDeleteRequest,
  ): ClientRoomDeleteResponse {
    const input = ClientRoomDeleteRequestSchema.parse(request);
    const actorId = this.#requireActor(actor);
    const replay = this.#database
      .prepare(
        `SELECT * FROM room_deletion_receipts
         WHERE actor_id=? AND idempotency_key=?`,
      )
      .get(actorId, input.idempotencyKey);
    if (replay !== undefined) {
      this.#assertReplay(replay, input);
      this.#files.reclaimRoomDeletionBlobs(text(replay, "deletion_id"));
      return this.#response(replay, true);
    }

    const receipt = this.#transaction(() => {
      this.#database.exec("PRAGMA defer_foreign_keys = ON");
      const principal = this.#database
        .prepare("SELECT kind FROM principals WHERE principal_id=?")
        .get(actorId);
      if (principal === undefined || text(principal, "kind") !== "human") {
        throw new ForbiddenError(
          "only Human principals can permanently delete Channels",
        );
      }
      const room = this.#database
        .prepare("SELECT * FROM rooms WHERE room_id=?")
        .get(input.roomId);
      if (room === undefined) {
        throw new NotFoundError(`Room ${input.roomId} was not found`);
      }
      if (text(room, "kind") !== "channel") {
        throw new ConflictError(
          "only regular Channels can be permanently deleted",
        );
      }
      requireRoomManager(this.#database, input.roomId, actorId);
      assertPermanentChannelChange(room);
      if (
        this.#database
          .prepare("SELECT 1 FROM role_instances WHERE channel_id=? LIMIT 1")
          .get(input.roomId)
      ) {
        throw new ConflictError(
          "Channels with Role instances cannot be deleted in this MVP; archive the channel instead",
        );
      }
      const latestRoomSeq = integer(room, "next_seq") - 1;
      if (input.basedOnRoomSeq !== latestRoomSeq) {
        throw new StaleContextError(input.basedOnRoomSeq, latestRoomSeq);
      }
      assertNoActiveRoomWork(this.#database, input.roomId);
      this.#assertRegularChannelReferenceBoundary(input.roomId);

      const deletionId = this.#createId("room_deletion");
      const deletedAt = this.#now().toISOString();
      const attachments = this.#database
        .prepare(
          "SELECT attachment_id FROM room_files WHERE room_id=? ORDER BY attachment_id",
        )
        .all(input.roomId);
      this.#database
        .prepare(
          `INSERT INTO room_deletion_receipts(
             deletion_id,actor_id,workspace_id,room_id,room_name,room_slug,
             based_on_room_seq,idempotency_key,file_count,deleted_at
           ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          deletionId,
          actorId,
          text(room, "workspace_id"),
          input.roomId,
          text(room, "name"),
          text(room, "slug"),
          input.basedOnRoomSeq,
          input.idempotencyKey,
          attachments.length,
          deletedAt,
        );
      const insertGc = this.#database.prepare(
        `INSERT INTO room_file_gc_receipts(
           deletion_id,attachment_id,state,attempt_count,last_error,
           created_at,updated_at,next_attempt_at_ms
         ) VALUES(?,?,'pending',0,NULL,?,?,?)`,
      );
      for (const attachment of attachments) {
        insertGc.run(
          deletionId,
          text(attachment, "attachment_id"),
          deletedAt,
          deletedAt,
          Date.parse(deletedAt),
        );
      }

      this.#removeSidebarReferences(text(room, "workspace_id"), input.roomId);
      this.#eraseCanonicalGraph(input.roomId);
      this.#database
        .prepare("DELETE FROM rooms WHERE room_id=?")
        .run(input.roomId);
      const violations = this.#database
        .prepare("PRAGMA foreign_key_check")
        .all();
      if (violations.length > 0) {
        throw new ConflictError(
          `Room deletion left ${violations.length} foreign-key reference(s)`,
        );
      }
      return this.#database
        .prepare("SELECT * FROM room_deletion_receipts WHERE deletion_id=?")
        .get(deletionId)!;
    });

    this.#files.reclaimRoomDeletionBlobs(text(receipt, "deletion_id"));
    return this.#response(receipt, false);
  }

  #assertReplay(row: Row, input: ClientRoomDeleteRequest): void {
    if (
      text(row, "room_id") !== input.roomId ||
      integer(row, "based_on_room_seq") !== input.basedOnRoomSeq
    ) {
      throw new IdempotencyConflictError(
        `idempotency key ${input.idempotencyKey} was already used for another mutation`,
      );
    }
  }

  #assertRegularChannelReferenceBoundary(roomId: string): void {
    const directPair = this.#database
      .prepare("SELECT 1 AS present FROM direct_room_pairs WHERE room_id=?")
      .get(roomId);
    if (directPair !== undefined) {
      throw new ConflictError(
        `regular Channel ${roomId} unexpectedly owns a Direct Room pair`,
      );
    }
    for (const [table, column] of CONTROL_ROOM_ONLY_REFERENCES) {
      const row = this.#database
        .prepare(`SELECT 1 AS present FROM ${table} WHERE ${column}=? LIMIT 1`)
        .get(roomId);
      if (row !== undefined) {
        throw new ConflictError(
          `regular Channel ${roomId} unexpectedly owns ${table} control data`,
        );
      }
    }
  }

  #eraseCanonicalGraph(roomId: string): void {
    const statements = [
      `DELETE FROM reminder_events WHERE reminder_id IN
         (SELECT reminder_id FROM reminders WHERE room_id=? OR target_room_id=?)`,
      `DELETE FROM reminder_fire_receipts WHERE reminder_id IN
         (SELECT reminder_id FROM reminders WHERE room_id=? OR target_room_id=?)`,
      `DELETE FROM reminders WHERE room_id=? OR target_room_id=?`,
      `DELETE FROM room_agent_sos_targets WHERE operation_id IN
         (SELECT operation_id FROM room_agent_sos_operations WHERE room_id=?)`,
      `DELETE FROM room_agent_sos_holds WHERE room_id=?`,
      `DELETE FROM room_agent_sos_operations WHERE room_id=?`,
      `DELETE FROM message_reactions WHERE message_id IN
         (SELECT message_id FROM messages WHERE room_id=?)`,
      `DELETE FROM human_saved_messages WHERE message_id IN
         (SELECT message_id FROM messages WHERE room_id=?)`,
      `DELETE FROM message_forward_requests WHERE source_room_id=?`,
      `DELETE FROM human_thread_follows WHERE thread_id IN
         (SELECT thread_id FROM threads WHERE room_id=?)`,
      `DELETE FROM agent_thread_follower_undo WHERE thread_id IN
         (SELECT thread_id FROM threads WHERE room_id=?)`,
      `DELETE FROM agent_thread_follows WHERE thread_id IN
         (SELECT thread_id FROM threads WHERE room_id=?)`,
      `DELETE FROM task_submission_artifacts WHERE task_id IN
         (SELECT task_id FROM tasks WHERE room_id=?)`,
      `DELETE FROM task_reviews WHERE room_id=?`,
      `DELETE FROM activation_obligations WHERE room_id=?`,
      `DELETE FROM task_batch_command_receipts WHERE room_id=?`,
      `DELETE FROM task_submissions WHERE room_id=?`,
      `DELETE FROM task_dependencies WHERE task_id IN
         (SELECT task_id FROM tasks WHERE room_id=?)
         OR dependency_task_id IN (SELECT task_id FROM tasks WHERE room_id=?)`,
      `DELETE FROM task_participants WHERE task_id IN
         (SELECT task_id FROM tasks WHERE room_id=?)`,
      `DELETE FROM task_reassignment_operations WHERE room_id=?`,
      `DELETE FROM activation_cancellation_requests WHERE room_id=?`,
      `DELETE FROM input_requests WHERE room_id=?`,
      `DELETE FROM attachment_comment_links WHERE room_id=?`,
      `DELETE FROM room_files WHERE room_id=?`,
      `DELETE FROM held_message_drafts WHERE room_id=?`,
      `DELETE FROM worker_message_presentations WHERE room_id=?`,
      `DELETE FROM worker_run_read_receipts WHERE room_id=?`,
      `DELETE FROM worker_target_read_positions WHERE room_id=?`,
      `DELETE FROM worker_task_history_read_positions WHERE room_id=?`,
      `DELETE FROM worker_target_context_windows WHERE room_id=?`,
      `DELETE FROM managed_mcp_calls WHERE room_id=?`,
      `DELETE FROM context_manifests WHERE run_attempt_id IN
         (SELECT run_attempt_id FROM run_attempts WHERE room_id=?)`,
      `DELETE FROM run_attempt_usage_aggregates WHERE run_attempt_id IN
        (SELECT run_attempt_id FROM run_attempts WHERE room_id = ?)`,
      `DELETE FROM run_attempt_usage WHERE run_attempt_id IN
         (SELECT run_attempt_id FROM run_attempts WHERE room_id=?)`,
      `DELETE FROM run_attempt_usage_gaps WHERE run_attempt_id IN
         (SELECT run_attempt_id FROM run_attempts WHERE room_id=?)`,
      `DELETE FROM run_attempt_cli_costs WHERE run_attempt_id IN
         (SELECT run_attempt_id FROM run_attempts WHERE room_id=?)`,
      `DELETE FROM run_attempt_final_replies WHERE run_attempt_id IN
         (SELECT run_attempt_id FROM run_attempts WHERE room_id=?)`,
      `DELETE FROM runtime_process_cleanups WHERE run_attempt_id IN
         (SELECT run_attempt_id FROM run_attempts WHERE room_id=?)`,
      `DELETE FROM run_trajectory_entries WHERE room_id=?`,
      `DELETE FROM runtime_processes WHERE room_id=?`,
      `DELETE FROM placement_capacity_reservations WHERE placement_id IN
         (SELECT placement_id FROM placements WHERE room_id=?)`,
      `DELETE FROM workspace_leases WHERE placement_id IN
         (SELECT placement_id FROM placements WHERE room_id=?)`,
      `DELETE FROM run_attempts WHERE room_id=?`,
      `DELETE FROM placements WHERE room_id=?`,
      `DELETE FROM activation_retry_fences WHERE room_id=?`,
      `DELETE FROM activation_presented_windows WHERE activation_id IN
         (SELECT activation_id FROM activations WHERE room_id=?)`,
      `DELETE FROM activation_delivery_windows WHERE activation_id IN
         (SELECT activation_id FROM activations WHERE room_id=?)`,
      `DELETE FROM activation_task_reads WHERE activation_id IN
         (SELECT activation_id FROM activations WHERE room_id=?)`,
      `DELETE FROM activations WHERE room_id=?`,
      `DELETE FROM inbox_items WHERE room_id=?`,
      `DELETE FROM outbox WHERE room_id=?`,
      `DELETE FROM subscription_cursors WHERE room_id=?`,
      `DELETE FROM human_activity_frontiers WHERE room_id=?`,
      `DELETE FROM room_events WHERE room_id=?`,
      `DELETE FROM tasks WHERE room_id=?`,
      `DELETE FROM messages WHERE room_id=?`,
      `DELETE FROM threads WHERE room_id=?`,
      `DELETE FROM agent_channel_attention WHERE room_id=?`,
      `DELETE FROM instance_wake_chain WHERE room_id=?`,
      `DELETE FROM instance_wake_guards WHERE room_id=?`,
      `DELETE FROM memory_entries_fts WHERE entry_id IN
         (SELECT entry_id FROM memory_entries WHERE scope_room_id=?)`,
      `DELETE FROM memory_revisions WHERE entry_id IN
         (SELECT entry_id FROM memory_entries WHERE scope_room_id=?)`,
      `DELETE FROM memory_entries WHERE scope_room_id=?`,
      `DELETE FROM memory_access_overrides WHERE room_id=?`,
      `DELETE FROM memory_access_policies WHERE room_id=?`,
      `DELETE FROM memory_index_marks WHERE room_id=?`,
      `DELETE FROM memberships WHERE room_id=?`,
    ];
    for (const sql of statements) {
      const parameterCount = (sql.match(/\?/g) ?? []).length;
      this.#database.prepare(sql).run(...Array(parameterCount).fill(roomId));
    }
  }

  #removeSidebarReferences(workspaceId: string, roomId: string): void {
    const key = `room:${roomId}`;
    const rows = this.#database
      .prepare(
        `SELECT principal_id,preferences_json FROM human_sidebar_preferences
         WHERE workspace_id=?`,
      )
      .all(workspaceId);
    const fields = [
      "pinned",
      "channelOrder",
      "dmOrder",
      "mutedActivity",
      "notifyAllMessages",
      "expandedLongMessages",
    ] as const;
    for (const row of rows) {
      const preferences = JSON.parse(text(row, "preferences_json")) as Record<
        string,
        unknown
      >;
      let changed = false;
      for (const field of fields) {
        if (!Array.isArray(preferences[field])) continue;
        const next = (preferences[field] as unknown[]).filter(
          (value) => value !== key,
        );
        if (next.length !== (preferences[field] as unknown[]).length) {
          preferences[field] = next;
          changed = true;
        }
      }
      if (Array.isArray(preferences.customSections)) {
        preferences.customSections = preferences.customSections.map(
          (section: { items: string[] }) => {
            const items = section.items.filter((item) => item !== key);
            if (items.length !== section.items.length) changed = true;
            return { ...section, items };
          },
        );
      }
      if (!changed) continue;
      if (typeof preferences.version === "number") {
        preferences.version += 1;
      }
      this.#database
        .prepare(
          `UPDATE human_sidebar_preferences SET preferences_json=?
           WHERE principal_id=? AND workspace_id=?`,
        )
        .run(
          JSON.stringify(preferences),
          text(row, "principal_id"),
          workspaceId,
        );
    }
  }

  #response(row: Row, deduplicated: boolean): ClientRoomDeleteResponse {
    const deletionId = text(row, "deletion_id");
    return ClientRoomDeleteResponseSchema.parse({
      deduplicated,
      deletedAt: text(row, "deleted_at"),
      deletionId,
      fileGc: this.#files.roomDeletionGcSummary(deletionId),
      roomId: text(row, "room_id"),
      workspaceId: text(row, "workspace_id"),
    });
  }
}
