import {
  HOST_EXECUTION_WORKSPACE_BINDING_LIMIT,
  HostExecutionWorkspaceBindingSchema,
  ActivationSchema,
  AgentRuntimeContextSchema,
  ContextManifestSchema,
  PlacementDecisionSchema,
  RuntimeRecoveryDescriptorSchema,
  RuntimeRetryDispositionSchema,
  RuntimeOfferProjectionSchema,
  RuntimeOfferSchema,
  RuntimeTrajectoryAppendInputSchema,
  RuntimeTrajectoryRecordSchema,
} from "@rah-os/protocol";
import { z } from "zod";

/**
 * RAH-owned, transport-neutral control contracts for a remote Computer.
 *
 * The observable lifecycle is supervised against Raft Computer, but these
 * schemas intentionally preserve RAH's authenticated Host generation,
 * immutable Placement, and content-free hint invariants.
 */
export const COMPUTER_CONTROL_API_VERSION = 1 as const;

const IdentifierSchema = z.string().trim().min(1);
const TimestampSchema = z.iso.datetime({ offset: true });

function rejectDuplicates(
  values: readonly string[],
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        message: `duplicate value: ${value}`,
        path: [index],
      });
    }
    seen.add(value);
  });
}

export const ComputerControlCapabilitySchema = z.enum([
  "content_free_hints",
  "managed_operations",
  "placement_pull",
  "runtime_offer_publish",
  "runtime_activity_publish",
  "terminal_proof",
  "worker_credential_issue",
]);
export type ComputerControlCapability = z.infer<
  typeof ComputerControlCapabilitySchema
>;

export const ComputerSessionOpenRequestSchema = z
  .object({
    capabilities: z.array(ComputerControlCapabilitySchema),
    computerBuildVersion: z.string().trim().min(1),
    computerInstanceId: IdentifierSchema,
    connectionId: IdentifierSchema,
    controlApiVersions: z.array(z.literal(COMPUTER_CONTROL_API_VERSION)).min(1),
    processId: z.number().int().positive(),
    runtimeProtocolVersion: z.number().int().positive(),
  })
  .strict()
  .superRefine((request, context) => {
    rejectDuplicates(request.capabilities, context);
    rejectDuplicates(request.controlApiVersions.map(String), context);
    for (const required of [
      "placement_pull",
      "runtime_offer_publish",
      "runtime_activity_publish",
      "terminal_proof",
      "worker_credential_issue",
    ] as const) {
      if (!request.capabilities.includes(required)) {
        context.addIssue({
          code: "custom",
          message: `Computer session requires ${required}`,
          path: ["capabilities"],
        });
      }
    }
  });
export type ComputerSessionOpenRequest = z.infer<
  typeof ComputerSessionOpenRequestSchema
>;

export const ComputerSessionOpenResponseSchema = z
  .object({
    acceptedControlApiVersion: z.literal(COMPUTER_CONTROL_API_VERSION),
    hostId: IdentifierSchema,
    hostInstanceId: IdentifierSchema,
    serverTime: TimestampSchema,
    sessionAccessToken: z.string().min(32),
    sessionExpiresAt: TimestampSchema,
  })
  .strict()
  .superRefine((response, context) => {
    if (
      Date.parse(response.sessionExpiresAt) <= Date.parse(response.serverTime)
    ) {
      context.addIssue({
        code: "custom",
        message: "sessionExpiresAt must be later than serverTime",
        path: ["sessionExpiresAt"],
      });
    }
  });
export type ComputerSessionOpenResponse = z.infer<
  typeof ComputerSessionOpenResponseSchema
>;

export const ComputerHostStateSchema = z.enum([
  "online",
  "draining",
  "offline",
]);
export type ComputerHostState = z.infer<typeof ComputerHostStateSchema>;

