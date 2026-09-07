import { z } from "zod";

import { IdentifierSchema } from "./common.ts";

export const WorkerTaskCreateRequestSchema = z
  .object({
    basedOnRoomSeq: z.number().int().nonnegative(),
    idempotencyKey: IdentifierSchema,
    title: z.string().trim().min(1),
    assigneeId: IdentifierSchema.optional(),
  })
  .strict();
export type WorkerTaskCreateRequest = z.infer<
  typeof WorkerTaskCreateRequestSchema
>;
