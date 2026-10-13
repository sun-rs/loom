import type { DatabaseSync } from "node:sqlite";
import { messageReferenceNameKey } from "@rah-os/protocol";
import { ConflictError } from "./errors.ts";

/** Kernel-owned identity rules; called inside the catalog transaction. */
export function assertRoleNameAvailable(
  database: DatabaseSync,
  controlRoomId: string,
  name: string,
  exceptRoleId?: string,
): void {
  const key = messageReferenceNameKey(name);
  for (const row of database
    .prepare(
      "SELECT role_id,configuration_json FROM role_templates WHERE control_room_id=? AND deleted_at IS NULL",
    )
    .all(controlRoomId)) {
    if (row.role_id === exceptRoleId) continue;
    const configuration = JSON.parse(String(row.configuration_json));
    if (messageReferenceNameKey(configuration.displayName) === key)
      throw new ConflictError("Role name already exists / 角色名称已存在");
  }
}

/** Never reuse a retained principal name, including a removed instance. */
export function allocateInstanceName(
  database: DatabaseSync,
  roleName: string,
): string {
  const occupied = new Set(
    database
      .prepare("SELECT handle FROM principals")
      .all()
      .map((row) => messageReferenceNameKey(String(row.handle))),
  );
  for (let suffix = 1; ; suffix++) {
    const name = `${roleName}-${suffix}`;
    if (name.length > 128)
      throw new ConflictError("Role name is too long for an instance suffix");
    if (!occupied.has(messageReferenceNameKey(name))) return name;
  }
}
