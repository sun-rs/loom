/** Raft's bounded inbox wake, with RAH's finite Activation and read/ACK contract. */
export function providerActivationInput() {
  return `Start this RAH OS Activation now. Use the current process environment, not a previous turn's Room, range, or Worker path.
Your first Worker call is \`"$RAH_WORKER_CLI" worker message-check --startup\`. It returns the current Agent identity and execution scope, the complete original MEMORY.md, and the current Activation's canonical messages together. This fulfills those startup reads; read additional notes only when needed. Inspect the returned content before acting. If the command fails, correct that failure; never infer missing memory or no work from an error. Delivery acknowledgement is not a reply or Task completion.
Handle this input using the standing instructions and publish explicit Room actions. Once the assigned work and required delivery are handled, finish this turn. Do not poll for or consume future peer replies just to keep the lane busy; RAH retains later work for follow-up. Never stop unfinished authorized work merely because you posted a progress message.`;
}

/** Role instances may never replace a bound native session implicitly. */
export function assertSessionReplacementAllowed() {
  if (process.env.RAH_REQUIRE_SESSION_CONTINUITY === "1") {
    throw new Error(
      "RAH_SESSION_CONTINUITY_REQUIRED: 原生会话无法继续，已停止；未创建替代会话。请检查运行时会话或账号状态。",
    );
  }
}
