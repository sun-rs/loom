import { z } from "zod";
import { IdentifierSchema } from "./common.ts";
import { AgentExecutionWorkspaceSchema } from "./agent-definition.ts";
import {
  ModelIntentSchema,
  RaftUnattendedToolAccessModeSchema,
} from "./execution-policy.ts";
export const ClientAgentProvisionRequestSchema = z
  .object({
    executionWorkspace: AgentExecutionWorkspaceSchema.optional(),
    avatarKey: IdentifierSchema.optional(),
    basedOnRoomSeq: z.number().int().nonnegative(),
    controlRoomId: IdentifierSchema,
    description: z.string().trim().max(2_000).optional(),
    displayName: z.string().trim().min(1).max(128),
    handle: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u),
    idempotencyKey: IdentifierSchema,
    instructions: z
      .string()
      .trim()
      .min(1)
      .max(64 * 1_024),
    modelIntent: ModelIntentSchema,
    role: z.string().trim().min(1).max(512),
    runtimeOfferId: IdentifierSchema,
    // Raft owns Provider session reuse automatically. The product does not
    // expose fresh/required as per-Agent controls; this optional literal is
    // retained only so older clients may state the automatic policy.
    sessionPolicy: z.literal("prefer_resume").optional(),
    // Optional only for wire compatibility. Raft does not expose a per-Agent
    // CLI permission selector; every new policy is unattended full access.
    toolAccessMode: RaftUnattendedToolAccessModeSchema.optional(),
  })
  .strict();
export type ClientAgentProvisionRequest = z.infer<
  typeof ClientAgentProvisionRequestSchema
>;
