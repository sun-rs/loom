import { createHash } from "node:crypto";
import type {
  ActivationCredentialScope,
  WorkerMessagePostRequest,
} from "@rah-os/protocol";
import { ForbiddenError, NotFoundError } from "./errors.ts";
import { integer, text, type Row } from "./sqlite-row.ts";

/** A deliberate revision confirms only this draft's frozen hold notice, not a
 * later read position. Reply ACK/final still use the original saved intent.
 * Do not check active/TTL here: collaboration checks those after its durable
 * idempotency lookup, so a lost successful response is safe to replay. */
export function heldRevisionWindow(
  scope: ActivationCredentialScope,
  roomId: string,
  threadId: string | undefined,
  input: WorkerMessagePostRequest,
  row: Row | undefined,
) {
  if (!row) throw new NotFoundError("Saved draft was not found");
  if (
    text(row, "participant_id") !== scope.participantId ||
    text(row, "activation_id") !== scope.activationId ||
    text(row, "room_id") !== roomId ||
    (row.thread_id ?? null) !== (threadId ?? null)
  )
    throw new ForbiddenError(
      "Draft revision is outside this execution or reply target",
    );
  // A target-confirmation draft has no rendered freshness notice. Its saved
  // seen bound must not become a review proof. In this slice accept only
  // originating drafts carrying the model's original reply marker: that send
  // passed the structural target guard and therefore never used that heuristic.
  if (roomId !== scope.roomId || row.reply_based_on_room_seq === null)
    throw new ForbiddenError(
      "Revision requires an original reply marker in this Activation's Room; use normal compose otherwise",
    );
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        "held-revision-v1",
        scope.participantId,
        scope.activationId,
        roomId,
        threadId ?? null,
        input.reviseDraftId,
        input.body,
      ]),
    )
    .digest("hex");
  return {
    basedOnRoomSeq: integer(row, "based_on_room_seq"),
    freshnessFloorSeq: integer(row, "seen_up_to_seq"),
    idempotencyKey: input.idempotencyKey ?? `revision-${digest.slice(0, 32)}`,
  };
}
