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
import { integer, text, type Row } from "./sqlite-row.ts";
import { NotFoundError } from "./errors.ts";
import {
  findActiveHeldMessageDraftForTarget,
  SEND_DRAFT_NOT_FOUND_MESSAGE,
} from "./held-message-drafts.ts";
import { deriveWorkerMessageIdempotencyKey } from "./worker-message-identity.ts";
import type { Principal } from "./types.ts";
import { workerMessageAttachments } from "./worker-message-attachments.ts";

/** Called inside the Kernel's existing transaction. Files and the canonical
 * message commit together; a freshness-held draft never publishes the files. */
export function postWorkerMessageTransaction(context: {
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
  const result = context.collaboration.postActivationMessage(
    context.principal,
    {
      activationId: scope.activationId,
      basedOnRoomSeq,
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
  if ("event" in result && !result.deduplicated)
    files.consume(attachments, result.event.aggregateId);
  context.comments.bindWorkerResult(attachmentComment, result);
  return result;
}
