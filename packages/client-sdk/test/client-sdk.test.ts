import assert from "node:assert/strict";
import test from "node:test";

import {
  FakeRahClient,
  HttpRahClient,
  RAH_CLIENT_OPERATION_NAMES,
  RahClientError,
  type RahFetch,
  type RahClientOperation,
} from "../src/index.ts";

const workspace = {
  controlRoomId: "room-control",
  createdAt: "2026-08-26T00:00:00.000Z",
  name: "RAH Workspace",
  slug: "rah-workspace",
  state: "active" as const,
  workspaceId: "workspace-main",
};

test("RahClient covers every existing Human API v3 operation", () => {
  assert.deepEqual(RAH_CLIENT_OPERATION_NAMES, [
    "activity.follow",
    "activity.list",
    "activity.mark",
    "agent.activity.list",
    "agent.get",
    "agent.list",
    "agent.manage",
    "agent.memory.config.get",
    "agent.memory.config.patch",
    "agent.memory.get",
    "agent.memory.read",
    "agent.memory.reset",
    "agent.onboard",
    "agent.presence.list",
    "agent.provision",
    "agent.room.list",
    "agent.trajectory.list",
    "agent.workspace.list",
    "agent.workspace.read",
    "file.cancel",
    "file.list",
    "file.prepare",
    "health",
    "host.runtime.list",
    "inputRequest.list",
    "inputRequest.resolve",
    "managedMcp.assignment.create",
    "managedMcp.assignment.list",
    "managedMcp.assignment.revise",
    "managedMcp.assignment.state",
    "managedMcp.executor.discover",
    "managedMcp.executor.list",
    "managedMcp.server.create",
    "managedMcp.server.list",
    "managedMcp.server.revise",
    "managedMcp.server.state",
    "managedMcp.usage.list",
    "message.context",
    "message.list",
    "message.post",
    "principal.me",
    "room.acknowledge",
    "room.agent.activity.list",
    "room.create",
    "room.direct.open",
    "room.list",
    "room.member.add",
    "room.member.list",
    "room.member.remove",
    "room.member.role",
    "room.sync",
    "room.update",
    "search",
    "task.assign",
    "task.cancel",
    "task.complete",
    "task.convert",
    "task.create",
    "task.global.list",
    "task.list",
    "task.reopen",
    "task.review.list",
    "task.unassign",
    "task.unblock",
    "thread.create",
    "thread.list",
    "thread.reply",
    "workspace.create",
    "workspace.list",
    "workspace.update",
  ]);
});

