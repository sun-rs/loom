import assert from "node:assert/strict";
import test from "node:test";

import type {
  ExecutionPolicyRevision,
  RuntimeOfferProjection,
} from "@rah-os/protocol";
import { PlacementDecisionSchema } from "@rah-os/protocol";

import { planNextPlacement, type PlacementPlannerInput } from "../src/index.ts";

const now = "2026-08-26T00:00:00.000Z";
const digest = (character: string) => `sha256:${character.repeat(64)}`;

function policy(
  overrides: Partial<ExecutionPolicyRevision> = {},
): ExecutionPolicyRevision {
  return {
    controlRoomId: "room-control",
    contentDigest: digest("a"),
    createdAt: now,
    createdBy: "human-1",
    executionPolicyId: "policy-1",
    executionPolicyRevisionId: "policy-v1",
    modelIntent: {
      fallback: "disabled",
      reasoning: "default",
      serviceTier: "default",
    },
    preferred: [],
    required: {
      allowedProtocolFamilies: ["rah-worker-process/v1"],
      capabilities: [
        { capability: "worker_commands", minimumEvidence: "probed" },
      ],
      minimumIsolation: "process",
      workspaceMode: "in_place",
    },
    retryPolicyRef: {
      artifactId: "retry-1",
      contentDigest: digest("b"),
      versionId: "retry-v1",
    },
    revision: 1,
    sessionPolicy: "fresh",
    toolAccessMode: "workspace_write",
    ...overrides,
  };
}

function offer(
  runtimeOfferId: string,
  overrides: Partial<RuntimeOfferProjection> = {},
): RuntimeOfferProjection {
  return {
    acceptedAt: now,
    capacityPoolIds: ["pool-default"],
    certificationRefs: [],
    capabilityEvidence: [
      { capability: "worker_commands", evidence: "certified" },
    ],
    hostId: `host-${runtimeOfferId}`,
    hostInstanceId: `instance-${runtimeOfferId}`,
    isolation: { evidence: "certified", level: "process" },
    leaseUntil: "2026-08-26T00:05:00.000Z",
    maxConcurrent: 4,
    modelBindingDescriptors: [],
    observedAt: now,
    protocolFamily: "rah-worker-process/v1",
    resolvedCertifications: [],
    revisionDigest: digest("c"),
    runtimeOfferId,
    runtimeOfferObservationId: `observation-${runtimeOfferId}`,
    runtimeOfferSnapshotDigest: digest("e"),
    runtimeProfileId: `profile-${runtimeOfferId}`,
    runtimeProfileRevisionId: `profile-${runtimeOfferId}-v1`,
    state: "available",
    supportedToolAccessModes: ["read_only", "workspace_write", "full_access"],
    workspaceMountDescriptors: [
      {
        modes: ["in_place"],
        workspaceDefinitionId: "workspace-1",
        workspaceMountDigest: digest("d"),
        workspaceMountRevisionId: `mount-${runtimeOfferId}-v1`,
      },
    ],
    ...overrides,
  };
}

function input(
  offers: RuntimeOfferProjection[],
  overrides: Partial<PlacementPlannerInput> = {},
): PlacementPlannerInput {
  return {
    activeHostInstances: offers.map((candidate) => ({
      hostId: candidate.hostId,
      hostInstanceId: candidate.hostInstanceId,
    })),
    activeParticipantIds: [],
    authorizedHostParticipants: offers.map((candidate) => ({
      hostId: candidate.hostId,
      participantIds: ["agent-1", "agent-2"],
    })),
    busyWorkspaceMountRevisionIds: [],
    candidates: [
      {
        activationId: "activation-1",
        agentDefinitionRevisionId: "agent-v1",
        agentEnabled: true,
        availableAt: now,
        createdAt: now,
        executionPolicy: policy(),
        participantId: "agent-1",
        priority: 0,
        roomId: "room-1",
        workspaceDefinitionId: "workspace-1",
      },
    ],
    capacities: {
      hosts: offers.map((candidate) => ({
        adminMaxConcurrent: 4,
        hostId: candidate.hostId,
        reserved: 0,
      })),
      offers: offers.map((candidate) => ({
        reserved: 0,
        runtimeOfferId: candidate.runtimeOfferId,
        structuralFailureCount: 0,
      })),
      pools: [
        { adminMaxConcurrent: 4, capacityPoolId: "pool-default", reserved: 0 },
      ],
      profiles: offers.map((candidate) => ({
        adminMaxConcurrent: 4,
        hostId: candidate.hostId,
        reserved: 0,
        runtimeProfileId: candidate.runtimeProfileId,
      })),
    },
    now,
    offers,
    schedulerVersion: "placement-planner/v1",
    ...overrides,
  };
}

