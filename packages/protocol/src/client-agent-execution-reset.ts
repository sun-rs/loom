import { z } from "zod";

import { IdentifierSchema, TimestampSchema } from "./common.ts";

export const AgentExecutionResetModeSchema = z.enum([
  "restart",
  "session",
  "full",
]);
export type AgentExecutionResetMode = z.infer<
  typeof AgentExecutionResetModeSchema
>;

export const ClientAgentExecutionResetRequestSchema = z
  .object({
    agentDefinitionId: IdentifierSchema,
    basedOnRoomSeq: z.number().int().nonnegative(),
    idempotencyKey: IdentifierSchema,
    mode: AgentExecutionResetModeSchema,
  })
  .strict();
export type ClientAgentExecutionResetRequest = z.infer<
  typeof ClientAgentExecutionResetRequestSchema
>;

export const ClientAgentExecutionResetResponseSchema = z
  .object({
    agentDefinitionId: IdentifierSchema,
    completedAt: TimestampSchema,
    computerHostId: IdentifierSchema,
    deduplicated: z.boolean(),
    mode: AgentExecutionResetModeSchema,
    operationId: IdentifierSchema,
    ownerParticipantId: IdentifierSchema,
    providerContinuityRecords: z.number().int().nonnegative(),
  })
  .strict();
export type ClientAgentExecutionResetResponse = z.infer<
  typeof ClientAgentExecutionResetResponseSchema
>;
