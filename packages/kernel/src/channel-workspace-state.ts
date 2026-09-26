import type { DatabaseSync } from "node:sqlite";
import { ChannelWorkspaceStateReportSchema } from "@rah-os/protocol";
import type { AuthenticatedHostContext } from "./auth.ts";
import { ForbiddenError } from "./errors.ts";
import { listHostExecutionWorkspaceBindings } from "./host-execution-workspaces.ts";

/**
 * Host observation of Channel primary directories (Kernel is not the
 * filesystem owner). Stored beside the immutable creation record and only
 * rewritten on change; it is not a Room business event, so the Room sequence
 * is untouched. A Host may report only Channels it holds a channel-home
 * binding for.
 */
export function reportChannelWorkspaceStates(
  database: DatabaseSync,
  host: AuthenticatedHostContext,
  untrustedReports: readonly unknown[],
  now: () => Date,
): void {
  const reports = untrustedReports.map((report) =>
    ChannelWorkspaceStateReportSchema.parse(report),
  );
  const bound = new Set(
    listHostExecutionWorkspaceBindings(database, host).flatMap((binding) =>
      binding.executionWorkspace?.kind === "channel_home"
        ? [binding.executionWorkspace.roomId]
        : [],
    ),
  );
  for (const report of reports)
    if (!bound.has(report.roomId))
      throw new ForbiddenError(
        `Host is not bound to Channel ${report.roomId}'s workspace`,
      );
  for (const report of reports) {
    const current = database
      .prepare(
        "SELECT channel_workspace_state_json FROM rooms WHERE room_id = ?",
      )
      .get(report.roomId)?.channel_workspace_state_json;
    const next = {
      state: report.state,
      ...(report.reason === undefined ? {} : { reason: report.reason }),
    };
    if (typeof current === "string") {
      const previous = JSON.parse(current) as Record<string, unknown>;
      if (previous.state === next.state && previous.reason === next.reason)
        continue;
    }
    database
      .prepare(
        "UPDATE rooms SET channel_workspace_state_json = ? WHERE room_id = ?",
      )
      .run(
        JSON.stringify({ ...next, updatedAt: now().toISOString() }),
        report.roomId,
      );
  }
}
