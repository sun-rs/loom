import type { DatabaseSync } from "node:sqlite";
import {
  ClientRoomTimelineRequestSchema,
  ClientRoomTimelineResponseSchema,
  type ClientRoomTimelineRequest,
  type RoomTimelineItem,
} from "@rah-os/protocol";
import { requireRoomMember } from "./collaboration-policy.ts";
import { requireDiscoveryHuman } from "./global-discovery.ts";
import { roomTimelineNoticeSql } from "./human-activity-notices.ts";
import { messageProjectionFromRow } from "./collaboration-projection.ts";
import { identityDisplayName } from "./identity-display-name.ts";
import { text, integer } from "./sqlite-row.ts";

/** One ordered read projection shared with unread eligibility. No writes, ACKs or worker deliveries. */
export function readRoomTimeline(
  db: DatabaseSync,
  actorId: string,
  request: ClientRoomTimelineRequest,
) {
  requireDiscoveryHuman(db, actorId);
  const input = ClientRoomTimelineRequestSchema.parse(request);
  requireRoomMember(db, input.roomId, actorId);
  const cte = `WITH timeline AS (
    SELECT 'message' AS kind, message_id AS id, room_seq FROM discovery_messages
      WHERE room_id = ? AND thread_id IS NULL
    UNION ALL
    SELECT 'notice' AS kind, event_id AS id, room_seq FROM room_events e
      WHERE e.room_id = ? AND ${roomTimelineNoticeSql}
  )`;
  const before = input.beforeSeq;
  const after = input.afterSeq;
  const descending = after === undefined;
  const boundary =
    before !== undefined
      ? "WHERE room_seq < ?"
      : after !== undefined
        ? "WHERE room_seq > ?"
        : "";
  const rows = db
    .prepare(
      `${cte} SELECT * FROM timeline ${boundary} ORDER BY room_seq ${descending ? "DESC" : "ASC"} LIMIT ?`,
    )
    .all(
      input.roomId,
      input.roomId,
      ...(before !== undefined ? [before] : after !== undefined ? [after] : []),
      input.limit,
    );
  if (descending) rows.reverse();
  const items: RoomTimelineItem[] = rows.map((row) => {
    if (row.kind === "message") {
      const message = db
        .prepare(
          "SELECT * FROM discovery_messages WHERE room_id=? AND message_id=?",
        )
        .get(input.roomId, text(row, "id"))!;
      return { kind: "message", message: messageProjectionFromRow(message) };
    }
    const event = db
      .prepare("SELECT * FROM room_events WHERE room_id=? AND event_id=?")
      .get(input.roomId, text(row, "id"))!;
    const payload = JSON.parse(text(event, "payload_json"));
    const type = text(event, "type") as
      "membership.added" | "room.unarchived" | "reminder.fired";
    const label =
      type === "membership.added"
        ? `${identityDisplayName(db, payload.participantId) ?? "已离开的成员"} 加入了频道`
        : type === "room.unarchived"
          ? "频道已恢复"
          : `提醒：${payload.title}`;
    return {
      kind: "notice",
      notice: {
        eventId: text(event, "event_id"),
        roomId: input.roomId,
        roomSeq: integer(event, "room_seq"),
        createdAt: text(event, "created_at"),
        type,
        text: label,
      },
    };
  });
  const cursorBefore = rows.length
    ? integer(rows[0]!, "room_seq")
    : (before ?? after ?? 0);
  const cursorAfter = rows.length
    ? integer(rows.at(-1)!, "room_seq")
    : (before ?? after ?? 0);
  const across = (op: "<" | ">", seq: number) =>
    db
      .prepare(`${cte} SELECT 1 FROM timeline WHERE room_seq ${op} ? LIMIT 1`)
      .get(input.roomId, input.roomId, seq) !== undefined;
  return ClientRoomTimelineResponseSchema.parse({
    items,
    cursorBefore,
    cursorAfter,
    hasMoreBefore: across("<", cursorBefore),
    hasMoreAfter: across(">", cursorAfter),
  });
}
