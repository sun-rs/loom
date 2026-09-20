import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentDefinitionRevisionSchema,
  AgentDefinitionSchema,
  ExecutionPolicyRevisionSchema,
  PlacementDecisionSchema,
  RuntimeModelBindingSchema,
  RuntimeOfferSchema,
} from "../src/index.ts";

const at = "2026-08-26T00:00:00.000Z";
const digest = (character: string) => `sha256:${character.repeat(64)}`;

test("placement protocol keeps Agent identity and immutable behavior revisions separate", () => {
  const definition = AgentDefinitionSchema.parse({
    agentId: "agent-definition-1",
    controlRoomId: "room-control",
    createdAt: at,
    currentRevisionId: "agent-revision-1",
    participantId: "agent-1",
    state: "enabled",
    updatedAt: at,
  });
  assert.equal(definition.participantId, "agent-1");

  const revision = AgentDefinitionRevisionSchema.parse({
    agentId: definition.agentId,
    agentDefinitionRevisionId: "agent-revision-1",
    contentDigest: digest("a"),
    createdAt: at,
    createdBy: "human-1",
    executionPolicyRevisionId: "policy-revision-1",
    instructionRefs: [
      {
        artifactId: "instructions-1",
        contentDigest: digest("b"),
        versionId: "instructions-v1",
      },
    ],
    memoryPolicyRef: {
      artifactId: "memory-policy-1",
      contentDigest: digest("c"),
      versionId: "memory-policy-v1",
    },
    revision: 1,
    role: "implementation agent",
    skillRefs: [],
  });
  assert.equal(revision.executionPolicyRevisionId, "policy-revision-1");
  assert.throws(() =>
    AgentDefinitionRevisionSchema.parse({
      ...revision,
      instructionRefs: ["/mutable/latest.md"],
    }),
  );
  assert.throws(() =>
    AgentDefinitionRevisionSchema.parse({ ...revision, runtimeId: "codex" }),
  );
});

test("execution policies strictly separate hard requirements from typed preferences", () => {
  const policy = ExecutionPolicyRevisionSchema.parse({
    controlRoomId: "room-control",
    contentDigest: digest("d"),
    createdAt: at,
    createdBy: "human-1",
    executionPolicyId: "policy-1",
    executionPolicyRevisionId: "policy-revision-1",
    modelIntent: {
      exactBindingIds: ["codex-luna-high"],
      fallback: "disabled",
      reasoning: "high",
      serviceTier: "default",
    },
    preferred: [
      { criterion: "runtime_offer", targetId: "offer-codex", weight: 100 },
      { criterion: "lower_load", weight: 10 },
    ],
    required: {
      allowedProtocolFamilies: ["rah-worker-process/v1"],
      capabilities: [
        { capability: "worker_commands", minimumEvidence: "probed" },
      ],
      minimumIsolation: "process",
      workspaceMode: "in_place",
    },
    retryPolicyRef: {
      artifactId: "retry-policy-1",
      contentDigest: digest("e"),
      versionId: "retry-policy-v1",
    },
    revision: 1,
    sessionPolicy: "fresh",
    toolAccessMode: "read_only",
  });
  assert.equal(policy.executionPolicyId, "policy-1");
  assert.equal(policy.toolAccessMode, "read_only");
  assert.equal(policy.preferred[0]?.criterion, "runtime_offer");
  assert.throws(() =>
    ExecutionPolicyRevisionSchema.parse({
      ...policy,
      preferred: [{ criterion: "llm_decides", weight: 999 }],
    }),
  );
  assert.throws(() =>
    ExecutionPolicyRevisionSchema.parse({
      ...policy,
      required: {
        ...policy.required,
        allowedProtocolFamilies: [],
      },
    }),
  );
  assert.throws(() =>
    ExecutionPolicyRevisionSchema.parse({
      ...policy,
      required: {
        ...policy.required,
        capabilities: [
          { capability: "worker_commands", minimumEvidence: "declared" },
        ],
      },
    }),
  );
});