export const ComputerHostRecordSchema = z
  .object({
    buildVersion: z.string().trim().min(1).optional(),
    hostId: IdentifierSchema,
    instanceId: IdentifierSchema,
    createdAt: TimestampSchema.optional(),
    lastSeenAt: TimestampSchema,
    participantIds: z.array(IdentifierSchema),
    processId: z.number().int().positive().optional(),
    protocolVersion: z.number().int().positive().optional(),
    state: ComputerHostStateSchema,
  })
  .strict()
  .superRefine((host, context) => {
    rejectDuplicates(host.participantIds, context);
  });
export type ComputerHostRecord = z.infer<typeof ComputerHostRecordSchema>;

export const ComputerHeartbeatRequestSchema = z
  .object({
    buildVersion: z.string().trim().min(1).optional(),
    processId: z.number().int().positive().optional(),
    protocolVersion: z.number().int().positive().optional(),
    state: ComputerHostStateSchema.default("online"),
  })
  .strict();
export type ComputerHeartbeatRequest = z.infer<
  typeof ComputerHeartbeatRequestSchema
>;

export const ComputerHeartbeatResponseSchema = z
  .object({
    executionWorkspaceBindings: z
      .array(HostExecutionWorkspaceBindingSchema)
      .max(HOST_EXECUTION_WORKSPACE_BINDING_LIMIT)
      .optional(),
    host: ComputerHostRecordSchema,
    serverTime: TimestampSchema,
    sessionExpiresAt: TimestampSchema,
  })
  .strict()
  .superRefine((response, context) => {
    if (
      Date.parse(response.sessionExpiresAt) <= Date.parse(response.serverTime)
    ) {
      context.addIssue({
        code: "custom",
        message: "sessionExpiresAt must be later than serverTime",
        path: ["sessionExpiresAt"],
      });
    }
  });
export type ComputerHeartbeatResponse = z.infer<
  typeof ComputerHeartbeatResponseSchema
>;

export const ComputerRuntimeOfferPublishRequestSchema = z
  .object({ offer: RuntimeOfferSchema })
  .strict();
export type ComputerRuntimeOfferPublishRequest = z.infer<
  typeof ComputerRuntimeOfferPublishRequestSchema
>;

export const ComputerRuntimeOfferPublishResponseSchema = z
  .object({ offer: RuntimeOfferProjectionSchema })
  .strict();
export type ComputerRuntimeOfferPublishResponse = z.infer<
  typeof ComputerRuntimeOfferPublishResponseSchema
>;

export const ComputerRunAttemptSchema = z
  .object({
    activationId: IdentifierSchema,
    attemptNumber: z.number().int().positive(),
    error: z.string().min(1).optional(),
    exitCode: z.number().int().optional(),
    exitSignal: z.string().trim().min(1).optional(),
    finishedAt: TimestampSchema.optional(),
    contextManifest: ContextManifestSchema.optional(),
    hostId: IdentifierSchema,
    /** S2-a warm turn identity (local Hosts only today). */
    instanceRuntimeId: IdentifierSchema.optional(),
    nativeTurnId: IdentifierSchema.optional(),
    participantId: IdentifierSchema,
    placement: PlacementDecisionSchema.optional(),
    roomId: IdentifierSchema,
    runAttemptId: IdentifierSchema,
    runtimeRunId: IdentifierSchema.optional(),
    startedAt: TimestampSchema,
    state: z.enum([
      "starting",
      "running",
      "orphaned",
      "exited",
      "failed",
      "cancelled",
      "timed_out",
    ]),
  })
  .strict();
export type ComputerRunAttempt = z.infer<typeof ComputerRunAttemptSchema>;

