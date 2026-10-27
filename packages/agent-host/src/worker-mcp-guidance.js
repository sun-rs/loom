// One per-turn transport affordance; never connection evidence or Room state.
export function withWorkerMcpGuidance(input, enabled) {
  return (
    input +
    (enabled
      ? "\nUse loom_reply for replies to this conversation; final=true only when finished. Other operations retain the Worker CLI. After publishing a request to a Channel peer, end your turn; Loom delivers their reply in a later wake. Native subagent wait tools (such as wait_agent) are only for your own native child agents, not Channel members."
      : "")
  );
}
