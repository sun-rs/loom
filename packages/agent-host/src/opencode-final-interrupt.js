// S2-c3 final-reply turn end for the OpenCode server driver, the OpenCode
// counterpart of `kimi-final-interrupt.js`. The Host alone decides that a
// final reply committed (a Kernel marker); the driver only chooses the moment:
// the first point where no tool part of this run is in flight (every tool part
// reached `completed` or `error`), so the CLI that posted the reply is never
// cut off. The interrupt is the native `POST /session/:id/abort`
// (OpenCode 1.18.32 `SessionPrompt.cancel` -> the session runner interrupts
// the loop fiber; the in-flight assistant is marked `MessageAbortedError` and
// the pending `POST /session/:id/message` answers with the last assistant).
//
// Reported as three separate facts: `requested` (the abort request was sent),
// `accepted` (its HTTP answer: `true` -> true, anything else false, no answer
// "unknown") and `terminal` (from the prompt's own answer, see `settle`).
// `sent` = requested.
//
// `preemptedFollowUp` is observed, never assumed. The follow-up window opens
// when the posting call completes: the terminal state of the tool part whose
// `state.input.command` first line is a `message-post ... --final`. With no
// identifiable posting call it opens when the abort fires, and an arm while a
// tool runs after model output that followed an earlier tool round is
// unattributable (`unknown`). In the window, any model output of an assistant
// (a `step-start` — the next model request already answered —, text or
// reasoning, or a new tool part) is a follow-up generation (`false`,
// irreversible); otherwise the abort preempted it (`true`). Stream evidence,
// not a server-side request audit; a gap in the stream (SSE reconnect) makes
// a clean window `unknown`.
// evo §57: a `loom_message_post` tool call with `final: true` (the Loom
// Worker tool facade) is the posting call too.
import { isLoomFinalPostPart } from "./opencode-worker-tools.js";

const FINAL_POST_COMMAND = /message-post\b.*\s--final\b/u;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function partId(part) {
  return typeof part.id === "string"
    ? part.id
    : typeof part.callID === "string"
      ? part.callID
      : JSON.stringify(part);
}

function postingCommand(part) {
  if (isLoomFinalPostPart(part)) return true;
  const state = isRecord(part.state) ? part.state : {};
  const input = isRecord(state.input) ? state.input : {};
  return (
    typeof input.command === "string" &&
    FINAL_POST_COMMAND.test(input.command.split("\n", 1)[0])
  );
}

export function createOpenCodeFinalInterrupt({ interrupt, inFlightTools }) {
  /** tool part id -> whether it is the final posting call. */
  const tools = new Map();
  /** Tool part ids already seen terminal on the stream. */
  const finished = new Set();
  let armed = false;
  let requested = false;
  let accepted = "unknown";
  let terminal;
  let ended = false;
  let postIdentified = false;
  let window = false;
  let followUp = false;
  let ambiguous = false;
  let toolRoundEnded = false;
  let outputSinceIdle = false;
  let confirming = false;
  const register = (part) => {
    const id = partId(part);
    if (finished.has(id)) return;
    if (!tools.has(id)) tools.set(id, postingCommand(part));
    if (tools.get(id) === true) postIdentified = true;
  };
  // The stream can lag behind the Host's signal (separate channels): before
  // aborting with no tool seen in flight, the persisted run is read. OpenCode
  // persists a tool part as running before it executes, and the Host signals
  // only after the post committed inside that tool, so the listing at signal
  // time already shows it. The check fails closed: a listing that cannot be
  // read, or is not a list of parts, is no evidence that the posting tool
  // ended. After one bounded recheck the abort optimization is dropped for this
  // run and the turn ends on its own (seventh review P1-2).
  const LISTING_ATTEMPTS = 2;
  let abandoned = false;
  const trustedParts = (parts) =>
    Array.isArray(parts) && parts.every((part) => isRecord(part));
  const fire = () => {
    if (requested || ended || confirming || abandoned) return;
    if (inFlightTools === undefined) return abort();
    confirming = true;
    const attempt = (remaining) =>
      Promise.resolve()
        .then(() => inFlightTools())
        .then((parts) => {
          if (!trustedParts(parts)) throw new Error("untrusted tool listing");
          return parts;
        })
        .then(
          (parts) => {
            confirming = false;
            for (const part of parts) register(part);
            if (tools.size === 0) abort();
          },
          () => {
            if (remaining > 1 && !ended) return attempt(remaining - 1);
            confirming = false;
            abandoned = true;
          },
        );
    void attempt(LISTING_ATTEMPTS);
  };
  const abort = () => {
    if (requested || ended) return;
    requested = true;
    if (!postIdentified) {
      window = true;
      if (outputSinceIdle && toolRoundEnded) followUp = true;
    }
    let pending;
    try {
      pending = Promise.resolve(interrupt());
    } catch (error) {
      pending = Promise.reject(error);
    }
    pending.then(
      (answer) => {
        accepted = answer === true;
      },
      () => {
        accepted = "unknown";
      },
    );
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
    /** One assistant part (`message.part.updated`) of this run. */
    observePart(part) {
      if (!isRecord(part)) return;
      // The prompt's answer can outrun the stream's tail (separate
      // connections): after settling, only keep the in-flight count exact.
      if (ended) {
        const status = isRecord(part.state) ? part.state.status : undefined;
        if (
          part.type === "tool" &&
          (status === "completed" || status === "error")
        ) {
          finished.add(partId(part));
          tools.delete(partId(part));
        }
        return;
      }
      const type = part.type;
      if (type === "text" || type === "reasoning" || type === "step-start") {
        output(type !== "step-start");
      } else if (type === "tool") {
        const id = partId(part);
        const status = isRecord(part.state) ? part.state.status : undefined;
        const terminalStatus = status === "completed" || status === "error";
        if (!tools.has(id) && !terminalStatus && !finished.has(id)) {
          tools.set(id, false);
          output(false);
        }
        if (tools.has(id) && postingCommand(part)) {
          tools.set(id, true);
          postIdentified = true;
        }
        if (terminalStatus) finished.add(id);
        if (terminalStatus && tools.has(id)) {
          const posting = tools.get(id) === true;
          tools.delete(id);
          if (posting && !window) window = true;
          if (tools.size === 0) {
            toolRoundEnded = true;
            outputSinceIdle = false;
          }
        }
      }
      if (armed && !requested && tools.size === 0) fire();
    },
    /**
     * The live bus lost events (an SSE reconnect): a follow-up generation in
     * the gap cannot be ruled out, so a clean window is no longer proof.
     */
    observeGap() {
      if (ended) return;
      ambiguous = true;
    },
    /** A streamed text/reasoning delta of an assistant part of this run. */
    observeDelta() {
      if (ended) return;
      output(true);
    },
    /** The Host's signal; false when already armed or the run settled. */
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
    /**
     * The prompt's answer: `aborted` when the last assistant carries
     * `MessageAbortedError` or still ends in `tool-calls` (the loop only exits
     * on its own with another finish), false for a natural end, undefined when
     * the prompt never answered.
     */
    settle(aborted) {
      if (ended) return;
      ended = true;
      terminal = typeof aborted === "boolean" ? aborted : undefined;
    },
    report() {
      return {
        requested,
        accepted: !requested ? "unknown" : accepted,
        terminal: !requested || terminal === undefined ? "unknown" : terminal,
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
