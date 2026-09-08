import type { z } from "zod";
import type {
  RoomKernel,
  WorkerProfileMetadataPort,
  AuthenticatedWorkerExecutionContext,
} from "@rah-os/kernel";
import * as P from "@rah-os/protocol";

export const WORKER_READ_ROUTE_PATHS = [
  "/v1/worker/auth/whoami",
  "/v1/worker/rooms/read",
  "/v1/worker/messages/search",
  "/v1/worker/rooms/list",
  "/v1/worker/rooms/resolve",
  "/v1/worker/attachments/comments",
  "/v1/worker/attachments/capabilities",
  "/v1/worker/messages/history",
  "/v1/worker/messages/resolve",
  "/v1/worker/room/members",
  "/v1/worker/server/info",
  "/v1/worker/profiles/get",
  "/v1/worker/tasks/list",
  "/v1/worker/tasks/history",
] as const;

export function handleWorkerReadRequest(
  kernel: RoomKernel,
  execution: AuthenticatedWorkerExecutionContext,
  route: string,
  body: Record<string, unknown>,
  parse: <T>(schema: z.ZodType<T>, body: Record<string, unknown>) => T,
  metadata?: WorkerProfileMetadataPort,
): unknown {
  switch (route) {
    case "/v1/worker/rooms/read":
      return kernel.workerTargetContext.read(
        execution,
        parse(P.WorkerRoomContextRequestSchema, body),
      );
    case "/v1/worker/messages/search":
      return kernel.workerReads.search(
        execution,
        parse(P.WorkerMessageSearchRequestSchema, body),
      );
    case "/v1/worker/auth/whoami":
      return kernel.workerReads.whoami(
        execution,
        parse(P.WorkerIntrospectionRequestSchema, body),
      );
    case "/v1/worker/rooms/list":
      return kernel.workerReads.rooms(
        execution,
        parse(P.WorkerRoomListRequestSchema, body),
      );
    case "/v1/worker/rooms/resolve":
      return kernel.workerReads.room(
        execution,
        parse(P.WorkerRoomResolveRequestSchema, body),
      );
    case "/v1/worker/attachments/comments":
      return kernel.attachmentComments.workerList(
        execution,
        parse(P.AttachmentCommentsRequestSchema, body),
      );
    case "/v1/worker/attachments/capabilities":
      return kernel.workerReads.uploadCapabilities(
        execution,
        parse(P.WorkerAttachmentUploadCapabilitiesRequestSchema, body),
      );
    case "/v1/worker/messages/history":
      return kernel.workerReads.history(
        execution,
        parse(P.WorkerHistoryRequestSchema, body),
      );
    case "/v1/worker/messages/resolve":
      return kernel.workerReads.resolve(
        execution,
        parse(P.WorkerMessageResolveRequestSchema, body),
      );
    case "/v1/worker/room/members":
      return kernel.workerReads.members(
        execution,
        parse(P.WorkerMembersRequestSchema, body),
        metadata,
      );
    case "/v1/worker/server/info":
      return kernel.workerReads.serverInfo(
        execution,
        parse(P.WorkerMembersRequestSchema, body),
        metadata,
      );
    case "/v1/worker/profiles/get":
      return kernel.workerReads.profile(
        execution,
        parse(P.WorkerProfileReadRequestSchema, body),
        metadata,
      );
    case "/v1/worker/tasks/list":
      return kernel.workerReads.tasks(
        execution,
        parse(P.WorkerTaskListRequestSchema, body),
      );
    case "/v1/worker/tasks/history":
      return kernel.workerReads.taskHistory(
        execution,
        parse(P.WorkerTaskHistoryRequestSchema, body),
      );
    default:
      return undefined;
  }
}
