import { migrateTaskCreationPolicyV80 } from "./task-creation-policy.ts";
import type { DatabaseSync } from "node:sqlite";

/** Migrate Channel policies; delivery and ACK remain unchanged. */
export function migrateChannelPolicies(database: DatabaseSync): void {
  const columns = database.prepare("PRAGMA table_info(rooms)").all();
  if (!columns.some((column) => column.name === "channel_steer_enabled"))
    database.exec(
      "ALTER TABLE rooms ADD COLUMN channel_steer_enabled INTEGER NOT NULL DEFAULT 1 CHECK(channel_steer_enabled IN (0,1))",
    );
  migrateTaskCreationPolicyV80(database);
}
