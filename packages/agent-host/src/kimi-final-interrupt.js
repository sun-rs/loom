// S2-c2 final-reply turn end for Kimi ACP (per-turn and warm drivers), the
// Kimi counterpart of `claude-final-interrupt.js`. The Host alone decides that
// a final reply committed (a Kernel marker); the driver only chooses the
// moment: the first point where no tool call of this prompt is in flight
// (every ACP `tool_call` has its terminal `tool_call_update`, status
// `completed` or `failed`), so the CLI that posted the reply is never cut off.
// The interrupt is the native ACP `session/cancel` NOTIFICATION (kimi-code
// 0.39.1 `AcpSession.cancel` -> `agent.cancel({turnId})`; the prompt then
// settles with `stopReason: "cancelled"`).
//
// Reported as three separate facts: `requested` (the notification was
// written), `accepted` and `terminal`. A notification has no answer, so both
// come from the prompt's own terminal response: `cancelled` -> accepted and
// terminal true; any other stopReason -> the cancel did not end the turn
// (accepted "unknown": it may have arrived after the turn ended; terminal
// false); no response -> both "unknown". `sent` = requested.
//
// `preemptedFollowUp` is observed, never assumed. The follow-up window opens
// when the posting call completes: the terminal update of the tool call whose
// `rawInput.command` first line is a `message-post ... --final`. With no
// identifiable posting call it opens when the cancel fires, and an arm while
// a tool runs after model output that followed an earlier tool round is
// unattributable (`unknown`). In the window, any model output (a text or
// thought chunk that is not a session notice, or a new tool call) is a
// follow-up generation (`false`, irreversible); otherwise the cancel
// preempted it (`true`). Stream evidence, not a server-side request audit.
import { isKimiLocalChunk } from "./kimi-acp-events.js";

const FINAL_POST_COMMAND = /message-post\b.*\s--final\b/u;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function postingCommand(update) {
  const command = isRecord(update.rawInput)
    ? update.rawInput.command
    : undefined;
  return (
    typeof command === "string" &&
    FINAL_POST_COMMAND.test(command.split("\n", 1)[0])
  );
}

export function createKimiFinalInterrupt({ interrupt }) {
  /** toolCallId -> whether it is the final posting call. */
  const tools = new Map();
  let armed = false;
  let requested = false;
  let stopReason;
  let ended = false;
  let postIdentified = false;
  let window = false;
  let followUp = false;
  let ambiguous = false;
  let toolRoundEnded = false;
  let outputSinceIdle = false;
  const fire = () => {
    if (requested || ended) return;
    requested = true;
    if (!postIdentified) {
      window = true;
      if (outputSinceIdle && toolRoundEnded) followUp = true;
    }
    try {
      interrupt();
    } catch {
      // The notification could not be written: the turn runs on.
      requested = false;
    }
  };
  const output = (modelText) => {
    if (modelText) outputSinceIdle = true;
    if (window) followUp = true;
  };
  return {
    get armed() {
      return armed;
    },
    get issued() {
      return requested;
    },
    get toolsInFlight() {
      return tools.size;
    },
    /** One ACP `session/update` `update` object of this prompt. */
    observe(update) {
      if (ended || !isRecord(update)) return;
      const kind = update.sessionUpdate;
      if (kind === "agent_message_chunk") {
        if (!isKimiLocalChunk(update)) output(true);
      } else if (kind === "agent_thought_chunk") {
        output(true);
      } else if (kind === "tool_call" || kind === "tool_call_update") {
        const id =
          typeof update.toolCallId === "string"
            ? update.toolCallId
            : JSON.stringify(update);
        const status = update.status;
        if (kind === "tool_call" && !tools.has(id)) {
          tools.set(id, false);
          output(false);
        }
        if (tools.has(id) && postingCommand(update)) {
          tools.set(id, true);
          postIdentified = true;
        }
        if (status === "completed" || status === "failed") {
          if (tools.has(id)) {
            const posting = tools.get(id) === true;
            tools.delete(id);
            if (posting && !window) window = true;
            if (tools.size === 0) {
              toolRoundEnded = true;
              outputSinceIdle = false;
            }
          }
        }
      }
      if (armed && !requested && tools.size === 0) fire();
    },
    /** The Host's signal; false when already armed or the prompt settled. */
    arm() {
      if (armed || ended) return false;
      armed = true;
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
    /** The prompt's terminal response (`stopReason`), or undefined if none. */
    settle(reason) {
      if (ended) return;
      ended = true;
      stopReason = typeof reason === "string" ? reason : undefined;
    },
    report() {
      const cancelled = stopReason === "cancelled";
      return {
        requested,
        accepted: !requested ? "unknown" : cancelled ? true : "unknown",
        terminal: !requested
          ? "unknown"
          : stopReason === undefined
            ? "unknown"
            : cancelled,
        sent: requested,
        preemptedFollowUp: !requested
          ? "unknown"
          : followUp
            ? false
            : ambiguous || !window
              ? "unknown"
              : true,
      };
    },
  };
}
