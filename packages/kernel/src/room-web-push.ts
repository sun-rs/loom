import { identityDisplayName } from "./identity-display-name.ts";
import type { DatabaseSync } from "node:sqlite";

import {
  WebPushPayloadSchema,
  type RoomEvent,
  type WebPushPayload,
} from "@rah-os/protocol";

import type { RoomEventWriter } from "./room-event-writer.ts";
import { nullableText, text, type Row } from "./sqlite-row.ts";

export type RoomWebPushCandidate = {
  payload: WebPushPayload;
  principalId: string;
};

type HumanRow = Row & { handle: string; principal_id: string };
type PersonalPushPreferences = {
  muted: boolean;
  notifyAllMessages: boolean;
};

/**
 * Read-only projection from canonical Room events to transport hints. It owns
 * neither subscriptions nor delivery and never creates conversation truth.
 *
 * Raft's published client contract defaults to DMs, exact mentions, and
 * followed thread replies. RAH OS additionally offers a personal per-Room
 * opt-in for ordinary top-level messages. InputRequest and critical Task
 * lifecycle events are canonical work attention and bypass ordinary mute.
 */
export class RoomWebPushProjection {
  readonly #database: DatabaseSync;
  readonly #events: RoomEventWriter;

  constructor(input: { database: DatabaseSync; events: RoomEventWriter }) {
    this.#database = input.database;
    this.#events = input.events;
  }

