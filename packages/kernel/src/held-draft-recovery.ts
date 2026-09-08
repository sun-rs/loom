import type { DatabaseSync } from "node:sqlite";
import { nullableText, text, type Row } from "./sqlite-row.ts";
import {
  WORKER_VISIBLE_ROOMS,
  workerRoomEntry,
} from "./worker-read-targets.ts";

/** Reuse the read facade's canonical addressing, including DM peer and Thread. */
export function heldDraftRecoveryTarget(
  database: DatabaseSync,
  draft: Row,
): string | undefined {
  const participantId = text(draft, "participant_id");
  const room = database
    .prepare(
      `${WORKER_VISIBLE_ROOMS} WHERE membership.principal_id=? AND r.room_id=?`,
    )
    .get(participantId, text(draft, "room_id"));
  if (!room) return undefined;
  const channel = workerRoomEntry(database, participantId, room).channel;
  const threadId = nullableText(draft, "thread_id");
  return threadId === undefined || threadId === null
    ? channel
    : `${channel}:${threadId}`;
}
