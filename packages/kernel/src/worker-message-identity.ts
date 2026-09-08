import { createHash } from "node:crypto";

/**
 * Server-derived idempotency key for an Agent send that omitted one.
 *
 * Raft's tool never asks the model for an idempotency key, so RAH derives one
 * from inputs the model already supplies plus facts the server already owns:
 *
 *   sha256("rah-worker-message-post-v1", participantId, activationId, roomId,
 *          threadId | null, basedOnRoomSeq, content-digest)
 *
 * `basedOnRoomSeq` is the *stable* number for the send — the participant's
 * stored read position for that target (or the Activation head on the
 * originating route) — never the Room head, because publishing advances the
 * Room head and an identical retry must still hash to the same key.
 *
 * Dedupe semantics this produces, stated deliberately: within one Activation,
 * at one target, at one read position, identical content is ONE logical send.
 * An identical retry therefore deduplicates. Two sends are distinct whenever
 * anything real differs — different content, a different target or Thread, a
 * different Activation, or a read position that moved because the participant
 * read the target or was shown a freshness hold in between. A caller that
 * genuinely wants byte-identical content published twice at an unchanged read
 * position must still supply an explicit `idempotencyKey`; nothing in the
 * request distinguishes that case from a retry.
 */
export function deriveWorkerMessageIdempotencyKey(input: {
  participantId: string;
  activationId: string;
  roomId: string;
  threadId?: string | undefined;
  basedOnRoomSeq: number;
  content:
    | {
        kind: "compose";
        body?: string | undefined;
        attachmentIds?: readonly string[] | undefined;
        commentAttachmentId?: string | undefined;
      }
    | { kind: "draft"; heldDraftId: string; reholdCount: number };
}): string {
  const content =
    input.content.kind === "draft"
      ? ["draft", input.content.heldDraftId, String(input.content.reholdCount)]
      : [
          "compose",
          input.content.body ?? "",
          [...(input.content.attachmentIds ?? [])].sort().join(","),
          input.content.commentAttachmentId ?? "",
        ];
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        "rah-worker-message-post-v1",
        input.participantId,
        input.activationId,
        input.roomId,
        input.threadId ?? null,
        input.basedOnRoomSeq,
        content,
      ]),
    )
    .digest("hex");
  return `derived-send-${digest.slice(0, 32)}`;
}
