import type { AgentWorkspaceSummary } from "@rah-os/protocol";
import { listWorkspaceRoot } from "./agent-workspace-browser.ts";

// Structural port of Raft Computer 1.0.18 scanWorkspaceDirectories aggregation.
// Reuse RAH's scoped reader; never follow links or count excluded secret files.
// Bound the walk instead of upstream's unbounded recursive Promise.all.
export async function summarizeWorkspaceRoot(
  rootDirectory: string,
  options: { maximumDirectories?: number } = {},
): Promise<AgentWorkspaceSummary> {
  const maximum = Math.max(1, Math.min(128, options.maximumDirectories ?? 128));
  const result: AgentWorkspaceSummary = {
    rootPath: rootDirectory,
    state: "ready",
    fileCount: 0,
    totalSizeBytes: 0,
    lastModified: null,
    truncated: false,
  };
  const pending = [""];
  let visited = 0;
  while (pending.length && visited < maximum) {
    const path = pending.shift()!;
    visited++;
    const listing = await listWorkspaceRoot({
      rootDirectory,
      rootId: "agent-workspace",
      rootKind: "agent-workspace",
      rootLabel: "Agent 工作区",
      path,
      includeHidden: true,
    });
    if (path === "") result.state = listing.state;
    result.truncated ||= listing.truncated;
    for (const entry of listing.entries) {
      if (
        result.lastModified === null ||
        entry.modifiedAt > result.lastModified
      )
        result.lastModified = entry.modifiedAt;
      if (entry.isDirectory) {
        if (pending.length + visited < maximum) pending.push(entry.path);
        else result.truncated = true;
      } else {
        result.fileCount++;
        result.totalSizeBytes += entry.size;
      }
    }
  }
  return result;
}
