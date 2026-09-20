import assert from "node:assert/strict";
import test from "node:test";

import {
  ClientAgentGetResponseSchema,
  ClientAgentCreatorSchema,
} from "../src/index.ts";

const at = "2026-09-02T00:00:00.000Z";
const digest = (character: string) => `sha256:${character.repeat(64)}`;

const child = {
  currentRevision: {
    agentId: "agent-child-definition",
    agentDefinitionRevisionId: "agent-child-revision",
    contentDigest: digest("a"),
    createdAt: at,
    createdBy: "agent-parent-principal",
    executionPolicyRevisionId: "policy-revision",
    instructionRefs: [],
    memoryPolicyRef: {
      artifactId: "memory-policy",
      contentDigest: digest("b"),
      versionId: "memory-policy-v1",
    },
    revision: 1,
    role: "Child Agent",
    skillRefs: [],
  },
  definition: {
    agentId: "agent-child-definition",
    controlRoomId: "room-control",
    createdAt: at,
    currentRevisionId: "agent-child-revision",
    participantId: "agent-child-principal",
    state: "enabled" as const,
    updatedAt: at,
  },
  handle: "child",
};

const policy = {
  contentDigest: digest("c"),
  controlRoomId: "room-control",
  createdAt: at,
  createdBy: "human-owner",
  executionPolicyId: "policy",
  executionPolicyRevisionId: "policy-revision",
  modelIntent: { fallback: "disabled" as const },
  preferred: [],
  required: {
    allowedProtocolFamilies: ["rah-worker-process/v1"],
    capabilities: [],
    minimumIsolation: "none" as const,
    workspaceMode: "in_place" as const,
  },
  retryPolicyRef: {
    artifactId: "retry-policy",
    contentDigest: digest("d"),
    versionId: "retry-policy-v1",
  },
  revision: 1,
  sessionPolicy: "fresh" as const,
  toolAccessMode: "full_access" as const,
};

test("Agent detail separates the immutable creator relationship from revision authors", () => {
  const creator = ClientAgentCreatorSchema.parse({
    avatarKey: "mug",
    displayName: "Owner",
    handle: "owner",
    kind: "human",
    principalId: "human-owner",
  });
  const parsed = ClientAgentGetResponseSchema.parse({
    agent: child,
    createdAgents: [child],
    creator,
    membershipRole: "member",
    policy,
  });
  assert.equal(parsed.creator?.principalId, "human-owner");
  assert.equal(parsed.createdAgents[0]?.handle, "child");
  assert.equal(
    ClientAgentCreatorSchema.safeParse({
      handle: "service",
      kind: "service",
      principalId: "service-1",
    }).success,
    false,
  );
});

test("Agent detail requires an explicit empty created-Agent projection", () => {
  assert.equal(
    ClientAgentGetResponseSchema.safeParse({
      agent: child,
      creator: null,
      membershipRole: "member",
      policy,
    }).success,
    false,
  );
});
