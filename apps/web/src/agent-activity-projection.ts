import type { RuntimeTrajectoryRecord } from "@rah-os/protocol";

// Raft AgentDetailPanel-DKwoNvgK.js: Eo/_o/To/Mo/Po/Lo/gs.
// This projects diagnostics only; a colored dot never completes a Room task.
export function agentTrajectoryTone(
  activity: RuntimeTrajectoryRecord,
):
  "active" | "error" | "neutral" | "success" | "warning" | "output" | "action" {
  const entry = activity.entry;
  if (entry.kind === "status") {
    if (entry.activity === "error") return "error";
    if (entry.activity === "online") return "success";
    if (entry.activity === "working" || entry.activity === "thinking") {
      return "active";
    }
    return "neutral";
  }
  if (entry.kind === "compaction_started" || entry.kind === "system")
    return "warning";
  if (entry.kind === "compaction_finished") return "success";
  if (entry.kind === "tool_start" || entry.kind === "thinking") return "active";
  if (entry.kind === "text") return "output";
  if (entry.kind === "slock_action") return "action";
  return "neutral";
}

export function agentTrajectoryPulses(
  activity: RuntimeTrajectoryRecord,
): boolean {
  return (
    activity.entry.kind === "thinking" ||
    (activity.entry.kind === "status" &&
      (activity.entry.activity === "thinking" ||
        activity.entry.activity === "working"))
  );
}

type TextTrajectoryRecord = RuntimeTrajectoryRecord & {
  entry: Extract<
    RuntimeTrajectoryRecord["entry"],
    { kind: "text" | "thinking" }
  >;
};

export function projectAgentActivityRows(
  activities: readonly RuntimeTrajectoryRecord[],
): RuntimeTrajectoryRecord[] {
  const rows: RuntimeTrajectoryRecord[] = [];
  for (const activity of activities) {
    const previous = rows.at(-1);
    if (isTextTrajectory(previous) && canCoalesce(previous, activity)) {
      rows[rows.length - 1] = {
        ...activity,
        activityId: `${previous.activityId}:${activity.activityId}`,
        entry: {
          ...previous.entry,
          text: previous.entry.text + activity.entry.text,
        },
        observedAt: previous.observedAt,
      };
      continue;
    }
    rows.push(activity);
  }
  return rows;
}

function canCoalesce(
  previous: TextTrajectoryRecord,
  current: RuntimeTrajectoryRecord,
): current is TextTrajectoryRecord {
  return (
    isTextTrajectory(current) &&
    previous.entry.kind === current.entry.kind &&
    previous.participantId === current.participantId &&
    previous.roomId === current.roomId &&
    previous.runAttemptId === current.runAttemptId &&
    previous.runtimeRunId === current.runtimeRunId &&
    previous.entry.subagent?.subagentType ===
      current.entry.subagent?.subagentType
  );
}

function isTextTrajectory(
  activity: RuntimeTrajectoryRecord | undefined,
): activity is TextTrajectoryRecord {
  return (
    activity !== undefined &&
    (activity.entry.kind === "text" || activity.entry.kind === "thinking")
  );
}
