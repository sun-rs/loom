import type { DatabaseSync } from "node:sqlite";

import { text } from "./sqlite-row.ts";

/**
 * Additive columns on `placements` and `runtime_processes` from earlier
 * schema versions, moved verbatim out of `RoomKernel.initialize` (S6 batch B,
 * source-size ratchet). Runs inside the final transactional schema unit.
 */
export function migratePlacementAndProcessColumns(
  database: DatabaseSync,
): void {
  const placementColumns = database
    .prepare("PRAGMA table_info(placements)")
    .all();
  if (
    !placementColumns.some(
      (row) => text(row, "name") === "runtime_offer_observation_id",
    )
  ) {
    database.exec(
      "ALTER TABLE placements ADD COLUMN runtime_offer_observation_id TEXT REFERENCES runtime_offer_observations(runtime_offer_observation_id)",
    );
  }
  const runtimeProcessColumns = database
    .prepare("PRAGMA table_info(runtime_processes)")
    .all();
  if (
    !runtimeProcessColumns.some(
      (row) => text(row, "name") === "recovery_lease_owner_instance_id",
    )
  ) {
    database.exec(
      "ALTER TABLE runtime_processes ADD COLUMN recovery_lease_owner_instance_id TEXT",
    );
  }
  if (
    !placementColumns.some(
      (row) => text(row, "name") === "runtime_offer_snapshot_digest",
    )
  ) {
    database.exec(
      "ALTER TABLE placements ADD COLUMN runtime_offer_snapshot_digest TEXT",
    );
  }
}
