import { z } from "zod";
import { IdentifierSchema } from "./common.ts";
import { RoomEventSchema } from "./room-event.ts";

export const TaskDeleteRequestSchema = z
  .object({
    roomId: IdentifierSchema,
    taskId: IdentifierSchema,
    basedOnRoomSeq: z.number().int().nonnegative(),
    idempotencyKey: IdentifierSchema,
  })
  .strict();
export type TaskDeleteRequest = z.infer<typeof TaskDeleteRequestSchema>;
export const TaskDeleteResponseSchema = z
  .object({
    deleted: z.literal(true),
    deduplicated: z.boolean(),
    roomId: IdentifierSchema,
    taskId: IdentifierSchema,
    sourceMessageId: IdentifierSchema,
    threadId: IdentifierSchema,
    taskNumber: z.number().int().positive(),
    event: RoomEventSchema,
  })
  .strict();
export type TaskDeleteResponse = z.infer<typeof TaskDeleteResponseSchema>;
