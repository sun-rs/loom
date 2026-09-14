import type { DatabaseSync } from "node:sqlite";
import { TaskWorkflowStatusSchema } from "@rah-os/protocol";
import { jsonObject, text, integer, type Row } from "./sqlite-row.ts";

// Canonical Task events only; no provider output or current Task state is used.
export function taskHistoryStatus(row: Row) {
  const payload = jsonObject(row, "payload_json");
  const explicit = TaskWorkflowStatusSchema.safeParse(payload.workflowStatus);
  if (explicit.success) return explicit.data;
  switch (text(row, "type")) {
    case "task.created":
      return payload.autoClaimed ? "in_progress" : "todo";
    case "task.reopened":
    case "task.released":
      return "todo";
    case "task.claimed":
    case "task.started":
    case "task.blocked":
    case "task.unblocked":
      return "in_progress";
    case "task.submitted":
      return "in_review";
    case "task.completed":
      return "done";
    case "task.cancelled":
      return "closed";
    default:
      return undefined;
  }
}

export function previousTaskHistoryStatus(database: DatabaseSync, row: Row) {
  const explicit = TaskWorkflowStatusSchema.safeParse(
    jsonObject(row, "payload_json").previousWorkflowStatus,
  );
  if (explicit.success) return explicit.data;
  const previous = database
    .prepare(
      `SELECT * FROM room_events
    WHERE room_id=? AND aggregate_type='task' AND aggregate_id=? AND room_seq<?
    AND (json_extract(payload_json,'$.workflowStatus') IS NOT NULL OR type IN
      ('task.created','task.reopened','task.released','task.claimed','task.started',
       'task.blocked','task.unblocked','task.submitted','task.completed','task.cancelled'))
    ORDER BY room_seq DESC LIMIT 1`,
    )
    .get(
      text(row, "room_id"),
      text(row, "aggregate_id"),
      integer(row, "room_seq"),
    ) as Row | undefined;
  return previous ? taskHistoryStatus(previous) : undefined;
}
