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
 *   head ends with Reply context metadata: exact targets, the shared
 *   --based-on-room-seq and optional turn handle. It supplies no command
 *   template or competing check option; ordinary handling lives in the
 *   standing protocol. No-directed-message and actionable Task windows request
 *   a check: Task mutations do not acknowledge delivery.
 * - a retry after an attempt that neither posted nor confirmed delivery adds
 *   one reminder line (Kernel-decided `previousAttemptUnconfirmed`); a retry
 *   after an attempt that committed a post but never confirmed delivery
 *   instead names that post (`previousAttemptReplyMessageId`) as a neutral
 *   fact — inspect it, finish what remains — and calls it the final reply
 *   only when the Kernel says it carried the final marker
 *   (`previousAttemptReplyFinal`; seventh review P2-3);
 * - a retry after a business-obligation completion refusal states that
 *   refusal and any final reply an earlier attempt committed (with its
 *   Thread) as one fact line (`previousAttemptRefusal`; D1-D 2026-09-27);
 * - a truncated window or one with a notice tail instead ends with one line
 *   asking for `message-check` first;
 * - a window carrying a catch-up (contract §3: Channel events after this
 *   consumer's cursor that did not wake it) shows them first under one factual
 *   label, then `For you:` and the Activation's own events; only the latter
 *   become `Reply context:` targets.
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
 * D1-D: the retry fact after a business-obligation completion refusal: the
 * Kernel's refusal and, when an earlier attempt's final reply committed, that
 * reply (and its Thread). Facts only; what to do next stays the model's call.
 */
export function previousAttemptRefusalLine(
  present: Pick<
    WorkerMessagePresentResponse,
    | "previousAttemptRefusal"
    | "previousAttemptReplyFinal"
    | "previousAttemptReplyMessageId"
    | "previousAttemptReplyThreadId"
  >,
): string {
  const reason = (present.previousAttemptRefusal ?? "").replace(/\.$/u, "");
  const messageId = present.previousAttemptReplyMessageId;
  if (messageId === undefined || present.previousAttemptReplyFinal !== true)
    return `Previous attempt's completion was refused: ${reason}.`;
  const thread =
    present.previousAttemptReplyThreadId === undefined
      ? ""
      : ` in thread=${shortWorkerRef(present.previousAttemptReplyThreadId)}`;
  return `Previous attempt posted its final reply msg=${shortWorkerRef(messageId)}${thread}; completion was refused: ${reason}.`;
}

/**
 * Reply metadata, not an action menu. Preserve each exact directed target
 * across compaction; the shared seq confirms the Room window, not completion.
 * No-reply and truncated windows retain their explicit check path below.
 */
function replyInstruction(
  targets: readonly string[],
  turn: string,
  through: number,
): string {
  return `Reply context: ${targets.map((target) => `--target ${target}`).join(" · ")}${turn} --based-on-room-seq ${through}`;
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

/** The catch-up block's one factual label (contract §3). */
function catchUpLabel(present: WorkerMessagePresentResponse): string {
  const omitted = present.catchUpOmittedCount ?? 0;
  if (omitted <= 0) return "Since your last read (did not wake you):";
  const range =
    present.catchUpOmittedFromSeq === undefined ||
    present.catchUpOmittedToSeq === undefined
      ? ""
      : `, seq ${present.catchUpOmittedFromSeq}-${present.catchUpOmittedToSeq}`;
  return `Since your last read (did not wake you; ${omitted} older event${omitted === 1 ? "" : "s"}${range}, not shown):`;
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
  // Contract §3 catch-up: events before the Activation range did not wake
  // this instance. They are shown as facts under their own label and never
  // become reply targets.
  // Review P1-2: inside the range, only the events that woke this instance
  // (Kernel `directedSeqs`) are its own; a merged range can carry a Human @
  // of someone else, which is background like the catch-up.
  // Absent = an older Kernel (treat the range as before); an explicit empty
  // set = nothing in this window woke the instance (review round 2).
  const directed =
    present.directedSeqs === undefined
      ? undefined
      : new Set(present.directedSeqs);
  const isOwn = (event: { roomSeq: number }) =>
    event.roomSeq >= present.fromSeq &&
    (directed === undefined || directed.has(event.roomSeq));
  const catchUp = present.events.filter((event) => !isOwn(event));
  const own = present.events.filter(isOwn);
  // Business commands do not ACK delivery: unlike message-post, they may
  // never carry the model's reply marker. Confirm before acting, not in a
  // second Run after the Task was already submitted (P90). Catch-up is inert.
  const taskDelivery = own.some(
    (event) =>
      event.type.startsWith("task.") || event.type === "review.submitted",
  );
  const instruction = complete
    ? own.length === 0
      ? `No message here woke you: message-check${turn}`
      : taskDelivery
        ? `Task delivery: run message-check${turn} first, then handle the Task events. Task commands do not acknowledge delivery.`
        : replyInstruction(
            compactWakeReplyTargets(own, present.addressing),
            turn,
            through,
          )
    : `Shown through seq ${through} of ${present.toSeq}${notice}: run message-check${turn} first, then reply.`;
  const retry =
    present.previousAttemptUnconfirmed === true
      ? `\n${PREVIOUS_ATTEMPT_UNCONFIRMED_LINE}`
      : present.previousAttemptRefusal !== undefined
        ? `\n${previousAttemptRefusalLine(present)}`
        : present.previousAttemptReplyMessageId !== undefined
          ? `\n${previousAttemptReplyLine(present.previousAttemptReplyMessageId, turn, present.previousAttemptReplyFinal === true)}`
          : "";
  const eventLines =
    catchUp.length === 0 && (present.catchUpOmittedCount ?? 0) <= 0
      ? renderCompactWakeEventLines(present.events, present.addressing)
      : [
          catchUpLabel(present),
          ...(catchUp.length === 0
            ? []
            : [renderCompactWakeEventLines(catchUp, present.addressing)]),
          ...(own.length === 0
            ? []
            : [
                "For you:",
                renderCompactWakeEventLines(own, present.addressing),
              ]),
        ].join("\n");
  const sections = [
    `${eventLines}\n${instruction}${retry}`,
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
