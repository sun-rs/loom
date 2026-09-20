import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPUTER_CONTROL_API_VERSION,
  ComputerExecutionCommandRequestSchema,
  ComputerOperationAcknowledgeRequestSchema,
  ComputerOperationClaimResponseSchema,
  ComputerExecutionCommandResponseSchema,
  ComputerErrorResponseSchema,
  ComputerHeartbeatRequestSchema,
  ComputerHeartbeatResponseSchema,
  ComputerPlacementClaimResponseSchema,
  ComputerRuntimeOfferPublishRequestSchema,
  ComputerSessionOpenRequestSchema,
  ComputerSessionOpenResponseSchema,
  ComputerWakeHintSchema,
  ComputerWorkerCredentialIssueRequestSchema,
  ComputerWorkerCredentialIssueResponseSchema,
  ComputerWorkerCredentialRevokeRequestSchema,
} from "../src/index.ts";

const at = "2026-08-27T00:00:00.000Z";
const later = "2026-08-27T00:05:00.000Z";
const digest = (character: string) => `sha256:${character.repeat(64)}`;

function placement() {
  return {
    activationId: "activation-1",
    agentDefinitionRevisionId: "agent-revision-1",
    candidateEvidence: [
      {
        hardRejectionReasons: [],
        resolvedModel: {
          selection: "no_model_selector_sent" as const,
          source: "runtime_default" as const,
        },
        runtimeOfferId: "offer-codex",
        runtimeOfferObservationId: "offer-observation-1",
        runtimeOfferSnapshotDigest: digest("7"),
        runtimeProfileRevisionId: "profile-codex-v1",
        score: [],
        totalScore: 0,
        workspaceMountRevisionId: "mount-1-v1",
      },
    ],
    candidateSetDigest: digest("6"),
    capacityPoolIds: ["pool-codex"],
    createdAt: at,
    executionPolicyRevisionId: "policy-revision-1",
    hostId: "host-1",
    hostInstanceId: "host-instance-1",
    leaseUntil: later,
    participantId: "agent-1",
    placementId: "placement-1",
    provenanceVersion: "offer_observation_v1" as const,
    protocolFamily: "rah-worker-process/v1",
    resolvedModel: {
      selection: "no_model_selector_sent" as const,
      source: "runtime_default" as const,
    },
    roomId: "room-1",
    runtimeOfferId: "offer-codex",
    runtimeOfferObservationId: "offer-observation-1",
    runtimeOfferSnapshotDigest: digest("7"),
    runtimeProfileDigest: digest("5"),
    runtimeProfileRevisionId: "profile-codex-v1",
    schedulerVersion: "placement-planner/v1",
    state: "consumed" as const,
    workspaceDefinitionId: "workspace-1",
    workspaceMode: "in_place" as const,
    workspaceMountDigest: digest("4"),
    workspaceMountRevisionId: "mount-1-v1",
  };
}

function agentRuntimeContext() {
  return {
    agentDefinitionRevision: {
      agentId: "agent-definition-1",
      agentDefinitionRevisionId: "agent-revision-1",
      contentDigest: digest("3"),
      createdAt: at,
      createdBy: "human-1",
      executionPolicyRevisionId: "policy-revision-1",
      instructionRefs: [],
      memoryPolicyRef: {
        artifactId: "memory-policy-1",
        contentDigest: digest("2"),
        versionId: "memory-policy-v1",
      },
      revision: 1,
      role: "implementation agent",
      skillRefs: [],
    },
    handle: "agent-1",
    participantId: "agent-1",
    schemaVersion: 1 as const,
  };
}

