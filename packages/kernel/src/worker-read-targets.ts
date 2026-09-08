import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { ActivationCredentialScope } from "@rah-os/protocol";
import { roomProjectionFromRow } from "./collaboration-projection.ts";
import { ConflictError, NotFoundError } from "./errors.ts";
import { text, type Row } from "./sqlite-row.ts";
import { requireWorkerRoomVisibility } from "./worker-task-scope.ts";
import { readAgentChannelAttention } from "./agent-channel-attention.ts";

/** Deliberately lacks Activation, Run, consumer and delivery bounds. */
export type WorkerVisibleRoomScope = Pick<
  ActivationCredentialScope,
  "participantId" | "roomId"
>;
export const WORKER_VISIBLE_ROOMS = `SELECT r.*, r.rowid AS room_order, d.left_principal_id, d.right_principal_id,
  peer.handle AS peer_handle FROM rooms r
  JOIN memberships membership ON membership.room_id=r.room_id
  LEFT JOIN direct_room_pairs d ON d.room_id=r.room_id
  LEFT JOIN principals peer ON peer.principal_id=CASE WHEN d.left_principal_id=membership.principal_id
    THEN d.right_principal_id ELSE d.left_principal_id END`;

export function workerRoomEntry(
  database: DatabaseSync,
  participantId: string,
  row: Row,
) {
  const room = roomProjectionFromRow(row);
  return {
    room,
    channel:
      room.kind === "direct" && typeof row.peer_handle === "string"
        ? `dm:@${row.peer_handle}`
        : `#${room.slug}`,
    attention: readAgentChannelAttention(database, participantId, room.roomId),
  };
}

export function resolveWorkerReadTarget(
  database: DatabaseSync,
  origin: WorkerVisibleRoomScope,
  channel?: string,
): WorkerVisibleRoomScope & { threadId?: string } {
  if (channel === undefined) {
    requireWorkerRoomVisibility(database, origin);
    return { participantId: origin.participantId, roomId: origin.roomId };
  }
  let where: string;
  let values: SQLInputValue[];
  let threadRef: string | undefined;
  if (channel.startsWith("#")) {
    const [slug, suffix, ...extra] = channel.slice(1).split(":");
    if (!slug || extra.length || suffix === "")
      throw new NotFoundError("read target is unavailable");
    where = "r.kind='channel' AND r.slug=?";
    values = [slug];
    threadRef = suffix;
  } else if (channel.startsWith("dm:@")) {
    const [handle, suffix, ...extra] = channel.slice(4).split(":");
    if (!handle || extra.length || suffix === "")
      throw new NotFoundError("read target is unavailable");
    where =
      "r.kind='direct' AND peer.handle=? AND (d.left_principal_id=? OR d.right_principal_id=?)";
    values = [handle, origin.participantId, origin.participantId];
    threadRef = suffix;
  } else {
    where = "r.room_id=?";
    values = [channel];
  }
  const rows = database
    .prepare(
      `${WORKER_VISIBLE_ROOMS} WHERE membership.principal_id=?
    AND r.kind IN ('channel','direct') AND ${where} LIMIT 2`,
    )
    .all(origin.participantId, ...values);
  if (rows.length !== 1)
    throw new NotFoundError(
      "read target is unavailable or ambiguous among joined Rooms",
    );
  const scope = {
    participantId: origin.participantId,
    roomId: text(rows[0]!, "room_id"),
  };
  requireWorkerRoomVisibility(database, scope);
  if (threadRef === undefined) return scope;
  const threads = database
    .prepare(
      `SELECT thread_id FROM threads WHERE room_id=? AND
    (thread_id=? OR root_message_id=? OR (length(?)>=8 AND (substr(thread_id,1,length(?))=? OR substr(root_message_id,1,length(?))=?))) LIMIT 2`,
    )
    .all(
      scope.roomId,
      threadRef,
      threadRef,
      threadRef,
      threadRef,
      threadRef,
      threadRef,
      threadRef,
    );
  if (threads.length !== 1)
    throw new NotFoundError("Thread is unavailable or ambiguous in this Room");
  return { ...scope, threadId: text(threads[0]!, "thread_id") };
}

export function workerReadThread(
  target: { threadId?: string },
  explicit?: string | null,
) {
  if (
    target.threadId !== undefined &&
    explicit !== undefined &&
    explicit !== target.threadId
  )
    throw new ConflictError("channel Thread conflicts with explicit threadId");
  return target.threadId ?? explicit;
}

export function resolveWorkerMessageRoom(
  database: DatabaseSync,
  origin: WorkerVisibleRoomScope,
  messageId: string,
) {
  const row = database
    .prepare(
      `SELECT m.room_id FROM messages m JOIN memberships membership ON membership.room_id=m.room_id
    JOIN rooms r ON r.room_id=m.room_id WHERE m.message_id=? AND membership.principal_id=? AND r.kind IN ('channel','direct')`,
    )
    .get(messageId, origin.participantId);
  if (!row) throw new NotFoundError("message is unavailable in joined Rooms");
  return resolveWorkerReadTarget(database, origin, text(row, "room_id"));
}
