import type { DatabaseSync } from "node:sqlite";
import * as P from "@rah-os/protocol";
import { discoveryPage } from "./global-discovery.ts";
import { integer, text, jsonObject, type Row } from "./sqlite-row.ts";
import { ForbiddenError } from "./errors.ts";

/** Shared canonical Task lifecycle projection. Callers must authenticate and authorize first. */
export function readTaskHistory(
  database: DatabaseSync,
  actorId: string,
  roomId: string,
  input: ReturnType<typeof P.WorkerTaskHistoryRequestSchema.parse>,
  bindingVersion: string,
): P.WorkerTaskHistoryResponse {
  const page = (() => {
    try {
      return discoveryPage(database, "room_events", actorId, {
        ...input,
        bindingVersion,
        sequenceRoomId: roomId,
      });
    } catch {
      throw new ForbiddenError("invalid read cursor or changed query scope");
    }
  })();
  const visible: Array<{ row: Row; entry: ReturnType<typeof historyEntry> }> =
    [];
  let bytes = 0,
    more = false;
  const rows = database
    .prepare(
      `SELECT *, room_seq AS event_order FROM room_events WHERE room_id=? AND room_seq<=? AND room_seq<?
    AND ((aggregate_type='task' AND aggregate_id=?)
      OR (type IN ('review.submitted','input.requested','input.resolved','input.cancelled','input.expired') AND json_extract(payload_json,'$.taskId')=?))
    ORDER BY room_seq DESC LIMIT ?`,
    )
    .iterate(
      roomId,
      page.ceiling,
      page.before,
      input.taskId,
      input.taskId,
      input.limit + 1,
    );
  for (const row of rows) {
    const entry = historyEntry(row),
      size = Buffer.byteLength(JSON.stringify(entry));
    if (size > P.TASK_HISTORY_ROW_MAX_BYTES)
      throw new ForbiddenError(
        "one Task history record exceeds its complete JSON limit",
      );
    if (
      visible.length === input.limit ||
      bytes + size > P.TASK_HISTORY_PAGE_MAX_BYTES
    ) {
      more = true;
      break;
    }
    visible.push({ row, entry });
    bytes += size;
  }
  return P.WorkerTaskHistoryResponseSchema.parse({
    taskId: input.taskId,
    frozenThroughRoomSeq: page.ceiling,
    events: visible.map(({ entry }) => entry),
    ...(more
      ? { nextCursor: page.next(integer(visible.at(-1)!.row, "event_order")) }
      : {}),
  });
}

function historyEntry(row: Row) {
  const payload = jsonObject(row, "payload_json");
  const entry: Record<string, unknown> = {
    eventId: text(row, "event_id"),
    roomSeq: integer(row, "room_seq"),
    type: text(row, "type"),
    actorId: text(row, "actor_id"),
    createdAt: text(row, "created_at"),
  };
  if (text(row, "type") === "task.amended") {
    const changes = P.TaskAmendChangesSchema.safeParse(payload.changes);
    if (changes.success) entry.changes = changes.data;
  }
  // Only canonical card fields: never return private answers, claim tokens or runtime metadata.
  for (const key of ["title", "summary", "progress"])
    if (typeof payload[key] === "string") entry[key] = payload[key];
  for (const key of ["description", "assigneeId"])
    if (typeof payload[key] === "string" || payload[key] === null)
      entry[key] = payload[key];
  if (P.TaskWorkflowStatusSchema.safeParse(payload.workflowStatus).success)
    entry.workflowStatus = payload.workflowStatus;
  if (
    payload.disposition === "approved" ||
    payload.disposition === "changes_requested"
  )
    entry.disposition = payload.disposition;
  return P.WorkerTaskHistoryEntrySchema.parse(entry);
}
