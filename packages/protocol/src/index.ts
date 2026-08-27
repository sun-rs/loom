import { z } from "zod";

import {
  ContentDigestSchema,
  IdentifierSchema,
  TimestampSchema,
  rejectDuplicateStrings,
} from "./common.ts";
import {
  AgentCatalogEntrySchema,
  AgentDefinitionRevisionSchema,
  VersionedContentRefSchema,
} from "./agent-definition.ts";
import {
  ParticipantKindSchema,
  PrincipalSchema,
  RoomSchema,
} from "./collaboration.ts";
import { RoomEventSchema, type RoomEvent } from "./room-event.ts";
import {
  TaskSchema,
  TaskStateSchema,
  type Task,
  type TaskState,
} from "./task.ts";

export { TaskSchema, TaskStateSchema };
export type { Task, TaskState };
export * from "./agent-definition.ts";
export { ContentDigestSchema } from "./common.ts";
export type { ContentDigest } from "./common.ts";
export {
  MembershipRoleSchema,
  MessageSchema,
  ParticipantKindSchema,
  PrincipalSchema,
  RoomKindSchema,
  RoomMembershipSchema,
  RoomSchema,
  ThreadSchema,
  WorkspaceSchema,
  WorkspaceStateSchema,
} from "./collaboration.ts";
export type {
  MembershipRole,
  Message,
  ParticipantKind,
  Principal,
  Room,
  RoomKind,
  RoomMembership,
  Thread,
  Workspace,
  WorkspaceState,
} from "./collaboration.ts";
export * from "./client.ts";
export { RoomEventSchema } from "./room-event.ts";
export type { RoomEvent } from "./room-event.ts";

export const ActivationReasonSchema = z.enum([
  "mention",
  "dm",
  "task_assigned",
  "task_available",
  "task_updated",
  "dependency_resolved",
  "input_requested",
  "input_resolved",
  "thread_subscription",
  "room_policy",
  "manual",
]);
export type ActivationReason = z.infer<typeof ActivationReasonSchema>;

export const ActivationStateSchema = z.enum([
  "queued",
  "leased",
  "quarantined",
  "completed",
  "cancelled",
]);
export type ActivationState = z.infer<typeof ActivationStateSchema>;

export const ActivationSchema = z
  .object({
    activationId: IdentifierSchema,
    roomId: IdentifierSchema,
    participantId: IdentifierSchema,
    fromSeq: z.number().int().positive(),
    toSeq: z.number().int().positive(),
    reason: ActivationReasonSchema,
    state: ActivationStateSchema,
    leaseOwner: IdentifierSchema.optional(),
    leaseUntil: TimestampSchema.optional(),
    attemptCount: z.number().int().nonnegative(),
    availableAt: TimestampSchema.optional(),
    lastError: z.string().min(1).optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
  .refine((activation) => activation.fromSeq <= activation.toSeq, {
    message: "fromSeq must be less than or equal to toSeq",
    path: ["fromSeq"],
  })
  .refine(
    (activation) =>
      activation.state !== "leased" ||
      (activation.leaseOwner !== undefined &&
        activation.leaseUntil !== undefined),
    {
      message: "leased activations require leaseOwner and leaseUntil",
      path: ["leaseOwner"],
    },
  );
export type Activation = z.infer<typeof ActivationSchema>;

export const WakeHintSchema = z
  .object({
    activationId: IdentifierSchema,
    participantId: IdentifierSchema,
    roomId: IdentifierSchema,
    headCursor: z.number().int().positive(),
    reason: ActivationReasonSchema,
  })
  .strict();
export type WakeHint = z.infer<typeof WakeHintSchema>;

export const InboxStateSchema = z.enum(["pending", "acknowledged"]);
export type InboxState = z.infer<typeof InboxStateSchema>;

export const InputRequestStateSchema = z.enum(["pending", "resolved"]);
export type InputRequestState = z.infer<typeof InputRequestStateSchema>;

export const InputRequestSchema = z
  .object({
    inputRequestId: IdentifierSchema,
    roomId: IdentifierSchema,
    taskId: IdentifierSchema,
    requesterId: IdentifierSchema,
    responderId: IdentifierSchema,
    question: z.string().trim().min(1),
    state: InputRequestStateSchema,
    answer: z.string().trim().min(1).optional(),
    resolvedBy: IdentifierSchema.optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    resolvedAt: TimestampSchema.optional(),
  })
  .strict()
  .superRefine((request, context) => {
    const resolutionFields = [
      request.answer,
      request.resolvedAt,
      request.resolvedBy,
    ];
    if (
      request.state === "pending" &&
      resolutionFields.some((value) => value !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "pending InputRequests cannot contain resolution evidence",
        path: ["state"],
      });
    }
    if (
      request.state === "resolved" &&
      resolutionFields.some((value) => value === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "resolved InputRequests require complete resolution evidence",
        path: ["state"],
      });
    }
    if (
      request.resolvedBy !== undefined &&
      request.resolvedBy !== request.responderId
    ) {
      context.addIssue({
        code: "custom",
        message: "InputRequests must be resolved by their responder",
        path: ["resolvedBy"],
      });
    }
  });
