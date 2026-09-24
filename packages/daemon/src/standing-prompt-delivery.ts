/** Structural adaptation of Raft Computer 1.0.18 buildPrompt Message Notifications
 * (main.js:736035-736066, SHA256 20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e).
 * Worker commands and finite RunAttempt lifecycle are RAH glue, not upstream byte reuse.
 */
import type { RuntimeDeliveryMode } from "@rah-os/agent-host";
export type PromptDeliveryMode = RuntimeDeliveryMode;
export function deliveryInstructions(
  mode: PromptDeliveryMode = "wait",
): string {
  const behavior =
    mode === "direct"
      ? "While you are working, the daemon may write a batched, content-free inbox update into your current turn. Native acceptance is subject to the active turn and session checks."
      : mode === "gated"
        ? "The daemon may deliver a target-scoped, content-free inbox notice at an allowed tool boundary. A fresh Claude session is not ready for live delivery until its first turn ends (a confirmed resumed session may be ready earlier); its pending work continues in a follow-up Activation."
        : "The daemon does not proactively inject new Room notices while this run is busy. Pending work is retained for a follow-up Activation after this execution ends. Already published Room messages remain readable through Worker tools.";
  return `## Message Notifications

Delivery mode at launch: ${mode}.
${behavior}

An inbox notice names pending targets only: it does not acknowledge Inbox, prove that you read a message, complete work, or expand this Activation's execution fence, and never derive "no work" from a content-free notice alone. At a natural breakpoint, read the named target with \`"$RAH_WORKER_CLI" worker message-read --target TARGET\`, keeping the original request and its reply target. Do not poll for future messages; RAH manages the next Activation.`;
}