test("HttpRahClient maps the complete Human API surface to v3 routes", async () => {
  const requests: string[] = [];
  const client = new HttpRahClient({
    accessToken: () => "human-secret",
    baseUrl: "",
    fetch: async (url) => {
      requests.push(url);
      return {
        json: async () => ({
          error: { code: "forbidden", message: "contract probe" },
        }),
        ok: false,
        status: 403,
      };
    },
  });
  const cases: ReadonlyArray<{
    input: unknown;
    operation: RahClientOperation;
    path: string;
  }> = [
    {
      input: { roomId: "room-main", threadId: "thread-main", following: true },
      operation: "activity.follow",
      path: "/v3/client/activity/follow",
    },
    {
      input: { workspaceId: "workspace-main" },
      operation: "activity.list",
      path: "/v3/client/activity/list",
    },
    {
      input: { roomId: "room-main", throughSeq: 4, action: "done" },
      operation: "activity.mark",
      path: "/v3/client/activity/mark",
    },
    {
      input: { workspaceId: "workspace-main", query: "literal" },
      operation: "search",
      path: "/v3/client/search",
    },
    {
      input: { workspaceId: "workspace-main" },
      operation: "task.global.list",
      path: "/v3/client/tasks/global",
    },
    {
      input: { messageId: "message-main" },
      operation: "message.context",
      path: "/v3/client/messages/context",
    },
    {
      input: { agentDefinitionId: "agent-definition" },
      operation: "agent.memory.config.get",
      path: "/v3/client/agents/memory/config/get",
    },
    {
      input: {
        agentDefinitionId: "agent-definition",
        patch: { expectedRevision: 0, set: { enabled: false } },
      },
      operation: "agent.memory.config.patch",
      path: "/v3/client/agents/memory/config/patch",
    },
    {
      input: { agentDefinitionId: "agent-definition", limit: 25 },
      operation: "agent.activity.list",
      path: "/v3/client/agents/activity/list",
    },
    {
      input: { agentDefinitionId: "agent-definition", limit: 25 },
      operation: "agent.trajectory.list",
      path: "/v3/client/agents/trajectory/list",
    },
    {
      input: { controlRoomId: "room-control" },
      operation: "agent.presence.list",
      path: "/v3/client/agents/presence/list",
    },
    {
      input: {
        agentDefinitionId: "agent-definition",
        path: "",
        includeHidden: false,
      },
      operation: "agent.workspace.list",
      path: "/v3/client/agents/workspace/list",
    },
    {
      input: { agentDefinitionId: "agent-definition", path: "notes/guide.md" },
      operation: "agent.workspace.read",
      path: "/v3/client/agents/workspace/read",
    },
    {
      input: { agentDefinitionId: "agent-definition" },
      operation: "agent.get",
      path: "/v3/client/agents/get",
    },
    {
      input: { agentDefinitionId: "agent-definition" },
      operation: "agent.memory.get",
      path: "/v3/client/agents/memory/get",
    },
    {
      input: {
        agentDefinitionId: "agent-definition",
        relativePath: "MEMORY.md",
      },
      operation: "agent.memory.read",
      path: "/v3/client/agents/memory/read",
    },
    {
      input: {
        agentDefinitionId: "agent-definition",
        confirmation: "RESET_AGENT_MEMORY",
        idempotencyKey: "memory-reset-1",
      },
      operation: "agent.memory.reset",
      path: "/v3/client/agents/memory/reset",
    },
    {
      input: { agentDefinitionId: "agent-definition" },
      operation: "agent.room.list",
      path: "/v3/client/agents/rooms/list",
    },
    {
      input: {},
      operation: "host.runtime.list",
      path: "/v1/local/runtimes/list",
    },
    {
      input: { controlRoomId: "room-control" },
      operation: "agent.list",
      path: "/v3/client/agents/list",
    },
    {
      input: {
        action: "set_state",
        agentDefinitionId: "agent-definition",
        basedOnRoomSeq: 1,
        idempotencyKey: "agent-disable",
        state: "disabled",
      },
      operation: "agent.manage",
      path: "/v3/client/agents/manage",
    },
    {
      input: {
        agentDefinitionId: "agent-definition",
        basedOnRoomSeq: 1,
        idempotencyKey: "agent-onboard",
        roomId: "room-main",
      },
      operation: "agent.onboard",
      path: "/v3/client/agents/onboard",
    },
    {
      input: {
        avatarKey: "robot",
        basedOnRoomSeq: 1,
        controlRoomId: "room-control",
        description: "Production agent",
        displayName: "Alice",
        handle: "alice",
        idempotencyKey: "agent-provision",
        instructions: "Use canonical Room state.",
        modelIntent: { fallback: "disabled" },
        role: "Engineering Agent",
        runtimeOfferId: "offer-codex",
      },
      operation: "agent.provision",
      path: "/v3/client/agents/provision",
    },
    {
      input: { roomId: "room-main" },
      operation: "inputRequest.list",
      path: "/v3/client/input-requests/list",
    },
    {
      input: {
        answer: "Approved",
        basedOnRoomSeq: 1,
        idempotencyKey: "input-resolve",
        inputRequestId: "input-main",
      },
      operation: "inputRequest.resolve",
      path: "/v3/client/input-requests/resolve",
    },
    {
      input: {
        allowedToolNames: ["room.snapshot"],
        basedOnRoomSeq: 1,
        idempotencyKey: "mcp-assignment-create",
        mcpServerId: "mcp-room-tools",
        participantId: "agent-alice",
      },
      operation: "managedMcp.assignment.create",
      path: "/v3/client/managed-mcp/assignments/create",
    },
    {
      input: { controlRoomId: "room-control" },
      operation: "managedMcp.assignment.list",
      path: "/v3/client/managed-mcp/assignments/list",
    },
    {
      input: {
        allowedToolNames: ["room.snapshot"],
        basedOnRoomSeq: 2,
        expectedAssignmentVersion: 1,
        idempotencyKey: "mcp-assignment-revise",
        mcpServerId: "mcp-room-tools",
        participantId: "agent-alice",
      },
      operation: "managedMcp.assignment.revise",
      path: "/v3/client/managed-mcp/assignments/revise",
    },
    {
      input: {
        basedOnRoomSeq: 3,
        expectedAssignmentVersion: 2,
        idempotencyKey: "mcp-assignment-disable",
        mcpServerId: "mcp-room-tools",
        participantId: "agent-alice",
        state: "disabled",
      },
      operation: "managedMcp.assignment.state",
      path: "/v3/client/managed-mcp/assignments/state",
    },
    {
      input: {
        controlRoomId: "room-control",
        executorRef: "executor-room-tools",
      },
      operation: "managedMcp.executor.discover",
      path: "/v3/client/managed-mcp/executors/discover",
    },
    {
      input: { controlRoomId: "room-control" },
      operation: "managedMcp.executor.list",
      path: "/v3/client/managed-mcp/executors/list",
    },
    {
      input: {
        basedOnRoomSeq: 1,
        controlRoomId: "room-control",
        definition: {
          executorRef: "executor-room-tools",
          runtimeName: "room_tools",
          serverName: "RAH Room tools",
          tools: [
            {
              inputSchema: { type: "object" },
              runtimeName: "room_snapshot",
              toolName: "room.snapshot",
            },
          ],
        },
        idempotencyKey: "mcp-server-create",
        mcpServerId: "mcp-room-tools",
      },
      operation: "managedMcp.server.create",
      path: "/v3/client/managed-mcp/servers/create",
    },
    {
      input: { controlRoomId: "room-control" },
      operation: "managedMcp.server.list",
      path: "/v3/client/managed-mcp/servers/list",
    },
    {
      input: {
        basedOnRoomSeq: 2,
        definition: {
          executorRef: "executor-room-tools",
          runtimeName: "room_tools",
          serverName: "RAH Room tools",
          tools: [
            {
              inputSchema: { type: "object" },
              runtimeName: "room_snapshot",
              toolName: "room.snapshot",
            },
          ],
        },
        expectedConfigVersion: 1,
        idempotencyKey: "mcp-server-revise",
        mcpServerId: "mcp-room-tools",
      },
      operation: "managedMcp.server.revise",
      path: "/v3/client/managed-mcp/servers/revise",
    },
    {
      input: {
        basedOnRoomSeq: 3,
        expectedConfigVersion: 2,
        idempotencyKey: "mcp-server-disable",
        mcpServerId: "mcp-room-tools",
        state: "disabled",
      },
      operation: "managedMcp.server.state",
      path: "/v3/client/managed-mcp/servers/state",
    },
    {
      input: {
        controlRoomId: "room-control",
        limit: 50,
        participantId: "agent-alice",
      },
      operation: "managedMcp.usage.list",
      path: "/v3/client/managed-mcp/usage/list",
    },
    {
      input: { roomId: "room-main" },
      operation: "message.list",
      path: "/v3/client/messages/list",
    },
    {
      input: {},
      operation: "principal.me",
      path: "/v3/client/principals/me",
    },
    {
      input: {
        basedOnRoomSeq: 1,
        body: "Hello",
        idempotencyKey: "message-post",
        roomId: "room-main",
      },
      operation: "message.post",
      path: "/v3/client/messages/post",
    },
    {
      input: {
        consumerId: "browser-main",
        roomId: "room-main",
        throughSeq: 1,
      },
      operation: "room.acknowledge",
      path: "/v3/client/rooms/acknowledge",
    },
    {
      input: {
        basedOnControlRoomSeq: 1,
        idempotencyKey: "room-create",
        kind: "channel",
        name: "Engineering",
        slug: "engineering",
        workspaceId: "workspace-main",
      },
      operation: "room.create",
      path: "/v3/client/rooms/create",
    },
    {
      input: {
        basedOnRoomSeq: 2,
        description: "Planning work",
        idempotencyKey: "room-update",
        name: "Planning",
        roomId: "room-main",
        visibility: "private",
      },
      operation: "room.update",
      path: "/v3/client/rooms/update",
    },
    {
      input: {
        basedOnControlRoomSeq: 2,
        idempotencyKey: "direct-open",
        peerPrincipalId: "agent-alice",
        workspaceId: "workspace-main",
      },
      operation: "room.direct.open",
      path: "/v3/client/rooms/direct/open",
    },
    {
      input: { roomId: "room-main" },
      operation: "room.agent.activity.list",
      path: "/v3/client/rooms/agents/activity/list",
    },
    {
      input: {},
      operation: "room.list",
      path: "/v3/client/rooms/list",
    },
    {
      input: {
        basedOnRoomSeq: 1,
        idempotencyKey: "member-add",
        principalId: "human-two",
        role: "member",
        roomId: "room-main",
      },
      operation: "room.member.add",
      path: "/v3/client/rooms/members/add",
    },
    {
      input: { roomId: "room-main" },
      operation: "room.member.list",
      path: "/v3/client/rooms/members/list",
    },
    {
      input: {
        basedOnRoomSeq: 1,
        idempotencyKey: "member-remove",
        principalId: "human-two",
        roomId: "room-main",
      },
      operation: "room.member.remove",
      path: "/v3/client/rooms/members/remove",
    },
    {
      input: {
        basedOnRoomSeq: 1,
        idempotencyKey: "member-role",
        principalId: "human-two",
        role: "admin",
        roomId: "room-main",
      },
      operation: "room.member.role",
      path: "/v3/client/rooms/members/role",
    },
    {
      input: { afterSeq: 0, consumerId: "browser-main", roomId: "room-main" },
      operation: "room.sync",
      path: "/v3/client/rooms/sync",
    },
    {
      input: {
        assigneeId: "agent-main",
        basedOnRoomSeq: 1,
        idempotencyKey: "task-assign",
        taskId: "task-main",
      },
      operation: "task.assign",
      path: "/v3/client/tasks/assign",
    },
    {
      input: {
        basedOnRoomSeq: 1,
        idempotencyKey: "task-unassign",
        taskId: "task-main",
      },
      operation: "task.unassign",
      path: "/v3/client/tasks/unassign",
    },
    {
      input: {
        basedOnRoomSeq: 1,
        idempotencyKey: "task-cancel",
        reason: "No longer needed",
        taskId: "task-main",
      },
      operation: "task.cancel",
      path: "/v3/client/tasks/cancel",
    },
    {
      input: {
        basedOnRoomSeq: 1,
        idempotencyKey: "task-reopen",
        taskId: "task-main",
      },
      operation: "task.reopen",
      path: "/v3/client/tasks/reopen",
    },
    {
      input: {
        basedOnRoomSeq: 1,
        idempotencyKey: "task-complete",
        taskId: "task-main",
      },
      operation: "task.complete",
      path: "/v3/client/tasks/complete",
    },
    {
      input: {
        basedOnRoomSeq: 1,
        idempotencyKey: "task-convert",
        messageId: "message-main",
        roomId: "room-main",
      },
      operation: "task.convert",
      path: "/v3/client/tasks/convert",
    },
    {
      input: {
        dependencyTaskIds: [],
        idempotencyKey: "task-create",
        roomId: "room-main",
        title: "Implement",
      },
      operation: "task.create",
      path: "/v3/client/tasks/create",
    },
    {
      input: { roomId: "room-main" },
      operation: "task.list",
      path: "/v3/client/tasks/list",
    },
    {
      input: { roomId: "room-main" },
      operation: "task.review.list",
      path: "/v3/client/tasks/reviews/list",
    },
    {
      input: {
        basedOnRoomSeq: 1,
        idempotencyKey: "task-unblock",
        taskId: "task-main",
      },
      operation: "task.unblock",
      path: "/v3/client/tasks/unblock",
    },
    {
      input: {
        basedOnRoomSeq: 1,
        idempotencyKey: "thread-create",
        rootMessageId: "message-main",
        roomId: "room-main",
      },
      operation: "thread.create",
      path: "/v3/client/threads/create",
    },
    {
      input: { roomId: "room-main" },
      operation: "thread.list",
      path: "/v3/client/threads/list",
    },
    {
      input: {
        basedOnRoomSeq: 1,
        body: "Reply",
        idempotencyKey: "thread-reply",
        roomId: "room-main",
        threadId: "thread-main",
      },
      operation: "thread.reply",
      path: "/v3/client/threads/reply",
    },
    {
      input: {
        idempotencyKey: "workspace-create",
        name: "Workspace",
        slug: "workspace",
      },
      operation: "workspace.create",
      path: "/v3/client/workspaces/create",
    },
    {
      input: {
        workspaceId: "workspace-main",
        name: "Design Lab",
        avatarKey: "robot",
        basedOnControlRoomSeq: 1,
        idempotencyKey: "identity",
      },
      operation: "workspace.update",
      path: "/v3/client/workspaces/update",
    },
    {
      input: {},
      operation: "workspace.list",
      path: "/v3/client/workspaces/list",
    },
  ];
  const request = client.request.bind(client) as (
    operation: RahClientOperation,
    input: unknown,
  ) => Promise<unknown>;

  for (const entry of cases) {
    await assert.rejects(request(entry.operation, entry.input), RahClientError);
  }
  assert.deepEqual(
    requests,
    cases.map(({ path }) => path),
  );
});

