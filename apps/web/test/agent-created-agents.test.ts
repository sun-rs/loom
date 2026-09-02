import assert from "node:assert/strict";
import test from "node:test";

import type { ClientAgentGetResponse } from "@rah-os/protocol";
import type { WorkspaceAgentView } from "@rah-os/ui-web";

import { projectCreatedAgentViews } from "../src/agent-created-agents.ts";

const at = "2026-09-02T00:00:00.000Z";
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const catalog = {
  currentRevision: {
    agentDefinitionId: "child-definition",
    agentDefinitionRevisionId: "child-revision",
    contentDigest: digest("a"),
    createdAt: at,
    createdBy: "parent-principal",
    displayName: "Child",
    executionPolicyRevisionId: "policy-revision",
    instructionRefs: [],
    memoryPolicyRef: {
      artifactId: "memory",
      contentDigest: digest("b"),
      versionId: "memory-v1",
    },
    revision: 1,
    role: "Child",
    skillRefs: [],
  },
  definition: {
    agentDefinitionId: "child-definition",
    controlRoomId: "room-control",
    createdAt: at,
    currentRevisionId: "child-revision",
    participantId: "child-principal",
    state: "enabled" as const,
    updatedAt: at,
  },
  handle: "child",
};
const detail = {
  agent: catalog,
  createdAgents: [catalog],
  creator: {
    handle: "owner",
    kind: "human" as const,
    principalId: "owner-principal",
  },
  policy: {
    contentDigest: digest("c"),
    controlRoomId: "room-control",
    createdAt: at,
    createdBy: "owner-principal",
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
      artifactId: "retry",
      contentDigest: digest("d"),
      versionId: "retry-v1",
    },
    revision: 1,
    sessionPolicy: "fresh" as const,
    toolAccessMode: "full_access" as const,
  },
} satisfies ClientAgentGetResponse;

test("created-Agent rows prefer the live directory but retain a canonical fallback", () => {
  const live = {
    agentDefinitionId: "child-definition",
    agentDefinitionRevisionId: "child-revision",
    connectionStatus: "online" as const,
    createdAt: at,
    createdBy: "parent-principal",
    displayName: "Child Live",
    executionPolicyRevisionId: "policy-revision",
    handle: "child",
    participantId: "child-principal",
    presence: "active" as const,
    role: "Child",
    runtimeAvailable: true,
    runtimeLabels: ["Codex"],
    skillRefs: [],
    state: "enabled" as const,
  } satisfies WorkspaceAgentView;
  assert.deepEqual(projectCreatedAgentViews(detail, [live]), [live]);

  const fallback = projectCreatedAgentViews(detail, []);
  assert.equal(fallback[0]?.displayName, "Child");
  assert.equal(fallback[0]?.runtimeAvailable, false);
  assert.deepEqual(fallback[0]?.runtimeLabels, []);
  assert.deepEqual(projectCreatedAgentViews(undefined, [live]), []);
});
