import { ClientAgentProvisionRequestSchema } from "./agent-provision-request.ts";
export * from "./agent-provision-request.ts";
export * from "./role-catalog.ts";
import { customModelAllowsEffort } from "./custom-model-effort.ts";
export * from "./custom-model-effort.ts";
export * from "./runtime-guide-settings.ts";
export * from "./runtime-settings.ts";
export * from "./run-watchdog.ts";
import { z } from "zod";
import { ClientAgentProfileRequestSchema } from "./client-agent-profile.ts";
export * from "./client-agent-profile.ts";
import { ClientAgentStateRequestSchema } from "./client-agent-state.ts";
export * from "./client-agent-state.ts";
export * from "./client-agent-deletion-diagnostics.ts";
export * from "./client-computer-profile.ts";
export * from "./client-discovery.ts";
export * from "./message-reference.ts";
export * from "./message-mention.ts";
import { WorkerTaskCausalityShape } from "./worker-task-causality.ts";
import {
  ContentDigestSchema,
  IdentifierSchema,
  TimestampSchema,
  rejectDuplicateStrings,
} from "./common.ts";
import {
  AgentCatalogEntrySchema,
  AgentDefinitionRevisionSchema,
  AgentExecutionWorkspaceSchema,
} from "./agent-definition.ts";
import {
  CustomModelSchema,
  CapabilityEvidenceLevelSchema,
  ExecutionPolicyRevisionSchema,
  ExplicitReasoningLevelSchema,
  IsolationLevelSchema,
  ModelBindingDescriptorSchema,
  ModelCapabilityClassSchema,
  ModelIntentSchema,
  PlacementPreferenceSchema,
  ReasoningLevelSchema,
  RuntimeCapabilityEvidenceSchema,
  RuntimeCapabilityRequirementSchema,
  RuntimeCertificationRefSchema,
  RuntimeCertificationSchema,
  RuntimeModelBindingSchema,
  RaftUnattendedToolAccessModeSchema,
  ServiceTierSchema,
  ToolAccessModeSchema,
  WorkspaceModeSchema,
} from "./execution-policy.ts";
import {
  ParticipantKindSchema,
  PrincipalSchema,
  RoomSchema,
} from "./collaboration.ts";
import { RoomEventSchema, type RoomEvent } from "./room-event.ts";
import {
  InputRequestResolveRequestSchema,
  InputRequestSchema,
  InputRequestStateSchema,
  InputRequestStatusSchema,
  type InputRequest,
  type InputRequestStatus,
} from "./input-request.ts";
import { ManagedMcpRuntimeAdapterSchema } from "./retired-managed-mcp.ts";
import {
  addTaskParticipantSelectionIssues,
  projectTaskLifecycle,
  taskWorkflowTransitionOptions,
  taskWorkflowStatus,
  TaskSchema,
  TaskAttentionSchema,
  TaskExecutionPhaseSchema,
  TaskLifecycleProjectionSchema,
  TaskStateSchema,
  TaskWorkflowStatusSchema,
  type Task,
  type TaskAttention,
  type TaskExecutionPhase,
  type TaskLifecycleProjection,
  type TaskState,
  type TaskWorkflowStatus,
} from "./task.ts";
import { TaskVerificationDeclarationSchema } from "./review.ts";

export {
  projectTaskLifecycle,
  taskWorkflowTransitionOptions,
  taskWorkflowStatus,
  TaskSchema,
  TaskAttentionSchema,
  TaskExecutionPhaseSchema,
  TaskLifecycleProjectionSchema,
  TaskStateSchema,
  TaskWorkflowStatusSchema,
};
export type {
  Task,
  TaskAttention,
  TaskExecutionPhase,
  TaskLifecycleProjection,
  TaskState,
  TaskWorkflowStatus,
};
export * from "./activation.ts";
export * from "./agent-memory.ts";
export * from "./agent-memory-config.ts";
export * from "./agent-app-inbox.ts";
export * from "./agent-memory-project.ts";
export * from "./agent-exclusive-operation.ts";
export * from "./agent-definition.ts";
export * from "./agent-avatar-pattern.ts";
export * from "./context-manifest.ts";
export * from "./execution-policy.ts";
export * from "./workspace-instruction-pack.ts";
export * from "./runtime-activity.ts";
export * from "./runtime-usage.ts";
export * from "./usage-summary.ts";
export * from "./agent-presence.ts";
export * from "./review.ts";
export * from "./reminder.ts";
export * from "./room-agent-sos.ts";
export { ContentDigestSchema } from "./common.ts";
export type { ContentDigest } from "./common.ts";
export {
  ForwardedMessageAuthorSnapshotSchema,
  ForwardedMessageBundleSchema,
  ForwardedMessageSnapshotSchema,
  MembershipRoleSchema,
  MessageSchema,
  ParticipantKindSchema,
  PrincipalSchema,
  RoomKindSchema,
  RoomMembershipSchema,
  RoomSchema,
  RoomVisibilitySchema,
  ThreadSchema,
  WorkspaceSchema,
  WorkspaceStateSchema,
} from "./collaboration.ts";
export type {
  ForwardedMessageAuthorSnapshot,
  ForwardedMessageBundle,
  ForwardedMessageSnapshot,
  MembershipRole,
  Message,
  ParticipantKind,
  Principal,
  Room,
  RoomKind,
  RoomMembership,
  RoomVisibility,
  Thread,
  Workspace,
  WorkspaceState,
} from "./collaboration.ts";
export * from "./client.ts";
export * from "./client-task.ts";
export * from "./worker-message.ts";
export * from "./worker-task-create.ts";
export * from "./worker-thread.ts";
export * from "./input-request.ts";
export { RoomEventSchema, ROOM_SYNC_RESPONSE_MAX_BYTES } from "./room-event.ts";
export type { RoomEvent } from "./room-event.ts";

export const InboxStateSchema = z.enum(["pending", "acknowledged"]);
export type InboxState = z.infer<typeof InboxStateSchema>;

export const RuntimeRecoveryDescriptorSchema = z
  .object({
    executionWorkspace: z
      .object({
        participantId: IdentifierSchema,
        workspaceDefinitionId: IdentifierSchema,
        workspaceMountRevisionId: IdentifierSchema,
        workspaceMountDigest: ContentDigestSchema,
      })
      .strict()
      .optional(),
    driver: IdentifierSchema,
    metadata: z.record(z.string(), z.unknown()),
    recoveryImplementationVersion: IdentifierSchema.optional(),
    recoveryKey: IdentifierSchema,
    runtimeProfileDigest: ContentDigestSchema.optional(),
    runtimeProfileRevisionId: IdentifierSchema.optional(),
  })
  .strict()
  .superRefine((descriptor, context) => {
    const provenance = [
      descriptor.recoveryImplementationVersion,
      descriptor.runtimeProfileDigest,
      descriptor.runtimeProfileRevisionId,
    ];
    const defined = provenance.filter((value) => value !== undefined).length;
    if (defined !== 0 && defined !== provenance.length) {
      context.addIssue({
        code: "custom",
        message: "runtime recovery provenance must be complete when present",
      });
    }
  });