test("FakeRahClient validates the same typed operation contract as HTTP", async () => {
  const calls: string[] = [];
  const client = new FakeRahClient(async (operation, input) => {
    calls.push(operation);
    assert.deepEqual(input, {});
    return { workspaces: [workspace] };
  });

  assert.deepEqual(await client.request("workspace.list", {}), {
    workspaces: [workspace],
  });
  assert.deepEqual(calls, ["workspace.list"]);

  const invalid = new FakeRahClient(async () => ({ workspaces: [{}] }));
  await assert.rejects(invalid.request("workspace.list", {}));
});

test("HttpRahClient owns route, auth, parsing, and structured errors", async () => {
  const requests: Array<{ init: Parameters<RahFetch>[1]; url: string }> = [];
  const fetch: RahFetch = async (url, init) => {
    requests.push({ init, url });
    return {
      json: async () => ({ workspaces: [workspace] }),
      ok: true,
      status: 200,
    };
  };
  const client = new HttpRahClient({
    accessToken: () => "human-secret",
    baseUrl: "http://127.0.0.1:7777/",
    fetch,
  });

  assert.deepEqual(await client.request("workspace.list", {}), {
    workspaces: [workspace],
  });
  assert.equal(
    requests[0]?.url,
    "http://127.0.0.1:7777/v3/client/workspaces/list",
  );
  assert.equal(requests[0]?.init.method, "POST");
  assert.equal(requests[0]?.init.headers.authorization, "Bearer human-secret");
  assert.equal(requests[0]?.init.body, "{}");

  const denied = new HttpRahClient({
    accessToken: () => "human-secret",
    baseUrl: "http://127.0.0.1:7777",
    fetch: async () => ({
      json: async () => ({
        error: { code: "forbidden", message: "Room access denied" },
      }),
      ok: false,
      status: 403,
    }),
  });
  await assert.rejects(
    denied.request("workspace.list", {}),
    (error: unknown) =>
      error instanceof RahClientError &&
      error.code === "forbidden" &&
      error.status === 403,
  );
});

