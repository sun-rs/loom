import { z } from "zod";

// Computer-local commands. The capability supplies owner identity, never the
// payload. These are not Kernel /v1/worker commands or Room acknowledgements.
export const AgentAppInboxCheckCommandSchema = z.object({}).strict();
export const AgentAppInboxAckCommandSchema = z
  .object({
    itemId: z
      .string()
      .min(1)
      .max(512)
      .regex(/^[^\u0000-\u001f\u007f]+$/u),
    version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export const AgentAppInboxAckResultSchema = z
  .object({
    acknowledged: z.boolean(),
    proofScope: z.literal("notification_acknowledged_not_memory_cleaned"),
  })
  .strict();
export type AgentAppInboxAckResult = z.infer<
  typeof AgentAppInboxAckResultSchema
>;
