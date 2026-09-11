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
    supportsAgentPrivateWorkspace: true,
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
        modes: ["in_place" as const],
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

const privateMount = (participantId: string, revision: string) => ({
  modes: ["in_place" as const],
  workspaceDefinitionId: "workspace-1",
  workspaceMountDigest: digest("d"),
  workspaceMountRevisionId: revision,
  participantId,
});

test("legacy Agent must not select another Agent private mount", () => {
  const candidateOffer = offer("offer-a");
  candidateOffer.workspaceMountDescriptors.unshift(
    privateMount("agent-2", "aaa-private-agent-2"),
  );
  const result = planNextPlacement(input([candidateOffer]));
  assert.equal(result.selection?.workspaceMountRevisionId, "mount-offer-a-v1");
});

test("private Agent must not silently fall back to global mount", () => {
  const plannerInput = input([offer("offer-a")]);
  Object.assign(plannerInput.candidates[0]!, {
    executionWorkspace: { kind: "agent_private" },
  });
  const result = planNextPlacement(plannerInput);
  assert.equal(result.selection, undefined);
});

test("private Agent selects its own mount regardless of lexical order", () => {
  const candidateOffer = offer("offer-a");
  candidateOffer.workspaceMountDescriptors = [
    privateMount("agent-2", "aaa-private-agent-2"),
    privateMount("agent-1", "zzz-private-agent-1"),
  ];
  const plannerInput = input([candidateOffer]);
  Object.assign(plannerInput.candidates[0]!, {
    executionWorkspace: { kind: "agent_private" },
  });
  const result = planNextPlacement(plannerInput);
  assert.equal(
    result.selection?.workspaceMountRevisionId,
    "zzz-private-agent-1",
  );
});

test("private Agent cannot schedule on an unsupported Offer even with a matching mount", () => {
  const candidateOffer = offer("offer-a", {
    supportsAgentPrivateWorkspace: false,
  });
  candidateOffer.workspaceMountDescriptors = [
    privateMount("agent-1", "my-mount"),
  ];
  const plannerInput = input([candidateOffer]);
  Object.assign(plannerInput.candidates[0]!, {
    executionWorkspace: { kind: "agent_private" },
  });
  const result = planNextPlacement(plannerInput);
  assert.equal(result.selection, undefined);
});
