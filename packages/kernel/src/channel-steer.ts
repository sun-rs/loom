import type { DatabaseSync } from "node:sqlite";

/** Channel policy only gates busy hints; delivery and ACK remain unchanged. */
export function migrateChannelSteerV78(database: DatabaseSync): void {
  const columns = database.prepare("PRAGMA table_info(rooms)").all();
  if (!columns.some((column) => column.name === "channel_steer_enabled"))
    database.exec(
      "ALTER TABLE rooms ADD COLUMN channel_steer_enabled INTEGER NOT NULL DEFAULT 1 CHECK(channel_steer_enabled IN (0,1))",
    );
}