test("hard constraints cannot be outweighed by a preferred unauthorized offer", () => {
  const unauthorized = offer("offer-a");
  const authorized = offer("offer-b");
  const plannerInput = input([unauthorized, authorized]);
  plannerInput.candidates[0] = {
    ...plannerInput.candidates[0]!,
    executionPolicy: policy({
      preferred: [
        {
          criterion: "runtime_offer",
          targetId: unauthorized.runtimeOfferId,
          weight: 1_000_000,
        },
      ],
    }),
  };
  plannerInput.authorizedHostParticipants = [
    { hostId: unauthorized.hostId, participantIds: [] },
    { hostId: authorized.hostId, participantIds: ["agent-1"] },
  ];

  const result = planNextPlacement(plannerInput);
  assert.equal(result.selection?.runtimeOfferId, authorized.runtimeOfferId);
  assert.deepEqual(
    result.selection?.candidateEvidence.find(
      (candidate) => candidate.runtimeOfferId === unauthorized.runtimeOfferId,
    )?.hardRejectionReasons,
    ["host_unauthorized"],
  );
});

test("planner rejects an Offer that cannot enforce the durable tool-access policy", () => {
  const unrestrictedOnly = offer("offer-full-only", {
    supportedToolAccessModes: ["full_access"],
  });
  const result = planNextPlacement(input([unrestrictedOnly]));

  assert.equal(result.selection, undefined);
  assert.equal(result.holds[0]?.reason, "no_compatible_offer");
  assert.deepEqual(result.holds[0]?.dependencyKeys, [
    `tool-access:${unrestrictedOnly.runtimeOfferId}:workspace_write`,
  ]);
});

test("planner output is deterministic across input insertion order", () => {
  const offerA = offer("offer-a");
  const offerB = offer("offer-b");
  const forward = input([offerB, offerA]);
  const olderCandidate = {
    ...forward.candidates[0]!,
    activationId: "activation-old",
    executionPolicy: policy({
      preferred: [
        { criterion: "lower_load", weight: 10 },
        { criterion: "runtime_offer", targetId: "offer-a", weight: 20 },
      ],
    }),
  };
  const newerCandidate = {
    ...olderCandidate,
    activationId: "activation-new",
    createdAt: "2026-08-26T00:00:01.000Z",
    participantId: "agent-2",
  };
  forward.candidates = [newerCandidate, olderCandidate];
  const reversed = input([offerA, offerB], {
    authorizedHostParticipants: [
      ...forward.authorizedHostParticipants,
    ].reverse(),
    capacities: {
      hosts: [...forward.capacities.hosts].reverse(),
      offers: [...forward.capacities.offers].reverse(),
      pools: [...forward.capacities.pools].reverse(),
      profiles: [...forward.capacities.profiles].reverse(),
    },
  });
  reversed.candidates = [
    {
      ...olderCandidate,
      executionPolicy: policy({
        preferred: [
          { criterion: "runtime_offer", targetId: "offer-a", weight: 20 },
          { criterion: "lower_load", weight: 10 },
        ],
      }),
    },
    newerCandidate,
  ];

  const first = planNextPlacement(forward);
  const second = planNextPlacement(reversed);
  assert.equal(first.selection?.runtimeOfferId, "offer-a");
  assert.equal(first.selection?.activationId, "activation-old");
  assert.deepEqual(first, second);
});

test("candidate digest changes when an immutable Offer observation changes", () => {
  const initial = planNextPlacement(input([offer("offer-observed")]));
  const refreshed = planNextPlacement(
    input([
      offer("offer-observed", {
        runtimeOfferObservationId: "observation-offer-observed-v2",
        runtimeOfferSnapshotDigest: digest("9"),
      }),
    ]),
  );

  assert.notEqual(
    initial.selection?.candidateSetDigest,
    refreshed.selection?.candidateSetDigest,
  );
});

test("runtime default is explicit and high reasoning without a verified binding holds", () => {
  const defaultResult = planNextPlacement(input([offer("offer-default")]));
  assert.deepEqual(defaultResult.selection?.resolvedModel, {
    selection: "no_model_selector_sent",
    source: "runtime_default",
  });

  const highInput = input([offer("offer-no-binding")]);
  highInput.candidates[0] = {
    ...highInput.candidates[0]!,
    executionPolicy: policy({
      modelIntent: {
        fallback: "disabled",
        reasoning: "high",
        serviceTier: "default",
      },
    }),
  };
  const highResult = planNextPlacement(highInput);
  assert.equal(highResult.selection, undefined);
  assert.equal(highResult.holds[0]?.reason, "model_unavailable");
});

test("explicit reasoning resolves only through a probed model binding", () => {
  const declared = offer("offer-declared", {
    modelBindingDescriptors: [
      {
        capabilityClasses: ["deep_coding"],
        evidence: "declared",
        modelBindingId: "model-high-declared",
        modelId: "model-declared",
        provider: "provider-a",
        supportedReasoning: ["high"],
        supportedServiceTiers: ["default"],
      },
    ],
  });
  const probed = offer("offer-probed", {
    modelBindingDescriptors: [
      {
        capabilityClasses: ["deep_coding"],
        evidence: "probed",
        modelBindingId: "model-high-probed",
        modelId: "model-probed",
        provider: "provider-b",
        supportedReasoning: ["high"],
        supportedServiceTiers: ["default"],
      },
    ],
  });
  const plannerInput = input([declared, probed]);
  plannerInput.candidates[0] = {
    ...plannerInput.candidates[0]!,
    executionPolicy: policy({
      modelIntent: {
        fallback: "compatible_offer",
        reasoning: "high",
        serviceTier: "default",
      },
    }),
  };

  const result = planNextPlacement(plannerInput);
  assert.equal(result.selection?.runtimeOfferId, "offer-probed");
  assert.deepEqual(result.selection?.resolvedModel, {
    modelBindingId: "model-high-probed",
    modelId: "model-probed",
    provider: "provider-b",
    reasoning: "high",
    source: "explicit_binding",
  });
});

