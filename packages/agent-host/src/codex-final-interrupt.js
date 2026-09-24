// Final-reply turn end, driver side (shared by the per-turn and warm Codex
// drivers). The Host alone decides that a final reply committed (a Kernel
// marker); the driver only chooses the moment: the first point where no tool
// item is in flight, so the CLI that posted the reply is never cut off. The
// interrupt then aborts the follow-up generation the tool loop would request
// only to say "sent". Whether it beat that generation is observed, not
// assumed: any model output, tool call or usage frame after the last tool
// finished means the follow-up had started.
const TOOL_ITEM_TYPES = new Set([
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "collabAgentToolCall",
  "webSearch",
]);
const GENERATION_METHODS = new Set([
  "item/agentMessage/delta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "thread/tokenUsage/updated",
]);
const GENERATION_ITEM_TYPES = new Set(["agentMessage", "reasoning"]);

export function createCodexFinalInterrupt({ interrupt }) {
  const tools = new Set();
  let generationSinceToolEnd = false;
  let armed = false;
  let issued = false;
  let rejected = false;
  let pending = Promise.resolve();
  const fire = () => {
    if (issued) return;
    issued = true;
    // Written synchronously: the follow-up request may be milliseconds away.
    pending = (async () => {
      try {
        await interrupt();
      } catch (error) {
        // A provider rejection proves no interrupt took effect; a timeout or
        // lost answer is ambiguous and still counts as issued.
        if (error?.providerRejected === true) rejected = true;
      }
    })();
  };
  return {
    get armed() {
      return armed;
    },
    /** True once the interrupt request was written for this turn. */
    get issued() {
      return issued && !rejected;
    },
    observe(frame) {
      const method = frame?.method;
      const item = frame?.params?.item;
      if (item && TOOL_ITEM_TYPES.has(item.type)) {
        const id = typeof item.id === "string" ? item.id : JSON.stringify(item);
        if (method === "item/started") {
          tools.add(id);
          generationSinceToolEnd = true;
        } else if (method === "item/completed") {
          tools.delete(id);
          if (tools.size === 0) generationSinceToolEnd = false;
        }
      } else if (
        GENERATION_METHODS.has(method) ||
        (method === "item/started" && GENERATION_ITEM_TYPES.has(item?.type))
      ) {
        generationSinceToolEnd = true;
      }
      if (armed && !issued && tools.size === 0) fire();
    },
    /** The Host's signal; false when already armed. */
    arm() {
      if (armed) return false;
      armed = true;
      if (tools.size === 0) fire();
      return true;
    },
    async report() {
      await pending;
      const sent = issued && !rejected;
      return {
        sent,
        preemptedFollowUp: sent ? !generationSinceToolEnd : "unknown",
      };
    },
  };
}
