import type { DatabaseSync } from "node:sqlite";
import {
  SystemChannelVisibilityReadSchema,
  SystemChannelVisibilityUpdateSchema,
  type Principal,
  type SystemChannelVisibilityRead,
  type SystemChannelVisibilityUpdate,
} from "@rah-os/protocol";
import { requireHumanControlRoomManager } from "./collaboration-policy.ts";
import { NotFoundError, IdempotencyConflictError } from "./errors.ts";
import { assertNoActiveRoomWork } from "./room-lifecycle-policy.ts";
import { text } from "./sqlite-row.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";

function scope(db: DatabaseSync, actor: Principal, workspaceId: string) {
  const control = db
    .prepare(
      "SELECT room_id FROM rooms WHERE workspace_id=? AND kind='control'",
    )
    .get(workspaceId);
  if (!control)
    throw new NotFoundError("Workspace control Room is unavailable");
  const controlRoomId = text(control, "room_id");
  requireHumanControlRoomManager(db, controlRoomId, actor.principalId);
  const room = db
    .prepare(
      "SELECT room_id,system_hidden FROM rooms WHERE workspace_id=? AND kind='channel' AND slug='all'",
    )
    .get(workspaceId);
  if (!room) throw new NotFoundError("System channel #all is unavailable");
  return {
    controlRoomId,
    roomId: text(room, "room_id"),
    hidden: room.system_hidden === 1,
  };
}
export function readSystemChannelVisibility(
  db: DatabaseSync,
  actor: Principal,
  input: SystemChannelVisibilityRead,
) {
  const { hidden } = scope(
    db,
    actor,
    SystemChannelVisibilityReadSchema.parse(input).workspaceId,
  );
  return { hidden };
}
/** Caller owns the transaction. A workspace policy event keeps restoration accessible via its control Room. */
export function changeSystemChannelVisibility(
  db: DatabaseSync,
  events: RoomEventWriter,
  actor: Principal,
  request: SystemChannelVisibilityUpdate,
  assertFresh: (roomId: string, seq: number) => void,
) {
  const input = SystemChannelVisibilityUpdateSchema.parse(request);
  const { controlRoomId, roomId } = scope(db, actor, input.workspaceId);
  const previous = db
    .prepare("SELECT * FROM room_events WHERE room_id=? AND idempotency_key=?")
    .get(controlRoomId, input.idempotencyKey);
  if (previous) {
    const event = events.eventFromRow(previous);
    if (
      event.actorId !== actor.principalId ||
      event.type !== "workspace.system_channel_visibility_changed" ||
      event.aggregateId !== roomId ||
      event.payload.hidden !== input.hidden
    )
      throw new IdempotencyConflictError(
        "System channel visibility idempotency key was reused",
      );
    return { hidden: input.hidden, event, deduplicated: true };
  }
  assertFresh(controlRoomId, input.basedOnRoomSeq);
  if (input.hidden) assertNoActiveRoomWork(db, roomId);
  db.prepare("UPDATE rooms SET system_hidden=? WHERE room_id=?").run(
    input.hidden ? 1 : 0,
    roomId,
  );
  const event = events.append({
    actorId: actor.principalId,
    aggregateId: roomId,
    aggregateType: "room",
    roomId: controlRoomId,
    idempotencyKey: input.idempotencyKey,
    type: "workspace.system_channel_visibility_changed",
    payload: {
      hidden: input.hidden,
      roomId,
      basedOnRoomSeq: input.basedOnRoomSeq,
    },
  });
  return { hidden: input.hidden, event, deduplicated: false };
}
