// Final-reply turn end, driver side (shared by the per-turn and warm Codex
// drivers). The Host alone decides that a final reply committed (a Kernel
// marker); the driver only chooses the moment: the first point where no tool
// item is in flight, so the CLI that posted the reply is never cut off. The
// interrupt then aborts the follow-up generation the tool loop would request
// only to say "sent".
//
// The interrupt itself is reported in three separate facts: `requested` (the
// request was written), `accepted` (the app-server answered it: true; refused:
// false; timeout or lost answer: "unknown") and `terminal` (the turn ended
// with status `interrupted`: true; another status: false; not seen:
// "unknown"). `sent` stays for older readers: requested and not refused.
//
// Whether the interrupt beat the follow-up generation (`preemptedFollowUp`) is
// observed, never assumed. The follow-up window opens when the posting call
// completes: the tool item whose command is the `--final` message post. With
// no identifiable posting call, it opens at the last tool completion before
// the interrupt, and an arm that may have come after a later tool started
// (model output between two tools) is unattributable (`unknown`).
// In the window:
// - model output (message/reasoning deltas or items) or a new tool call is a
//   follow-up generation (`false`); the fact is irreversible — a later tool
//   completing never clears it;
// - usage is attributed by cumulative growth: each model response observed
//   (output or tool call after the previous tool round) settles one advancing
//   report, so the posting response's late usage is not a follow-up; an
//   advance beyond every observed response is one (`false`); an unchanged
//   repeat is nothing; an unreadable or baseline-less report is `unknown`;
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

// Flags precede the heredoc body, so only the command's first line is read:
// a `--final` quoted inside the message body never identifies a post.
const FINAL_POST_COMMAND = /message-post\b.*\s--final\b/u;

function isFinalPost(item) {
  if (item?.type !== "commandExecution") return false;
  const command = Array.isArray(item.command)
    ? item.command.join(" ")
    : item.command;
  return (
    typeof command === "string" &&
    FINAL_POST_COMMAND.test(command.split("\n", 1)[0])
  );
}

export function createCodexFinalInterrupt({ interrupt }) {
  const tools = new Map();
  let armed = false;
  let requested = false;
  /** @type {boolean | "unknown"} */
  let accepted = "unknown";
  /** @type {boolean | "unknown"} */
  let terminal = "unknown";
  let pending = Promise.resolve();
  // Window state. `window` opens at the posting call's completion (or, with
  // no identified posting call, when the interrupt fires).
  let postIdentified = false;
  let window = false;
  let followUp = false; // irreversible once true
  let unknownEvidence = false; // unreadable / unattributable usage in window
  let ambiguous = false; // unidentified posting call, unattributable arm
  // Fallback bookkeeping: model text (not tool calls) since the last tool
  // round went idle.
  let toolRoundEnded = false;
  let outputSinceIdle = false;
  // Usage attribution: responses observed and not yet settled by an
  // advancing report; a response starts with its first output or tool call.
  let inResponse = false;
  let unsettled = 0;
  let usageTotal;
  const fire = () => {
    if (requested) return;
    requested = true;
    if (!postIdentified) {
      // Fallback: the window opens now. Output since the last tool round
      // ended (with every tool finished) already followed the post.
      window = true;
      if (outputSinceIdle && toolRoundEnded) followUp = true;
    }
    // Written synchronously: the follow-up request may be milliseconds away.
    pending = (async () => {
      try {
        await interrupt();
        accepted = true;
      } catch (error) {
        // A provider rejection proves no interrupt took effect; a timeout or
        // lost answer is ambiguous.
        if (error?.providerRejected === true) accepted = false;
      }
    })();
  };
  const response = () => {
    if (inResponse) return;
    inResponse = true;
    unsettled += 1;
  };
  const output = (modelText) => {
    response();
    if (modelText) outputSinceIdle = true;
    if (window) followUp = true;
  };
  return {
    get armed() {
      return armed;
    },
    /** True once the interrupt request was written and not refused. */
    get issued() {
      return requested && accepted !== false;
    },
    observe(frame) {
      const method = frame?.method;
      const item = frame?.params?.item;
      if (item && TOOL_ITEM_TYPES.has(item.type)) {
        const id = typeof item.id === "string" ? item.id : JSON.stringify(item);
        if (method === "item/started") {
          const posting = isFinalPost(item);
          if (posting) postIdentified = true;
          tools.set(id, posting);
          output(false);
        } else if (method === "item/completed") {
          const posting = tools.get(id) === true || isFinalPost(item);
          if (posting) postIdentified = true;
          tools.delete(id);
          if (posting && !window) window = true;
          if (tools.size === 0) {
            toolRoundEnded = true;
            outputSinceIdle = false;
            inResponse = false;
          }
        }
      } else if (
        GENERATION_METHODS.has(method) ||
        (method === "item/started" && GENERATION_ITEM_TYPES.has(item?.type))
      ) {
        output(true);
      } else if (method === USAGE_METHOD) {
        const total = frame?.params?.tokenUsage?.total?.totalTokens;
        if (typeof total !== "number" || !Number.isFinite(total)) {
          if (window) unknownEvidence = true;
        } else if (usageTotal === undefined || total > usageTotal) {
          const baseline = usageTotal !== undefined;
          usageTotal = total;
          if (unsettled > 0) unsettled -= 1;
          else if (window) {
            if (baseline) followUp = true;
            else unknownEvidence = true;
          }
        }
      } else if (method === "turn/completed") {
        const status = frame?.params?.turn?.status;
        if (typeof status === "string") terminal = status === "interrupted";
      }
      if (armed && !requested && tools.size === 0) fire();
    },
    /** The Host's signal; false when already armed. */
    arm() {
      if (armed) return false;
      armed = true;
      // Unidentified posting call, a tool in flight, and model text after an
      // earlier tool round: that tool may be the post or a follow-up.
      if (
        !postIdentified &&
        tools.size > 0 &&
        toolRoundEnded &&
        outputSinceIdle
      )
        ambiguous = true;
      if (tools.size === 0) fire();
      return true;
    },
    async report() {
      await pending;
      const sent = requested && accepted !== false;
      return {
        requested,
        accepted: requested ? accepted : "unknown",
        terminal,
        sent,
        preemptedFollowUp: !sent
          ? "unknown"
          : followUp
            ? false
            : unknownEvidence || ambiguous || !window
              ? "unknown"
              : true,
      };
    },
  };
}
