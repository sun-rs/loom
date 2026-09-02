import type { RuntimeTrajectoryRecord } from "@rah-os/protocol";
import { activityPresentation } from "./identity-presentation.ts";

/** Raft Att: preview dots express activity, not full-log record kind colors. */
export function previewActivityKind(entry: RuntimeTrajectoryRecord["entry"]) {
  if (entry.kind === "status") return entry.activity;
  if (entry.kind === "thinking") return "thinking" as const;
  if (entry.kind === "compaction_finished") return "online" as const;
  return "working" as const;
}

/** Raft YW: compact preview uses a tool's label, not its command/input body. */
export function previewActivityText(
  entry: RuntimeTrajectoryRecord["entry"],
): string {
  const presentation = activityPresentation(entry);
  if (
    entry.kind === "tool_start" ||
    entry.kind === "system" ||
    entry.kind === "slock_action"
  )
    return presentation.label;
  return presentation.detail || presentation.label;
}
