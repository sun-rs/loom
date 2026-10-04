// One per-turn transport affordance; never connection evidence or Room state.
export function withWorkerMcpGuidance(input, enabled) {
  return (
    input +
    (enabled
      ? "\nUse loom_reply for replies to this conversation; final=true only when finished. Other operations retain the Worker CLI."
      : "")
  );
}
