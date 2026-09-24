// Final-reply turn end, driver side (shared by the per-turn and warm Codex
// drivers). The Host alone decides that a final reply committed (a Kernel
// marker); the driver only chooses the moment: the first point where no tool
// item is in flight, so the CLI that posted the reply is never cut off. The
// interrupt then aborts the follow-up generation the tool loop would request
// only to say "sent". Whether it beat that generation is observed, not
// assumed, over the window that opens when the last tool item finished:
// - model output (message/reasoning deltas or items) or a new tool call in
//   the window: the follow-up had started (`false`);
// - a usage report that advances the thread total while no observed
//   generation is still waiting for its usage: a follow-up generation ran
//   without visible output (`false`);
// - an unchanged usage repeat is not a generation, and the first advancing
//   report after a generation was observed settles THAT generation (the
//   posting call's usage may land after the tool finished) — neither is
//   follow-up evidence;
// - an unreadable usage report in the window: `unknown`;
// - otherwise the interrupt preempted the follow-up (`true`).
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
]);
const USAGE_METHOD = "thread/tokenUsage/updated";
const GENERATION_ITEM_TYPES = new Set(["agentMessage", "reasoning"]);

export function createCodexFinalInterrupt({ interrupt }) {
  const tools = new Set();
  // Follow-up evidence since the last tool item finished (see above).
  let followUp = false;
  let unreadableUsage = false;
  // The last thread usage total, and whether an observed generation has not
  // been matched by an advancing usage report yet.
  let usageTotal;
  let awaitingUsage = false;
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
          followUp = true;
          awaitingUsage = true;
        } else if (method === "item/completed") {
          tools.delete(id);
          if (tools.size === 0) {
            followUp = false;
            unreadableUsage = false;
          }
        }
      } else if (
        GENERATION_METHODS.has(method) ||
        (method === "item/started" && GENERATION_ITEM_TYPES.has(item?.type))
      ) {
        followUp = true;
        awaitingUsage = true;
      } else if (method === USAGE_METHOD) {
        const total = frame?.params?.tokenUsage?.total?.totalTokens;
        if (typeof total !== "number" || !Number.isFinite(total)) {
          unreadableUsage = true;
        } else if (usageTotal === undefined || total > usageTotal) {
          usageTotal = total;
          if (awaitingUsage) awaitingUsage = false;
          else followUp = true;
        }
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
        preemptedFollowUp: !sent
          ? "unknown"
          : followUp
            ? false
            : unreadableUsage
              ? "unknown"
              : true,
      };
    },
  };
}