export const ComputerPlacementLaunchClaimSchema = z
  .object({
    activation: ActivationSchema,
    agentContext: AgentRuntimeContextSchema,
    placement: PlacementDecisionSchema,
    runAttempt: ComputerRunAttemptSchema,
  })
  .strict()
  .superRefine((claim, context) => {
    const expected = {
      activationId: claim.placement.activationId,
      hostId: claim.placement.hostId,
      participantId: claim.placement.participantId,
      roomId: claim.placement.roomId,
    };
    const mismatches = [
      [
        "activation",
        "activationId",
        claim.activation.activationId,
        expected.activationId,
      ],
      [
        "activation",
        "participantId",
        claim.activation.participantId,
        expected.participantId,
      ],
      ["activation", "roomId", claim.activation.roomId, expected.roomId],
      [
        "agentContext",
        "participantId",
        claim.agentContext.participantId,
        expected.participantId,
      ],
      [
        "runAttempt",
        "activationId",
        claim.runAttempt.activationId,
        expected.activationId,
      ],
      ["runAttempt", "hostId", claim.runAttempt.hostId, expected.hostId],
      [
        "runAttempt",
        "participantId",
        claim.runAttempt.participantId,
        expected.participantId,
      ],
      ["runAttempt", "roomId", claim.runAttempt.roomId, expected.roomId],
    ] as const;
    for (const [owner, field, actual, wanted] of mismatches) {
      if (actual !== wanted) {
        context.addIssue({
          code: "custom",
          message: `${owner}.${field} must match Placement`,
          path: [owner, field],
        });
      }
    }
    if (claim.activation.leaseOwner !== claim.placement.hostId) {
      context.addIssue({
        code: "custom",
        message: "Activation leaseOwner must match Placement Host",
        path: ["activation", "leaseOwner"],
      });
    }
    if (claim.activation.attemptCount !== claim.runAttempt.attemptNumber) {
      context.addIssue({
        code: "custom",
        message: "RunAttempt number must match Activation attemptCount",
        path: ["runAttempt", "attemptNumber"],
      });
    }
    if (
      claim.agentContext.agentDefinitionRevision.agentDefinitionRevisionId !==
        claim.placement.agentDefinitionRevisionId ||
      claim.agentContext.agentDefinitionRevision.executionPolicyRevisionId !==
        claim.placement.executionPolicyRevisionId
    ) {
      context.addIssue({
        code: "custom",
        message: "Agent context revisions must match Placement",
        path: ["agentContext", "agentDefinitionRevision"],
      });
    }
    if (claim.placement.state !== "consumed") {
      context.addIssue({
        code: "custom",
        message: "a launch claim requires a consumed Placement",
        path: ["placement", "state"],
      });
    }
    if (
      claim.runAttempt.placement === undefined ||
      claim.runAttempt.placement.placementId !== claim.placement.placementId ||
      claim.runAttempt.placement.hostInstanceId !==
        claim.placement.hostInstanceId
    ) {
      context.addIssue({
        code: "custom",
        message: "RunAttempt Placement must match the claimed generation",
        path: ["runAttempt", "placement"],
      });
    }
    const manifest = claim.runAttempt.contextManifest;
    if (
      manifest === undefined ||
      manifest.runAttemptId !== claim.runAttempt.runAttemptId ||
      manifest.activationId !== claim.activation.activationId ||
      manifest.roomId !== claim.activation.roomId ||
      manifest.participantId !== claim.activation.participantId ||
      manifest.throughRoomSeq !== claim.activation.toSeq ||
      manifest.placement?.placementId !== claim.placement.placementId ||
      manifest.agentDefinition?.agentDefinitionRevisionId !==
        claim.agentContext.agentDefinitionRevision.agentDefinitionRevisionId
    ) {
      context.addIssue({
        code: "custom",
        message: "ContextManifest must match the exact launch claim",
        path: ["runAttempt", "contextManifest"],
      });
    }
  });
export type ComputerPlacementLaunchClaim = z.infer<
  typeof ComputerPlacementLaunchClaimSchema
>;

export const ComputerPlacementClaimRequestSchema = z
  .object({
    leaseMs: z
      .number()
      .int()
      .positive()
      .max(24 * 60 * 60 * 1_000),
  })
  .strict();
export type ComputerPlacementClaimRequest = z.infer<
  typeof ComputerPlacementClaimRequestSchema
