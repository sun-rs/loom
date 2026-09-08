import type { DatabaseSync } from "node:sqlite";
import {
  AttachmentSchema,
  type Attachment,
  type WorkerMessagePostRequest,
  type RoomEvent,
} from "@rah-os/protocol";
import { text, type Row } from "./sqlite-row.ts";
import { IdempotencyConflictError } from "./errors.ts";

/** Persistent intent snapshots are shared by both Room send facades. Caller owns
 * one transaction and must consume live attachments only after a new event. */
export function workerMessageAttachments(context: {
  database: DatabaseSync;
  roomId: string;
  input: WorkerMessagePostRequest & { idempotencyKey: string };
  eventFromRow: (row: Row) => RoomEvent;
  resolveLive: (ids: readonly string[]) => Attachment[];
}) {
  const { database, input } = context;
  const previous = database
    .prepare(
      "SELECT * FROM room_events WHERE room_id=? AND idempotency_key=? AND type='message.posted'",
    )
    .get(context.roomId, input.idempotencyKey);
  const held =
    input.heldDraftId === undefined
      ? undefined
      : database
          .prepare("SELECT * FROM held_message_drafts WHERE held_draft_id=?")
          .get(input.heldDraftId);
  const savedAttachments =
    held === undefined
      ? []
      : AttachmentSchema.array()
          .max(10)
          .parse(JSON.parse(text(held, "attachments_json")));
  const attachmentIds =
    input.sendDraft === true
      ? savedAttachments.map((a) => a.attachmentId)
      : (input.attachmentIds ?? []);
  const previousHeld = database
    .prepare(
      "SELECT attachments_json FROM held_message_drafts WHERE room_id=? AND idempotency_key=?",
    )
    .get(context.roomId, input.idempotencyKey);
  const receiptAttachments =
    previous !== undefined
      ? AttachmentSchema.array()
          .max(10)
          .parse(context.eventFromRow(previous).payload.attachments ?? [])
      : previousHeld === undefined
        ? undefined
        : AttachmentSchema.array()
            .max(10)
            .parse(JSON.parse(text(previousHeld, "attachments_json")));
  if (
    receiptAttachments !== undefined &&
    input.sendDraft !== true &&
    JSON.stringify(receiptAttachments.map((a) => a.attachmentId)) !==
      JSON.stringify(attachmentIds)
  )
    throw new IdempotencyConflictError(
      `idempotency key ${input.idempotencyKey} was already used for another mutation`,
    );
  // A durable receipt describes the accepted intent even if its unposted file
  // was subsequently canceled or reclaimed. Replays still pass the identity,
  // target and full-command checks below; only a new post consumes live files.
  return receiptAttachments ?? context.resolveLive(attachmentIds);
}
