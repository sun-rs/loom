import { MessageSchema } from "./collaboration.ts";
import { WorkerHistoryResponseSchema } from "./worker-read-tools.ts";
import { z } from "zod";
import { IdentifierSchema } from "./common.ts";
import {
  WorkerReadChannelSchema,
  WorkerTargetReceiptSchema,
} from "./worker-room-targets.ts";
import { RoomSyncResponseSchema } from "./room-sync-response.ts";

export const WorkerRoomContextRequestSchema = z
  .object({
    channel: WorkerReadChannelSchema,
    contextReceipt: WorkerTargetReceiptSchema.optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export type WorkerRoomContextRequest = z.input<
  typeof WorkerRoomContextRequestSchema
>;
export const WorkerRoomContextResponseSchema = z
  .object({
    roomId: IdentifierSchema,
    threadId: IdentifierSchema.optional(),
    throughRoomSeq: z.number().int().nonnegative(),
    eventFloorSeq: z.number().int().nonnegative(),
    complete: z.boolean(),
    contextReceipt: WorkerTargetReceiptSchema,
    window: z.lazy(() => RoomSyncResponseSchema),
    threadContext: z
      .lazy(() =>
        z
          .object({
            rootMessage: MessageSchema,
            history: WorkerHistoryResponseSchema,
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
export type WorkerRoomContextResponse = z.infer<
  typeof WorkerRoomContextResponseSchema
>;