test("require_resume fails closed until compatible session evidence exists", () => {
  const plannerInput = input([offer("offer-session")]);
  plannerInput.candidates[0] = {
    ...plannerInput.candidates[0]!,
    executionPolicy: policy({ sessionPolicy: "require_resume" }),
  };

  const result = planNextPlacement(plannerInput);
  assert.equal(result.selection, undefined);
  assert.equal(result.holds[0]?.reason, "session_locality_unavailable");
});

test("structural failure preference is scored rather than silently ignored", () => {
  const offerA = offer("offer-a");
  const offerB = offer("offer-b");
  const plannerInput = input([offerA, offerB]);
  plannerInput.candidates[0] = {
    ...plannerInput.candidates[0]!,
    executionPolicy: policy({
      preferred: [{ criterion: "avoid_structural_failures", weight: 100 }],
    }),
  };
  plannerInput.capacities.offers = [
    { reserved: 0, runtimeOfferId: "offer-a", structuralFailureCount: 3 },
    { reserved: 0, runtimeOfferId: "offer-b", structuralFailureCount: 0 },
  ];

  const result = planNextPlacement(plannerInput);
  assert.equal(result.selection?.runtimeOfferId, "offer-b");
  assert.deepEqual(
    result.selection?.candidateEvidence.map((candidate) => [
      candidate.runtimeOfferId,
      candidate.totalScore,
    ]),
    [
      ["offer-a", -300],
      ["offer-b", 0],
    ],
  );
});

test("an unschedulable oldest Activation does not block later feasible work", () => {
  const onlyOffer = offer("offer-ready");
  const plannerInput = input([onlyOffer]);
  plannerInput.candidates = [
    {
      ...plannerInput.candidates[0]!,
      activationId: "activation-old",
      createdAt: "2026-08-25T23:00:00.000Z",
      executionPolicy: policy({
        required: {
          ...policy().required,
          allowedProtocolFamilies: ["acp/v1"],
        },
      }),
    },
    {
      ...plannerInput.candidates[0]!,
      activationId: "activation-ready",
      participantId: "agent-2",
    },
  ];

  const result = planNextPlacement(plannerInput);
  assert.equal(result.selection?.activationId, "activation-ready");
  assert.equal(result.holds[0]?.activationId, "activation-old");
  assert.equal(result.holds[0]?.reason, "no_compatible_offer");
});

test("capacity uses Kernel reservations and the strictest configured limit", () => {
  const availableOffer = offer("offer-capacity", { maxConcurrent: 10 });
  const plannerInput = input([availableOffer]);
  plannerInput.capacities.hosts[0] = {
    adminMaxConcurrent: 1,
    hostId: availableOffer.hostId,
    reserved: 1,
  };

  const result = planNextPlacement(plannerInput);
  assert.equal(result.selection, undefined);
  assert.equal(result.holds[0]?.reason, "capacity_exhausted");
  assert.deepEqual(result.holds[0]?.dependencyKeys, [
    `capacity:host:${availableOffer.hostId}`,
  ]);
});

test("workspace routing skips a busy mount when another compatible mount exists", () => {
  const routedOffer = offer("offer-workspace", {
    workspaceMountDescriptors: [
      {
        modes: ["in_place"],
        workspaceDefinitionId: "workspace-1",
        workspaceMountDigest: digest("1"),
        workspaceMountRevisionId: "mount-a-busy",
      },
      {
        modes: ["in_place"],
        workspaceDefinitionId: "workspace-1",
        workspaceMountDigest: digest("2"),
        workspaceMountRevisionId: "mount-b-ready",
      },
    ],
  });
  const plannerInput = input([routedOffer], {
    busyWorkspaceMountRevisionIds: ["mount-a-busy"],
  });

  const result = planNextPlacement(plannerInput);
  assert.equal(result.selection?.workspaceMountRevisionId, "mount-b-ready");
});

test("duplicate snapshot identities fail instead of making order significant", () => {
  const duplicated = offer("offer-duplicate");
  const plannerInput = input([duplicated, duplicated]);
  assert.throws(
    () => planNextPlacement(plannerInput),
    /duplicate runtime offer/,
  );
});

test("planner selection materializes directly into a strict PlacementDecision", () => {
  const result = planNextPlacement(input([offer("offer-decision")]));
  assert.ok(result.selection);

  const decision = PlacementDecisionSchema.parse({
    ...result.selection,
    createdAt: now,
    leaseUntil: "2026-08-26T00:05:00.000Z",
    placementId: "placement-1",
    state: "reserved",
  });
  assert.equal(decision.runtimeOfferId, "offer-decision");
});
