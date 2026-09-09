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
/**
 * The same scheme for a Task command, which Raft also never asks the model to
 * key. The identity of a Task operation is: who, in which Activation, in which
 * Room, which operation, on which subject (Task or Message), with which
 * content — plus `roundSeq`, the Room sequence of the latest event that opened
 * a *new round of owner work* on that Task (a `task.reopened`, or a
 * `review.submitted` whose disposition is changes_requested).
 *
 * `roundSeq` is the server-side form of the rule the standing prompt used to
 * teach the Agent: without it a rework round's reclaim/start/progress/submit
 * would hash to the first round's keys and deduplicate into no-ops. It moves
 * only when a real reopening event is appended, so an ordinary retry inside one
 * round still hashes identically and still deduplicates.
 *
 * The Activation's read position is deliberately NOT an input: unlike a send,
 * a committed Task command advances that position, so including it would make
 * an identical retry look new. Two genuinely distinct operations that differ in
 * nothing — the same progress note twice inside one Activation and one round —
 * therefore collapse into one, exactly as for a send; a caller that wants both
 * must present an explicit `idempotencyKey`.
 */
export function deriveWorkerTaskIdempotencyKey(input: {
  participantId: string;
  activationId: string;
  roomId: string;
  operation: string;
  subjectId: string | null;
  roundSeq: number;
  content: readonly (string | null)[];
}): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        "rah-worker-task-command-v1",
        input.participantId,
        input.activationId,
        input.roomId,
        input.operation,
        input.subjectId,
        input.roundSeq,
        [...input.content],
      ]),
    )
    .digest("hex");
  return `derived-task-${digest.slice(0, 32)}`;
}

/**
 * The same scheme once more, for the remaining commands Raft never asks the
 * model to key: a reaction, a Thread unfollow, a Channel mute or unmute, a
 * self-profile update and an attachment reservation. Raft's CLI either sends no
 * key at all or mints one itself with `randomUUID()`; RAH keeps the ledger's
 * replay check and derives the key from what the operation actually is:
 *
 *   sha256("rah-worker-command-v1", participantId, activationId, roomId,
 *          operation, subjectId, content)
 *
 * The trade-off is the one already documented for a send and for a Task
 * command: inside one Activation, at one subject, the same operation with the
 * same content is ONE logical operation, so an identical retry deduplicates and
 * a caller that genuinely wants it applied twice must present an explicit
 * `idempotencyKey`. Anything that really differs — a different emoji, a
 * different Thread or Channel, add versus remove, a different profile patch, a
 * different file — hashes differently and is a distinct operation.
 */
export function deriveWorkerCommandIdempotencyKey(input: {
  participantId: string;
  activationId: string;
  roomId: string;
  operation: string;
  subjectId: string | null;
  content: readonly (string | null)[];
}): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        "rah-worker-command-v1",
        input.participantId,
        input.activationId,
        input.roomId,
        input.operation,
        input.subjectId,
        [...input.content],
      ]),
    )
    .digest("hex");
  return `derived-${input.operation}-${digest.slice(0, 32)}`;
}

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
