import { z } from "zod";
import { IdentifierSchema } from "./common.ts";

export const ClientAgentStateRequestSchema = z
  .object({
    action: z.literal("set_state"),
    agentDefinitionId: IdentifierSchema,
    basedOnRoomSeq: z.number().int().nonnegative(),
    idempotencyKey: IdentifierSchema,
    state: z.enum(["enabled", "disabled", "tombstoned"]),
  })
  .strict();
export type ClientAgentStateRequest = z.infer<
  typeof ClientAgentStateRequestSchema
>;