>;

export const ComputerPlacementClaimResponseSchema = z
  .object({ claim: ComputerPlacementLaunchClaimSchema.nullable() })
  .strict();
export type ComputerPlacementClaimResponse = z.infer<
  typeof ComputerPlacementClaimResponseSchema
>;

export const ComputerRuntimeProcessSchema = z
  .object({
    activationId: IdentifierSchema,
    exitCode: z.number().int().optional(),
    exitSignal: IdentifierSchema.optional(),
    launchHostId: IdentifierSchema,
    participantId: IdentifierSchema,
    /** S2-a: which terminal proof closed this execution record. */
    proofKind: z.enum(["process_exit", "turn_quiesced"]).optional(),
    quiesceResult: z.enum(["success", "error", "cancelled"]).optional(),
    closeSeq: z.number().int().nonnegative().optional(),
    recoveryAttemptCount: z.number().int().nonnegative(),
    recoveryDescriptor: RuntimeRecoveryDescriptorSchema,
    recoveryLastError: z.string().min(1).optional(),
    recoveryLeaseOwner: IdentifierSchema.optional(),
    recoveryLeaseOwnerInstanceId: IdentifierSchema.optional(),
    recoveryLeaseUntil: TimestampSchema.optional(),
    registeredAt: TimestampSchema,
    roomId: IdentifierSchema,
    runAttemptId: IdentifierSchema,
    runtimeProcessId: IdentifierSchema,
    runtimeRunId: IdentifierSchema,
    state: z.enum(["prepared", "active", "orphaned", "terminated"]),
    terminatedAt: TimestampSchema.optional(),
    updatedAt: TimestampSchema,
  })
  .strict();
export type ComputerRuntimeProcess = z.infer<
  typeof ComputerRuntimeProcessSchema
>;

const RunIdentityShape = {
  recoveryDescriptor: RuntimeRecoveryDescriptorSchema,
  runAttemptId: IdentifierSchema,
  runtimeRunId: IdentifierSchema,
} as const;

export const ComputerExecutionCommandRequestSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        activationId: IdentifierSchema,
        kind: z.literal("activation.renew"),
        leaseMs: z
          .number()
          .int()
          .positive()
          .max(24 * 60 * 60 * 1_000),
      })
      .strict(),
    z
      .object({ kind: z.literal("runtime.prepare"), ...RunIdentityShape })
      .strict(),
    z.object({ kind: z.literal("run.start"), ...RunIdentityShape }).strict(),
    RuntimeTrajectoryAppendInputSchema.extend({
      kind: z.literal("run.trajectory.append"),
    }).strict(),
    z
      .object({
        exit: z
          .object({
            code: z.number().int().nullable(),
            signal: IdentifierSchema.optional(),
          })
          .strict(),
        kind: z.literal("runtime.terminate"),
        runAttemptId: IdentifierSchema,
        runtimeRunId: IdentifierSchema,
      })
      .strict(),
    z
      .object({
        error: z.string().trim().min(1).optional(),
        exitCode: z.number().int().optional(),
        exitSignal: IdentifierSchema.optional(),
        kind: z.literal("run.finish"),
        runAttemptId: IdentifierSchema,
        state: z.enum(["exited", "failed", "cancelled", "timed_out"]),
      })
      .strict(),
    z
      .object({
        activationId: IdentifierSchema,
        consumerId: IdentifierSchema,
        kind: z.literal("activation.complete"),
      })
      .strict(),
    z
      .object({
        activationId: IdentifierSchema,
        error: z.string().trim().min(1),
        kind: z.literal("activation.retry"),
        retryAfterMs: z
          .number()
          .int()
          .nonnegative()
          .max(24 * 60 * 60 * 1_000),
        retryDisposition: RuntimeRetryDispositionSchema.optional(),
      })
      .strict(),
    z
      .object({
        activationId: IdentifierSchema,
        error: z.string().trim().min(1),
        kind: z.literal("activation.quarantine"),
      })
      .strict(),
    z
      .object({
        activationId: IdentifierSchema,
        kind: z.literal("activation.cancellation.resolve"),
      })
      .strict(),
    /**
     * The Host registers that it handed the Kernel's own rendering of this
     * Activation's range to the runtime, after that driver's acceptance
     * signal. It carries no range, no page and no digest: everything the
     * record contains was written by the server when it rendered. This rides
     * the existing authenticated Host session — the same `session.host`
     * (`AuthenticatedHostContext` from `agent_host_credentials`) that
     * `run.finish` and `activation.complete` use — so no new authentication
     * path exists anywhere for this fact.
     */
    z
      .object({
        activationId: IdentifierSchema,
        consumerId: IdentifierSchema,
        kind: z.literal("delivery.presented.sent"),
        runAttemptId: IdentifierSchema,
      })
      .strict(),
  ],
);
export type ComputerExecutionCommandRequest = z.infer<
  typeof ComputerExecutionCommandRequestSchema