  project(input: { roomId: string; roomSeq: number }): RoomWebPushCandidate[] {
    if (!Number.isSafeInteger(input.roomSeq) || input.roomSeq <= 0) return [];
    const eventRow = this.#database
      .prepare("SELECT * FROM room_events WHERE room_id = ? AND room_seq = ?")
      .get(input.roomId, input.roomSeq);
    if (!eventRow) return [];
    const event = this.#events.eventFromRow(eventRow);
    const room = this.#database
      .prepare("SELECT * FROM rooms WHERE room_id = ?")
      .get(input.roomId);
    if (!room || text(room, "kind") === "control") return [];
    const workspaceId = text(room, "workspace_id");
    const roomName = text(room, "name");
    const humans = (
      this.#database
        .prepare(
          `SELECT p.principal_id, p.handle FROM memberships m
         JOIN principals p ON p.principal_id = m.principal_id
         WHERE m.room_id = ? AND p.kind = 'human' AND p.principal_id <> ?
         ORDER BY p.principal_id`,
        )
        .all(input.roomId, event.actorId) as HumanRow[]
    ).filter(
      (human) =>
        !this.#workspaceMuted(text(human, "principal_id"), workspaceId),
    );
    const sender = this.#database
      .prepare("SELECT handle FROM principals WHERE principal_id = ?")
      .get(event.actorId);
    const senderName =
      identityDisplayName(this.#database, event.actorId) ??
      (sender ? text(sender, "handle") : "RAH OS");

    if (event.type === "message.posted") {
      return this.#messageCandidates({
        event,
        humans,
        room,
        roomName,
        senderName,
        workspaceId,
      });
    }
    if (event.type === "input.requested") {
      return this.#inputRequestCandidates({
        event,
        humans,
        roomName,
        senderName,
      });
    }
    if (event.type === "activation.retry_blocked") {
      return this.#activationRetryBlockedCandidates({
        event,
        humans,
        roomName,
      });
    }
    return this.#taskCandidates({ event, humans, roomName, senderName });
  }

  #activationRetryBlockedCandidates(input: {
    event: RoomEvent;
    humans: HumanRow[];
    roomName: string;
  }): RoomWebPushCandidate[] {
    const activation = this.#database
      .prepare(
        `SELECT activations.participant_id, principals.handle
         FROM activations
         JOIN principals ON principals.principal_id = activations.participant_id
         WHERE activations.activation_id = ?`,
      )
      .get(input.event.aggregateId);
    if (!activation) return [];
    const handle =
      identityDisplayName(this.#database, text(activation, "participant_id")) ??
      text(activation, "handle");
    const count =
      typeof input.event.payload.sameErrorCount === "number"
        ? String(input.event.payload.sameErrorCount)
        : "3";
    const error = this.#payloadText(input.event, "error") ?? "Runtime error";
    return input.humans.map((human) => {
      const principalId = text(human, "principal_id");
      return {
        principalId,
        payload: WebPushPayloadSchema.parse({
          version: 1,
          alwaysShow: true,
          notificationId: `${input.event.eventId}:${principalId}`,
          tag: `agent-runtime-fence:${text(activation, "participant_id")}`,
          title: `@${handle} 已停止自动重试`,
          body: `${input.roomName} · 同一 Runtime 错误连续 ${count} 次：${error}`.slice(
            0,
            1000,
          ),
          target: { kind: "room", roomId: input.event.roomId },
        }),
      };
    });
  }

  #messageCandidates(input: {
    event: RoomEvent;
    humans: HumanRow[];
    room: Row;
    roomName: string;
    senderName: string;
    workspaceId: string;
  }): RoomWebPushCandidate[] {
    const message = this.#database
      .prepare("SELECT * FROM messages WHERE message_id = ?")
      .get(input.event.aggregateId);
    if (!message) return [];
    const messageBody = text(message, "body");
    const forwardedBundleJson = nullableText(message, "forwarded_bundle_json");
    const forwardedCount =
      forwardedBundleJson === null
        ? 0
        : forwardedBundleItemCount(forwardedBundleJson);
    const body = (
      messageBody.trim().length > 0
        ? messageBody
        : `转发了 ${String(forwardedCount)} 条消息`
    ).slice(0, 1000);
    const threadId = nullableText(message, "thread_id") ?? undefined;
    const thread = threadId
      ? this.#database
          .prepare(
            "SELECT root_message_id, created_by FROM threads WHERE thread_id = ?",
          )
          .get(threadId)
      : undefined;
    return input.humans.flatMap((human) => {
      const principalId = text(human, "principal_id");
      const handle = text(human, "handle");
      const mentioned = Boolean(
        this.#database
          .prepare("SELECT rah_has_mention(?, ?) AS mentioned")
          .get(body, handle)?.mentioned,
      );
      const preferences = this.#preferences(
        principalId,
        input.workspaceId,
        input.event.roomId,
      );
      const threadEligible =
        threadId !== undefined &&
        thread !== undefined &&
        this.#threadEligible(principalId, threadId, thread);
      const ordinaryRoomEligible =
        threadId === undefined && preferences.notifyAllMessages;
      const eligible =
        mentioned ||
        (!preferences.muted &&
          (text(input.room, "kind") === "direct" ||
            threadEligible ||
            ordinaryRoomEligible));
      if (!eligible) return [];
      return [
        {
          principalId,
          payload: WebPushPayloadSchema.parse({
            version: 1,
            notificationId: `${input.event.eventId}:${principalId}`,
            tag: threadId ? `thread:${threadId}` : `room:${input.event.roomId}`,
            title: `${input.senderName} · ${input.roomName}`,
            body,
            target: {
              kind: "message",
              roomId: input.event.roomId,
              messageId: input.event.aggregateId,
              ...(threadId && thread
                ? {
                    threadId,
                    rootMessageId: text(thread, "root_message_id"),
                  }
                : {}),
            },
          }),
        },
      ];
    });
  }

  #inputRequestCandidates(input: {
    event: RoomEvent;
    humans: HumanRow[];
    roomName: string;
    senderName: string;
  }): RoomWebPushCandidate[] {
    const request = this.#database
      .prepare("SELECT * FROM input_requests WHERE input_request_id = ?")
      .get(input.event.aggregateId);
    if (!request) return [];
    const principalId = text(request, "responder_id");
    if (!input.humans.some((row) => text(row, "principal_id") === principalId))
      return [];
    return [
      {
        principalId,
        payload: WebPushPayloadSchema.parse({
          version: 1,
          notificationId: `${input.event.eventId}:${principalId}`,
          tag: `input-request:${input.event.aggregateId}`,
          title: `${input.senderName} 请求输入`,
          body: `${input.roomName} · ${text(request, "question")}`.slice(
            0,
            1000,
          ),
          target: {
            kind: "input_request",
            inputRequestId: input.event.aggregateId,
            roomId: input.event.roomId,
            taskId: text(request, "task_id"),
          },
        }),
      },
    ];
  }

  #taskCandidates(input: {
    event: RoomEvent;
    humans: HumanRow[];
    roomName: string;
    senderName: string;
  }): RoomWebPushCandidate[] {
    const taskId =
      input.event.type === "review.submitted"
        ? this.#payloadText(input.event, "taskId")
        : input.event.aggregateType === "task"
          ? input.event.aggregateId
          : undefined;
    if (!taskId) return [];
    const task = this.#database
      .prepare("SELECT * FROM tasks WHERE task_id = ?")
      .get(taskId);
    if (!task) return [];
    const disposition = this.#payloadText(input.event, "disposition");
    const presentation = (() => {
      switch (input.event.type) {
        case "task.submitted":
          return {
            title: `${input.senderName} 提交任务 #${String(task.task_number)}，待审核`,
            detail:
              this.#payloadText(input.event, "summary") ?? text(task, "title"),
          };
        case "task.blocked":
          return {
            title: `任务 #${String(task.task_number)} 已阻塞`,
            detail:
              this.#payloadText(input.event, "reason") ??
              nullableText(task, "blocked_reason") ??
              text(task, "title"),
          };
        case "task.completed":
          return {
            title: `任务 #${String(task.task_number)} 已完成`,
            detail: text(task, "title"),
          };
        case "task.cancelled":
          return {
            title: `任务 #${String(task.task_number)} 已取消`,
            detail:
              this.#payloadText(input.event, "reason") ??
              nullableText(task, "cancellation_reason") ??
              text(task, "title"),
          };
        case "task.reassigned":
          return {
            title: `任务 #${String(task.task_number)} 已改派`,
            detail:
              this.#payloadText(input.event, "reason") ?? text(task, "title"),
          };
        case "review.submitted":
          return disposition === "changes_requested"
            ? {
                title: `任务 #${String(task.task_number)} 要求修改`,
                detail:
                  this.#payloadText(input.event, "summary") ??
                  text(task, "title"),
              }
            : undefined;
        default:
          return undefined;
      }
    })();
    if (!presentation) return [];
    const threadId = text(task, "thread_id");
    const thread = this.#database
      .prepare(
        "SELECT root_message_id, created_by FROM threads WHERE thread_id = ?",
      )
      .get(threadId);
    const participantIds = new Set(
      this.#database
        .prepare(
          "SELECT participant_id FROM task_participants WHERE task_id = ?",
        )
        .all(taskId)
        .map((row) => text(row, "participant_id")),
    );
    return input.humans.flatMap((human) => {
      const principalId = text(human, "principal_id");
      const relevant =
        text(task, "creator_id") === principalId ||
        participantIds.has(principalId) ||
        (thread !== undefined &&
          this.#threadEligible(principalId, threadId, thread));
      if (!relevant) return [];
      return [
        {
          principalId,
          payload: WebPushPayloadSchema.parse({
            version: 1,
            notificationId: `${input.event.eventId}:${principalId}`,
            tag: `task:${taskId}`,
            title: presentation.title,
            body: `${input.roomName} · ${presentation.detail}`.slice(0, 1000),
            target: {
              kind: "task",
              roomId: input.event.roomId,
              taskId,
              threadId,
              ...(thread
                ? { rootMessageId: text(thread, "root_message_id") }
                : {}),
            },
          }),
        },
      ];
    });
  }

  #threadEligible(principalId: string, threadId: string, thread: Row) {
    const explicit = this.#database
      .prepare(
        "SELECT following FROM human_thread_follows WHERE principal_id = ? AND thread_id = ?",
      )
      .get(principalId, threadId);
    return (
      explicit?.following === 1 ||
      (explicit === undefined &&
        (text(thread, "created_by") === principalId ||
          this.#database
            .prepare(
              "SELECT 1 FROM messages WHERE thread_id = ? AND actor_id = ? LIMIT 1",
            )
            .get(threadId, principalId) !== undefined ||
          this.#database
            .prepare(
              "SELECT 1 FROM tasks WHERE thread_id = ? AND (assignee_id = ? OR creator_id = ?) LIMIT 1",
            )
            .get(threadId, principalId, principalId) !== undefined))
    );
  }

  #preferences(
    principalId: string,
    workspaceId: string,
    roomId: string,
  ): PersonalPushPreferences {
    const row = this.#database
      .prepare(
        "SELECT preferences_json FROM human_sidebar_preferences WHERE principal_id = ? AND workspace_id = ?",
      )
      .get(principalId, workspaceId);
    if (!row) return { muted: false, notifyAllMessages: false };
    try {
      const preferences = JSON.parse(text(row, "preferences_json")) as {
        mutedActivity?: unknown;
        mutedWorkspace?: unknown;
        notifyAllMessages?: unknown;
      };
      const key = `room:${roomId}`;
      return {
        muted:
          Array.isArray(preferences.mutedActivity) &&
          preferences.mutedActivity.includes(key),
        notifyAllMessages:
          Array.isArray(preferences.notifyAllMessages) &&
          preferences.notifyAllMessages.includes(key),
      };
    } catch {
      return { muted: false, notifyAllMessages: false };
    }
  }

  #workspaceMuted(principalId: string, workspaceId: string): boolean {
    const row = this.#database
      .prepare(
        "SELECT preferences_json FROM human_sidebar_preferences WHERE principal_id = ? AND workspace_id = ?",
      )
      .get(principalId, workspaceId);
    if (!row) return false;
    try {
      const preferences = JSON.parse(text(row, "preferences_json")) as {
        mutedWorkspace?: unknown;
      };
      return preferences.mutedWorkspace === true;
    } catch {
      return false;
    }
  }

  #payloadText(event: RoomEvent, key: string) {
    const value = event.payload[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }
}

function forwardedBundleItemCount(value: string): number {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "items" in parsed &&
      Array.isArray(parsed.items)
    ) {
      return parsed.items.length;
    }
  } catch {
    // A malformed canonical row is handled by its owning read path. Push stays bounded.
  }
  return 0;
}
