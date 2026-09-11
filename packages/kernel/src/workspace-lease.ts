import type { DatabaseSync } from "node:sqlite";

import type { PlacementDecision } from "@rah-os/protocol";

import type { InPlaceWorkspaceSharing } from "./room-kernel-options.ts";
import { text } from "./sqlite-row.ts";

/**
 * The set of workspace mounts the placement planner must treat as taken.
 *
 * An `in_place` mount is a mutual exclusion point only when the Kernel is
 * configured `"exclusive"`. The default `"shared"` permits concurrent writers
 * to an explicitly shared mount; it is not Raft workspace isolation. Raft
 * uses a separate default cwd per Agent. Under `"exclusive"` the set
 * is every live in-place lease plus every in-place placement whose
 * RuntimeProcess has no terminal proof, so an orphan can never share a mount
 * with a new Run.
 */
export function busyWorkspaceMountRevisionIds(input: {
  database: DatabaseSync;
  sharing: InPlaceWorkspaceSharing;
  unprovenRuntimePlacements: ReadonlyArray<{ placement: PlacementDecision }>;
}): string[] {
  if (input.sharing === "shared") return [];
  return [
    ...new Set([
      ...input.database
        .prepare(
          "SELECT workspace_mount_revision_id FROM workspace_leases WHERE workspace_mode = 'in_place' ORDER BY workspace_mount_revision_id",
        )
        .all()
        .map((row) => text(row, "workspace_mount_revision_id")),
      ...input.unprovenRuntimePlacements
        .map(({ placement }) => placement)
        .filter((placement) => placement.workspaceMode === "in_place")
        .map((placement) => placement.workspaceMountRevisionId),
    ]),
  ].sort();
}
