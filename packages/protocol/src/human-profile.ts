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

export const WorkspaceHumanDirectoryRequestSchema = z
  .object({ workspaceId: IdentifierSchema })
  .strict();
export type WorkspaceHumanDirectoryRequest = z.infer<
  typeof WorkspaceHumanDirectoryRequestSchema
>;

export const WorkspaceHumanMemberSchema = z
  .object({
    principal: PrincipalSchema.extend({ kind: z.literal("human") }),
    membership: z
      .object({ role: MembershipRoleSchema, joinedAt: TimestampSchema })
      .strict(),
  })
  .strict();
export type WorkspaceHumanMember = z.infer<typeof WorkspaceHumanMemberSchema>;

/** Bounded Workspace identity projection derived from the unique control Room. */
export const WorkspaceHumanDirectoryResponseSchema = z
  .object({
    humans: z.array(WorkspaceHumanMemberSchema).max(500),
    truncated: z.boolean(),
    workspaceId: IdentifierSchema,
  })
  .strict();
export type WorkspaceHumanDirectoryResponse = z.infer<
  typeof WorkspaceHumanDirectoryResponseSchema
>;