function claim() {
  const selectedPlacement = placement();
  return {
    activation: {
      activationId: "activation-1",
      attemptCount: 1,
      createdAt: at,
      fromSeq: 1,
      leaseOwner: "host-1",
      leaseUntil: later,
      participantId: "agent-1",
      reason: "room_policy" as const,
      roomId: "room-1",
      state: "leased" as const,
      toSeq: 2,
      updatedAt: at,
    },
    agentContext: agentRuntimeContext(),
    placement: selectedPlacement,
    runAttempt: {
      activationId: "activation-1",
      attemptNumber: 1,
      contextManifest: {
        activationId: "activation-1",
        agentDefinition: {
          agentDefinitionRevisionId: "agent-revision-1",
          contentDigest: digest("3"),
          instructionRefs: [],
          memoryPolicyRef: {
            artifactId: "memory-policy-1",
            contentDigest: digest("2"),
            versionId: "memory-policy-v1",
          },
          skillRefs: [],
        },
        contentDigest: digest("8"),
        contextManifestId: "context-manifest-1",
        createdAt: at,
        eventRanges: [{ fromSeq: 1, toSeq: 2 }],
        participantId: "agent-1",
        placement: {
          placementId: "placement-1",
          runtimeProfileDigest: digest("5"),
          runtimeProfileRevisionId: "profile-codex-v1",
          workspaceDefinitionId: "workspace-1",
          workspaceMode: "in_place" as const,
          workspaceMountDigest: digest("4"),
          workspaceMountRevisionId: "mount-1-v1",
        },
        roomId: "room-1",
        runAttemptId: "run-1",
        schemaVersion: 1 as const,
        throughRoomSeq: 2,
      },
      hostId: "host-1",
      participantId: "agent-1",
      placement: selectedPlacement,
      roomId: "room-1",
      runAttemptId: "run-1",
      startedAt: at,
      state: "starting" as const,
    },
  };
}

test("Computer session negotiation is actor-free and generation-scoped", () => {
  assert.equal(COMPUTER_CONTROL_API_VERSION, 1);
  const request = ComputerSessionOpenRequestSchema.parse({
    capabilities: [
      "content_free_hints",
      "placement_pull",
      "runtime_activity_publish",
      "runtime_offer_publish",
      "terminal_proof",
      "worker_credential_issue",
    ],
    computerBuildVersion: "1.0.0",
    computerInstanceId: "computer-instance-1",
    connectionId: "connection-1",
    controlApiVersions: [1],
    processId: 42,
    runtimeProtocolVersion: 1,
  });
  assert.equal(request.connectionId, "connection-1");
  assert.throws(() =>
    ComputerSessionOpenRequestSchema.parse({
      ...request,
      hostId: "injected-host",
    }),
  );
  assert.throws(() =>
    ComputerSessionOpenRequestSchema.parse({
      ...request,
      actorId: "injected-human",
    }),
  );
  assert.throws(() =>
    ComputerSessionOpenRequestSchema.parse({
      ...request,
      capabilities: ["placement_pull", "placement_pull"],
    }),
  );
  assert.throws(() =>
    ComputerSessionOpenRequestSchema.parse({
      ...request,
      capabilities: ["placement_pull", "runtime_offer_publish"],
    }),
  );
  assert.throws(() =>
    ComputerSessionOpenRequestSchema.parse({
      ...request,
      controlApiVersions: [2],
    }),
  );

  const response = ComputerSessionOpenResponseSchema.parse({
    acceptedControlApiVersion: 1,
    hostId: "host-1",
    hostInstanceId: "host-instance-1",
    serverTime: at,
    sessionAccessToken: "rah_host_session_abcdefghijklmnopqrstuvwxyz",
    sessionExpiresAt: later,
  });
  assert.equal(response.hostInstanceId, "host-instance-1");
  assert.throws(() =>
    ComputerSessionOpenResponseSchema.parse({
      ...response,
      sessionExpiresAt: at,
    }),
  );
});

test("Computer execution commands expose only generation-fenced lifecycle mutations", () => {
  const prepared = ComputerExecutionCommandRequestSchema.parse({
    kind: "runtime.prepare",
    recoveryDescriptor: {
      driver: "resident-runner/v1",
      metadata: { controlSocket: "/private/run-1.sock" },
      recoveryKey: "runtime-1",
    },
    runAttemptId: "run-1",
    runtimeRunId: "runtime-1",
  });
  assert.equal(prepared.kind, "runtime.prepare");
  assert.throws(() =>
    ComputerExecutionCommandRequestSchema.parse({
      ...prepared,
      hostId: "injected-host",
    }),
  );

  const terminal = ComputerExecutionCommandRequestSchema.parse({
    exit: { code: 0 },
    kind: "runtime.terminate",
    runAttemptId: "run-1",
    runtimeRunId: "runtime-1",
  });
  assert.equal(terminal.kind, "runtime.terminate");
  if (terminal.kind !== "runtime.terminate") {
    throw new Error("expected a runtime termination command");
  }
  assert.deepEqual(terminal.exit, { code: 0 });
  assert.throws(() =>
    ComputerExecutionCommandRequestSchema.parse({
      ...terminal,
      exit: { code: 0, stdout: "Room content must not be terminal proof" },
    }),
  );

  const response = ComputerExecutionCommandResponseSchema.parse({
    kind: "run.start",
    runAttempt: {
      ...claim().runAttempt,
      runtimeRunId: "runtime-1",
      state: "running",
    },
  });
  assert.equal(response.kind, "run.start");
  assert.throws(() =>
    ComputerExecutionCommandResponseSchema.parse({
      kind: "run.start",
      runtimeProcess: {},
    }),
  );

  const cancellationResolution = ComputerExecutionCommandRequestSchema.parse({
    activationId: "activation-1",
    kind: "activation.cancellation.resolve",
  });
  assert.equal(cancellationResolution.kind, "activation.cancellation.resolve");
  assert.throws(() =>
    ComputerExecutionCommandRequestSchema.parse({
      ...cancellationResolution,
      actorId: "injected-human",
    }),
  );

  const cancellationResolutionResponse =
    ComputerExecutionCommandResponseSchema.parse({
      activation: claim().activation,
      kind: "activation.cancellation.resolve",
    });
  assert.equal(
    cancellationResolutionResponse.kind,
    "activation.cancellation.resolve",
  );
});

