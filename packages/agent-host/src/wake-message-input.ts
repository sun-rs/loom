/**
 * S1-d bodied wake: the Activation's new Room events, already rendered by the
 * Kernel (`/v1/worker/message-present`), become the wake turn's text instead of
 * the fixed `providerActivationInput()` literal that mandates a startup check.
 *
 * Wake compaction (2026-09-24): every turn's wake stays in native history for
 * the life of the session, so it carries only what differs per turn — the
 * rendered events, the confirm-through seq and (warm) the turn handle. Every
 * constant rule the earlier wake repeated (the environment line, the Delivery
 * paragraph, Raft's closing line and response-target hint from
 * `formatConcreteMessagesRuntimeInput`, `slices/packages/daemon/dist/
 * chunk-TEGPBMW7.js:24350/24377`, and the finish rules) is stated once in the
 * standing prompt (`packages/daemon/src/standing-prompt-compiler.ts`).
 *
 * - each event line is `renderCompactWakeEventLines`: canonical target, real
 *   Room seq, short message ref, author and body; a non-message business fact
 *   keeps a compact type and payload;
 * - a window whose contiguous `presentedThroughSeq` reaches the Activation
 *   head ends with one `Reply:` line naming the exact `--based-on-room-seq`
 *   (RAH's only implicit acknowledgement evidence) and the no-reply
 *   `message-check` exit;
 * - a truncated window or one with a notice tail instead ends with one line
 *   asking for `message-check` first.
 */
import type { WorkerMessagePresentResponse } from "@rah-os/protocol";

import { turnArgument } from "./provider-activation-input.js";
import { renderCompactWakeEventLines } from "./worker-read-render.ts";

export type BodiedWakeMemory = {
  /** The complete current MEMORY.md, verbatim. */
  content: string;
  /**
   * `changed`: the native session's system snapshot differs from the current
   * file. `not_in_system`: this launch carries no system snapshot (tool mode).
   */
  reason: "changed" | "not_in_system";
};

function memoryLines(memory: BodiedWakeMemory | undefined): string[] {
  if (memory === undefined) return [];
  return [
    [
      "## Complete original MEMORY.md",
      memory.reason === "changed"
        ? "Your memory index changed since this session's system snapshot; this is the current complete index. Read it completely."
        : "This launch carries no system copy of your memory index; this is the current complete index. Read it completely.",
      memory.content,
    ].join("\n"),
  ];
}

/**
 * Returns undefined when nothing is confirmable (the very first event in the
 * range degraded to notice): the caller then keeps the fixed startup wake.
 */
export function formatBodiedWakeInput(input: {
  present: WorkerMessagePresentResponse;
  memory?: BodiedWakeMemory | undefined;
  /** Warm runtimes: this turn's Worker handle, carried on every command. */
  turnHandle?: string | undefined;
}): string | undefined {
  const { present } = input;
  const through = present.presentedThroughSeq;
  if (through <= 0 || present.events.length === 0) return undefined;
  const turn = turnArgument(input.turnHandle);
  // Only a window that reaches the Activation head can be confirmed by a
  // reply: the originating post route requires `basedOnRoomSeq === toSeq`,
  // and a `--target` post citing a shorter prefix is held as stale.
  const complete = through === present.toSeq && present.noticeCount === 0;
  const notice =
    present.noticeCount <= 0
      ? ""
      : `; ${present.noticeCount} more event${present.noticeCount === 1 ? "" : "s"}${
          present.noticeFromSeq === undefined ||
          present.noticeToSeq === undefined
            ? ""
            : ` (seq ${present.noticeFromSeq}-${present.noticeToSeq})`
        } not shown`;
  const instruction = complete
    ? `Reply: message-post${turn} --based-on-room-seq ${through} · no reply needed: message-check${turn}`
    : `Shown through seq ${through} of ${present.toSeq}${notice}: run message-check${turn} first, then reply.`;
  const sections = [
    `${renderCompactWakeEventLines(present.events, present.addressing)}\n${instruction}`,
    ...memoryLines(input.memory),
  ];
  return sections.join("\n\n");
}