export type InputRequest = z.infer<typeof InputRequestSchema>;

export const InputRequestStatusSchema = z
  .object({
    inputRequestId: IdentifierSchema,
    taskId: IdentifierSchema,
    state: InputRequestStateSchema,
  })
  .strict();
export type InputRequestStatus = z.infer<typeof InputRequestStatusSchema>;

export const InputRequestResolveRequestSchema = z
  .object({
    answer: z.string().trim().min(1),
    basedOnRoomSeq: z.number().int().nonnegative(),
    idempotencyKey: IdentifierSchema,
    inputRequestId: IdentifierSchema,
  })
  .strict();
export type InputRequestResolveRequest = z.infer<
  typeof InputRequestResolveRequestSchema
>;

export const RuntimeRecoveryDescriptorSchema = z
  .object({
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

export const CapabilityEvidenceLevelSchema = z.enum([
  "declared",
  "probed",
  "certified",
]);
export type CapabilityEvidenceLevel = z.infer<
  typeof CapabilityEvidenceLevelSchema
>;

export const WorkspaceModeSchema = z.enum([
  "in_place",
  "worktree",
  "ephemeral",
]);
export type WorkspaceMode = z.infer<typeof WorkspaceModeSchema>;

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

export const RuntimeProfileManifestSchema = z.discriminatedUnion(
  "manifestVersion",
  [RuntimeProfileManifestV1Schema, RuntimeProfileManifestV2Schema],
);
export type RuntimeProfileManifest = z.infer<
  typeof RuntimeProfileManifestSchema
>;

export const RuntimeProfileProbeReportSchema = z
  .object({
    reportVersion: z.literal(1),
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

export const IsolationLevelSchema = z.enum([
  "none",
  "process",
  "platform",
  "container",
]);
export type IsolationLevel = z.infer<typeof IsolationLevelSchema>;

export const ReasoningLevelSchema = z.enum([
  "default",
  "low",
  "medium",
  "high",
  "max",
]);
export type ReasoningLevel = z.infer<typeof ReasoningLevelSchema>;

export const ExplicitReasoningLevelSchema = z.enum([
  "low",
  "medium",
  "high",
  "max",
]);
export type ExplicitReasoningLevel = z.infer<
  typeof ExplicitReasoningLevelSchema
>;

export const ServiceTierSchema = z.enum(["default", "fast", "priority"]);
export type ServiceTier = z.infer<typeof ServiceTierSchema>;

export const ModelCapabilityClassSchema = z.enum([
  "fast",
  "balanced",
  "deep_coding",
]);
export type ModelCapabilityClass = z.infer<typeof ModelCapabilityClassSchema>;

export const ModelIntentSchema = z
  .object({
    exactBindingIds: UniqueIdentifierArraySchema.min(1).optional(),
    capabilityClass: ModelCapabilityClassSchema.optional(),
    reasoning: ReasoningLevelSchema.optional(),
    serviceTier: ServiceTierSchema.optional(),
    fallback: z.enum(["disabled", "same_profile", "compatible_offer"]),
  })
  .strict()
  .refine(
    (intent) =>
      intent.exactBindingIds === undefined ||
      intent.capabilityClass === undefined,
    {
      message: "exactBindingIds and capabilityClass are mutually exclusive",
      path: ["capabilityClass"],
    },
  );
export type ModelIntent = z.infer<typeof ModelIntentSchema>;

export const RuntimeCapabilityEvidenceSchema = z
  .object({
    capability: IdentifierSchema,
    evidence: CapabilityEvidenceLevelSchema,
  })
  .strict();
export type RuntimeCapabilityEvidence = z.infer<
  typeof RuntimeCapabilityEvidenceSchema
>;

export const RuntimeCertificationRefSchema = z
  .object({
    certificationId: IdentifierSchema,
    certificationDigest: ContentDigestSchema,
  })
  .strict();
export type RuntimeCertificationRef = z.infer<
  typeof RuntimeCertificationRefSchema
>;

export const RuntimeCertificationSchema = z
  .object({
    certificationId: IdentifierSchema,
    certificationDigest: ContentDigestSchema,
    protocolFamily: IdentifierSchema,
    runtimeProfileDigest: ContentDigestSchema,
    capabilities: UniqueIdentifierArraySchema,
    maximumIsolation: IsolationLevelSchema,
  })
  .strict();
export type RuntimeCertification = z.infer<typeof RuntimeCertificationSchema>;

export const RuntimeCapabilityRequirementSchema = z
  .object({
    capability: IdentifierSchema,
    minimumEvidence: z.enum(["probed", "certified"]),
  })
  .strict();
export type RuntimeCapabilityRequirement = z.infer<
  typeof RuntimeCapabilityRequirementSchema
>;

const ModelBindingDescriptorFields = {
  modelBindingId: IdentifierSchema,
  provider: IdentifierSchema,
  modelId: IdentifierSchema,
  capabilityClasses: z
    .array(ModelCapabilityClassSchema)
    .superRefine(rejectDuplicateStrings),
  supportedReasoning: z
    .array(ExplicitReasoningLevelSchema)
    .superRefine(rejectDuplicateStrings),
  supportedServiceTiers: z
    .array(ServiceTierSchema)
    .superRefine(rejectDuplicateStrings),
  evidence: CapabilityEvidenceLevelSchema,
};

export const ModelBindingDescriptorSchema = z
  .object(ModelBindingDescriptorFields)
  .strict();
export type ModelBindingDescriptor = z.infer<
  typeof ModelBindingDescriptorSchema
>;

export const RuntimeModelBindingSchema = z
  .object({
    ...ModelBindingDescriptorFields,
    adapterMapping: z
      .object({
        kind: IdentifierSchema,
        config: z.record(z.string(), z.unknown()),
      })
      .strict(),
  })
  .strict();
export type RuntimeModelBinding = z.infer<typeof RuntimeModelBindingSchema>;

const PreferenceWeightSchema = z.number().int().positive().max(1_000_000);
const TargetPreferenceSchema = z
  .object({
    criterion: z.enum([
      "runtime_offer",
      "runtime_profile",
      "protocol_family",
      "model_binding",
    ]),
    targetId: IdentifierSchema,
    weight: PreferenceWeightSchema,
  })
  .strict();
const ScalarPreferenceSchema = z
  .object({
    criterion: z.enum(["lower_load", "avoid_structural_failures"]),
    weight: PreferenceWeightSchema,
  })
  .strict();

export const PlacementPreferenceSchema = z.union([
  TargetPreferenceSchema,
  ScalarPreferenceSchema,
]);
export type PlacementPreference = z.infer<typeof PlacementPreferenceSchema>;

export const ExecutionPolicyRevisionSchema = z
  .object({
    executionPolicyId: IdentifierSchema,
    executionPolicyRevisionId: IdentifierSchema,
    controlRoomId: IdentifierSchema,
    revision: z.number().int().positive(),
    contentDigest: ContentDigestSchema,
    required: z
      .object({
        authorizedHostIds: UniqueIdentifierArraySchema.min(1).optional(),
        allowedOfferIds: UniqueIdentifierArraySchema.min(1).optional(),
        allowedProtocolFamilies: UniqueIdentifierArraySchema.min(1),
        capabilities: z.array(RuntimeCapabilityRequirementSchema),
        minimumIsolation: IsolationLevelSchema,
        workspaceMode: WorkspaceModeSchema,
      })
      .strict(),
    preferred: z.array(PlacementPreferenceSchema).max(64),
    modelIntent: ModelIntentSchema,
    sessionPolicy: z.enum(["fresh", "prefer_resume", "require_resume"]),
    retryPolicyRef: VersionedContentRefSchema,
    createdBy: IdentifierSchema,
    createdAt: TimestampSchema,
  })
  .strict()
  .superRefine((policy, context) => {
    rejectDuplicateStrings(
      policy.required.capabilities.map((requirement) => requirement.capability),
      context,
    );
    rejectDuplicateStrings(
      policy.preferred.map((preference) =>
        "targetId" in preference
          ? `${preference.criterion}:${preference.targetId}`
          : preference.criterion,
      ),
      context,
    );
  });
export type ExecutionPolicyRevision = z.infer<
  typeof ExecutionPolicyRevisionSchema
>;

export const ClientAgentProvisionRequestSchema = z
  .object({
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
    sessionPolicy: z.enum(["fresh", "prefer_resume", "require_resume"]),
  })
  .strict();
export type ClientAgentProvisionRequest = z.infer<
  typeof ClientAgentProvisionRequestSchema
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

export const RuntimeOfferStateSchema = z.enum([
  "available",
  "degraded",
  "draining",
  "unavailable",
]);
export type RuntimeOfferState = z.infer<typeof RuntimeOfferStateSchema>;

export const WorkspaceMountDescriptorSchema = z
  .object({
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
  "agent_disabled",
  "lane_busy",
  "host_unauthorized",
  "host_generation_inactive",
  "offer_stale",
  "offer_unavailable",
  "offer_not_allowed",
  "protocol_unsupported",
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
    consumerId: IdentifierSchema,
    limit: z.number().int().positive().max(500).optional(),
    roomId: IdentifierSchema,
  })
  .strict();
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

export const ClientTasksListRequestSchema = z
  .object({ roomId: IdentifierSchema })
  .strict();
export type ClientTasksListRequest = z.infer<
  typeof ClientTasksListRequestSchema
>;

export const ClientTaskCreateRequestSchema = z
  .object({
    assigneeId: IdentifierSchema.optional(),
    basedOnRoomSeq: z.number().int().nonnegative().optional(),
    dependencyTaskIds: z.array(IdentifierSchema).default([]),
    description: z.string().trim().min(1).optional(),
    idempotencyKey: IdentifierSchema,
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
  );
export type ClientTaskCreateRequest = z.infer<
  typeof ClientTaskCreateRequestSchema
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
    throughSeq: z.number().int().nonnegative(),
  })
  .strict();
export type WorkerAcknowledgeRequest = z.infer<
  typeof WorkerAcknowledgeRequestSchema
>;

export const WorkerMessagePostRequestSchema = z
  .object({
    basedOnRoomSeq: z.number().int().nonnegative(),
    body: z.string().trim().min(1),
    idempotencyKey: IdentifierSchema,
  })
  .strict();
export type WorkerMessagePostRequest = z.infer<
  typeof WorkerMessagePostRequestSchema
>;

const WorkerTaskCommandBaseSchema = z
  .object({
    taskId: IdentifierSchema,
    idempotencyKey: IdentifierSchema,
    basedOnRoomSeq: z.number().int().nonnegative(),
  })
  .strict();

export const WorkerTaskClaimRequestSchema = WorkerTaskCommandBaseSchema;
export type WorkerTaskClaimRequest = z.infer<
  typeof WorkerTaskClaimRequestSchema
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
  },
).strict();
export type WorkerTaskSubmitRequest = z.infer<
  typeof WorkerTaskSubmitRequestSchema
>;

export const RoomSnapshotSchema = z
  .object({
    room: RoomSchema,
    members: z.array(PrincipalSchema),
  })
  .strict();
export type RoomSnapshot = z.infer<typeof RoomSnapshotSchema>;

export const RoomSyncResponseSchema = z
  .object({
    cursorBefore: z.number().int().nonnegative(),
    cursorAfter: z.number().int().nonnegative(),
    latestRoomSeq: z.number().int().nonnegative(),
    snapshot: RoomSnapshotSchema.nullable(),
    events: z.array(RoomEventSchema),
  })
  .strict()
  .refine((response) => response.cursorBefore <= response.latestRoomSeq, {
    message: "cursorBefore must be less than or equal to latestRoomSeq",
    path: ["cursorBefore"],
  })
  .refine((response) => response.cursorAfter <= response.latestRoomSeq, {
    message: "cursorAfter must be less than or equal to latestRoomSeq",
    path: ["cursorAfter"],
  });
export type RoomSyncResponse = z.infer<typeof RoomSyncResponseSchema>;

export const WorkerSyncResponseSchema = RoomSyncResponseSchema;
export type WorkerSyncResponse = RoomSyncResponse;

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

export const ClientTasksListResponseSchema = z
  .object({ tasks: z.array(TaskSchema) })
  .strict();
export type ClientTasksListResponse = z.infer<
  typeof ClientTasksListResponseSchema
>;

export const ClientTaskMutationResponseSchema = z
  .object({
    deduplicated: z.boolean(),
    event: RoomEventSchema,
    task: TaskSchema,
  })
  .strict();
export type ClientTaskMutationResponse = z.infer<
  typeof ClientTaskMutationResponseSchema
>;

export const ClientTaskAttentionMutationResponseSchema =
  ClientTaskMutationResponseSchema.extend({
    activationIds: z.array(IdentifierSchema),
  }).strict();
export type ClientTaskAttentionMutationResponse = z.infer<
  typeof ClientTaskAttentionMutationResponseSchema
>;

export const ClientInputRequestsListResponseSchema = z
  .object({ inputRequests: z.array(InputRequestSchema) })
  .strict();
export type ClientInputRequestsListResponse = z.infer<
  typeof ClientInputRequestsListResponseSchema
>;

export const WorkerAcknowledgeResponseSchema = z
  .object({
    acknowledgedThrough: z.number().int().nonnegative(),
  })
  .strict();
export type WorkerAcknowledgeResponse = z.infer<
  typeof WorkerAcknowledgeResponseSchema
>;

export const WorkerMessageMutationResponseSchema = z
  .object({
    activationIds: z.array(IdentifierSchema),
    deduplicated: z.boolean(),
    event: RoomEventSchema,
  })
  .strict();
export type WorkerMessageMutationResponse = z.infer<
  typeof WorkerMessageMutationResponseSchema
>;

export const WorkerTaskMutationResponseSchema = z
  .object({
    deduplicated: z.boolean(),
    event: RoomEventSchema,
    task: TaskSchema,
  })
  .strict();
export type WorkerTaskMutationResponse = z.infer<
  typeof WorkerTaskMutationResponseSchema
>;

export const WorkerTaskAttentionMutationResponseSchema =
  WorkerTaskMutationResponseSchema.extend({
    activationIds: z.array(IdentifierSchema),
  }).strict();
export type WorkerTaskAttentionMutationResponse = z.infer<
  typeof WorkerTaskAttentionMutationResponseSchema
>;

export const WorkerTaskRequestInputResponseSchema = z
  .object({
    deduplicated: z.boolean(),
    event: RoomEventSchema,
    inputRequest: InputRequestSchema,
    task: TaskSchema,
  })
  .strict();
export type WorkerTaskRequestInputResponse = z.infer<
  typeof WorkerTaskRequestInputResponseSchema
>;

export const InputRequestResolveResponseSchema = z
  .object({
    activationIds: z.array(IdentifierSchema),
    deduplicated: z.boolean(),
    event: RoomEventSchema,
    inputRequest: InputRequestSchema,
    task: TaskSchema,
  })
  .strict();
export type InputRequestResolveResponse = z.infer<
  typeof InputRequestResolveResponseSchema
>;

export const WorkerTaskGetResponseSchema = z
  .object({
    task: TaskSchema,
  })
  .strict();
export type WorkerTaskGetResponse = z.infer<typeof WorkerTaskGetResponseSchema>;

export const WorkerTaskInputStatusResponseSchema = z
  .object({
    inputRequest: InputRequestStatusSchema.nullable(),
  })
  .strict();
export type WorkerTaskInputStatusResponse = z.infer<
  typeof WorkerTaskInputStatusResponseSchema
>;

export const ErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: IdentifierSchema,
        message: z.string().min(1),
      })
      .strict(),
  })
  .strict();
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const WorkerErrorResponseSchema = ErrorResponseSchema;
export type WorkerErrorResponse = ErrorResponse;

export const ClientErrorResponseSchema = ErrorResponseSchema;
export type ClientErrorResponse = z.infer<typeof ClientErrorResponseSchema>;
