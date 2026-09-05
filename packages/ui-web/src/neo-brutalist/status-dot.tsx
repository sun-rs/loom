import type { AgentPresence } from "@rah-os/protocol";

/** Raft Uze/fp structural port. External is a type marker, not working status. */
export function AgentStatusDot({
  activity,
  label,
  className,
  external = false,
  size = "md",
}: {
  activity: AgentPresence["activity"];
  label: string;
  className: string;
  external?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <i
      className={`${className} rah-agent-status-dot`}
      data-activity={external ? "external" : activity}
      data-size={size}
      data-online={activity !== "offline"}
      data-pulse={
        !external && (activity === "thinking" || activity === "working")
      }
      title={label}
      aria-label={label}
    />
  );
}
