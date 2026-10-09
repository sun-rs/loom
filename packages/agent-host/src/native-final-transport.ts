import type { WorkerMessagePresentResponse } from "@rah-os/protocol";
import { compactWakeReplyTargets } from "./worker-read-render.ts";

/** Per-Run transport binding, not a second delivery cursor. Kernel still
 * validates target, freshness and acknowledged delivery at publication. */
export function nativeFinalSequence(
  present: WorkerMessagePresentResponse,
): number | undefined {
  if (
    present.presentedThroughSeq !== present.toSeq ||
    present.noticeCount !== 0
  )
    return;
  const own = present.events.filter(
    (event) =>
      event.roomSeq >= present.fromSeq &&
      (present.directedSeqs === undefined ||
        present.directedSeqs.includes(event.roomSeq)),
  );
  if (
    !own.some((event) => event.type === "message.posted") ||
    own.some(
      (event) =>
        event.type.startsWith("task.") || event.type === "review.submitted",
    ) ||
    compactWakeReplyTargets(own, present.addressing).length !== 1
  )
    return;
  return present.presentedThroughSeq;
}

/** The Host constructs the old wire envelope; the model emits only text.
 * Empty string deliberately uses WorkerFinalOutput's invalid/no-send receipt. */
export function nativeFinalEnvelope(
  text: string | undefined,
  deliveredSeq: number | undefined,
): string {
  if (!text?.trim() || deliveredSeq === undefined) return "";
  return JSON.stringify({
    kind: "room.reply",
    version: 1,
    body: text,
    final: true,
    basedOnRoomSeq: deliveredSeq,
  });
}
