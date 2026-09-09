import type { DatabaseSync } from "node:sqlite";

import type { RoomEvent } from "@rah-os/protocol";

import { integer, text, type Row } from "./sqlite-row.ts";

/**
 * Raft's rendered Room shows a Task-anchored message with its Task number and
 * current status inline — `@Alice: Fix the login bug [task #3 status=in_progress]`
 * (agent-prompt-compiler.js line 166) — and tells the Agent that
 * `raft message read` shows that suffix on any message later converted to a
 * Task (line 172). RAH's Agent reads the same Room as JSON, so the suffix is
 * appended to the message body in the Agent-facing read paths only: the stored
 * Message row, the canonical event ledger and every Human-facing projection are
 * untouched.
 *
 * `workflow_status` is RAH's own status vocabulary
 * (`todo|in_progress|in_review|done|closed`), which already carries Raft's four
 * values plus `closed`.
 */
export function taskAnchorSuffix(
  taskNumber: number,
  workflowStatus: string,
): string {
  return `[task #${String(taskNumber)} status=${workflowStatus}]`;
}

const ANCHOR_PATTERN = /\[task #\d+ status=[a-z_]+\]$/u;

function appendSuffix(body: string, suffix: string): string {
  if (ANCHOR_PATTERN.test(body.trimEnd())) return body;
  return body.length === 0 ? suffix : `${body} ${suffix}`;
}

/** One bounded lookup for a whole page: `source_message_id` is unique. */
function anchorsForMessages(
  database: DatabaseSync,
  messageIds: readonly string[],
): Map<string, string> {
  const anchors = new Map<string, string>();
  const unique = [...new Set(messageIds)].filter((id) => id.length > 0);
  if (unique.length === 0) return anchors;
  const rows = database
    .prepare(
      `SELECT source_message_id, task_number, workflow_status FROM tasks
       WHERE source_message_id IN (${unique.map(() => "?").join(",")})`,
    )
    .all(...unique) as Row[];
  for (const row of rows) {
    anchors.set(
      text(row, "source_message_id"),
      taskAnchorSuffix(
        integer(row, "task_number"),
        text(row, "workflow_status"),
      ),
    );
  }
  return anchors;
}

export function annotateTaskAnchoredMessages<
  T extends { body: string; messageId: string },
>(database: DatabaseSync, messages: readonly T[]): T[] {
  const anchors = anchorsForMessages(
    database,
    messages.map((message) => message.messageId),
  );
  if (anchors.size === 0) return [...messages];
  return messages.map((message) => {
    const suffix = anchors.get(message.messageId);
    return suffix === undefined
      ? message
      : { ...message, body: appendSuffix(message.body, suffix) };
  });
}

export function annotateTaskAnchoredMessage<
  T extends { body: string; messageId: string },
>(database: DatabaseSync, message: T): T {
  return annotateTaskAnchoredMessages(database, [message])[0]!;
}

/** The same suffix on the `message.posted` events an Agent parses out of sync. */
export function annotateTaskAnchoredEvents(
  database: DatabaseSync,
  events: readonly RoomEvent[],
): RoomEvent[] {
  const posted = events.filter(
    (event) =>
      event.type === "message.posted" &&
      typeof (event.payload as { body?: unknown }).body === "string",
  );
  const anchors = anchorsForMessages(
    database,
    posted.map((event) => messageIdOf(event)),
  );
  if (anchors.size === 0) return [...events];
  return events.map((event) => {
    if (event.type !== "message.posted") return event;
    const body = (event.payload as { body?: unknown }).body;
    if (typeof body !== "string") return event;
    const suffix = anchors.get(messageIdOf(event));
    return suffix === undefined
      ? event
      : {
          ...event,
          payload: { ...event.payload, body: appendSuffix(body, suffix) },
        };
  });
}

function messageIdOf(event: RoomEvent): string {
  const messageId = (event.payload as { messageId?: unknown }).messageId;
  return typeof messageId === "string" && messageId.length > 0
    ? messageId
    : event.aggregateId;
}