>;

export const ComputerExecutionCommandResponseSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        activation: ActivationSchema,
        kind: z.literal("activation.renew"),
      })
      .strict(),
    z
      .object({
        kind: z.literal("runtime.prepare"),
        runtimeProcess: ComputerRuntimeProcessSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("run.start"),
        runAttempt: ComputerRunAttemptSchema,
      })
      .strict(),
    z
      .object({
        activity: RuntimeTrajectoryRecordSchema,
        kind: z.literal("run.trajectory.append"),
      })
      .strict(),
    z
      .object({
        kind: z.literal("runtime.terminate"),
        runtimeProcess: ComputerRuntimeProcessSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("run.finish"),
        runAttempt: ComputerRunAttemptSchema,
      })
      .strict(),
    z
      .object({
        activation: ActivationSchema,
        kind: z.literal("activation.complete"),
      })
      .strict(),
    z
      .object({
        activation: ActivationSchema,
        kind: z.literal("activation.retry"),
      })
      .strict(),
    z
      .object({
        activation: ActivationSchema,
        kind: z.literal("activation.quarantine"),
      })
      .strict(),
    z
      .object({
        activation: ActivationSchema,
        kind: z.literal("activation.cancellation.resolve"),
      })
      .strict(),
    z
      .object({
        kind: z.literal("delivery.presented.sent"),
        registered: z.literal(true),
      })
      .strict(),
  ],
);
export type ComputerExecutionCommandResponse = z.infer<
  typeof ComputerExecutionCommandResponseSchema
>;

export const ComputerWorkerCredentialIssueRequestSchema = z
  .object({
    activationId: IdentifierSchema,
    consumerId: IdentifierSchema,
    participantId: IdentifierSchema,
    roomId: IdentifierSchema,
    runAttemptId: IdentifierSchema,
    toSeq: z.number().int().positive(),
  })
  .strict();
export type ComputerWorkerCredentialIssueRequest = z.infer<
  typeof ComputerWorkerCredentialIssueRequestSchema
>;

export const ComputerWorkerCredentialIssueResponseSchema = z
  .object({
    credentialId: IdentifierSchema,
    expiresAt: TimestampSchema,
    workerAccessToken: z.string().min(32).max(4_096),
    workerApiOrigin: z.url(),
  })
  .strict()
  .superRefine((response, context) => {
    const url = new URL(response.workerApiOrigin);
    const loopbackHttp =
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "[::1]");
    if (url.origin !== response.workerApiOrigin) {
      context.addIssue({
        code: "custom",
        message: "workerApiOrigin must be an origin without path or query",
        path: ["workerApiOrigin"],
      });
    }
    if (url.protocol !== "https:" && !loopbackHttp) {
      context.addIssue({
        code: "custom",
        message: "workerApiOrigin requires HTTPS outside numeric loopback",
        path: ["workerApiOrigin"],
      });
    }
  });
