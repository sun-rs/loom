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
import { type Row } from "./sqlite-row.ts";
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
  eventFromRow: (row: Row) => RoomEvent;
}) {
  const { database, scope, files, execution } = context;
  const input = WorkerMessagePostRequestSchema.parse(context.input);
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
      basedOnRoomSeq: input.basedOnRoomSeq,
      idempotencyKey: input.idempotencyKey,
      recipients: route.recipients,
      roomId: scope.roomId,
      attachments,
      ...(attachmentComment ? { attachmentComment } : {}),
      ...(input.sendDraft === true
        ? {
            heldDraftId: input.heldDraftId!,
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
