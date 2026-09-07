import assert from "node:assert/strict";
import test from "node:test";
import type {
  HumanProfileResponse,
  LocalRuntimeInventoryEntry,
  Principal,
} from "@rah-os/protocol";
import type { WorkspaceAgentView } from "@rah-os/ui-web";
import {
  createPrincipalObservationFence,
  createWorkspaceEntities,
} from "../src/workspace-entities.ts";

const human: Principal = {
  principalId: "same-id",
  kind: "human",
  handle: "owner",
  displayName: "Owner Name",
  avatarKey: "human-avatar",
};
const agent: WorkspaceAgentView = {
  agentDefinitionId: "same-id",
  participantId: "agent-principal",
  displayName: "Alice",
  handle: "alice",
  avatarKey: "preset:skull",
  role: "Assistant",
  state: "enabled",
  createdAt: "2026-09-04T00:00:00Z",
  createdBy: human.principalId,
  executionPolicyRevisionId: "policy",
  skillRefs: [],
  runtimeAvailable: true,
  runtimeLabels: [],
};
const runtime = (id: string): LocalRuntimeInventoryEntry => ({
  runtimeProfileId: id,
  displayName: id,
  available: true,
  configured: true,
  executable: "/fake/cli",
  source: "configured",
  modelBindingDescriptors: [],
  agentBindings: [
    {
      agentDefinitionId: agent.agentDefinitionId,
      participantId: agent.participantId,
      handle: agent.handle,
    },
  ],
});
const input = {
  workspaceId: "workspace",
  actorId: human.principalId,
  human,
  hostId: "host",
  computer: {
    displayName: "My Computer",
    hostname: "host.local",
    os: "test",
    status: "online" as const,
    observedAt: "2026-09-04T00:00:00Z",
  },
  agents: [agent],
  runtimes: [runtime("runtime-a")],
};

test("an authorized Human profile response is not overwritten by an unversioned startup cache", () => {
  const profile: HumanProfileResponse = {
    workspaceId: "workspace",
    principal: {
      ...human,
      kind: "human",
      displayName: "Fresh profile name",
      avatarKey: "fresh-profile-avatar",
      description: "Fresh profile description",
    },
    membership: { role: "owner", joinedAt: "2026-09-04T00:00:00Z" },
    canReadCreatedAgents: true,
    createdAgentDefinitionIds: [agent.agentDefinitionId, "missing"],
    truncated: false,
  };
  const projection = createWorkspaceEntities(input).humanProfile(profile)!;
  assert.equal(projection.principal.displayName, "Fresh profile name");
  assert.equal(projection.principal.avatarKey, "fresh-profile-avatar");
  assert.equal(projection.principal.description, "Fresh profile description");
  assert.deepEqual(projection.createdAgents, [agent]);
  assert.deepEqual(
    createWorkspaceEntities({ ...input, agents: [] }).humanProfile(profile)
      ?.createdAgents,
    [],
  );
  assert.deepEqual(
    createWorkspaceEntities({
      ...input,
      agents: [{ ...agent, state: "tombstoned" }],
    }).humanProfile(profile)?.createdAgents,
    [],
  );
  assert.equal(
    createWorkspaceEntities({ ...input, workspaceId: "other" }).humanProfile(
      profile,
    ),
    undefined,
  );
});

test("Principal observation fence rejects reads and writes made obsolete by a newer local write", () => {
  const applied: Principal[] = [];
  const settled: string[] = [];
  const fence = createPrincipalObservationFence((principal) =>
    applied.push(principal),
  );
  fence.subscribe(human.principalId, () => settled.push("settled"));
  const oldRead = fence.capture(human.principalId);
  const firstWrite = fence.beginWrite(human.principalId);
  assert.equal(
    fence.observe({ ...human, displayName: "Old remote read" }, oldRead),
    false,
  );
  const secondWrite = fence.beginWrite(human.principalId);
  const readDuringWrite = fence.capture(human.principalId);
  assert.equal(
    fence.observe(
      { ...human, displayName: "Remote state while write is pending" },
      readDuringWrite,
    ),
    false,
  );
  assert.equal(
    fence.commit({ ...human, displayName: "Latest local write" }, secondWrite),
    true,
  );
  assert.deepEqual(settled, ["settled"]);
  assert.equal(
    fence.commit({ ...human, displayName: "Late first write" }, firstWrite),
    false,
  );
  assert.deepEqual(
    settled,
    ["settled"],
    "an obsolete completion cannot settle the latest generation twice",
  );
  const latestRead = fence.capture(human.principalId);
  assert.equal(
    fence.observe(
      { ...human, displayName: "Later authorized read" },
      latestRead,
    ),
    true,
  );
  assert.deepEqual(
    applied.map((principal) => principal.displayName),
    ["Latest local write", "Later authorized read"],
  );
});

test("a failed write settles the fence so a rejected profile read can retry", () => {
  const fence = createPrincipalObservationFence(() => {});
  let retries = 0;
  fence.subscribe(human.principalId, () => retries++);
  const read = fence.capture(human.principalId);
  const write = fence.beginWrite(human.principalId);
  assert.equal(fence.observe(human, read), false);
  fence.finishWrite(write);
  assert.equal(retries, 1);
  assert.equal(fence.observe(human, fence.capture(human.principalId)), true);
});

test("an invalidated scope permanently rejects an A to B to A late completion", () => {
  const applied: Principal[] = [];
  const oldScope = createPrincipalObservationFence((principal) =>
    applied.push(principal),
  );
  const write = oldScope.beginWrite(human.principalId);
  oldScope.invalidate();
  assert.equal(oldScope.commit(human, write), false);
  assert.deepEqual(applied, []);
});