test("Computer heartbeat derives Host identity from the authenticated session", () => {
  const heartbeat = ComputerHeartbeatRequestSchema.parse({
    buildVersion: "1.0.0",
    processId: 42,
    protocolVersion: 1,
    state: "online",
  });
  assert.equal(heartbeat.state, "online");
  assert.throws(() =>
    ComputerHeartbeatRequestSchema.parse({
      ...heartbeat,
      hostId: "injected-host",
    }),
  );
  assert.throws(() =>
    ComputerHeartbeatRequestSchema.parse({
      ...heartbeat,
      instanceId: "injected-generation",
    }),
  );
  const response = ComputerHeartbeatResponseSchema.parse({
    host: {
      buildVersion: "1.0.0",
      hostId: "host-1",
      instanceId: "host-instance-1",
      lastSeenAt: at,
      participantIds: ["agent-1"],
      processId: 42,
      protocolVersion: 1,
      state: "online",
    },
    serverTime: at,
    sessionExpiresAt: later,
  });
  assert.equal(response.sessionExpiresAt, later);
});

test("Computer runtime publication reuses the redacted immutable Offer contract", () => {
  const request = ComputerRuntimeOfferPublishRequestSchema.parse({
    offer: {
      capacityPoolIds: ["pool-codex"],
      capabilityEvidence: [
        { capability: "worker_commands", evidence: "probed" },
      ],
      hostId: "host-1",
      hostInstanceId: "host-instance-1",
      isolation: { evidence: "probed", level: "process" },
      leaseUntil: later,
      maxConcurrent: 1,
      modelBindingDescriptors: [],
      observedAt: at,
      probeReportRef: {
        probeDigest: digest("1"),
        probeReportId: "probe-1",
      },
      protocolFamily: "rah-worker-process/v1",
      revisionDigest: digest("2"),
      runtimeOfferId: "offer-codex",
      runtimeProfileId: "profile-codex",
      runtimeProfileRevisionId: "profile-codex-v1",
      state: "available",
      workspaceMountDescriptors: [
        {
          modes: ["in_place"],
          workspaceDefinitionId: "workspace-1",
          workspaceMountDigest: digest("3"),
          workspaceMountRevisionId: "mount-1-v1",
        },
      ],
    },
  });
  assert.equal(request.offer.runtimeOfferId, "offer-codex");
  assert.throws(() =>
    ComputerRuntimeOfferPublishRequestSchema.parse({
      offer: { ...request.offer, providerToken: "secret" },
    }),
  );
});

test("remote Placement claims are one generation-consistent identity chain", () => {
  const response = ComputerPlacementClaimResponseSchema.parse({
    claim: claim(),
  });
  assert.equal(response.claim?.placement.hostInstanceId, "host-instance-1");
  assert.throws(() =>
    ComputerPlacementClaimResponseSchema.parse({
      claim: {
        ...claim(),
        runAttempt: { ...claim().runAttempt, hostId: "other-host" },
      },
    }),
  );
  assert.throws(() =>
    ComputerPlacementClaimResponseSchema.parse({
      claim: {
        ...claim(),
        agentContext: {
          ...agentRuntimeContext(),
          participantId: "other-agent",
        },
      },
    }),
  );
});

