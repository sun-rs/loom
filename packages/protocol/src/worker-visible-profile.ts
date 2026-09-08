import { AgentPresenceSchema } from "./agent-presence.ts";
import { z } from "zod";
import { IdentifierSchema, TimestampSchema } from "./common.ts";
import { AgentDefinitionStateSchema } from "./agent-definition.ts";
import {
  ReasoningLevelSchema,
  ToolAccessModeSchema,
} from "./execution-policy.ts";

export const WorkerComputerPublicMetadataSchema = z
  .object({
    hostId: IdentifierSchema,
    displayName: z.string().min(1).max(256),
    hostname: z.string().min(1).max(256),
    os: z.string().min(1).max(256),
    description: z.string().max(500).nullable(),
    connection: z
      .object({
        status: z.enum(["online", "draining", "offline", "unknown"]),
        observedAt: TimestampSchema,
        lastSeenAt: TimestampSchema.optional(),
        staleAfterMs: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();
export type WorkerComputerPublicMetadata = z.infer<
  typeof WorkerComputerPublicMetadataSchema
>;
export const WorkerRuntimePublicMetadataSchema = z
  .object({
    hostId: IdentifierSchema,
    runtimeProfileId: IdentifierSchema,
    runtimeProfileRevisionId: IdentifierSchema,
    cliId: z.enum(["codex", "kimi", "claude", "opencode"]).optional(),
    displayName: z.string().min(1).max(256),
    executionMode: z.literal("byoc"),
  })
  .strict();
export type WorkerRuntimePublicMetadata = z.infer<
  typeof WorkerRuntimePublicMetadataSchema
>;

const Person = z
  .object({
    participantId: IdentifierSchema,
    kind: z.enum(["human", "agent"]),
    handle: IdentifierSchema,
    displayName: z.string(),
    avatarKey: IdentifierSchema.optional(),
  })
  .strict();
const Model = z
  .object({
    modelBindingId: IdentifierSchema,
    provider: IdentifierSchema,
    modelId: IdentifierSchema,
  })
  .strict();
const Computer = z
  .object({
    ...WorkerComputerPublicMetadataSchema.omit({ hostId: true }).partial()
      .shape,
    hostId: IdentifierSchema,
    observedState: z.enum(["online", "draining", "offline"]).optional(),
    reportedBuildVersion: z.string().optional(),
    observedAt: TimestampSchema.optional(),
  })
  .strict();
const RuntimeTarget = z
  .object({
    runtimeOfferId: IdentifierSchema,
    registered: z.boolean(),
    runtime: WorkerRuntimePublicMetadataSchema.optional(),
    runtimeProfileId: IdentifierSchema.optional(),
    runtimeProfileRevisionId: IdentifierSchema.optional(),
    protocolFamily: IdentifierSchema.optional(),
    computer: Computer.optional(),
    models: z.array(Model).max(16),
    modelsTruncated: z.boolean(),
  })
  .strict();
export const WorkerVisibleProfileMetadataSchema = z
  .object({
    createdAt: TimestampSchema,
    deletedAt: TimestampSchema.nullable(),
    membership: z
      .object({
        scope: z.literal("room"),
        role: z.enum(["owner", "admin", "member"]),
        joinedAt: TimestampSchema,
      })
      .strict(),
    availability: AgentPresenceSchema.pick({
      activity: true,
      reason: true,
      activityAt: true,
    })
      .extend({ observedAt: TimestampSchema })
      .nullable(),
    creator: Person.nullable(),
    createdAgents: z
      .array(
        Person.extend({
          agentDefinitionId: IdentifierSchema,
          state: AgentDefinitionStateSchema,
          runtimes: z
            .array(
              z
                .object({
                  runtimeOfferId: IdentifierSchema,
                  registered: z.boolean(),
                  runtime: WorkerRuntimePublicMetadataSchema.optional(),
                })
                .strict(),
            )
            .max(16)
            .optional(),
          runtimesTruncated: z.boolean().optional(),
        }),
      )
      .max(50),
    createdAgentsTruncated: z.boolean(),
    createdAgentsNextCursor: z.string().optional(),
    configured: z
      .object({
        modelBindingIds: z.array(IdentifierSchema).max(16),
        modelBindingIdsTruncated: z.boolean(),
        modelSelection: z.enum([
          "binding_ids",
          "capability_class",
          "runtime_default",
        ]),
        capabilityClass: z.string().optional(),
        runtimeTargetsRestricted: z.boolean(),
        reasoning: ReasoningLevelSchema,
        toolAccessMode: ToolAccessModeSchema,
        runtimeTargets: z.array(RuntimeTarget).max(16),
        runtimeTargetsTruncated: z.boolean(),
      })
      .strict()
      .nullable(),
    actualRun: z
      .object({
        runAttemptId: IdentifierSchema,
        state: z.enum([
          "starting",
          "running",
          "orphaned",
          "exited",
          "failed",
          "cancelled",
          "timed_out",
        ]),
        startedAt: TimestampSchema,
        finishedAt: TimestampSchema.optional(),
        computer: Computer,
        runtime: WorkerRuntimePublicMetadataSchema.optional(),
        runtimeOfferId: IdentifierSchema.optional(),
        runtimeProfileId: IdentifierSchema.optional(),
        runtimeProfileRevisionId: IdentifierSchema.optional(),
        model: z
          .object({
            source: z.enum(["runtime_default", "explicit_binding"]),
            modelBindingId: IdentifierSchema.optional(),
            provider: IdentifierSchema.optional(),
            modelId: IdentifierSchema.optional(),
            reasoning: ReasoningLevelSchema.optional(),
          })
          .strict()
          .nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type WorkerVisibleProfileMetadata = z.infer<
  typeof WorkerVisibleProfileMetadataSchema
>;
export const WorkerIntrospectionRequestSchema = z.object({}).strict();
export const WorkerWhoamiResponseSchema = z
  .object({
    authenticated: z.literal(true),
    credentialKind: z.literal("activation"),
    token: z.literal("[REDACTED]"),
    participantId: IdentifierSchema,
    roomId: IdentifierSchema,
    activationId: IdentifierSchema,
    runAttemptId: IdentifierSchema,
    hostId: IdentifierSchema,
    consumerId: IdentifierSchema,
    toSeq: z.number().int().nonnegative(),
  })
  .strict();
export type WorkerWhoamiResponse = z.infer<typeof WorkerWhoamiResponseSchema>;
export const WorkerLiveVersionResponseSchema = z
  .object({
    source: z.literal("serving_daemon"),
    buildVersion: z.string().nullable(),
    protocolVersion: z.number().int().positive().nullable(),
  })
  .strict();
export type WorkerLiveVersionResponse = z.infer<
  typeof WorkerLiveVersionResponseSchema
>;
