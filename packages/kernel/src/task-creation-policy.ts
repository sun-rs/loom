import type { DatabaseSync } from "node:sqlite";
import { ForbiddenError } from "./errors.ts";

export function migrateTaskCreationPolicyV80(database: DatabaseSync): void {
  if (
    !database
      .prepare("PRAGMA table_info(rooms)")
      .all()
      .some((row) => row.name === "allow_instance_task_creation")
  )
    database.exec(
      "ALTER TABLE rooms ADD COLUMN allow_instance_task_creation INTEGER NOT NULL DEFAULT 0 CHECK(allow_instance_task_creation IN (0,1))",
    );
}

/** Kernel-owned creation authority. Existing Task execution is unchanged. */
export function assertTaskCreationAllowed(
  database: DatabaseSync,
  roomId: string,
  actorId: string,
): void {
  const actor = database
    .prepare("SELECT kind FROM principals WHERE principal_id=?")
    .get(actorId);
  if (actor?.kind === "human") return;
  const room = database
    .prepare(
      "SELECT kind, allow_instance_task_creation FROM rooms WHERE room_id=?",
    )
    .get(roomId);
  if (room?.kind === "channel" && room.allow_instance_task_creation === 1)
    return;
  throw new ForbiddenError(
    "Task creation requires Human confirmation in this Channel. Suggest the work in a normal reply; continue already-authorized ordinary work without creating a Task. Existing open Tasks may still be claimed.",
  );
}