test("Computer wake hints remain content-free", () => {
  assert.deepEqual(
    ComputerWakeHintSchema.parse({
      kind: "placement.ready",
      placementId: "placement-1",
    }),
    { kind: "placement.ready", placementId: "placement-1" },
  );
  assert.throws(() =>
    ComputerWakeHintSchema.parse({
      body: "private Room message",
      kind: "placement.ready",
      placementId: "placement-1",
    }),
  );
  assert.deepEqual(
    ComputerErrorResponseSchema.parse({
      error: { code: "unauthenticated", message: "authentication failed" },
    }),
    {
      error: { code: "unauthenticated", message: "authentication failed" },
    },
  );
});

test("remote Worker credentials are activation-scoped and never accept Host identity", () => {
  const request = ComputerWorkerCredentialIssueRequestSchema.parse({
    activationId: "activation-1",
    consumerId: "host-1:runtime",
    participantId: "agent-1",
    roomId: "room-1",
    runAttemptId: "run-1",
    toSeq: 2,
  });
  assert.throws(() =>
    ComputerWorkerCredentialIssueRequestSchema.parse({
      ...request,
      hostId: "injected-host",
    }),
  );
  const response = ComputerWorkerCredentialIssueResponseSchema.parse({
    credentialId: "worker-credential-1",
    expiresAt: later,
    workerAccessToken: `rah_wat_${"a".repeat(48)}`,
    workerApiOrigin: "http://127.0.0.1:4175",
  });
  assert.equal(response.workerApiOrigin, "http://127.0.0.1:4175");
  assert.throws(() =>
    ComputerWorkerCredentialIssueResponseSchema.parse({
      ...response,
      workerApiOrigin: "http://192.0.2.10:4175",
    }),
  );
  assert.deepEqual(
    ComputerWorkerCredentialRevokeRequestSchema.parse({
      credentialId: response.credentialId,
    }),
    { credentialId: "worker-credential-1" },
  );
});

test("managed Computer operations expose typed phases without shell or log payloads", () => {
  const restart = ComputerOperationClaimResponseSchema.parse({
    operation: {
      action: "restart",
      operationId: "operation-restart-1",
      requestedAt: "2026-08-28T00:00:00.000Z",
    },
  });
  assert.equal(restart.operation?.action, "restart");
  const upgrade = ComputerOperationClaimResponseSchema.parse({
    operation: {
      action: "upgrade",
      operationId: "operation-upgrade-1",
      requestedAt: "2026-08-28T00:00:00.000Z",
      targetBuildVersion: "1.2.3",
    },
  });
  assert.equal(upgrade.operation?.action, "upgrade");
  assert.equal(
    upgrade.operation?.action === "upgrade"
      ? upgrade.operation.targetBuildVersion
      : undefined,
    "1.2.3",
  );
  assert.throws(() =>
    ComputerOperationClaimResponseSchema.parse({
      operation: {
        action: "upgrade",
        operationId: "operation-upgrade-invalid",
        requestedAt: "2026-08-28T00:00:00.000Z",
      },
    }),
  );
  assert.deepEqual(
    ComputerOperationAcknowledgeRequestSchema.parse({
      kind: "operation.progress",
      operationId: "operation-upgrade-1",
      phase: "verifying",
    }),
    {
      kind: "operation.progress",
      operationId: "operation-upgrade-1",
      phase: "verifying",
    },
  );
  assert.throws(() =>
    ComputerOperationAcknowledgeRequestSchema.parse({
      command: "rm -rf /",
      kind: "operation.progress",
      log: "arbitrary diagnostic text",
      operationId: "operation-upgrade-1",
      phase: "verifying",
    }),
  );
  assert.deepEqual(
    ComputerOperationAcknowledgeRequestSchema.parse({
      kind: "operation.ready",
      observedBuildVersion: "1.2.3",
      operationId: "operation-upgrade-1",
    }),
    {
      kind: "operation.ready",
      observedBuildVersion: "1.2.3",
      operationId: "operation-upgrade-1",
    },
  );
  assert.deepEqual(
    ComputerOperationAcknowledgeRequestSchema.parse({
      failureCode: "identity_attestation_failed",
      kind: "operation.failed",
      operationId: "operation-upgrade-1",
      phase: "restarting",
    }),
    {
      failureCode: "identity_attestation_failed",
      kind: "operation.failed",
      operationId: "operation-upgrade-1",
      phase: "restarting",
    },
  );
});
