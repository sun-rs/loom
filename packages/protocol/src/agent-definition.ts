import { z } from "zod";

import {
  ContentDigestSchema,
  IdentifierSchema,
  TimestampSchema,
  rejectDuplicateStrings,
} from "./common.ts";

export const VersionedContentRefSchema = z
  .object({
    artifactId: IdentifierSchema,
    versionId: IdentifierSchema,
    contentDigest: ContentDigestSchema,
  })
  .strict();
export type VersionedContentRef = z.infer<typeof VersionedContentRefSchema>;

export const AgentDefinitionStateSchema = z.enum([
  "enabled",
  "disabled",
  "tombstoned",
]);
export type AgentDefinitionState = z.infer<typeof AgentDefinitionStateSchema>;

export const AgentDefinitionSchema = z
  .object({
    agentId: IdentifierSchema,
    participantId: IdentifierSchema,
    controlRoomId: IdentifierSchema,
    state: AgentDefinitionStateSchema,
    currentRevisionId: IdentifierSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
  .refine(
    (definition) =>
      Date.parse(definition.updatedAt) >= Date.parse(definition.createdAt),
    {
      message: "updatedAt must not precede createdAt",
      path: ["updatedAt"],
    },
  );
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;

export const AgentExecutionWorkspaceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("agent_private") }).strict(),
  z
    .object({
      kind: z.literal("existing_mount"),
      workspaceMountRevisionId: IdentifierSchema,
    })
    .strict(),
]);
export type AgentExecutionWorkspace = z.infer<
  typeof AgentExecutionWorkspaceSchema
>;

export const HOST_EXECUTION_WORKSPACE_BINDING_LIMIT = 512;

export const HostExecutionWorkspaceBindingSchema = z
  .object({
    participantId: IdentifierSchema,
    agentDefinitionRevisionId: IdentifierSchema,
    workspaceDefinitionId: IdentifierSchema,
    executionWorkspace: AgentExecutionWorkspaceSchema.optional(),
  })
  .strict();
export type HostExecutionWorkspaceBinding = z.infer<
  typeof HostExecutionWorkspaceBindingSchema
>;

export const AgentDefinitionRevisionSchema = z
  .object({
    executionWorkspace: AgentExecutionWorkspaceSchema.optional(),
    agentDefinitionRevisionId: IdentifierSchema,
    agentId: IdentifierSchema,
    revision: z.number().int().positive(),
    displayName: z.string().trim().min(1).max(128).optional(),
    description: z.string().trim().max(2_000).optional(),
    avatarKey: IdentifierSchema.optional(),
    role: z.string().trim().min(1),
    instructions: z
      .string()
      .trim()
      .min(1)
      .max(64 * 1_024)
      .optional(),
    instructionRefs: z.array(VersionedContentRefSchema),
    skillRefs: z.array(VersionedContentRefSchema),
    memoryPolicyRef: VersionedContentRefSchema,
    executionPolicyRevisionId: IdentifierSchema,
    contentDigest: ContentDigestSchema,
    createdBy: IdentifierSchema,
    createdAt: TimestampSchema,
  })
  .strict()
  .superRefine((revision, context) => {
    const references = [...revision.instructionRefs, ...revision.skillRefs];
    rejectDuplicateStrings(
      references.map(
        (reference) => `${reference.artifactId}:${reference.versionId}`,
      ),
      context,
    );
  });
export type AgentDefinitionRevision = z.infer<
  typeof AgentDefinitionRevisionSchema
>;

export const AgentRuntimeContextSchema = z
  .object({
    instanceSessionRequired: z.boolean().optional(),
    instanceChannelId: IdentifierSchema.optional(),
    agentDefinitionRevision: AgentDefinitionRevisionSchema,
    // Added to v1 as a backward-compatible field: newly issued launch claims
    // always freeze it, while an older remote Computer may still omit it.
    handle: IdentifierSchema.optional(),
    participantId: IdentifierSchema,
    schemaVersion: z.literal(1),
  })
  .strict();
export type AgentRuntimeContext = z.infer<typeof AgentRuntimeContextSchema>;

export const AgentCatalogEntrySchema = z
  .object({
    instanceChannelId: IdentifierSchema.optional(),
    // Saved explicit model choice, projected from the current execution policy.
    modelBindingId: IdentifierSchema.optional(),
    currentRevision: AgentDefinitionRevisionSchema,
    definition: AgentDefinitionSchema,
    handle: IdentifierSchema,
  })
  .strict();
export type AgentCatalogEntry = z.infer<typeof AgentCatalogEntrySchema>;

export const ClientAgentsListRequestSchema = z
  .object({
    controlRoomId: IdentifierSchema,
    includeDeleted: z.boolean().optional(),
  })
  .strict();
export type ClientAgentsListRequest = z.infer<
  typeof ClientAgentsListRequestSchema
>;

export const ClientAgentsListResponseSchema = z
  .object({ agents: z.array(AgentCatalogEntrySchema) })
  .strict();
export type ClientAgentsListResponse = z.infer<
  typeof ClientAgentsListResponseSchema
>;

export const ClientAgentOnboardRequestSchema = z
  .object({
    agentId: IdentifierSchema,
    basedOnRoomSeq: z.number().int().nonnegative(),
    idempotencyKey: IdentifierSchema,
    roomId: IdentifierSchema,
  })
  .strict();
export type ClientAgentOnboardRequest = z.infer<
  typeof ClientAgentOnboardRequestSchema
>;
