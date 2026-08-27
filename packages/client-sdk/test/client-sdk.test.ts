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
    "agent.list",
    "agent.onboard",
    "agent.provision",
    "health",
    "host.runtime.list",
    "inputRequest.list",
    "inputRequest.resolve",
    "message.list",
    "message.post",
    "principal.me",
    "room.acknowledge",
    "room.agent.activity.list",
    "room.create",
    "room.list",
    "room.member.add",
    "room.member.list",
    "room.member.remove",
    "room.member.role",
    "room.sync",
    "task.assign",
    "task.cancel",
    "task.complete",
    "task.create",
    "task.list",
    "task.unblock",
    "thread.create",
    "thread.list",
    "thread.reply",
    "workspace.create",
    "workspace.list",
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
        sessionPolicy: "fresh",
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
        idempotencyKey: "task-complete",
        taskId: "task-main",
      },
      operation: "task.complete",
      path: "/v3/client/tasks/complete",
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
