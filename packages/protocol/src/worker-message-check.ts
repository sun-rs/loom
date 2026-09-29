import { z } from "zod";
import { WorkerSyncResponseSchema } from "./worker-presented-context.ts";

export const WorkerMessageCheckRequestSchema = z
  .object({ replay: z.boolean().optional() })
  .strict();
export const WorkerMessageCheckResponseSchema = z
  .object({
    readConfirmationId: z.string().uuid().optional(),
    delivery: WorkerSyncResponseSchema,
    throughSeq: z.number().int().nonnegative(),
  })
  .strict()
  .refine((value) => value.delivery.cursorAfter <= value.throughSeq, {
    message: "check cursor exceeds frozen Activation",
  });

export const WorkerReadReceivedRequestSchema = z
  .object({ readReceiptId: z.string().uuid() })
  .strict();
