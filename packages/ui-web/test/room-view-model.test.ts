import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentCatalogEntry,
  ClientHealthResponse,
  LocalRuntimeInventoryEntry,
  Message,
  Task,
} from "@rah-os/protocol";

import {
  activeMobileNavigation,
  canCreateWorkspaceRoom,
  canHumanCompleteTask,
  canManageRoomMembers,
  canOnboardWorkspaceAgent,
  createRoomViewModel,
  foundationCapabilityIssue,
  opaqueIdFromBytes,
  mentionedRoomAgentIds,
  roomMessageAttentionRecipients,
  roomAgentTargets,
  roomAgentCandidates,
  roomPollDelay,
  roomSelectionFromSearch,
  roomSelectionSearch,
  roomSlugFromName,
  selectProductRooms,
  taskAssigneeForSelectedAgents,
  workspaceAgentDirectory,
} from "../src/index.ts";

const createdAt = "2026-08-26T00:00:00.000Z";

test("mobile navigation has exactly one active destination while the Room drawer is open", () => {
  assert.equal(
    activeMobileNavigation({
      activeSurface: "room",
      activeTab: "chat",
      roomsOpen: false,
    }),
    "chat",
  );
  assert.equal(
    activeMobileNavigation({
      activeSurface: "room",
      activeTab: "chat",
      roomsOpen: true,
    }),
    "rooms",
  );
  assert.equal(
    activeMobileNavigation({
      activeSurface: "agents",
      activeTab: "files",
      roomsOpen: true,
    }),
    "rooms",
  );
  assert.equal(
    activeMobileNavigation({
      activeSurface: "agents",
      activeTab: "files",
      roomsOpen: false,
    }),
    "agents",
  );
  assert.equal(
    activeMobileNavigation({
      activeSurface: "computers",
      activeTab: "chat",
      roomsOpen: false,
    }),
    undefined,
  );
});

test("Room creation derives a stable editable slug without inventing a hidden identifier", () => {
  assert.equal(roomSlugFromName(" Agent Council "), "agent-council");
  assert.equal(roomSlugFromName("产品 讨论"), "产品-讨论");
  assert.equal(roomSlugFromName("---"), "");
});

test("Room selection has a reload-safe URL projection", () => {
  assert.equal(roomSelectionFromSearch("?room=room-main"), "room-main");
  assert.equal(roomSelectionFromSearch("?room="), undefined);
  assert.equal(roomSelectionFromSearch("?tab=tasks"), undefined);
  assert.equal(roomSelectionSearch("room-main"), "?room=room-main");
  assert.equal(
    roomSelectionSearch("room with spaces"),
    "?room=room+with+spaces",
  );
});

test("opaque browser ids do not depend on secure-context randomUUID", () => {
  assert.equal(
    opaqueIdFromBytes(
      Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 255]),
    ),
    "000102030405060708090a0b0c0d0eff",
  );
  assert.throws(() => opaqueIdFromBytes(new Uint8Array(15)));
});

test("Workspace Agent directory is independent from Room membership and reports Runtime bindings", () => {
  const agent = {
    currentRevision: {
      agentDefinitionId: "definition-alice",
      agentDefinitionRevisionId: "definition-alice-v1",
      contentDigest: `sha256:${"a".repeat(64)}`,
      createdAt,
      createdBy: "human-main",
      executionPolicyRevisionId: "policy-v1",
      instructionRefs: [],
      memoryPolicyRef: {
        artifactId: "memory",
        contentDigest: `sha256:${"b".repeat(64)}`,
        versionId: "memory-v1",
      },
      revision: 1,
      role: "Researcher",
      skillRefs: [],
    },
    definition: {
      agentDefinitionId: "definition-alice",
      controlRoomId: "catalog-control",
      createdAt,
      currentRevisionId: "definition-alice-v1",
      participantId: "agent-alice",
      state: "enabled",
      updatedAt: createdAt,
    },
    handle: "Alice",
  } satisfies AgentCatalogEntry;
  const runtime = {
    agentBindings: [
      {
        agentDefinitionId: "definition-alice",
        handle: "Alice",
        participantId: "agent-alice",
      },
    ],
    available: true,
    configured: true,
    displayName: "Fake CLI",
    executable: "fake-cli",
    resolvedExecutablePath: "/tmp/fake-cli",
    runtimeOfferId: "offer-alice",
    runtimeProfileId: "profile-alice",
    runtimeProfileRevisionId: "profile-alice-v1",
    source: "configured",
    version: "1.0.0",
  } satisfies LocalRuntimeInventoryEntry;

  const directory = workspaceAgentDirectory({
    agents: [agent],
    runtimes: [runtime],
  });
  assert.deepEqual(directory, [
    {
      agentDefinitionId: "definition-alice",
      displayName: "Alice",
      handle: "Alice",
      participantId: "agent-alice",
      role: "Researcher",
      runtimeAvailable: true,
      runtimeLabels: ["Fake CLI"],
      state: "enabled",
    },
  ]);
  assert.deepEqual(
    roomAgentCandidates({ directory, memberIds: ["human-main"] }),
    [{ ...directory[0], joined: false }],
  );
  assert.deepEqual(
    roomAgentCandidates({
      directory,
      memberIds: ["human-main", "agent-alice"],
    }),
    [{ ...directory[0], joined: true }],
  );
});

