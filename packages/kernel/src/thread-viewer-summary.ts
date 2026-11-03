import type { DatabaseSync } from "node:sqlite";
import type { Thread } from "@rah-os/protocol";
import { identityDisplayName } from "./identity-display-name.ts";

/** Authorized by listThreads before entry; one bulk read, no history ACK or writes. */
export function threadReplyPreviews(
  db: DatabaseSync,
  roomId: string,
  roots: readonly string[],
) {
  if (roots.length > 100 || new Set(roots).size !== roots.length)
    throw Error("Invalid thread preview scope");
  const result = new Map<
    string,
    NonNullable<NonNullable<Thread["viewerSummary"]>["previews"]>
  >();
  if (!roots.length) return result;
  const rows = db
    .prepare(
      `WITH ranked AS (
    SELECT m.thread_id,m.message_id,m.actor_id,m.room_seq,substr(m.body,1,400) AS preview,m.created_at,p.kind,
    ROW_NUMBER() OVER(PARTITION BY m.thread_id ORDER BY m.room_seq DESC,m.message_id DESC) AS position
    FROM discovery_messages m JOIN threads t ON t.thread_id=m.thread_id AND t.room_id=m.room_id
    JOIN principals p ON p.principal_id=m.actor_id
    WHERE m.room_id=? AND t.root_message_id IN (SELECT value FROM json_each(?))
  ) SELECT * FROM ranked WHERE position<=3 ORDER BY thread_id,room_seq,message_id`,
    )
    .all(roomId, JSON.stringify(roots));
  const names = new Map<string, string>();
  for (const row of rows) {
    const actorId = String(row.actor_id),
      threadId = String(row.thread_id);
    if (!names.has(actorId))
      names.set(actorId, identityDisplayName(db, actorId) ?? "已离开的成员");
    const list = result.get(threadId) ?? [];
    list.push({
      messageId: String(row.message_id),
      roomSeq: Number(row.room_seq),
      actorId,
      senderKind: row.kind === "agent" ? "agent" : "human",
      senderName: names.get(actorId)!,
      preview: String(row.preview).slice(0, 400),
      createdAt: String(row.created_at),
    });
    result.set(threadId, list);
  }
  return result;
}
/** Read projection only: existing replies, follow overrides and Human read frontiers. */
export function threadViewerSummaries(
  db: DatabaseSync,
  roomId: string,
  actorId: string,
) {
  const rows = db
    .prepare(
      `WITH replies AS MATERIALIZED (
 SELECT m.thread_id,m.actor_id,m.message_id,m.room_seq,
 CASE WHEN m.actor_id<>$actor AND m.room_seq>COALESCE(f.read_seq,0)
 AND COALESCE(h.following, t.created_by=$actor OR root.actor_id=$actor OR EXISTS(
 SELECT 1 FROM messages mine WHERE mine.thread_id=t.thread_id AND mine.actor_id=$actor))=1
 THEN 1 ELSE 0 END AS unread
 FROM discovery_messages m JOIN threads t ON t.thread_id=m.thread_id
 JOIN messages root ON root.message_id=t.root_message_id
 LEFT JOIN human_activity_frontiers f ON f.room_id=m.room_id AND f.scope_id=m.thread_id AND f.principal_id=$actor
 LEFT JOIN human_thread_follows h ON h.thread_id=m.thread_id AND h.principal_id=$actor
 WHERE m.room_id=$room AND m.thread_id IS NOT NULL
 ), summaries AS (
 SELECT thread_id,json_group_array(DISTINCT actor_id) participants,SUM(unread) unread_count,
 MIN(CASE WHEN unread=1 THEN room_seq END) first_seq FROM replies GROUP BY thread_id
 ) SELECT s.*,r.message_id first_id FROM summaries s LEFT JOIN replies r ON r.thread_id=s.thread_id AND r.room_seq=s.first_seq`,
    )
    .all({ $actor: actorId, $room: roomId });
  return new Map(
    rows.map((row) => [
      String(row.thread_id),
      {
        participantIds: JSON.parse(String(row.participants)) as string[],
        unreadCount: Number(row.unread_count),
        firstUnreadMessageId:
          row.first_id == null ? null : String(row.first_id),
      } satisfies NonNullable<Thread["viewerSummary"]>,
    ]),
  );
}
