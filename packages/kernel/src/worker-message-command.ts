import { recordWorkerRunMessageWrite } from "./worker-run-message-writes.ts";
import * as HeldReadCoverage from "./held-read-coverage.ts";
import * as ReadCoverage from "./activation-read-coverage.ts";
import type { AttachmentCommentsService } from "./attachment-comments.ts";
import type { DatabaseSync } from "node:sqlite";
import {
  WorkerMessagePostRequestSchema,
  type ActivationCredentialScope,
  type RoomEvent,
  type WorkerMessagePostRequest,
} from "@rah-os/protocol";
import type { AuthenticatedWorkerExecutionContext } from "./auth.ts";
import type { CollaborationService } from "./collaboration-service.ts";
import type { RoomFiles } from "./room-files.ts";
import { resolveWorkerReplyRoute } from "./worker-message-routing.ts";
import { assertWorkerReplyTarget } from "./worker-reply-target-guard.ts";
import { integer, text, type Row } from "./sqlite-row.ts";
import { NotFoundError } from "./errors.ts";
import {
  findActiveHeldMessageDraftForTarget,
  heldDraftReplyIntent,
  heldDraftResendJudgement,
  SEND_DRAFT_NOT_FOUND_MESSAGE,
  settleHeldDraftReplyIntent,
} from "./held-message-drafts.ts";
import { deriveWorkerMessageIdempotencyKey } from "./worker-message-identity.ts";
import type { Principal } from "./types.ts";
import { workerMessageAttachments } from "./worker-message-attachments.ts";

/** Called inside the Kernel's existing transaction. Files and the canonical
 * message commit together; a freshness-held draft never publishes the files. */