export type ComputerWorkerCredentialIssueResponse = z.infer<
  typeof ComputerWorkerCredentialIssueResponseSchema
>;

export const ComputerWorkerCredentialRevokeRequestSchema = z
  .object({ credentialId: IdentifierSchema })
  .strict();
export type ComputerWorkerCredentialRevokeRequest = z.infer<
  typeof ComputerWorkerCredentialRevokeRequestSchema
>;

export const ComputerWorkerCredentialRevokeResponseSchema = z
  .object({ revoked: z.literal(true) })
  .strict();
export type ComputerWorkerCredentialRevokeResponse = z.infer<
  typeof ComputerWorkerCredentialRevokeResponseSchema
>;

const BuildVersionSchema = z.string().trim().min(1).max(128);

export const ComputerOperationAssignmentSchema = z.discriminatedUnion(
  "action",
  [
    z
      .object({
        action: z.literal("restart"),
        operationId: IdentifierSchema,
        requestedAt: TimestampSchema,
      })
      .strict(),
    z
      .object({
        action: z.literal("upgrade"),
        operationId: IdentifierSchema,
        requestedAt: TimestampSchema,
        targetBuildVersion: BuildVersionSchema,
      })
      .strict(),
  ],
);
export type ComputerOperationAssignment = z.infer<
  typeof ComputerOperationAssignmentSchema
>;

export const ComputerOperationClaimRequestSchema = z.object({}).strict();
export type ComputerOperationClaimRequest = z.infer<
  typeof ComputerOperationClaimRequestSchema
>;

export const ComputerOperationClaimResponseSchema = z
  .object({ operation: ComputerOperationAssignmentSchema.nullable() })
  .strict();
export type ComputerOperationClaimResponse = z.infer<
  typeof ComputerOperationClaimResponseSchema
>;

export const ComputerOperationPhaseSchema = z.enum([
  "draining",
  "downloading",
  "verifying",
  "staging",
  "replacing",
  "restarting",
]);
export type ComputerOperationPhase = z.infer<
  typeof ComputerOperationPhaseSchema
>;

export const ComputerOperationFailureCodeSchema = z.enum([
  "control_unavailable",
  "download_failed",
  "identity_attestation_failed",
  "replacement_failed",
  "staging_failed",
  "unsupported_operation",
  "verification_failed",
  "version_attestation_failed",
]);
export type ComputerOperationFailureCode = z.infer<
  typeof ComputerOperationFailureCodeSchema
>;

export const ComputerOperationAcknowledgeRequestSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("operation.progress"),
        operationId: IdentifierSchema,
        phase: ComputerOperationPhaseSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("operation.ready"),
        observedBuildVersion: BuildVersionSchema,
        operationId: IdentifierSchema,
      })
      .strict(),
    z
      .object({
        failureCode: ComputerOperationFailureCodeSchema,
        kind: z.literal("operation.failed"),
        operationId: IdentifierSchema,
        phase: ComputerOperationPhaseSchema,
      })
      .strict(),
  ],
);
export type ComputerOperationAcknowledgeRequest = z.infer<
  typeof ComputerOperationAcknowledgeRequestSchema
>;

export const ComputerOperationAcknowledgeResponseSchema = z
  .object({ accepted: z.literal(true), terminal: z.boolean() })
  .strict();
export type ComputerOperationAcknowledgeResponse = z.infer<
  typeof ComputerOperationAcknowledgeResponseSchema
>;

export const ComputerWakeHintSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("placement.ready"),
      placementId: IdentifierSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("computer.operation.ready"),
      operationId: IdentifierSchema,
    })
    .strict(),
]);
export type ComputerWakeHint = z.infer<typeof ComputerWakeHintSchema>;

export const ComputerErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: IdentifierSchema,
        message: z.string().min(1),
      })
      .strict(),
  })
  .strict();
export type ComputerErrorResponse = z.infer<typeof ComputerErrorResponseSchema>;
