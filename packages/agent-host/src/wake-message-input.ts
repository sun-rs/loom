/**
 * S1-d bodied wake: the Activation's new Room events, already rendered by the
 * Kernel (`/v1/worker/message-present`), become the wake turn's text instead of
 * the fixed `providerActivationInput()` literal that mandates a startup check.
 *
 * Shape follows Raft Computer 1.0.32 `formatConcreteMessagesRuntimeInput`
 * (`slices/packages/daemon/dist/chunk-TEGPBMW7.js:24366-24379`): header, the
 * rendered bodies, an optional notice for what was not rendered, Raft's closing
 * line and response-target hint verbatim. RAH differences, each deliberate:
 *
 * - every event line is rendered by the same function `message-check` uses
 *   (`renderWorkerEventLines`), so it carries the real Room `seq`, the author
 *   handle and the canonical target, and a non-message business fact (a Task
 *   change, a membership change) is shown rather than skipped; execution-audit
 *   events were already covered-but-omitted by the Kernel's projection;
 * - RAH keeps the model-submitted causal marker as the only implicit
 *   acknowledgement evidence, so the text states the contiguous
 *   `presentedThroughSeq` and, when that prefix reaches the Activation head,
 *   the exact `--based-on-room-seq` value to reply with. A truncated window
 *   instead asks for `message-check` first;
 * - an Activation handled without a reply still needs the explicit
 *   `message-check` acknowledgement; the text says so in one line.
 */
import type { WorkerMessagePresentResponse } from "@rah-os/protocol";

import {
  ACTIVATION_ENVIRONMENT_LINE,
  ACTIVATION_FINISH_RULES,
} from "./provider-activation-input.js";
import { renderWorkerEventLines } from "./worker-read-render.ts";

/** `RAFT_CHUNK:24350`, verbatim. */
export const RESPONSE_TARGET_HINT =
  "Reply in the channel or create/reply in a thread as appropriate; use each message's `target` and `msg` fields to choose the exact target.";

/** `RAFT_CHUNK:24377`, verbatim. */
export const WAKE_CLOSING_LINE =
  "Respond as appropriate. Complete all your work before stopping.";

export type BodiedWakeMemory = {
  /** The complete current MEMORY.md, verbatim. */
  content: string;
  /**
   * `changed`: the native session's system snapshot differs from the current
   * file. `not_in_system`: this launch carries no system snapshot (tool mode).
   */
  reason: "changed" | "not_in_system";
};

function noticeLines(present: WorkerMessagePresentResponse): string[] {
  if (present.noticeCount <= 0) return [];
  const range =
    present.noticeFromSeq === undefined || present.noticeToSeq === undefined
      ? ""
      : ` in sequence range ${present.noticeFromSeq}-${present.noticeToSeq}`;
  const plural = present.noticeCount === 1 ? "event" : "events";
  return [
    `[RAH inbox notice: ${present.noticeCount} further Room ${plural}${range} were not rendered into this turn.]`,
    'They are not confirmed by replying. Run `"$RAH_WORKER_CLI" worker message-check` to read them before you finish; deferring them does not establish that there is no work.',
  ];
}

function memoryLines(memory: BodiedWakeMemory | undefined): string[] {
  if (memory === undefined) return [];
  return [
    "## Complete original MEMORY.md",
    memory.reason === "changed"
      ? "Your memory index changed since this session's system snapshot; this is the current complete index. Read it completely."
      : "This launch carries no system copy of your memory index; this is the current complete index. Read it completely.",
    memory.content,
  ];
}

/**
 * Returns undefined when nothing is confirmable (the very first event in the
 * range degraded to notice): the caller then keeps the fixed startup wake.
 */
export function formatBodiedWakeInput(input: {
  present: WorkerMessagePresentResponse;
  memory?: BodiedWakeMemory | undefined;
}): string | undefined {
  const { present } = input;
  const through = present.presentedThroughSeq;
  if (through <= 0 || present.events.length === 0) return undefined;
  // Only a window that reaches the Activation head can be confirmed by a
  // reply: the originating post route requires `basedOnRoomSeq === toSeq`,
  // and a `--target` post citing a shorter prefix is held as stale.
  const complete = through === present.toSeq && present.noticeCount === 0;
  const messageCount = present.events.filter(
    (event) => event.type === "message.posted",
  ).length;
  const sections: string[][] = [
    [ACTIVATION_ENVIRONMENT_LINE],
    [
      messageCount === 1 ? "New message received:" : "New messages received:",
      "",
      renderWorkerEventLines(present.events, present.addressing),
    ],
    noticeLines(present),
    complete
      ? [
          `Delivery: the events above are contiguous through seq ${through}, the end of this Activation. Reply once with \`"$RAH_WORKER_CLI" worker message-post --based-on-room-seq ${through}\` (body on stdin as usual; with no \`--target\` it replies where these messages arrived — add \`--target\` only to address a different Room, Thread or DM). A successful post with that flag confirms delivery through seq ${through}; no message-check is needed first.`,
          'If no reply is needed, run `"$RAH_WORKER_CLI" worker message-check` once instead; that confirms delivery. Delivery confirmation is not a reply or Task completion.',
        ]
      : [
          `Delivery: the events above are contiguous only through seq ${through}; this Activation continues through seq ${present.toSeq}. Run \`"$RAH_WORKER_CLI" worker message-check\` first to read the rest; it confirms delivery. Then reply with \`message-post\` as usual.`,
        ],
    memoryLines(input.memory),
    [WAKE_CLOSING_LINE, RESPONSE_TARGET_HINT, ACTIVATION_FINISH_RULES],
  ];
  return sections
    .filter((section) => section.length > 0)
    .map((section) => section.join("\n"))
    .join("\n\n");
}