test("health is unauthenticated GET while business operations require a token", async () => {
  const requests: Array<{ init: Parameters<RahFetch>[1]; url: string }> = [];
  const fetch: RahFetch = async (url, init) => {
    requests.push({ init, url });
    return {
      json: async () => ({
        apiVersion: 3,
        buildVersion: "test",
        capabilities: {
          agentOnboard: true,
          agentRead: true,
          agentWrite: true,
          cursorAcknowledge: true,
          hints: false,
          inputRequestRead: true,
          inputRequestResolve: true,
          managedMcpRead: true,
          managedMcpWrite: true,
          memberRead: true,
          memberWrite: true,
          messageRead: true,
          messageWrite: true,
          roomRead: true,
          roomSync: true,
          roomWrite: true,
          taskRead: true,
          taskWrite: true,
          threadRead: true,
          threadWrite: true,
          workspaceRead: true,
          workspaceWrite: true,
        },
        kernelSchemaVersion: 8,
        protocolVersion: 1,
        state: "online",
      }),
      ok: true,
      status: 200,
    };
  };
  const client = new HttpRahClient({
    accessToken: () => undefined,
    baseUrl: "http://127.0.0.1:7777",
    fetch,
  });

  assert.equal((await client.request("health", {})).state, "online");
  assert.equal(requests[0]?.url, "http://127.0.0.1:7777/v3/client/health");
  assert.equal(requests[0]?.init.method, "GET");
  assert.equal(requests[0]?.init.headers.authorization, undefined);
  await assert.rejects(
    client.request("workspace.list", {}),
    /access token is required/,
  );
});
