import type {
  RuntimeTrajectoryEntry,
  RuntimeTrajectoryActivity,
} from "@rah-os/protocol";

/** Structural port of mne in Raft index-BoAC7nSE.js (2026-08-31).
 * Only activity is projected: private text/tool details never enter presence.
 * Text/action/system entries do not replace current activity. Runtime writers
 * publish explicit working transitions before text, as Raft Computer does.
 */
export function raftTrajectoryActivity(
  entry: RuntimeTrajectoryEntry,
): RuntimeTrajectoryActivity | undefined {
  switch (entry.kind) {
    case "thinking":
      return "thinking";
    case "tool_start":
    case "compaction_started":
      return "working";
    case "compaction_finished":
      return "online";
    case "status":
      return entry.activity;
    default:
      return undefined;
  }
}
