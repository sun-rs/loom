/** Structural adaptation of Raft Computer 1.0.18 buildPrompt Message Notifications
 * (main.js:736035-736066, SHA256 20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e).
 * Worker commands and finite RunAttempt lifecycle are RAH glue, not upstream byte reuse.
 */
import type { RuntimeDeliveryMode } from "@rah-os/agent-host";
export type PromptDeliveryMode = RuntimeDeliveryMode;
export function deliveryInstructions(
  mode: PromptDeliveryMode = "wait",
): string {
  // S1-g: mode detail beyond this is served by `worker help messages`.
  const behavior =
    mode === "direct"
      ? "The daemon may write a batched, content-free inbox update into your current turn."
      : mode === "gated"
        ? "The daemon may deliver a content-free inbox notice at an allowed tool boundary; a fresh Claude session is not ready for live delivery until its first turn ends."
        : "The daemon does not proactively inject new Room notices while you are busy; pending work is retained for a follow-up Activation.";
  return `## Message Notifications

Delivery mode at launch: ${mode}. ${behavior} A notice names pending targets only: it does not acknowledge Inbox, prove you read a message, complete work or widen this Activation, and never derive "no work" from a content-free notice alone. At a natural breakpoint read it with \`"$RAH_WORKER_CLI" worker message-read --target TARGET\`.`;
}
