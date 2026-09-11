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
        ? "The daemon may deliver a target-scoped, content-free inbox notice at an allowed tool boundary. A fresh Claude session is not ready for live delivery until its first turn ends; a confirmed resumed session may be ready earlier. RAH closes this process after the turn results, so fresh-session pending work continues in a follow-up Activation rather than being written into a closing pipe."
        : "The daemon does not proactively inject new Room notices while this run is busy. Pending work is retained for a follow-up Activation after this execution ends. Already published Room messages remain readable through Worker tools.";
  return `## Message Notifications

Delivery mode at launch: ${mode}.
${behavior}

Runtime Guide settings may change while you work; the launch mode is not a promise that a notice will arrive. An actual inbox notice reports pending targets, not message bodies or a new Task authorization. It does not acknowledge Inbox, prove that you read a message, complete work, or expand this Activation's execution fence.
Treat a content-free notice as a non-urgent signal; never derive "no work" from a content-free notice alone. At a natural breakpoint, use \`"$RAH_WORKER_CLI" worker message-read --target TARGET\` to inspect the exact Room/DM/Thread identified by the notice. Preserve the original request and its reply target; do not replace it with only the latest message. If you defer, report that honestly. Read higher-priority corrections before deciding whether to pivot; follow the existing Worker authority and freshness rules, and leave work outside your execution scope to durable follow-up.
Do not keep the process alive polling for future messages. RAH manages the next Activation; it does not keep this CLI process resident between Activations.`;
}