test("runtime offers are redacted, generation-bound, and digest-bound", () => {
  const binding = RuntimeModelBindingSchema.parse({
    adapterMapping: {
      config: { reasoningKey: "model_reasoning_effort" },
      kind: "codex-cli/v1",
    },
    capabilityClasses: ["deep_coding"],
    evidence: "certified",
    modelBindingId: "codex-luna-high",
    modelId: "gpt-5.6-luna",
    provider: "openai",
    supportedReasoning: ["high"],
    supportedServiceTiers: ["default"],
  });
  assert.equal(binding.adapterMapping.kind, "codex-cli/v1");
  const { adapterMapping: _adapterMapping, ...bindingDescriptor } = binding;

  const offer = RuntimeOfferSchema.parse({
    capacityPoolIds: ["pool-codex-plan"],
    capabilityEvidence: [
      { capability: "worker_commands", evidence: "certified" },
    ],
    hostId: "host-1",
    hostInstanceId: "host-instance-1",
    isolation: { evidence: "certified", level: "process" },
    leaseUntil: "2026-08-26T00:05:00.000Z",
    maxConcurrent: 2,
    modelBindingDescriptors: [bindingDescriptor],
    observedAt: at,
    observedVersion: "0.1.0",
    protocolFamily: "rah-worker-process/v1",
    revisionDigest: digest("f"),
    runtimeOfferId: "offer-codex",
    runtimeProfileId: "profile-codex",
    runtimeProfileRevisionId: "profile-codex-v1",
    state: "available",
    workspaceMountDescriptors: [
      {
        modes: ["in_place"],
        workspaceDefinitionId: "workspace-1",
        workspaceMountDigest: digest("1"),
        workspaceMountRevisionId: "mount-1-v1",
      },
    ],
  });
  assert.equal(offer.hostInstanceId, "host-instance-1");
  assert.throws(() =>
    RuntimeOfferSchema.parse({ ...offer, localPath: "/Users/sun/Code" }),
  );
  assert.throws(() =>
    RuntimeOfferSchema.parse({ ...offer, providerToken: "secret" }),
  );
  assert.throws(() =>
    RuntimeOfferSchema.parse({
      ...offer,
      modelBindingDescriptors: [binding],
    }),
  );
  assert.throws(() =>
    RuntimeOfferSchema.parse({
      ...offer,
      leaseUntil: "2026-08-25T23:59:00.000Z",
    }),
  );
});

test("PlacementDecision represents runtime default without inventing a model", () => {
  const decision = PlacementDecisionSchema.parse({
    activationId: "activation-1",
    agentDefinitionRevisionId: "agent-revision-1",
    candidateEvidence: [
      {
        hardRejectionReasons: [],
        resolvedModel: {
          selection: "no_model_selector_sent",
          source: "runtime_default",
        },
        runtimeOfferId: "offer-codex",
        runtimeOfferObservationId: "offer-codex-observation-1",
        runtimeOfferSnapshotDigest: digest("3"),
        runtimeProfileRevisionId: "profile-codex-v1",
        score: [{ criterion: "lower_load", points: 10 }],
        totalScore: 10,
        workspaceMountRevisionId: "mount-1-v1",
      },
    ],
    candidateSetDigest: digest("2"),
    capacityPoolIds: ["pool-codex-plan"],
    createdAt: at,
    executionPolicyRevisionId: "policy-revision-1",
    hostId: "host-1",
    hostInstanceId: "host-instance-1",
    leaseUntil: "2026-08-26T00:05:00.000Z",
    participantId: "agent-1",
    placementId: "placement-1",
    provenanceVersion: "offer_observation_v1",
    protocolFamily: "rah-worker-process/v1",
    resolvedModel: {
      selection: "no_model_selector_sent",
      source: "runtime_default",
    },
    roomId: "room-1",
    runtimeOfferId: "offer-codex",
    runtimeOfferObservationId: "offer-codex-observation-1",
    runtimeOfferSnapshotDigest: digest("3"),
    runtimeProfileDigest: digest("f"),
    runtimeProfileRevisionId: "profile-codex-v1",
    schedulerVersion: "placement-planner/v1",
    state: "reserved",
    toolAccessMode: "read_only",
    workspaceDefinitionId: "workspace-1",
    workspaceMode: "in_place",
    workspaceMountDigest: digest("1"),
    workspaceMountRevisionId: "mount-1-v1",
  });
  assert.equal(decision.resolvedModel.source, "runtime_default");
  assert.equal(decision.toolAccessMode, "read_only");
  assert.throws(() =>
    PlacementDecisionSchema.parse({
      ...decision,
      resolvedModel: {
        modelId: "guessed-model",
        selection: "no_model_selector_sent",
        source: "runtime_default",
      },
    }),
  );
  assert.throws(() =>
    PlacementDecisionSchema.parse({
      ...decision,
      resolvedModel: {
        modelBindingId: "different-binding",
        modelId: "different-model",
        provider: "other",
        source: "explicit_binding",
      },
    }),
  );
  assert.throws(() =>
    PlacementDecisionSchema.parse({
      ...decision,
      candidateEvidence: decision.candidateEvidence.map((candidate) => ({
        ...candidate,
        totalScore: 999,
      })),
    }),
  );
  assert.throws(() =>
    PlacementDecisionSchema.parse({
      ...decision,
      runtimeOfferObservationId: "different-observation",
    }),
  );
  assert.throws(() =>
    PlacementDecisionSchema.parse({
      ...decision,
      runtimeOfferObservationId: undefined,
      runtimeOfferSnapshotDigest: undefined,
    }),
  );
  const {
    runtimeOfferObservationId: _runtimeOfferObservationId,
    runtimeOfferSnapshotDigest: _runtimeOfferSnapshotDigest,
    ...legacyDecision
  } = decision;
  assert.equal(
    PlacementDecisionSchema.parse({
      ...legacyDecision,
      candidateEvidence: legacyDecision.candidateEvidence.map(
        ({
          runtimeOfferObservationId: _candidateObservationId,
          runtimeOfferSnapshotDigest: _candidateSnapshotDigest,
          ...candidate
        }) => candidate,
      ),
      provenanceVersion: "legacy_without_offer_observation",
    }).provenanceVersion,
    "legacy_without_offer_observation",
  );
});
