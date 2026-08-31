import type { RuntimeTrajectoryRecord } from "@rah-os/protocol";

export const MAX_AGENT_DIAGNOSTIC_ACTIVITIES = 200;
export const MAX_AGENT_DIAGNOSTIC_BYTES = 64 * 1_024;

export type AgentDiagnosticIdentity = {
  agentDefinitionId: string;
  displayName: string;
  handle: string;
  participantId: string;
};

/**
 * Export correlation metadata only. Runtime text, reasoning summaries, tool
 * inputs and tool results stay out of clipboard diagnostics.
 */
export function renderAgentActivityDiagnostics(
  agent: AgentDiagnosticIdentity,
  activities: readonly RuntimeTrajectoryRecord[],
): string {
  const visible = activities.slice(-MAX_AGENT_DIAGNOSTIC_ACTIVITIES);
  const lines = [
    "RAH_OS Agent runtime trajectory diagnostics",
    `Agent: ${agent.displayName} (@${agent.handle})`,
    `AgentDefinition: ${agent.agentDefinitionId}`,
    `Participant: ${agent.participantId}`,
    `Activity total: ${activities.length}`,
    `Exported records: ${visible.length}`,
    "",
    ...visible.map(renderActivityLine),
  ];
  return truncateUtf8(lines.join("\n"), MAX_AGENT_DIAGNOSTIC_BYTES);
}

function renderActivityLine(activity: RuntimeTrajectoryRecord): string {
  const entry = activity.entry;
  return [
    `[${safeField(activity.observedAt)}]`,
    `kind=${entry.kind}`,
    ...(entry.kind === "status"
      ? [
          `activity=${entry.activity}`,
          ...(entry.detailKind === undefined
            ? []
            : [`detailKind=${entry.detailKind}`]),
        ]
      : []),
    ...(entry.kind === "tool_start" ? [`tool=${quoted(entry.toolName)}`] : []),
    `roomId=${quoted(activity.roomId)}`,
    `runAttemptId=${quoted(activity.runAttemptId)}`,
    `runtimeRunId=${quoted(activity.runtimeRunId)}`,
    `activityId=${quoted(activity.activityId)}`,
    `producerSequence=${activity.producerSequence}`,
    `serverSequence=${activity.serverSequence}`,
  ].join(" ");
}

function quoted(value: string): string {
  return `"${safeField(value)}"`;
}

function safeField(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n")
    .replaceAll('"', '\\"');
}

function truncateUtf8(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).length <= maxBytes) return value;
  const marker = "\n… diagnostics truncated at 64 KiB";
  const markerBytes = encoder.encode(marker).length;
  let used = 0;
  let output = "";
  for (const character of value) {
    const length = encoder.encode(character).length;
    if (used + length + markerBytes > maxBytes) break;
    output += character;
    used += length;
  }
  return output + marker;
}