test("Room membership drives Message delivery while mentions only raise attention", () => {
  const agents = roomAgentTargets([
    { handle: "Sun", kind: "human", principalId: "human-main" },
    { handle: "Kimi", kind: "agent", principalId: "agent-kimi" },
    { handle: "Codex", kind: "agent", principalId: "agent-codex" },
  ]);
  assert.deepEqual(agents, [
    { handle: "Codex", participantId: "agent-codex" },
    { handle: "Kimi", participantId: "agent-kimi" },
  ]);
  assert.deepEqual(
    roomMessageAttentionRecipients({
      availableAgents: agents,
      mentionedParticipantIds: [],
    }),
    [],
  );
  assert.deepEqual(
    roomMessageAttentionRecipients({
      availableAgents: agents,
      mentionedParticipantIds: ["agent-kimi"],
    }),
    [{ participantId: "agent-kimi", reason: "mention" }],
  );
  assert.throws(() =>
    roomMessageAttentionRecipients({
      availableAgents: agents,
      mentionedParticipantIds: ["agent-not-in-room"],
    }),
  );
  assert.deepEqual(
    mentionedRoomAgentIds({
      agents,
      body: "@Kimi lead this; @Codex can review later",
    }),
    ["agent-codex", "agent-kimi"],
  );
  assert.deepEqual(
    mentionedRoomAgentIds({ agents, body: "@Kimi-extra should not match" }),
    [],
  );
  assert.equal(
    taskAssigneeForSelectedAgents({
      availableAgents: agents,
      selectedParticipantIds: ["agent-codex"],
    }),
    "agent-codex",
  );
  assert.equal(
    taskAssigneeForSelectedAgents({
      availableAgents: agents,
      selectedParticipantIds: ["agent-codex", "agent-kimi"],
    }),
    undefined,
  );
  assert.throws(() =>
    taskAssigneeForSelectedAgents({
      availableAgents: agents,
      selectedParticipantIds: [],
    }),
  );
});

function task(taskId: string, state: Task["state"]): Task {
  const submitted = state === "submitted" || state === "completed";
  return {
    createdAt,
    creatorId: "human-main",
    dependencyTaskIds: [],
    roomId: "room-main",
    state,
    taskId,
    title: taskId,
    updatedAt: createdAt,
    ...(state === "claimed" || state === "in_progress"
      ? {
          assigneeId: "agent-main",
          claimUntil: "2026-08-26T01:00:00.000Z",
          claimedBy: "agent-main",
        }
      : {}),
    ...(submitted
      ? {
          assigneeId: "agent-main",
          submissionSummary: "ready",
          submittedAt: createdAt,
        }
      : {}),
    ...(state === "completed" ? { completedAt: createdAt } : {}),
    ...(state === "cancelled"
      ? { cancellationReason: "cancelled", cancelledAt: createdAt }
      : {}),
  };
}

test("Room view model preserves canonical order and maps Task workflow to Raft columns", () => {
  const messages: Message[] = [
    {
      actorId: "agent-main",
      body: "second",
      createdAt,
      messageId: "message-2",
      roomId: "room-main",
      roomSeq: 2,
    },
    {
      actorId: "human-main",
      body: "first",
      createdAt,
      messageId: "message-1",
      roomId: "room-main",
      roomSeq: 1,
    },
  ];
  const view = createRoomViewModel({
    members: [
      { handle: "Hakase", kind: "human", principalId: "human-main" },
      { handle: "Alice", kind: "agent", principalId: "agent-main" },
    ],
    messages,
    tasks: [
      task("todo", "todo"),
      task("doing", "in_progress"),
      task("review", "submitted"),
      task("done", "completed"),
      task("closed", "cancelled"),
    ],
  });

  assert.deepEqual(
    view.messages.map(({ author, body }) => ({ author, body })),
    [
      { author: "Hakase", body: "first" },
      { author: "Alice", body: "second" },
    ],
  );
  assert.deepEqual(
    view.taskColumns.map(({ id, tasks }) => [
      id,
      tasks.map(({ taskId }) => taskId),
    ]),
    [
      ["todo", ["todo"]],
      ["in-progress", ["doing"]],
      ["review", ["review"]],
      ["done", ["done"]],
      ["closed", ["closed"]],
    ],
  );
  const submitted = view.taskColumns
    .find(({ id }) => id === "review")
    ?.tasks.at(0);
  assert.equal(submitted?.assigneeLabel, "Alice");
  assert.equal(submitted?.submissionSummary, "ready");
});