export type RuntimeRecoveryDescriptor = z.infer<
  typeof RuntimeRecoveryDescriptorSchema
>;

const UniqueIdentifierArraySchema = z
  .array(IdentifierSchema)
  .superRefine(rejectDuplicateStrings);

const RuntimeArgumentSchema = z
  .string()
  .max(32_768)
  .refine((value) => !value.includes("\0"), "arguments cannot contain NUL");
const RuntimeExecutableSchema = z
  .string()
  .trim()
  .min(1)
  .max(4_096)
  .refine(
    (value) => !/[|;&<>`]/.test(value) && !value.includes("$("),
    "executable must not be a shell expression",
  );

function rejectCredentialBearingRuntimeArguments(
  values: readonly string[],
  context: z.RefinementCtx,
): void {
  values.forEach((value, index) => {
    const argument = value.trim();
    if (
      /^--?[a-z0-9_-]*(?:api[-_]?key|access[-_]?token|token|password|secret|credential)(?:=|$)/i.test(
        argument,
      ) ||
      /^[A-Z0-9_]*(?:API_KEY|TOKEN|PASSWORD|SECRET|CREDENTIAL)[A-Z0-9_]*=/.test(
        argument,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "credential-bearing arguments cannot enter a manifest",
        path: [index],
      });
    }
  });
}

export const GenericProcessProfileAdapterConfigSchema = z
  .object({
    completedRunRetention: z
      .number()
      .int()
      .nonnegative()
      .max(10_000)
      .optional(),
    diagnosticByteLimit: z
      .number()
      .int()
      .positive()
      .max(16 * 1_024 * 1_024)
      .optional(),
    supervisorControlTimeoutMs: z
      .number()
      .int()
      .positive()
      .max(10 * 60_000)
      .optional(),
    supervisorStartupTimeoutMs: z
      .number()
      .int()
      .positive()
      .max(10 * 60_000)
      .optional(),
    terminationGraceMs: z
      .number()
      .int()
      .nonnegative()
      .max(10 * 60_000)
      .optional(),
  })
  .strict();
export type GenericProcessProfileAdapterConfig = z.infer<
  typeof GenericProcessProfileAdapterConfigSchema
>;

export const RuntimeProfileManifestV1Schema = z
  .object({
    manifestVersion: z.literal(1),
    runtimeProfileId: IdentifierSchema,
    displayName: z.string().trim().min(1).max(256),
    protocolFamily: z.literal("rah-worker-process/v1"),
    adapter: z
      .object({
        kind: z.literal("generic-process/v1"),
        executable: RuntimeExecutableSchema,
        fixedArgs: z
          .array(RuntimeArgumentSchema)
          .max(256)
          .superRefine(rejectCredentialBearingRuntimeArguments),
        config: GenericProcessProfileAdapterConfigSchema,
      })
      .strict(),
    declaredCapabilities: UniqueIdentifierArraySchema.max(256),
    recoveryDrivers: UniqueIdentifierArraySchema.max(64),
    workspacePolicy: z
      .object({
        allowedModes: z
          .array(WorkspaceModeSchema)
          .min(1)
          .superRefine(rejectDuplicateStrings),
      })
      .strict(),
  })
  .strict();
export type RuntimeProfileManifestV1 = z.infer<
  typeof RuntimeProfileManifestV1Schema
>;

const RuntimeEnvironmentVariableNameSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
  .max(256)
  .refine(
    (value) => !runtimeEnvironmentVariableIsDaemonOwned(value),
    "daemon-owned RAH environment variables cannot enter a profile",
  );

function runtimeEnvironmentVariableIsDaemonOwned(value: string): boolean {
  const normalized = value.toUpperCase();
  return (
    normalized.startsWith("RAH_AGENT_") ||
    normalized.startsWith("RAH_WORKER_") ||
    normalized.startsWith("RAH_ACTIVATION_") ||
    normalized.startsWith("RAH_PROCESS_SUPERVISOR_") ||
    [
      "RAH_CONSUMER_ID",
      "RAH_FROM_SEQ",
      "RAH_HOST_ID",
      "RAH_PARTICIPANT_ID",
      "RAH_ROOM_ID",
      "RAH_RUN_ATTEMPT_ID",
      "RAH_TO_SEQ",
    ].includes(normalized)
  );
}

const RuntimeStaticEnvironmentVariableNameSchema =
  RuntimeEnvironmentVariableNameSchema.refine(
    (value) =>
      !/(?:^|_)(?:API_?KEY|ACCESS_?TOKEN|AUTH_?TOKEN|TOKEN|PASSWORD|SECRET|CREDENTIAL)(?:_|$)/i.test(
        value,
      ),
    "credential-bearing environment variables must use credentialSlots",
  );

export const RuntimeCredentialSlotSchema = z
  .object({
    slotId: IdentifierSchema,
    target: z
      .object({
        kind: z.literal("environment"),
        variable: RuntimeEnvironmentVariableNameSchema,
      })
      .strict(),
  })
  .strict();
export type RuntimeCredentialSlot = z.infer<typeof RuntimeCredentialSlotSchema>;

export const RuntimeProfileManifestV2Schema = z
  .object({
    manifestVersion: z.literal(2),
    runtimeProfileId: IdentifierSchema,
    displayName: z.string().trim().min(1).max(256),
    protocolFamily: z.literal("rah-worker-process/v1"),
    adapter: z
      .object({
        kind: z.literal("generic-process/v1"),
        executable: RuntimeExecutableSchema,
        fixedArgs: z
          .array(RuntimeArgumentSchema)
          .max(256)
          .superRefine(rejectCredentialBearingRuntimeArguments),
        config: GenericProcessProfileAdapterConfigSchema,
      })
      .strict(),
    staticEnv: z.record(
      RuntimeStaticEnvironmentVariableNameSchema,
      z.string().max(32_768),
    ),
    credentialSlots: z.array(RuntimeCredentialSlotSchema).max(64),
    declaredCapabilities: UniqueIdentifierArraySchema.max(256),
    recoveryDrivers: UniqueIdentifierArraySchema.max(64),
    // Retired metadata: accepted only for durable RuntimeProfile revision compatibility.
    managedMcpAdapter: ManagedMcpRuntimeAdapterSchema.optional(),
    workspacePolicy: z
      .object({
        allowedModes: z
          .array(WorkspaceModeSchema)
          .min(1)
          .superRefine(rejectDuplicateStrings),
      })
      .strict(),
  })
  .strict()
  .superRefine((manifest, context) => {
    rejectDuplicateStrings(
      manifest.credentialSlots.map((slot) => slot.slotId),
      context,
    );
    rejectDuplicateStrings(
      manifest.credentialSlots.map((slot) => slot.target.variable),
      context,
    );
    manifest.credentialSlots.forEach((slot, index) => {
      if (Object.hasOwn(manifest.staticEnv, slot.target.variable)) {
        context.addIssue({
          code: "custom",
          message: `credential target duplicates staticEnv: ${slot.target.variable}`,
          path: ["credentialSlots", index, "target", "variable"],
        });
      }
    });
  });
export type RuntimeProfileManifestV2 = z.infer<
  typeof RuntimeProfileManifestV2Schema
>;

export const RuntimeProfileManifestV3Schema = z
  .object({
    manifestVersion: z.literal(3),
    runtimeProfileId: IdentifierSchema,
    displayName: z.string().trim().min(1).max(256),
    protocolFamily: z.literal("rah-worker-process/v1"),
    adapter: z
      .object({
        kind: z.enum([
          "generic-process/v1",
          "claude-stream-json/v1",
          "codex-app-server/v1",
          "kimi-acp/v1",
          "opencode-server/v1",
        ]),
        executable: RuntimeExecutableSchema,
        fixedArgs: z
          .array(RuntimeArgumentSchema)
          .max(256)
          .superRefine(rejectCredentialBearingRuntimeArguments),
        config: GenericProcessProfileAdapterConfigSchema,
      })
      .strict(),
    staticEnv: z.record(
      RuntimeStaticEnvironmentVariableNameSchema,
      z.string().max(32_768),
    ),
    credentialSlots: z.array(RuntimeCredentialSlotSchema).max(64),
    declaredCapabilities: UniqueIdentifierArraySchema.max(256),
    recoveryDrivers: UniqueIdentifierArraySchema.max(64),
    // Retired metadata: accepted only for durable RuntimeProfile revision compatibility.
    managedMcpAdapter: ManagedMcpRuntimeAdapterSchema.optional(),
    workspacePolicy: z
      .object({
        allowedModes: z
          .array(WorkspaceModeSchema)
          .min(1)
          .superRefine(rejectDuplicateStrings),
      })
      .strict(),
    modelCatalogProbe: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("claude-cli/v1") }).strict(),
      z.object({ kind: z.literal("codex-cli/v1") }).strict(),
      z.object({ kind: z.literal("kimi-cli/v1") }).strict(),
      z.object({ kind: z.literal("opencode-cli/v1") }).strict(),
    ]),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (
      manifest.adapter.kind === "claude-stream-json/v1" &&
      manifest.modelCatalogProbe.kind !== "claude-cli/v1"
    ) {
      context.addIssue({
        code: "custom",
        message:
          "claude-stream-json/v1 requires the claude-cli/v1 model catalog probe",
        path: ["modelCatalogProbe", "kind"],
      });
    }
    if (
      manifest.adapter.kind === "kimi-acp/v1" &&
      manifest.modelCatalogProbe.kind !== "kimi-cli/v1"
    ) {
      context.addIssue({
        code: "custom",
        message: "kimi-acp/v1 requires the kimi-cli/v1 model catalog probe",
        path: ["modelCatalogProbe", "kind"],
      });
    }
    if (
      manifest.adapter.kind === "codex-app-server/v1" &&
      manifest.modelCatalogProbe.kind !== "codex-cli/v1"
    ) {
      context.addIssue({
        code: "custom",
        message:
          "codex-app-server/v1 requires the codex-cli/v1 model catalog probe",
        path: ["modelCatalogProbe", "kind"],
      });
    }
    if (
      manifest.adapter.kind === "opencode-server/v1" &&
      manifest.modelCatalogProbe.kind !== "opencode-cli/v1"
    ) {
      context.addIssue({
        code: "custom",
        message:
          "opencode-server/v1 requires the opencode-cli/v1 model catalog probe",
        path: ["modelCatalogProbe", "kind"],
      });
    }
    rejectDuplicateStrings(
      manifest.credentialSlots.map((slot) => slot.slotId),
      context,
    );
    rejectDuplicateStrings(
      manifest.credentialSlots.map((slot) => slot.target.variable),
      context,
    );
    manifest.credentialSlots.forEach((slot, index) => {
      if (Object.hasOwn(manifest.staticEnv, slot.target.variable)) {
        context.addIssue({
          code: "custom",
          message: `credential target duplicates staticEnv: ${slot.target.variable}`,
          path: ["credentialSlots", index, "target", "variable"],
        });
      }
    });
  });
export type RuntimeProfileManifestV3 = z.infer<
  typeof RuntimeProfileManifestV3Schema
>;

export const RuntimeProfileManifestSchema = z.discriminatedUnion(
  "manifestVersion",
  [
    RuntimeProfileManifestV1Schema,
    RuntimeProfileManifestV2Schema,
    RuntimeProfileManifestV3Schema,
  ],
);
export type RuntimeProfileManifest = z.infer<
  typeof RuntimeProfileManifestSchema
>;

const RuntimeProfileProbeReportFields = {
  probeReportId: IdentifierSchema,
  probeDigest: ContentDigestSchema,
  runtimeProfileId: IdentifierSchema,
  runtimeProfileRevisionId: IdentifierSchema,
  runtimeProfileDigest: ContentDigestSchema,
  adapter: z
    .object({
      kind: IdentifierSchema,
      implementationVersion: IdentifierSchema,
    })
    .strict(),
  available: z.boolean(),
  failureCode: z
    .enum([
      "executable_not_found",
      "executable_not_executable",
      "executable_not_regular_file",
      "model_catalog_probe_failed",
      "recovery_driver_unavailable",
      "unsupported_adapter",
    ])
    .optional(),
  executableIdentity: z
    .object({
      requestedExecutable: z.string().trim().min(1).max(4_096),
      resolvedExecutablePath: z.string().trim().min(1).max(16_384),
      contentDigest: ContentDigestSchema,
      byteLength: z.number().int().nonnegative(),
    })
    .strict()
    .optional(),
  recoveryDrivers: z
    .array(
      z
        .object({
          driver: IdentifierSchema,
          implementationVersion: IdentifierSchema,
        })
        .strict(),
    )
    .superRefine((drivers, context) =>
      rejectDuplicateStrings(
        drivers.map((driver) => driver.driver),
        context,
      ),
    ),
  observedAt: TimestampSchema,
};

export const RuntimeProfileProbeReportV1Schema = z
  .object({
    reportVersion: z.literal(1),
    ...RuntimeProfileProbeReportFields,
  })
  .strict()
  .superRefine((report, context) => {
    if (report.available && report.executableIdentity === undefined) {
      context.addIssue({
        code: "custom",
        message: "available probe reports require executableIdentity",
        path: ["executableIdentity"],
      });
    }
    if (report.available && report.failureCode !== undefined) {
      context.addIssue({
        code: "custom",
        message: "available probe reports cannot have failureCode",
        path: ["failureCode"],
      });
    }
    if (!report.available && report.failureCode === undefined) {
      context.addIssue({
        code: "custom",
        message: "unavailable probe reports require failureCode",
        path: ["failureCode"],
      });
    }
  });
export type RuntimeProfileProbeReportV1 = z.infer<
  typeof RuntimeProfileProbeReportV1Schema
>;

export const RuntimeProfileProbeReportV2Schema = z
  .object({
    reportVersion: z.literal(2),
    ...RuntimeProfileProbeReportFields,
    modelBindings: z.array(RuntimeModelBindingSchema),
  })
  .strict()
  .superRefine((report, context) => {
    if (report.available && report.executableIdentity === undefined) {
      context.addIssue({
        code: "custom",
        message: "available probe reports require executableIdentity",
        path: ["executableIdentity"],
      });
    }
    if (report.available && report.failureCode !== undefined) {
      context.addIssue({
        code: "custom",
        message: "available probe reports cannot have failureCode",
        path: ["failureCode"],
      });
    }
    if (!report.available && report.failureCode === undefined) {
      context.addIssue({
        code: "custom",
        message: "unavailable probe reports require failureCode",
        path: ["failureCode"],
      });
    }
    rejectDuplicateStrings(
      report.modelBindings.map((binding) => binding.modelBindingId),
      context,
    );
    report.modelBindings.forEach((binding, index) => {
      if (binding.evidence !== "probed") {
        context.addIssue({
          code: "custom",
          message: "Runtime probe model bindings require probed evidence",
          path: ["modelBindings", index, "evidence"],
        });
      }
    });
  });
export type RuntimeProfileProbeReportV2 = z.infer<
  typeof RuntimeProfileProbeReportV2Schema
>;

export const RuntimeProfileProbeReportSchema = z.discriminatedUnion(
  "reportVersion",
  [RuntimeProfileProbeReportV1Schema, RuntimeProfileProbeReportV2Schema],
);
export type RuntimeProfileProbeReport = z.infer<
  typeof RuntimeProfileProbeReportSchema
>;

export const RuntimeProfileRevisionStateSchema = z.enum([
  "inactive",
  "active",
  "deprecated",
]);
export type RuntimeProfileRevisionState = z.infer<
  typeof RuntimeProfileRevisionStateSchema
>;

export const RuntimeProfileSchema = z
  .object({
    runtimeProfileId: IdentifierSchema,
    activeRevisionId: IdentifierSchema.optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();
export type RuntimeProfile = z.infer<typeof RuntimeProfileSchema>;

export const RuntimeProfileRevisionSchema = z
  .object({
    runtimeProfileRevisionId: IdentifierSchema,
    runtimeProfileId: IdentifierSchema,
    revision: z.number().int().positive(),
    contentDigest: ContentDigestSchema,
    manifest: RuntimeProfileManifestSchema,
    state: RuntimeProfileRevisionStateSchema,
    importedAt: TimestampSchema,
    activatedAt: TimestampSchema.optional(),
    deprecatedAt: TimestampSchema.optional(),
  })
  .strict()
  .superRefine((revision, context) => {
    if (revision.state === "active" && revision.activatedAt === undefined) {
      context.addIssue({
        code: "custom",
        message: "active revisions require activatedAt",
        path: ["activatedAt"],
      });
    }
    if (
      revision.state === "deprecated" &&
      revision.deprecatedAt === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "deprecated revisions require deprecatedAt",
        path: ["deprecatedAt"],
      });
    }
  });
export type RuntimeProfileRevision = z.infer<
  typeof RuntimeProfileRevisionSchema
>;

export const RuntimeProfileAuditActionSchema = z.enum([
  "imported",
  "probe_recorded",
  "activated",
  "deprecated",
]);
export type RuntimeProfileAuditAction = z.infer<
  typeof RuntimeProfileAuditActionSchema
>;

export const RuntimeProfileAuditEntrySchema = z
  .object({
    sequence: z.number().int().positive(),
    auditEntryId: IdentifierSchema,
    action: RuntimeProfileAuditActionSchema,
    runtimeProfileId: IdentifierSchema,
    runtimeProfileRevisionId: IdentifierSchema,
    contentDigest: ContentDigestSchema,
    reason: z.string().trim().min(1).optional(),
    occurredAt: TimestampSchema,
  })
  .strict();
export type RuntimeProfileAuditEntry = z.infer<
  typeof RuntimeProfileAuditEntrySchema
>;

export const WorkspaceAgentHostBindingSchema = z
  .object({
    hostId: IdentifierSchema,
    runtimeOfferId: IdentifierSchema,
    runtimeProfileId: IdentifierSchema,
    runtimeProfileRevisionId: IdentifierSchema,
  })
  .strict();
export type WorkspaceAgentHostBinding = z.infer<
  typeof WorkspaceAgentHostBindingSchema
>;

export const ClientAgentProvisionResponseSchema = z
  .object({
    agent: AgentCatalogEntrySchema,
    deduplicated: z.boolean(),
    event: RoomEventSchema,
    hostBinding: WorkspaceAgentHostBindingSchema,
    policy: ExecutionPolicyRevisionSchema,
  })
  .strict();
export type ClientAgentProvisionResponse = z.infer<
  typeof ClientAgentProvisionResponseSchema
>;

export const ClientAgentConfigureRequestSchema =
  ClientAgentProvisionRequestSchema.omit({ controlRoomId: true }).extend({
    action: z.literal("configure"),
    agentId: IdentifierSchema,
  });
export type ClientAgentConfigureRequest = z.infer<
  typeof ClientAgentConfigureRequestSchema
>;

export const ClientAgentManageRequestSchema = z.discriminatedUnion("action", [
  ClientAgentConfigureRequestSchema,
  ClientAgentStateRequestSchema,
  ClientAgentProfileRequestSchema,
]);
export type ClientAgentManageRequest = z.infer<
  typeof ClientAgentManageRequestSchema
>;

export const ClientAgentManageResponseSchema = z
  .object({
    agent: AgentCatalogEntrySchema,
    deduplicated: z.boolean(),
    event: RoomEventSchema,
    hostBinding: WorkspaceAgentHostBindingSchema.optional(),
    policy: ExecutionPolicyRevisionSchema.optional(),
  })
  .strict();
export type ClientAgentManageResponse = z.infer<
  typeof ClientAgentManageResponseSchema
>;

export * from "./agent-workspace.ts";
export * from "./channel-workspace.ts";
export * from "./member-graph.ts";
export * from "./client-task-reassignment.ts";
export const ClientAgentGetRequestSchema = z
  .object({ agentId: IdentifierSchema })
  .strict();
export type ClientAgentGetRequest = z.infer<typeof ClientAgentGetRequestSchema>;
export const ClientAgentCreatorSchema = z.discriminatedUnion("kind", [
  PrincipalSchema.extend({ kind: z.literal("human") }),
  PrincipalSchema.extend({ kind: z.literal("agent") }),
]);
export type ClientAgentCreator = z.infer<typeof ClientAgentCreatorSchema>;
export const ClientAgentGetResponseSchema = z
  .object({
    agent: AgentCatalogEntrySchema,
    createdAgents: z.array(AgentCatalogEntrySchema),
    creator: ClientAgentCreatorSchema.nullable(),
    membershipRole: z.enum(["owner", "admin", "member"]).optional(),
    policy: ExecutionPolicyRevisionSchema,
  })
  .strict();
export type ClientAgentGetResponse = z.infer<
  typeof ClientAgentGetResponseSchema
>;

export const RuntimeOfferStateSchema = z.enum([
  "available",
  "degraded",
  "draining",
  "unavailable",
]);
export type RuntimeOfferState = z.infer<typeof RuntimeOfferStateSchema>;

export const WorkspaceMountDescriptorSchema = z
  .object({
    participantId: IdentifierSchema.optional(),
    workspaceDefinitionId: IdentifierSchema,
    workspaceMountRevisionId: IdentifierSchema,
    workspaceMountDigest: ContentDigestSchema,
    modes: z
      .array(WorkspaceModeSchema)
      .min(1)
      .superRefine(rejectDuplicateStrings),
  })
  .strict();
export type WorkspaceMountDescriptor = z.infer<
  typeof WorkspaceMountDescriptorSchema
>;

export const RuntimeProfileProbeReportRefSchema = z
  .object({
    probeReportId: IdentifierSchema,
    probeDigest: ContentDigestSchema,
  })
  .strict();
export type RuntimeProfileProbeReportRef = z.infer<
  typeof RuntimeProfileProbeReportRefSchema
>;

export const RuntimeOfferSchema = z
  .object({
    customModelRuntime: z.enum(["claude", "codex"]).optional(),
    supportsAgentPrivateWorkspace: z.boolean().optional(),
    runtimeOfferId: IdentifierSchema,
    hostId: IdentifierSchema,
    hostInstanceId: IdentifierSchema,
    runtimeProfileId: IdentifierSchema,
    runtimeProfileRevisionId: IdentifierSchema,
    revisionDigest: ContentDigestSchema,
    probeReportRef: RuntimeProfileProbeReportRefSchema.optional(),
    protocolFamily: IdentifierSchema,
    certificationRefs: z.array(RuntimeCertificationRefSchema).default([]),
    capabilityEvidence: z.array(RuntimeCapabilityEvidenceSchema),
    isolation: z
      .object({
        level: IsolationLevelSchema,
        evidence: CapabilityEvidenceLevelSchema,
      })
      .strict(),
    modelBindingDescriptors: z.array(ModelBindingDescriptorSchema),
    workspaceMountDescriptors: z.array(WorkspaceMountDescriptorSchema),
    capacityPoolIds: UniqueIdentifierArraySchema,
    maxConcurrent: z.number().int().positive(),
    state: RuntimeOfferStateSchema,
    // Optional on the wire only for durable Offers accepted before this
    // capability was published. Absence means full-access only.
    supportedToolAccessModes: z
      .array(ToolAccessModeSchema)
      .min(1)
      .superRefine(rejectDuplicateStrings)
      .optional(),
    observedVersion: z.string().trim().min(1).optional(),
    observedAt: TimestampSchema,
    leaseUntil: TimestampSchema,
  })
  .strict()
  .superRefine((offer, context) => {
    if (Date.parse(offer.leaseUntil) <= Date.parse(offer.observedAt)) {
      context.addIssue({
        code: "custom",
        message: "leaseUntil must be later than observedAt",
        path: ["leaseUntil"],
      });
    }
    rejectDuplicateStrings(
      offer.capabilityEvidence.map((evidence) => evidence.capability),
      context,
    );
    rejectDuplicateStrings(
      offer.certificationRefs.map((reference) => reference.certificationId),
      context,
    );
    rejectDuplicateStrings(
      offer.modelBindingDescriptors.map((binding) => binding.modelBindingId),
      context,
    );
    rejectDuplicateStrings(
      offer.workspaceMountDescriptors.map(
        (workspace) => workspace.workspaceMountRevisionId,
      ),
      context,
    );
    const reportsProbedEvidence =
      offer.capabilityEvidence.some(
        (evidence) => evidence.evidence === "probed",
      ) ||
      offer.isolation.evidence === "probed" ||
      offer.modelBindingDescriptors.some(
        (binding) => binding.evidence === "probed",
      );
    if (reportsProbedEvidence && offer.probeReportRef === undefined) {
      context.addIssue({
        code: "custom",
        message: "probed evidence requires an immutable probeReportRef",
        path: ["probeReportRef"],
      });
    }
  });
export type RuntimeOffer = z.infer<typeof RuntimeOfferSchema>;

export const RuntimeOfferProjectionSchema = RuntimeOfferSchema.safeExtend({
  acceptedAt: TimestampSchema,
  resolvedCertifications: z.array(RuntimeCertificationSchema),
  runtimeOfferObservationId: IdentifierSchema,
  runtimeOfferSnapshotDigest: ContentDigestSchema,
}).superRefine((projection, context) => {
  rejectDuplicateStrings(
    projection.resolvedCertifications.map(
      (certification) => certification.certificationId,
    ),
    context,
  );
  const references = new Map(
    projection.certificationRefs.map((reference) => [
      reference.certificationId,
      reference.certificationDigest,
    ]),
  );
  if (
    projection.resolvedCertifications.length !== references.size ||
    projection.resolvedCertifications.some(
      (certification) =>
        references.get(certification.certificationId) !==
        certification.certificationDigest,
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "resolvedCertifications must exactly match certificationRefs",
      path: ["resolvedCertifications"],
    });
  }
});
export type RuntimeOfferProjection = z.infer<
  typeof RuntimeOfferProjectionSchema
>;

export const ResolvedModelSchema = z.discriminatedUnion("source", [
  CustomModelSchema.extend({
    source: z.literal("custom_model"),
    reasoning: ExplicitReasoningLevelSchema.optional(),
  })
    .strict()
    .refine((model) => customModelAllowsEffort(model, model.reasoning), {
      message: "unsupported custom model effort",
    }),
  z
    .object({
      source: z.literal("runtime_default"),
      selection: z.literal("no_model_selector_sent"),
    })
    .strict(),
  z
    .object({
      source: z.literal("explicit_binding"),
      modelBindingId: IdentifierSchema,
      provider: IdentifierSchema,
      modelId: IdentifierSchema,
      reasoning: ExplicitReasoningLevelSchema.optional(),
      serviceTier: ServiceTierSchema.optional(),
    })
    .strict(),
]);
export type ResolvedModel = z.infer<typeof ResolvedModelSchema>;

function resolvedModelsEqual(
  left: ResolvedModel,
  right: ResolvedModel,
): boolean {
  if (left.source !== right.source) return false;
  if (left.source === "runtime_default") return true;
  if (left.source === "custom_model")
    return (
      right.source === "custom_model" &&
      left.runtime === right.runtime &&
      left.modelId === right.modelId &&
      left.reasoning === right.reasoning
    );
  if (right.source !== "explicit_binding") return false;
  return (
    left.modelBindingId === right.modelBindingId &&
    left.provider === right.provider &&
    left.modelId === right.modelId &&
    left.reasoning === right.reasoning &&
    left.serviceTier === right.serviceTier
  );
}

export const PlacementHardRejectionReasonSchema = z.enum([
  "private_workspace_unsupported",
  "agent_disabled",
  "lane_busy",
  "host_unauthorized",
  "host_generation_inactive",
  "offer_stale",
  "offer_unavailable",
  "offer_not_allowed",
  "protocol_unsupported",
  "tool_access_unsupported",
  "capability_missing",
  "capability_evidence_insufficient",
  "isolation_insufficient",
  "model_unavailable",
  "workspace_unavailable",
  "workspace_mode_unsupported",
  "workspace_busy",
  "capacity_unconfigured",
  "capacity_exhausted",
  "circuit_open",
  "session_locality_unavailable",
]);
export type PlacementHardRejectionReason = z.infer<
  typeof PlacementHardRejectionReasonSchema
>;

export const PlacementHoldReasonSchema = z.enum([
  "agent_disabled",
  "lane_busy",
  "no_authorized_host",
  "no_compatible_offer",
  "profile_offline",
  "model_unavailable",
  "capacity_unconfigured",
  "capacity_exhausted",
  "workspace_busy",
  "session_locality_unavailable",
  "circuit_open",
]);
export type PlacementHoldReason = z.infer<typeof PlacementHoldReasonSchema>;

export const PlacementHoldSchema = z
  .object({
    activationId: IdentifierSchema,
    reason: PlacementHoldReasonSchema,
    dependencyKeys: UniqueIdentifierArraySchema,
    evaluatedAt: TimestampSchema,
    nextEvaluationAt: TimestampSchema,
  })
  .strict()
  .refine(
    (hold) => Date.parse(hold.nextEvaluationAt) >= Date.parse(hold.evaluatedAt),
    {
      message: "nextEvaluationAt must not precede evaluatedAt",
      path: ["nextEvaluationAt"],
    },
  );
export type PlacementHold = z.infer<typeof PlacementHoldSchema>;

export const PlacementScoreEvidenceSchema = z
  .object({
    criterion: IdentifierSchema,
    points: z.number().int().min(-1_000_000_000).max(1_000_000_000),
  })
  .strict();
export type PlacementScoreEvidence = z.infer<
  typeof PlacementScoreEvidenceSchema
>;

export const PlacementCandidateEvidenceSchema = z
  .object({
    runtimeOfferId: IdentifierSchema,
    runtimeOfferObservationId: IdentifierSchema.optional(),
    runtimeOfferSnapshotDigest: ContentDigestSchema.optional(),
    runtimeProfileRevisionId: IdentifierSchema,
    hardRejectionReasons: z.array(PlacementHardRejectionReasonSchema),
    resolvedModel: ResolvedModelSchema.optional(),
    workspaceMountRevisionId: IdentifierSchema.optional(),
    score: z.array(PlacementScoreEvidenceSchema).optional(),
    totalScore: z
      .number()
      .int()
      .min(-1_000_000_000)
      .max(1_000_000_000)
      .optional(),
  })
  .strict()
  .superRefine((evidence, context) => {
    const rejected = evidence.hardRejectionReasons.length > 0;
    rejectDuplicateStrings(evidence.hardRejectionReasons, context);
    if (evidence.score !== undefined) {
      rejectDuplicateStrings(
        evidence.score.map((entry) => entry.criterion),
        context,
      );
    }
    if (
      rejected &&
      (evidence.resolvedModel !== undefined ||
        evidence.workspaceMountRevisionId !== undefined ||
        evidence.score !== undefined ||
        evidence.totalScore !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "rejected candidates cannot contain resolution or score evidence",
        path: ["hardRejectionReasons"],
      });
    }
    if (
      !rejected &&
      (evidence.resolvedModel === undefined ||
        evidence.workspaceMountRevisionId === undefined ||
        evidence.score === undefined ||
        evidence.totalScore === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "feasible candidates require resolution and score evidence",
        path: ["score"],
      });
    }
    if (
      !rejected &&
      evidence.score !== undefined &&
      evidence.totalScore !== undefined &&
      evidence.score.reduce((total, entry) => total + entry.points, 0) !==
        evidence.totalScore
    ) {
      context.addIssue({
        code: "custom",
        message: "totalScore must equal the sum of score evidence",
        path: ["totalScore"],
      });
    }
  });
export type PlacementCandidateEvidence = z.infer<
  typeof PlacementCandidateEvidenceSchema
>;

export const PlacementDecisionSchema = z
  .object({
    placementId: IdentifierSchema,
    activationId: IdentifierSchema,
    roomId: IdentifierSchema,
    participantId: IdentifierSchema,
    agentDefinitionRevisionId: IdentifierSchema,
    executionPolicyRevisionId: IdentifierSchema,
    hostId: IdentifierSchema,
    hostInstanceId: IdentifierSchema,
    provenanceVersion: z.enum([
      "legacy_without_offer_observation",
      "offer_observation_v1",
    ]),
    runtimeOfferId: IdentifierSchema,
    runtimeOfferObservationId: IdentifierSchema.optional(),
    runtimeOfferSnapshotDigest: ContentDigestSchema.optional(),
    runtimeProfileRevisionId: IdentifierSchema,
    runtimeProfileDigest: ContentDigestSchema,
    protocolFamily: IdentifierSchema,
    resolvedModel: ResolvedModelSchema,
    workspaceDefinitionId: IdentifierSchema,
    workspaceMountRevisionId: IdentifierSchema,
    workspaceMountDigest: ContentDigestSchema,
    workspaceMode: WorkspaceModeSchema,
    capacityPoolIds: UniqueIdentifierArraySchema,
    schedulerVersion: IdentifierSchema,
    candidateSetDigest: ContentDigestSchema,
    candidateEvidence: z.array(PlacementCandidateEvidenceSchema).min(1),
    state: z.enum(["reserved", "consumed", "released"]),
    // Durable placements created before provider-native access selection used
    // the historical full-access launch flags.
    toolAccessMode: ToolAccessModeSchema.default("full_access"),
    leaseUntil: TimestampSchema,
    createdAt: TimestampSchema,
  })
  .strict()
  .superRefine((decision, context) => {
    if (Date.parse(decision.leaseUntil) <= Date.parse(decision.createdAt)) {
      context.addIssue({
        code: "custom",
        message: "leaseUntil must be later than createdAt",
        path: ["leaseUntil"],
      });
    }
    rejectDuplicateStrings(
      decision.candidateEvidence.map((evidence) => evidence.runtimeOfferId),
      context,
    );
    const candidateIds = decision.candidateEvidence.map(
      (evidence) => evidence.runtimeOfferId,
    );
    if (
      candidateIds.some(
        (candidateId, index) =>
          index > 0 && candidateIds[index - 1]!.localeCompare(candidateId) > 0,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "candidateEvidence must be ordered by runtimeOfferId",
        path: ["candidateEvidence"],
      });
    }
    const selected = decision.candidateEvidence.find(
      (evidence) => evidence.runtimeOfferId === decision.runtimeOfferId,
    );
    if (selected === undefined || selected.hardRejectionReasons.length > 0) {
      context.addIssue({
        code: "custom",
        message:
          "selected runtimeOfferId must reference feasible candidate evidence",
        path: ["runtimeOfferId"],
      });
    } else {
      if (decision.provenanceVersion === "offer_observation_v1") {
        if (
          decision.runtimeOfferObservationId === undefined ||
          decision.runtimeOfferSnapshotDigest === undefined ||
          decision.candidateEvidence.some(
            (candidate) =>
              candidate.runtimeOfferObservationId === undefined ||
              candidate.runtimeOfferSnapshotDigest === undefined,
          )
        ) {
          context.addIssue({
            code: "custom",
            message:
              "offer_observation_v1 requires immutable observation provenance for every candidate",
            path: ["runtimeOfferObservationId"],
          });
        }
        if (
          selected.runtimeOfferObservationId !==
            decision.runtimeOfferObservationId ||
          selected.runtimeOfferSnapshotDigest !==
            decision.runtimeOfferSnapshotDigest
        ) {
          context.addIssue({
            code: "custom",
            message:
              "selected candidate observation must match placement provenance",
            path: ["runtimeOfferObservationId"],
          });
        }
      } else if (
        decision.runtimeOfferObservationId !== undefined ||
        decision.runtimeOfferSnapshotDigest !== undefined ||
        decision.candidateEvidence.some(
          (candidate) =>
            candidate.runtimeOfferObservationId !== undefined ||
            candidate.runtimeOfferSnapshotDigest !== undefined,
        )
      ) {
        context.addIssue({
          code: "custom",
          message:
            "legacy provenance cannot contain fabricated Offer observation references",
          path: ["provenanceVersion"],
        });
      }
      if (
        selected.resolvedModel === undefined ||
        !resolvedModelsEqual(selected.resolvedModel, decision.resolvedModel)
      ) {
        context.addIssue({
          code: "custom",
          message: "selected candidate model must match resolvedModel",
          path: ["resolvedModel"],
        });
      }
      if (
        selected.workspaceMountRevisionId !== decision.workspaceMountRevisionId
      ) {
        context.addIssue({
          code: "custom",
          message:
            "selected candidate workspace must match placement workspace",
          path: ["workspaceMountRevisionId"],
        });
      }
    }
  });
export type PlacementDecision = z.infer<typeof PlacementDecisionSchema>;

export const ActivationCredentialScopeSchema = z
  .object({
    activationId: IdentifierSchema,
    consumerId: IdentifierSchema,
    hostId: IdentifierSchema,
    participantId: IdentifierSchema,
    roomId: IdentifierSchema,
    runAttemptId: IdentifierSchema,
    toSeq: z.number().int().positive(),
  })
  .strict();
export type ActivationCredentialScope = z.infer<
  typeof ActivationCredentialScopeSchema
>;

export const ClientRoomSyncRequestSchema = z
  .object({
    afterSeq: z.number().int().nonnegative().optional(),
    bootstrap: z.literal("latest").optional(),
    consumerId: IdentifierSchema,
    limit: z.number().int().positive().max(500).optional(),
    roomId: IdentifierSchema,
  })
  .strict()
  .refine(
    ({ afterSeq, bootstrap }) =>
      bootstrap === undefined || afterSeq === undefined,
    { message: "latest bootstrap cannot include afterSeq" },
  );
export type ClientRoomSyncRequest = z.infer<typeof ClientRoomSyncRequestSchema>;

export const ClientAcknowledgeRequestSchema = z
  .object({
    consumerId: IdentifierSchema,
    roomId: IdentifierSchema,
    throughSeq: z.number().int().nonnegative(),
  })
  .strict();
export type ClientAcknowledgeRequest = z.infer<
  typeof ClientAcknowledgeRequestSchema
>;

export const ClientTaskCreateRequestSchema = z
  .object({
    assigneeId: IdentifierSchema.optional(),
    basedOnRoomSeq: z.number().int().nonnegative().optional(),
    collaboratorIds: z.array(IdentifierSchema).optional(),
    dependencyTaskIds: z.array(IdentifierSchema).default([]),
    description: z.string().trim().min(1).optional(),
    idempotencyKey: IdentifierSchema,
    reviewerIds: z.array(IdentifierSchema).optional(),
    roomId: IdentifierSchema,
    title: z.string().trim().min(1),
  })
  .strict()
  .refine(
    (command) =>
      new Set(command.dependencyTaskIds).size ===
      command.dependencyTaskIds.length,
    {
      message: "dependencyTaskIds must be unique",
      path: ["dependencyTaskIds"],
    },
  )
  .superRefine((command, context) =>
    addTaskParticipantSelectionIssues(
      {
        assigneeId: command.assigneeId,
        collaboratorIds: command.collaboratorIds ?? [],
        reviewerIds: command.reviewerIds ?? [],
      },
      context,
    ),
  );
export type ClientTaskCreateRequest = z.infer<
  typeof ClientTaskCreateRequestSchema
>;

export const ClientTaskConvertRequestSchema = z
  .object({
    assigneeId: IdentifierSchema.optional(),
    basedOnRoomSeq: z.number().int().nonnegative(),
    collaboratorIds: z.array(IdentifierSchema).optional(),
    dependencyTaskIds: z.array(IdentifierSchema).default([]),
    description: z.string().trim().min(1).optional(),
    idempotencyKey: IdentifierSchema,
    messageId: IdentifierSchema,
    reviewerIds: z.array(IdentifierSchema).optional(),
    roomId: IdentifierSchema,
  })
  .strict()
  .refine(
    (command) =>
      new Set(command.dependencyTaskIds).size ===
      command.dependencyTaskIds.length,
    {
      message: "dependencyTaskIds must be unique",
      path: ["dependencyTaskIds"],
    },
  )
  .superRefine((command, context) =>
    addTaskParticipantSelectionIssues(
      {
        assigneeId: command.assigneeId,
        collaboratorIds: command.collaboratorIds ?? [],
        reviewerIds: command.reviewerIds ?? [],
      },
      context,
    ),
  );
export type ClientTaskConvertRequest = z.infer<
  typeof ClientTaskConvertRequestSchema
>;

const ClientTaskCommandBaseSchema = z
  .object({
    basedOnRoomSeq: z.number().int().nonnegative(),
    idempotencyKey: IdentifierSchema,
    taskId: IdentifierSchema,
  })
  .strict();

export const ClientTaskAssignRequestSchema = ClientTaskCommandBaseSchema.extend(
  {
    assigneeId: IdentifierSchema,
  },
).strict();
export type ClientTaskAssignRequest = z.infer<
  typeof ClientTaskAssignRequestSchema
>;

export const ClientTaskUnassignRequestSchema = ClientTaskCommandBaseSchema;
export type ClientTaskUnassignRequest = z.infer<
  typeof ClientTaskUnassignRequestSchema
>;

export const ClientTaskUnblockRequestSchema = ClientTaskCommandBaseSchema;
export type ClientTaskUnblockRequest = z.infer<
  typeof ClientTaskUnblockRequestSchema
>;

export const ClientTaskCompleteRequestSchema = ClientTaskCommandBaseSchema;
export type ClientTaskCompleteRequest = z.infer<
  typeof ClientTaskCompleteRequestSchema
>;

export const ClientTaskCancelRequestSchema = ClientTaskCommandBaseSchema.extend(
  {
    reason: z.string().trim().min(1),
  },
).strict();
export type ClientTaskCancelRequest = z.infer<
  typeof ClientTaskCancelRequestSchema
>;

export const ClientInputRequestsListRequestSchema = z
  .object({
    roomId: IdentifierSchema,
    state: InputRequestStateSchema.optional(),
  })
  .strict();
export type ClientInputRequestsListRequest = z.infer<
  typeof ClientInputRequestsListRequestSchema
>;

export const WorkerSyncRequestSchema = z
  .object({
    afterSeq: z.number().int().nonnegative().optional(),
  })
  .strict();
export type WorkerSyncRequest = z.infer<typeof WorkerSyncRequestSchema>;

export const WorkerAcknowledgeRequestSchema = z
  .object({
    readConfirmationId: z.string().uuid().optional(),
    throughSeq: z.number().int().nonnegative(),
  })
  .strict();
export type WorkerAcknowledgeRequest = z.infer<
  typeof WorkerAcknowledgeRequestSchema
>;

const WorkerTaskCommandBaseSchema = z
  .object({ taskId: IdentifierSchema, ...WorkerTaskCausalityShape })
  .strict();

export const WorkerTaskClaimRequestSchema = WorkerTaskCommandBaseSchema;
export type WorkerTaskClaimRequest = z.infer<
  typeof WorkerTaskClaimRequestSchema
>;

export const WorkerTaskClaimMessageRequestSchema = z
  .object({
    ...WorkerTaskCausalityShape,
    messageId: IdentifierSchema,
    rationale: z.string().trim().min(1).max(2_000),
  })
  .strict();
export type WorkerTaskClaimMessageRequest = z.infer<
  typeof WorkerTaskClaimMessageRequestSchema
>;

export const WorkerTaskReleaseRequestSchema = WorkerTaskCommandBaseSchema;
export type WorkerTaskReleaseRequest = z.infer<
  typeof WorkerTaskReleaseRequestSchema
>;

export const WorkerTaskBlockRequestSchema = WorkerTaskCommandBaseSchema.extend({
  reason: z.string().trim().min(1),
}).strict();
export type WorkerTaskBlockRequest = z.infer<
  typeof WorkerTaskBlockRequestSchema
>;

export const WorkerTaskGetRequestSchema = z
  .object({
    taskId: IdentifierSchema,
  })
  .strict();
export type WorkerTaskGetRequest = z.infer<typeof WorkerTaskGetRequestSchema>;

export const WorkerTaskInputStatusRequestSchema = z
  .object({
    taskId: IdentifierSchema,
  })
  .strict();
export type WorkerTaskInputStatusRequest = z.infer<
  typeof WorkerTaskInputStatusRequestSchema
>;

export const WorkerTaskStartRequestSchema = WorkerTaskCommandBaseSchema;
export type WorkerTaskStartRequest = z.infer<
  typeof WorkerTaskStartRequestSchema
>;

export const WorkerTaskProgressRequestSchema =
  WorkerTaskCommandBaseSchema.extend({
    progress: z.string().trim().min(1),
  }).strict();
export type WorkerTaskProgressRequest = z.infer<
  typeof WorkerTaskProgressRequestSchema
>;

export const WorkerTaskRequestInputRequestSchema =
  WorkerTaskCommandBaseSchema.extend({
    question: z.string().trim().min(1),
  }).strict();
export type WorkerTaskRequestInputRequest = z.infer<
  typeof WorkerTaskRequestInputRequestSchema
>;

export const WorkerTaskSubmitRequestSchema = WorkerTaskCommandBaseSchema.extend(
  {
    summary: z.string().trim().min(1),
    verification: TaskVerificationDeclarationSchema.optional(),
  },
).strict();
export type WorkerTaskSubmitRequest = z.infer<
  typeof WorkerTaskSubmitRequestSchema
>;

export {
  RoomSnapshotSchema,
  RoomSyncResponseSchema,
} from "./room-sync-response.ts";
export type { RoomSnapshot, RoomSyncResponse } from "./room-sync-response.ts";
import { RoomSyncResponseSchema } from "./room-sync-response.ts";

export * from "./worker-presented-context.ts";
export * from "./worker-task-causality.ts";

export const ClientRoomSyncResponseSchema = RoomSyncResponseSchema;
export type ClientRoomSyncResponse = z.infer<
  typeof ClientRoomSyncResponseSchema
>;

export const ClientAcknowledgeResponseSchema = z
  .object({
    acknowledgedThrough: z.number().int().nonnegative(),
  })
  .strict();
export type ClientAcknowledgeResponse = z.infer<
  typeof ClientAcknowledgeResponseSchema
>;

export * from "./task-response.ts";

export * from "./error-response.ts";
export * from "./room-files.ts";
export * from "./message-social.ts";
export * from "./official-agent-avatars.ts";
export * from "./profile-image.ts";
export * from "./runtime-failure.ts";
export * from "./human-profile.ts";
export * from "./public-channel.ts";

export * from "./worker-message-tools.ts";
export * from "./worker-task-trajectory.ts";
export {
  WorkbenchServiceRestartRequestSchema,
  WorkbenchServiceStatusSchema,
} from "./workbench-service.ts";

export * from "./worker-read-tools.ts";
export * from "./client-task-history.ts";

export * from "./agent-skills.ts";

export * from "./worker-task-management.ts";

export * from "./worker-self-profile.ts";

export * from "./task-amend.ts";

export * from "./worker-channel-attention.ts";

export * from "./attachment-comments.ts";

export * from "./task-delete.ts";

export * from "./worker-addressing.ts";

export * from "./worker-message-check.ts";
export * from "./worker-message-present.ts";
export * from "./worker-task-batch.ts";
export * from "./worker-task-update.ts";

export * from "./system-channel-visibility.ts";
export * from "./composer-controls.ts";
export * from "./channel-memory.ts";

export {
  MessageMentionBindingSchema,
  type MessageMentionBinding,
} from "./collaboration.ts";

export { canonicalAgentIdField } from "./agent-id-compat.ts";
export { isWorkerShortRef, shortWorkerRef } from "./worker-short-ref.ts";
export * from "./worker-mcp.ts";
export * from "./worker-mcp-receipt.ts";
