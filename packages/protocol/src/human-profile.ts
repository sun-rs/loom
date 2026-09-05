import { z } from "zod";
import { IdentifierSchema, TimestampSchema } from "./common.ts";
import { MembershipRoleSchema, PrincipalSchema } from "./collaboration.ts";

export const HumanProfileRequestSchema = z
  .object({
    workspaceId: IdentifierSchema,
    principalId: IdentifierSchema,
  })
  .strict();
export type HumanProfileRequest = z.infer<typeof HumanProfileRequestSchema>;

/** Read projection, not a second identity/ownership store. */
export const HumanProfileResponseSchema = z
  .object({
    workspaceId: IdentifierSchema,
    principal: PrincipalSchema.extend({ kind: z.literal("human") }),
    membership: z
      .object({ role: MembershipRoleSchema, joinedAt: TimestampSchema })
      .strict(),
    canReadCreatedAgents: z.boolean(),
    createdAgentDefinitionIds: z.array(IdentifierSchema).max(500),
    truncated: z.boolean(),
  })
  .strict();
export type HumanProfileResponse = z.infer<typeof HumanProfileResponseSchema>;
