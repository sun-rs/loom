// Final-reply turn end for Claude Code stream-json (per-turn and warm
// drivers), the Claude counterpart of `codex-final-interrupt.js`. The Host
// alone decides that a final reply committed (a Kernel marker); the driver
// only chooses the moment: the first point where no tool call is in flight
// (every `tool_use` of an `assistant` frame has its `tool_result`), so the CLI
// that posted the reply is never cut off. The interrupt is the native
// `control_request` `{subtype:"interrupt"}` (Claude Code SDK
// `SDKControlInterruptRequest`), answered by a `control_response`.
//
// Reported as three separate facts: `requested` (the request was written),
// `accepted` (the control_response was `success`: true; `error`: false;
// timeout or lost answer: "unknown") and `terminal` (this turn's `result`
// ended aborted — `terminal_reason` aborted_tools/aborted_streaming: true;
// any other reason: false; none seen: "unknown"). An older CLI's
// `error_during_execution` result without `terminal_reason` cannot tell a
// platform interrupt from a provider failure: it counts as aborted only when
// this interrupt's own control_response was a success (the correlated cancel
// receipt), otherwise `terminal` is "unknown" and the run does not read as an
// intended final end (seventh review P2-4). `sent` = requested and not
// refused.
//
// Receipt race: the receipt and the result can reach the driver in either
// order — the result first, or both in one stdout chunk, where readline emits
// the result line before the receipt's settlement (a microtask) has run. So
// when such a result arrives while this interrupt's receipt is still
// outstanding, the decision waits for it, bounded by
// `LEGACY_RECEIPT_GRACE_MS`: a success receipt within the bound makes the
// result this interrupt's end; a refusal, a lost receipt or one beyond the
// bound leaves it "unknown" (a failure), as before.
//
// `preemptedFollowUp` is observed, never assumed. The follow-up window opens
// when the posting call completes: the `tool_result` of the Bash `tool_use`
// whose command's first line is a `message-post ... --final`. With no
// identifiable posting call it opens when the interrupt fires, and an arm
// while a tool runs after model text that followed an earlier tool round is
// unattributable (`unknown`). In the window, any model output — a partial
// `stream_event` (the follow-up request's stream began) or an `assistant`
// frame — is a follow-up generation (`false`, irreversible); otherwise the
// interrupt preempted it (`true`). This is stream evidence, not a
// server-side request audit: a request sent but not yet streaming when the
// interrupt landed is not observable here.
const FINAL_POST_COMMAND = /message-post\b.*\s--final\b/u;
const ABORTED_REASONS = new Set(["aborted_tools", "aborted_streaming"]);
// The receipt is at most one stdout write away from the result the same CLI
// process wrote, so it lands within milliseconds even under heavy load; 2 s
// covers scheduling stalls of a loaded host while staying well below the
// drivers' 5 s control_request timeout, so a receipt that never comes still
// fails the run promptly.
export const LEGACY_RECEIPT_GRACE_MS = 2_000;

function contentOf(frame) {
  const content = frame?.message?.content;
  return Array.isArray(content) ? content : [];
}

function isFinalPost(block) {
  if (block?.type !== "tool_use" || block.name !== "Bash") return false;
  const command = block.input?.command;
  return (
    typeof command === "string" &&
    FINAL_POST_COMMAND.test(command.split("\n", 1)[0])
  );
}

/**
 * A `result` frame that ended because the running turn was aborted. Without
 * `terminal_reason` (older CLI) only a correlated interrupt receipt makes an
 * `error_during_execution` an abort; without one it is not proof.
 */
export function isAbortedClaudeResult(
  frame,
  { interruptAcknowledged = false } = {},
) {
  if (frame?.type !== "result") return false;
  if (typeof frame.terminal_reason === "string")
    return ABORTED_REASONS.has(frame.terminal_reason);
  return interruptAcknowledged && frame.subtype === "error_during_execution";
}

/** An older CLI's result shape that needs the interrupt receipt to decide. */
function isLegacyErrorResult(frame) {
  return (
    frame?.type === "result" &&
    typeof frame.terminal_reason !== "string" &&
    frame.subtype === "error_during_execution"
  );
}

