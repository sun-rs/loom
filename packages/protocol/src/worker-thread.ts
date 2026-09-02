import { z } from "zod";

import { IdentifierSchema } from "./common.ts";
import { RoomEventSchema } from "./room-event.ts";

export const WorkerThreadUnfollowRequestSchema = z
  .object({
    basedOnRoomSeq: z.number().int().nonnegative(),
    idempotencyKey: IdentifierSchema,
    threadId: IdentifierSchema,
  })
  .strict();
export type WorkerThreadUnfollowRequest = z.infer<
  typeof WorkerThreadUnfollowRequestSchema
>;

export const WorkerThreadUnfollowResponseSchema = z
  .object({
    deduplicated: z.boolean(),
    event: RoomEventSchema,
    following: z.literal(false),
    threadId: IdentifierSchema,
  })
  .strict();
export type WorkerThreadUnfollowResponse = z.infer<
  typeof WorkerThreadUnfollowResponseSchema
>;
