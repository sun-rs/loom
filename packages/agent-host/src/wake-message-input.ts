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
 *   head ends with one `Reply:` line: a complete command naming the exact
 *   `--target` of the delivered messages (one command per target when the
 *   window spans several) and `--based-on-room-seq` (RAH's only implicit
 *   acknowledgement evidence), plus the no-reply `message-check` exit;
 * - a retry after an attempt that neither posted nor confirmed delivery adds
 *   one reminder line (Kernel-decided `previousAttemptUnconfirmed`); a retry
 *   after an attempt that committed a post but never confirmed delivery
 *   instead names that post (`previousAttemptReplyMessageId`) as a neutral
 *   fact — inspect it, finish what remains — and calls it the final reply
 *   only when the Kernel says it carried the final marker
 *   (`previousAttemptReplyFinal`; seventh review P2-3);
 * - a truncated window or one with a notice tail instead ends with one line
 *   asking for `message-check` first.
 */
import {
  shortWorkerRef,
  type WorkerMessagePresentResponse,
} from "@rah-os/protocol";

import {
  renderChannelMemoryDelta,
  renderChannelMemoryIndexRefresh,
} from "./channel-memory-index.ts";
import { turnArgument } from "./provider-activation-input.js";
import {
  compactWakeReplyTargets,
  renderCompactWakeEventLines,
} from "./worker-read-render.ts";

/** The one-line retry reminder; the Kernel decides when it applies. */
export const PREVIOUS_ATTEMPT_UNCONFIRMED_LINE =
  "Previous attempt ended without a reply or message-check.";

/**
 * The one-line retry notice when the previous attempt's post already landed.
 * Neutral unless that post carried the final-reply marker: a progress post or
 * one target's answer is not a completed reply.
 */
export function previousAttemptReplyLine(
  messageId: string,
  turn: string,
  final = false,
) {
  const ref = shortWorkerRef(messageId);
  return final
    ? `Previous attempt posted its final reply msg=${ref}; confirm delivery with message-check${turn}.`
    : `Previous attempt posted msg=${ref}; inspect it and finish any remaining work (it does not show every target was answered), or message-check${turn} if nothing remains.`;
}

/**
 * The complete reply command(s). The model always copies an explicit target,
 * so the target is stated rather than left to memory that compaction rewrites.
 * Any one post citing the head confirms the whole window (the implicit ACK is
 * per Room), so a multi-target window lists one command per target and
 * `--final` moves to the model's last post.
 */
function replyInstruction(
  targets: readonly string[],
  turn: string,
  through: number,
): string {
  const post = (target: string) =>
    `message-post --target ${target}${turn} --based-on-room-seq ${through}`;
  const check = `no reply needed: message-check${turn}`;
  if (targets.length <= 1)
    return `Reply: ${post(targets[0] ?? "")} --final · ${check}`;
  return `Reply per target (--final on your last post only): ${targets
    .map(post)
    .join(" · ")} · ${check}`;
}

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
    ? replyInstruction(
        compactWakeReplyTargets(present.events, present.addressing),
        turn,
        through,
      )
    : `Shown through seq ${through} of ${present.toSeq}${notice}: run message-check${turn} first, then reply.`;
  const retry =
    present.previousAttemptUnconfirmed === true
      ? `\n${PREVIOUS_ATTEMPT_UNCONFIRMED_LINE}`
      : present.previousAttemptReplyMessageId !== undefined
        ? `\n${previousAttemptReplyLine(present.previousAttemptReplyMessageId, turn, present.previousAttemptReplyFinal === true)}`
        : "";
  const sections = [
    `${renderCompactWakeEventLines(present.events, present.addressing)}\n${instruction}${retry}`,
    ...memoryLines(input.memory),
    ...(present.memoryDelta === undefined
      ? []
      : [renderChannelMemoryDelta(present.memoryDelta)]),
    ...(present.memoryIndex === undefined
      ? []
      : [renderChannelMemoryIndexRefresh(present.memoryIndex)]),
  ];
  return sections.join("\n\n");
}