export function createClaudeFinalInterrupt({ interrupt }) {
  const tools = new Map();
  let armed = false;
  let requested = false;
  /** @type {boolean | "unknown"} */
  let accepted = "unknown";
  /** @type {boolean | "unknown"} */
  let terminal = "unknown";
  let ended = false;
  let pending = Promise.resolve();
  /** The result whose decision waits for the receipt, and that wait. */
  let receiptFrame;
  /** @type {Promise<boolean> | undefined} */
  let receiptWait;
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
    pending = (async () => {
      try {
        await interrupt();
        accepted = true;
      } catch (error) {
        if (error?.providerRejected === true) accepted = false;
      }
    })();
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
      return requested && accepted !== false;
    },
    /** The number of tool calls started and not yet answered. */
    get toolsInFlight() {
      return tools.size;
    },
    observe(frame) {
      if (ended) return;
      if (frame?.type === "assistant") {
        let text = false;
        let started = false;
        for (const block of contentOf(frame)) {
          if (block?.type === "tool_use") {
            const id =
              typeof block.id === "string" ? block.id : JSON.stringify(block);
            const posting = isFinalPost(block);
            if (posting) postIdentified = true;
            tools.set(id, posting);
            started = true;
          } else if (block?.type === "text" || block?.type === "thinking")
            text = true;
        }
        if (text || started) output(text);
      } else if (frame?.type === "stream_event") {
        output(true);
      } else if (frame?.type === "user") {
        for (const block of contentOf(frame)) {
          if (block?.type !== "tool_result") continue;
          const id = block.tool_use_id;
          if (!tools.has(id)) continue;
          const posting = tools.get(id) === true;
          tools.delete(id);
          if (posting && !window) window = true;
          if (tools.size === 0) {
            toolRoundEnded = true;
            outputSinceIdle = false;
          }
        }
      } else if (frame?.type === "result") {
        ended = true;
        // Decided when the result arrives, exactly as the driver decides it
        // (`endedByInterrupt`), or — for a reason-less result while the
        // receipt is outstanding — within the bounded receipt wait: a later
        // receipt does not rewrite it.
        if (!requested) return;
        if (isLegacyErrorResult(frame) && accepted === "unknown") {
          receiptFrame = frame;
          receiptWait = new Promise((resolve) => {
            const timer = setTimeout(
              () => resolve(false),
              LEGACY_RECEIPT_GRACE_MS,
            );
            timer.unref?.();
            void pending.then(() => {
              clearTimeout(timer);
              resolve(accepted === true);
            });
          }).then((acknowledged) => {
            terminal = acknowledged ? true : "unknown";
            return acknowledged;
          });
        } else
          terminal = isLegacyErrorResult(frame)
            ? accepted === true
              ? true
              : "unknown"
            : isAbortedClaudeResult(frame);
        return;
      }
      if (armed && !requested && tools.size === 0) fire();
    },
    /**
     * Whether `frame` (this turn's result) is the end this interrupt caused:
     * requested, not refused, and aborted — a reason-less older result only
     * with this interrupt's success receipt already in hand.
     */
    endedByInterrupt(frame) {
      return (
        requested &&
        accepted !== false &&
        isAbortedClaudeResult(frame, {
          interruptAcknowledged: accepted === true,
        })
      );
    },
    /**
     * Whether `frame` is a reason-less result whose decision waits for this
     * interrupt's outstanding receipt (`endedByInterruptAfterReceipt`).
     */
    awaitsReceipt(frame) {
      return receiptWait !== undefined && frame === receiptFrame;
    },
    /**
     * `endedByInterrupt`, except that a result awaiting the receipt is
     * decided once the receipt settles, within `LEGACY_RECEIPT_GRACE_MS`.
     */
    async endedByInterruptAfterReceipt(frame) {
      if (receiptWait === undefined || frame !== receiptFrame)
        return this.endedByInterrupt(frame);
      return await receiptWait;
    },
    /** The Host's signal; false when already armed or the turn ended. */
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
    async report() {
      await pending;
      await receiptWait;
      const sent = requested && accepted !== false;
      return {
        requested,
        accepted: requested ? accepted : "unknown",
        terminal: requested
          ? accepted === false
            ? false
            : terminal
          : "unknown",
        sent,
        preemptedFollowUp: !sent
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
