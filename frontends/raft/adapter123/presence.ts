import type { AgentPresence } from "@rah-os/protocol";
/** Pure observation projection. A Role has no execution lane of its own. */
export function nativePresence(
  ids: readonly string[],
  presence: readonly AgentPresence[],
) {
  const facts = presence.filter((p) => ids.includes(p.agentId));
  const first = ["working", "thinking", "error", "online", "offline"].flatMap(
    (activity) => facts.filter((p) => p.activity === activity),
  )[0];
  if (!first) return { status: "inactive" as const };
  return {
    status:
      first.activity === "offline" ? ("stopped" as const) : ("active" as const),
    activityKind: first.activity,
    activityDetail: "",
    activityDetailKind: null,
  };
}
