import * as P from "@rah-os/protocol";

import type { AuthenticatedActorContext } from "./auth.ts";
import {
  requireRoomMember,
  requireRoomContentReader,
} from "./collaboration-policy.ts";
import { ForbiddenError } from "./errors.ts";
import { requireDiscoveryHuman } from "./global-discovery.ts";
import type { PersonalStateContext } from "./message-social.ts";
import { text } from "./sqlite-row.ts";

/**
 * Resolves product identities at click time. URLs only encode these targets;
 * this service rechecks current canonical existence and Human ACL.
 */
export class HumanNavigation {
  readonly #context: PersonalStateContext;

  constructor(context: PersonalStateContext) {
    this.#context = context;
  }

  resolve(
    auth: AuthenticatedActorContext,
    request: P.ClientNavigationResolveRequest,
  ): P.ClientNavigationResolveResponse {
    const actorId = this.#context.requireActor(auth);
    requireDiscoveryHuman(this.#context.database, actorId);
    const { target } = P.ClientNavigationResolveRequestSchema.parse(request);
    const db = this.#context.database;
    if (target.kind === "room") {
      requireRoomContentReader(db, target.roomId, actorId);
      this.#requireRow(
        "SELECT room_id FROM rooms WHERE room_id=?",
        target.roomId,
      );
      return { target };
    }
    if (
      target.kind === "message" ||
      target.kind === "thread" ||
      target.kind === "task" ||
      target.kind === "input_request" ||
      target.kind === "artifact"
    ) {
      if (target.kind === "message" || target.kind === "thread")
        requireRoomContentReader(db, target.roomId, actorId);
      else requireRoomMember(db, target.roomId, actorId);
    }
    if (target.kind === "message") {
      const row = this.#requireRow(
        `SELECT m.thread_id,th.root_message_id FROM messages m
         LEFT JOIN threads th ON th.thread_id=m.thread_id
         WHERE m.room_id=? AND m.message_id=?`,
        target.roomId,
        target.messageId,
      );
      const threadId =
        row.thread_id === null ? undefined : text(row, "thread_id");
      const rootMessageId =
        row.root_message_id === null ? undefined : text(row, "root_message_id");
      if (
        (target.threadId !== undefined && target.threadId !== threadId) ||
        (target.rootMessageId !== undefined &&
          target.rootMessageId !== rootMessageId)
      )
        throw new ForbiddenError("message target is stale or unavailable");
      return {
        target: {
          ...target,
          ...(threadId === undefined ? {} : { threadId }),
          ...(rootMessageId === undefined ? {} : { rootMessageId }),
        },
      };
    }
    if (target.kind === "thread") {
      const row = this.#requireRow(
        "SELECT root_message_id FROM threads WHERE room_id=? AND thread_id=?",
        target.roomId,
        target.threadId,
      );
      const rootMessageId = text(row, "root_message_id");
      if (
        target.rootMessageId !== undefined &&
        target.rootMessageId !== rootMessageId
      ) {
        throw new ForbiddenError("thread target is stale or unavailable");
      }
      return { target: { ...target, rootMessageId } };
    }
    if (target.kind === "task") {
      const row = this.#requireRow(
        "SELECT thread_id,source_message_id FROM tasks WHERE room_id=? AND task_id=?",
        target.roomId,
        target.taskId,
      );
      const threadId = text(row, "thread_id");
      const rootMessageId = text(row, "source_message_id");
      if (
        (target.threadId !== undefined && target.threadId !== threadId) ||
        (target.rootMessageId !== undefined &&
          target.rootMessageId !== rootMessageId)
      )
        throw new ForbiddenError("task target is stale or unavailable");
      return { target: { ...target, rootMessageId, threadId } };
    }
    if (target.kind === "input_request") {
      const row = this.#requireRow(
        "SELECT task_id,state FROM input_requests WHERE room_id=? AND input_request_id=?",
        target.roomId,
        target.inputRequestId,
      );
      const taskId = text(row, "task_id");
      if (
        text(row, "state") !== "pending" ||
        (target.taskId !== undefined && target.taskId !== taskId)
      )
        throw new ForbiddenError(
          "input request target is stale or unavailable",
        );
      return { target: { ...target, taskId } };
    }
    if (target.kind === "agent") {
      const row = this.#requireRow(
        "SELECT control_room_id FROM agent_definitions WHERE agent_definition_id=? AND state<>'tombstoned'",
        target.agentDefinitionId,
      );
      requireRoomMember(db, text(row, "control_room_id"), actorId);
      return { target };
    }
    if (target.kind === "computer") {
      this.#requireRow(
        "SELECT host_id FROM agent_hosts WHERE host_id=?",
        target.hostId,
      );
      return { target };
    }
    const row = db
      .prepare(
        `SELECT room_id FROM room_files WHERE room_id=? AND attachment_id=? AND state IN ('completed','consumed')
         UNION ALL
         SELECT t.room_id FROM task_submission_artifacts a JOIN tasks t ON t.task_id=a.task_id WHERE t.room_id=? AND a.attachment_id=?
         LIMIT 1`,
      )
      .get(target.roomId, target.artifactId, target.roomId, target.artifactId);
    if (!row) throw new ForbiddenError("artifact target is unavailable");
    return { target };
  }

  #requireRow(sql: string, ...parameters: string[]) {
    const row = this.#context.database.prepare(sql).get(...parameters);
    if (!row) throw new ForbiddenError("navigation target is unavailable");
    return row;
  }
}