export function postWorkerMessageTransaction(context: {
  finalOutput?: boolean;
  comments: AttachmentCommentsService;
  database: DatabaseSync;
  collaboration: CollaborationService;
  files: RoomFiles;
  principal: Principal;
  scope: ActivationCredentialScope;
  execution: AuthenticatedWorkerExecutionContext;
  input: WorkerMessagePostRequest;
  now: () => Date;
  eventFromRow: (row: Row) => RoomEvent;
  acknowledge: (
    scope: ActivationCredentialScope,
    input: { postedRoomId: string; modelBasedOnRoomSeq: number | undefined },
  ) => void;
  recordFinal: (scope: ActivationCredentialScope, event: RoomEvent) => void;
}) {
  const { database, scope, files, execution } = context;
  const parsed = WorkerMessagePostRequestSchema.parse(context.input);
  // Raft's tool supplies neither a cursor nor an idempotency key. On the
  // originating route the server derives the cursor from the Activation head it
  // already fenced, and resolves the saved draft for this target itself.
  const heldDraftId =
    parsed.sendDraft !== true
      ? undefined
      : (parsed.heldDraftId ??
        (() => {
          const saved = findActiveHeldMessageDraftForTarget(database, {
            participantId: scope.participantId,
            roomId: scope.roomId,
            ...(parsed.threadId == null ? {} : { threadId: parsed.threadId }),
            nowMs: context.now().getTime(),
          });
          if (saved === undefined)
            throw new NotFoundError(SEND_DRAFT_NOT_FOUND_MESSAGE);
          return text(saved, "held_draft_id");
        })());
  const draftRow =
    heldDraftId === undefined
      ? undefined
      : database
          .prepare("SELECT * FROM held_message_drafts WHERE held_draft_id = ?")
          .get(heldDraftId);
  const basedOnRoomSeq = parsed.basedOnRoomSeq ?? scope.toSeq;
  const idempotencyKey =
    parsed.idempotencyKey ??
    deriveWorkerMessageIdempotencyKey({
      participantId: scope.participantId,
      activationId: scope.activationId,
      roomId: scope.roomId,
      ...(parsed.threadId == null ? {} : { threadId: parsed.threadId }),
      basedOnRoomSeq,
      content:
        draftRow === undefined
          ? {
              kind: "compose",
              ...(parsed.body === undefined ? {} : { body: parsed.body }),
              ...(parsed.attachmentIds === undefined
                ? {}
                : { attachmentIds: parsed.attachmentIds }),
              ...(parsed.commentAttachmentId === undefined
                ? {}
                : { commentAttachmentId: parsed.commentAttachmentId }),
            }
          : {
              kind: "draft",
              heldDraftId: heldDraftId!,
              reholdCount: integer(draftRow, "rehold_count"),
            },
    });
  const input: WorkerMessagePostRequest & { idempotencyKey: string } = {
    ...parsed,
    basedOnRoomSeq,
    idempotencyKey,
    ...(heldDraftId === undefined ? {} : { heldDraftId }),
  };
  const route = resolveWorkerReplyRoute({ ...context, input });
  // `--send-draft` restores the held send's own causal marker and `--final`
  // (same Activation only) through the step the target route shares.
  const intent = heldDraftReplyIntent(
    draftRow,
    scope.activationId,
    context.input,
  );
  // Judged on the normalized target, like the `--target` route. A saved draft
  // keeps the verdict of its held send; a resend that newly makes it this
  // turn's reply is judged on the draft's own target.
  if (heldDraftId === undefined)
    assertWorkerReplyTarget(database, scope, {
      roomId: scope.roomId,
      threadId: route.threadId,
      modelBasedOnRoomSeq: context.input.basedOnRoomSeq,
      final: parsed.final,
    });
  else {
    const judgement = heldDraftResendJudgement(draftRow, scope, intent);
    if (judgement !== undefined)
      assertWorkerReplyTarget(database, scope, judgement);
  }
  const attachmentComment = context.comments.workerMetadata(execution, input, {
    roomId: scope.roomId,
    ...(route.threadId === undefined ? {} : { threadId: route.threadId }),
  });
  const attachments = workerMessageAttachments({
    database,
    input,
    roomId: scope.roomId,
    eventFromRow: context.eventFromRow,
    resolveLive: (ids) => files.forWorkerMessage(execution, ids),
  });
  const previousHeld = database
    .prepare(
      "SELECT held_draft_id FROM held_message_drafts WHERE room_id=? AND idempotency_key=?",
    )
    .get(scope.roomId, idempotencyKey);
  const result = context.collaboration.postActivationMessage(
    context.principal,
    {
      activationId: scope.activationId,
      ...(context.finalOutput || parsed.final === true
        ? { replyReturnRunAttemptId: scope.runAttemptId }
        : {}),
      ...(context.finalOutput
        ? { finalOutputRunAttemptId: scope.runAttemptId }
        : {}),
      basedOnRoomSeq,
      // No presented floor here, and the omission is load-bearing rather than
      // an oversight. This route's own gate is `basedOnRoomSeq === scope.toSeq`
      // (`resolveWorkerReplyRoute`, `worker-message-routing.ts:192-193`), so
      // the causal marker is always the Activation head, and the presented
      // prefix is by construction at most that head — `Math.max` with it can
      // never raise this floor. A mutation adding it turns no test red because
      // it cannot change an outcome. Making the prefix meaningful on this route
      // means letting the marker be BELOW the head, which is a change to that
      // staleness gate and a separate decision.
      idempotencyKey,
      recipients: route.recipients,
      roomId: scope.roomId,
      attachments,
      ...(attachmentComment ? { attachmentComment } : {}),
      ...(input.sendDraft === true
        ? {
            heldDraftId: heldDraftId!,
            ...(input.anyway === true ? { continueAnyway: true } : {}),
          }
        : { body: input.body ?? "" }),
      ...(route.threadId === undefined ? {} : { threadId: route.threadId }),
    },
  );
  recordWorkerRunMessageWrite(database, scope.runAttemptId, result);
  if ("event" in result && !result.deduplicated)
    files.consume(attachments, result.event.aggregateId);
  context.comments.bindWorkerResult(attachmentComment, result);
  // Raft hides the ACK inside `raft message check` (main.js@729502). RAH's
  // ACK stays credential-bound and model-side, but a post that the model
  // based on content the Host already presented in this RunAttempt carries
  // the same evidence, so it no longer needs a separate check turn. Only the
  // presented prefix is acknowledged; a notice-degraded sequence stops the
  // cursor and still requires an explicit `message-check`. A held send keeps
  // its intent on the draft for resend or same-target revision.
  settleHeldDraftReplyIntent({
    database,
    scope,
    intent,
    result,
    confirmReadCoverage: (s, e, seq) =>
      ReadCoverage.confirmPost(database, s, e, seq),
    acknowledge: context.acknowledge,
    recordFinal: context.recordFinal,
  });
  if ("state" in result && result.state === "held") {
    const readReceiptId = HeldReadCoverage.record(
      database,
      scope,
      result,
      previousHeld?.held_draft_id !== result.heldDraftId,
    );
    return { ...result, ...(readReceiptId ? { readReceiptId } : {}) };
  }
  // A token that woke nobody rides back on the successful post, exactly as
  // Raft returns unresolvedMentionHandles alongside a queued message. A
  // deduplicated post reports nothing: the first one already did.
  if (
    "event" in result &&
    !result.deduplicated &&
    route.unresolvedMentionHandles.length > 0
  )
    return {
      ...result,
      unresolvedMentionHandles: route.unresolvedMentionHandles,
    };
  return result;
}
