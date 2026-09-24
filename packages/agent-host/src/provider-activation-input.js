/** Shared by the fixed wake and the S1-d bodied wake (`wake-message-input.ts`). */
export const ACTIVATION_ENVIRONMENT_LINE =
  "Start this RAH OS Activation now. Use the current process environment, not a previous turn's Room, range, or Worker path.";

/** Shared by the fixed wake and the S1-d bodied wake (`wake-message-input.ts`). */
export const ACTIVATION_FINISH_RULES =
  "Handle this input using the standing instructions and publish explicit Room actions. Once the assigned work and required delivery are handled, finish this turn. Do not poll for or consume future peer replies just to keep the lane busy; RAH retains later work for follow-up. Never stop unfinished authorized work merely because you posted a progress message.";

/**
 * Raft's bounded inbox wake, with RAH's finite Activation and read/ACK
 * contract. S1-d: this fixed wake remains the path for every driver without a
 * reliable acceptance signal, and for any Codex turn whose bodied wake could
 * not be prepared.
 */
const RUNTIME_NOTICE_LIMIT = 300;

/**
 * S2-0: the Host's one-line leftover-process cleanup notice for this run
 * (`RAH_RUNTIME_NOTICE`, a Host fence). The Kernel hands it to exactly one
 * RunAttempt; it is appended as a single bounded line, never Room content.
 */
export function withRuntimeNotice(text) {
  const notice = (process.env.RAH_RUNTIME_NOTICE ?? "")
    .split("\n")[0]
    .trim()
    .slice(0, RUNTIME_NOTICE_LIMIT);
  return notice === "" ? text : `${text}\n${notice}`;
}

export function providerActivationInput() {
  return withRuntimeNotice(`${ACTIVATION_ENVIRONMENT_LINE}
Your first Worker call is \`"$RAH_WORKER_CLI" worker message-check --startup\`. It returns the current Agent identity and execution scope, the complete original MEMORY.md, and the current Activation's canonical messages together. This fulfills those startup reads; read additional notes only when needed. Inspect the returned content before acting. If the command fails, correct that failure; never infer missing memory or no work from an error. Delivery acknowledgement is not a reply or Task completion.
${ACTIVATION_FINISH_RULES}`);
}

/** Role instances may never replace a bound native session implicitly. */
export function assertSessionReplacementAllowed() {
  if (process.env.RAH_REQUIRE_SESSION_CONTINUITY === "1") {
    throw new Error(
      "RAH_SESSION_CONTINUITY_REQUIRED: 原生会话无法继续，已停止；未创建替代会话。请检查运行时会话或账号状态。",
    );
  }
}