test("typed identity joins Agent, principal, Computer and runtime without name matching", () => {
  const directory = createWorkspaceEntities(input);
  assert.equal(directory.person(human.principalId)?.displayName, "Owner Name");
  assert.equal(
    directory.person(agent.participantId)?.avatarKey,
    agent.avatarKey,
  );
  assert.equal(directory.agent(agent.agentDefinitionId), agent);
  assert.equal(
    directory.computerForAgent(agent.agentDefinitionId)?.displayName,
    "My Computer",
  );
  assert.equal(
    directory.runtimeForAgent(agent.agentDefinitionId)?.runtimeProfileId,
    "runtime-a",
  );
  assert.equal(
    directory.runtimeForAgent(agent.agentDefinitionId, "unknown-model")
      ?.runtimeProfileId,
    "runtime-a",
    "unknown model metadata cannot erase a unique runtime binding",
  );
  assert.ok(
    directory.edges.some(
      (edge) => edge.from === "agent:same-id" && edge.to === "computer:host",
    ),
  );
  assert.ok(
    !directory.edges.some(
      (edge) => edge.from === "human:same-id" && edge.to === "computer:host",
    ),
    "co-location does not prove ownership",
  );
  assert.ok(
    !directory.edges.some((edge) => edge.kind === "created"),
    "a revision editor is not original creator evidence",
  );
});

test("the authenticated Human write result replaces an older directory identity without losing membership", () => {
  const directory = createWorkspaceEntities({
    ...input,
    human: {
      ...human,
      displayName: "Fresh authenticated name",
      description: "Fresh authenticated description",
    },
    humans: [
      {
        principal: {
          ...human,
          displayName: "Stale directory name",
          description: "Stale directory description",
        },
        membership: {
          joinedAt: "2026-09-04T00:00:00Z",
          role: "owner" as const,
        },
      },
    ],
  });
  assert.equal(
    directory.person(human.principalId)?.displayName,
    "Fresh authenticated name",
  );
  assert.equal(
    directory.humans()[0]?.principal.displayName,
    "Fresh authenticated name",
  );
  assert.equal(directory.humans()[0]?.membership.role, "owner");
});

test("a non-Human principal cannot replace a Workspace Human membership", () => {
  const directory = createWorkspaceEntities({
    ...input,
    human: { ...human, kind: "service", displayName: "Service collision" },
    humans: [
      {
        principal: { ...human, displayName: "Canonical Human" },
        membership: {
          joinedAt: "2026-09-04T00:00:00Z",
          role: "owner" as const,
        },
      },
    ],
  });
  assert.equal(directory.humans()[0]?.principal.displayName, "Canonical Human");
  assert.equal(
    directory.person(human.principalId)?.displayName,
    "Canonical Human",
  );
});

test("unknown bindings and ambiguous runtime selection fail closed, never first/last wins", () => {
  const directory = createWorkspaceEntities({
    ...input,
    runtimes: [runtime("runtime-b"), runtime("runtime-a")],
  });
  assert.equal(directory.runtimeForAgent(agent.agentDefinitionId), undefined);
  assert.deepEqual(
    directory.computerAgents().map((binding) => binding.runtimeLabel),
    ["runtime-a · runtime-b"],
  );
  const badBinding = runtime("bad");
  badBinding.agentBindings[0]!.participantId = "someone-else";
  assert.equal(
    createWorkspaceEntities({
      ...input,
      runtimes: [badBinding],
    }).computerAgents().length,
    0,
  );
  assert.equal(directory.person("alice"), undefined);
});

test("rebuilding after switch, removal or rename cannot resurrect old directory data", () => {
  assert.equal(
    createWorkspaceEntities({ ...input, workspaceId: undefined }).agent(
      agent.agentDefinitionId,
    ),
    undefined,
  );
  assert.equal(
    createWorkspaceEntities({ ...input, agents: [] }).computerAgents().length,
    0,
  );
  const renamed = {
    ...agent,
    displayName: "New Name",
    avatarKey: "new-avatar",
  };
  const directory = createWorkspaceEntities({ ...input, agents: [renamed] });
  assert.equal(directory.person(agent.participantId)?.displayName, "New Name");
  assert.equal(directory.person(agent.participantId)?.avatarKey, "new-avatar");
});

test("enrichment preserves the query's authorized candidate set and rejects contradictory kinds", () => {
  const directory = createWorkspaceEntities(input);
  assert.equal(
    directory.resolvePerson({
      principalId: agent.participantId,
      handle: "old",
      kind: "agent",
    }).displayName,
    "Alice",
  );
  assert.equal(
    directory.resolvePerson({
      principalId: agent.participantId,
      handle: "human",
      kind: "human",
    }).displayName,
    "human",
  );
  assert.equal(
    directory.resolvePerson({
      principalId: "unknown",
      handle: "Unknown",
      kind: "human",
    }).avatarKey,
    undefined,
  );
  assert.deepEqual(
    [human].map((p) => directory.resolvePerson(p)).map((p) => p.principalId),
    [human.principalId],
  );
});

test("a cleared canonical avatar cannot be resurrected by an older search result", () => {
  const withoutAvatar = { ...agent, avatarKey: undefined };
  const directory = createWorkspaceEntities({
    ...input,
    agents: [withoutAvatar],
  });
  assert.equal(
    directory.resolvePerson({
      principalId: agent.participantId,
      kind: "agent",
      handle: "old",
      avatarKey: "old-avatar",
    }).avatarKey,
    undefined,
  );
});
