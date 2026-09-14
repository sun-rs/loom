import type { DatabaseSync } from "node:sqlite";

/** A rebuildable display projection owned by AttachmentCommentsService.
 * Caller owns the comment transaction. Receipts/events retain accepted inputs. */
export function refreshAttachmentCommentCounts(
  db: DatabaseSync,
  attachmentId?: string,
) {
  const sources =
    attachmentId === undefined
      ? "SELECT f.message_id FROM room_files f JOIN attachment_comment_links l USING(attachment_id)"
      : "SELECT message_id FROM room_files WHERE attachment_id=?";
  db.prepare(
    `UPDATE messages SET attachments_json=(
    SELECT json_group_array(json_set(a.value,'$.commentCount',
      (SELECT count(*) FROM attachment_comment_links l
       WHERE l.attachment_id=json_extract(a.value,'$.attachmentId')
         AND l.room_id=messages.room_id)))
    FROM json_each(messages.attachments_json) a
  ) WHERE message_id IN (
    ${sources}
  ) AND attachments_json<>'[]'`,
  ).run(...(attachmentId === undefined ? [] : [attachmentId]));
}

/** Feed the existing bounded mounted-message metadata refresh, without file polling. */
export function messageAttachmentCommentState(
  db: DatabaseSync,
  messageId: string,
) {
  const row = db
    .prepare("SELECT room_id,attachments_json FROM messages WHERE message_id=?")
    .get(messageId);
  const attachments = JSON.parse(String(row?.attachments_json ?? "[]")) as {
    attachmentId: string;
    commentCount?: number;
  }[];
  if (!attachments.length) return { version: 0 };
  const version = Number(
    db
      .prepare(
        `SELECT coalesce(max(e.room_seq),0) AS version
    FROM room_files f JOIN attachment_comment_links l USING(attachment_id)
    JOIN messages m ON m.message_id=l.message_id
    JOIN room_events e ON e.aggregate_id=m.message_id AND e.room_id=m.room_id AND e.type='message.posted'
    WHERE f.room_id=? AND f.message_id=?`,
      )
      .get(String(row!.room_id), messageId)!.version,
  );
  return {
    version,
    attachmentCommentCounts: Object.fromEntries(
      attachments.map((a) => [a.attachmentId, a.commentCount ?? 0]),
    ),
  };
}