test("Room polling is prompt while behind and bounded under repeated failure", () => {
  assert.equal(
    roomPollDelay({ caughtUp: false, consecutiveFailures: 0, visible: true }),
    250,
  );
  assert.equal(
    roomPollDelay({ caughtUp: true, consecutiveFailures: 0, visible: true }),
    5_000,
  );
  assert.equal(
    roomPollDelay({ caughtUp: true, consecutiveFailures: 1, visible: true }),
    1_000,
  );
  assert.equal(
    roomPollDelay({ caughtUp: true, consecutiveFailures: 10, visible: true }),
    30_000,
  );
  assert.equal(
    roomPollDelay({ caughtUp: false, consecutiveFailures: 0, visible: false }),
    15_000,
  );
});

test("Human completion is offered only for a caught-up submitted Task", () => {
  assert.equal(
    canHumanCompleteTask({
      caughtUp: true,
      currentPrincipalId: "human-main",
      task: task("review", "submitted"),
      taskWrite: true,
    }),
    true,
  );
  assert.equal(
    canHumanCompleteTask({
      caughtUp: false,
      currentPrincipalId: "human-main",
      task: task("review", "submitted"),
      taskWrite: true,
    }),
    false,
  );
  assert.equal(
    canHumanCompleteTask({
      caughtUp: true,
      currentPrincipalId: "human-main",
      task: task("doing", "in_progress"),
      taskWrite: true,
    }),
    false,
  );
  assert.equal(
    canHumanCompleteTask({
      caughtUp: true,
      currentPrincipalId: "human-other",
      task: task("review-other", "submitted"),
      taskWrite: true,
    }),
    false,
  );
});

test("write controls require both daemon capabilities and canonical manager roles", () => {
  assert.equal(
    canManageRoomMembers({ caughtUp: true, memberWrite: true, role: "owner" }),
    true,
  );
  assert.equal(
    canManageRoomMembers({
      caughtUp: true,
      memberWrite: true,
      role: "member",
    }),
    false,
  );
  assert.equal(
    canOnboardWorkspaceAgent({
      agentOnboard: false,
      caughtUp: true,
      memberWrite: true,
      role: "admin",
    }),
    false,
  );
  assert.equal(
    canOnboardWorkspaceAgent({
      agentOnboard: true,
      caughtUp: true,
      memberWrite: true,
      role: "admin",
    }),
    true,
  );
  assert.equal(
    canCreateWorkspaceRoom({ role: "owner", roomWrite: true }),
    true,
  );
  assert.equal(
    canCreateWorkspaceRoom({ role: "member", roomWrite: true }),
    false,
  );
});

test("product Room selection does not get trapped in an earlier control-only Agent catalog", () => {
  const workspaces = [
    {
      controlRoomId: "catalog-control",
      createdAt,
      name: "Agent Catalog",
      slug: "agent-catalog",
      state: "active" as const,
      workspaceId: "catalog",
    },
    {
      controlRoomId: "product-control",
      createdAt,
      name: "RAH Multi-Agent",
      slug: "rah-multi-agent",
      state: "active" as const,
      workspaceId: "product",
    },
  ];
  const rooms = [
    {
      createdAt,
      kind: "control" as const,
      name: "Agent Catalog control",
      roomId: "catalog-control",
      slug: "agent-catalog-control",
      workspaceId: "catalog",
    },
    {
      createdAt,
      kind: "channel" as const,
      name: "Agent Council",
      roomId: "agent-council",
      slug: "agent-council",
      workspaceId: "product",
    },
  ];

  assert.deepEqual(
    selectProductRooms({ rooms, workspaces }).map(({ roomId }) => roomId),
    ["agent-council"],
  );
});

test("the UI fails closed only on capabilities required for canonical Room recovery", () => {
  const health: ClientHealthResponse = {
    apiVersion: 3,
    buildVersion: "test",
    capabilities: {
      agentOnboard: false,
      agentRead: false,
      agentWrite: false,
      cursorAcknowledge: true,
      hints: false,
      inputRequestRead: false,
      inputRequestResolve: false,
      memberRead: false,
      memberWrite: false,
      messageRead: false,
      messageWrite: false,
      roomRead: true,
      roomSync: true,
      roomWrite: false,
      taskRead: false,
      taskWrite: false,
      threadRead: false,
      threadWrite: false,
      workspaceRead: true,
      workspaceWrite: false,
    },
    kernelSchemaVersion: 8,
    protocolVersion: 1,
    state: "online",
  };

  assert.equal(foundationCapabilityIssue(health), undefined);
  assert.equal(
    foundationCapabilityIssue({
      ...health,
      capabilities: { ...health.capabilities, roomSync: false },
    }),
    "daemon 缺少基础 capability: roomSync",
  );
  assert.equal(
    foundationCapabilityIssue({ ...health, state: "starting" }),
    "daemon 当前状态为 starting",
  );
});
