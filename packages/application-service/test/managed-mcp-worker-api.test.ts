import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RoomKernel } from "@rah-os/kernel";

import {
  WorkerApplicationService,
  type ManagedMcpExecutorPort,
} from "../src/index.ts";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

async function jsonObject(
  response: Response,
): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  assert.ok(
    typeof value === "object" && value !== null && !Array.isArray(value),
  );
  return value as Record<string, unknown>;
}

function latestRoomSeq(
  kernel: RoomKernel,
  actor: Parameters<RoomKernel["sync"]>[0],
  roomId: string,
): number {
  return kernel.sync(actor, {
    afterSeq: 0,
    consumerId: "managed-mcp-worker-test",
    roomId,
  }).latestRoomSeq;
}

test("Worker managed MCP endpoints reload a fenced catalog and delegate through an injected executor", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-managed-mcp-worker-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  const executorCalls: Array<Record<string, unknown>> = [];
  const executor: ManagedMcpExecutorPort = {
    call: async (input, { signal }) => {
      executorCalls.push(input);
      if (input.arguments.hang === true) {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        });
      }
      return {
        content: [
          { text: `room:${String(input.arguments.roomId)}`, type: "text" },
        ],
        isError: false,
        structuredContent: { source: "fake-managed-mcp-executor" },
      };
    },
  };
  const service = new WorkerApplicationService({
    kernel,
    managedMcpExecutor: executor,
    managedMcpTimeoutMs: 10,
  });
  try {
    kernel.initialize();
    const human = kernel.provisionPrincipal({
      handle: "managed-mcp-worker-human",
      kind: "human",
    });
    const agent = kernel.provisionPrincipal({
      handle: "managed-mcp-worker-agent",
      kind: "agent",
    });
    const humanActor = kernel.authenticateAccessToken(human.accessToken);
    const workspace = kernel.createWorkspace(humanActor, {
      idempotencyKey: "managed-mcp-worker-workspace",
      name: "Managed MCP Worker Workspace",
      slug: "managed-mcp-worker-workspace",
    });
    const controlRoomId = workspace.controlRoom.roomId;
    const workRoom = kernel.createWorkspaceRoom(humanActor, {
      basedOnControlRoomSeq: workspace.event.roomSeq,
      idempotencyKey: "managed-mcp-worker-room",
      kind: "channel",
      name: "Managed MCP Worker Room",
      slug: "managed-mcp-worker-room",
      workspaceId: workspace.workspace.workspaceId,
    }).room;
    for (const roomId of [controlRoomId, workRoom.roomId]) {
      kernel.addMember(humanActor, {
        principalId: agent.principal.principalId,
        roomId,
      });
    }
    const policy = kernel.createExecutionPolicy(humanActor, {
      basedOnRoomSeq: latestRoomSeq(kernel, humanActor, controlRoomId),
      controlRoomId,
      idempotencyKey: "managed-mcp-worker-policy",
      modelIntent: {
        fallback: "disabled",
        reasoning: "default",
        serviceTier: "default",
      },
      preferred: [],
      required: {
        allowedProtocolFamilies: ["rah-worker-process/v1"],
        capabilities: [],
        minimumIsolation: "process",
        workspaceMode: "in_place",
      },
      retryPolicyRef: {
        artifactId: "retry-policy",
        contentDigest: digest("a"),
        versionId: "retry-policy-v1",
      },
      sessionPolicy: "fresh",
    });
    kernel.createAgentDefinition(humanActor, {
      basedOnRoomSeq: latestRoomSeq(kernel, humanActor, controlRoomId),
      controlRoomId,
      executionPolicyRevisionId: policy.policy.executionPolicyRevisionId,
      idempotencyKey: "managed-mcp-worker-agent-definition",
      instructionRefs: [],
      memoryPolicyRef: {
        artifactId: "memory-policy",
        contentDigest: digest("b"),
        versionId: "memory-policy-v1",
      },
      participantId: agent.principal.principalId,
      role: "tool-using agent",
      skillRefs: [],
    });
    kernel.managedMcp.createServer(humanActor, {
      basedOnRoomSeq: latestRoomSeq(kernel, humanActor, controlRoomId),
      controlRoomId,
      definition: {
        executorRef: "executor-room-tools",
        runtimeName: "room_tools",
        serverName: "RAH Room tools",
        tools: [
          {
            inputSchema: {
              additionalProperties: false,
              properties: { roomId: { type: "string" } },
              type: "object",
            },
            runtimeName: "room_snapshot",
            toolName: "room.snapshot",
          },
        ],
      },
      idempotencyKey: "managed-mcp-worker-server-create",
      mcpServerId: "mcp-room-tools",
    });
    kernel.managedMcp.assignServer(humanActor, {
      allowedToolNames: ["room.snapshot"],
      basedOnRoomSeq: latestRoomSeq(kernel, humanActor, controlRoomId),
      idempotencyKey: "managed-mcp-worker-assignment-create",
      mcpServerId: "mcp-room-tools",
      participantId: agent.principal.principalId,
    });
    kernel.postMessage(humanActor, {
      body: "Call the Room tool.",
      idempotencyKey: "managed-mcp-worker-activation",
      recipients: [
        {
          participantId: agent.principal.principalId,
          reason: "mention",
        },
      ],
      roomId: workRoom.roomId,
    });
    const host = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId: "managed-mcp-worker-host",
        participantIds: [agent.principal.principalId],
      }).accessToken,
    );
    kernel.heartbeatHost(host);
    const activation = kernel.leaseNextActivation(host, { leaseMs: 30_000 });
    assert.ok(activation);
    const run = kernel.createRunAttempt(host, {
      activationId: activation.activationId,
    });
    const recoveryDescriptor = {
      driver: "fake-runtime",
      metadata: {},
      recoveryKey: "managed-mcp-worker-runtime",
    };
    kernel.prepareRunAttemptRuntime(host, {
      recoveryDescriptor,
      runAttemptId: run.runAttemptId,
      runtimeRunId: "managed-mcp-worker-runtime",
    });
    kernel.markRunAttemptRunning(host, {
      recoveryDescriptor,
      runAttemptId: run.runAttemptId,
      runtimeRunId: "managed-mcp-worker-runtime",
    });
    await service.start();
    const credential = service.issueActivationCredential(host, {
      activationId: activation.activationId,
      consumerId: "managed-mcp-worker",
      hostId: host.hostId,
      participantId: agent.principal.principalId,
      roomId: workRoom.roomId,
      runAttemptId: run.runAttemptId,
      toSeq: activation.toSeq,
    });
    const request = async (path: string, body: Record<string, unknown>) =>
      await fetch(`${service.origin}${path}`, {
        body: JSON.stringify(body),
        headers: {
          authorization: `Bearer ${credential.accessToken}`,
          "content-type": "application/json",
        },
        method: "POST",
      });

    const catalogResponse = await request("/v1/worker/mcp/tools", {});
    assert.equal(catalogResponse.status, 200);
    const catalog = await jsonObject(catalogResponse);
    assert.equal(catalog.catalogVersion, 1);
    assert.equal((catalog.tools as unknown[]).length, 1);
    assert.equal(
      JSON.stringify(catalog).includes("executor-room-tools"),
      false,
    );

    const callResponse = await request("/v1/worker/mcp/call", {
      arguments: { roomId: workRoom.roomId },
      expectedAssignmentVersion: 1,
      expectedConfigVersion: 1,
      mcpServerId: "mcp-room-tools",
      toolName: "room.snapshot",
    });
    assert.equal(callResponse.status, 200);
    assert.equal(
      ((await jsonObject(callResponse)).content as Array<{ text: string }>)[0]
        ?.text,
      `room:${workRoom.roomId}`,
    );
    assert.equal(executorCalls[0]?.executorRef, "executor-room-tools");
    assert.equal("accessToken" in executorCalls[0]!, false);

    const injected = await request("/v1/worker/mcp/call", {
      arguments: { roomId: workRoom.roomId },
      executorRef: "attacker-controlled",
      expectedAssignmentVersion: 1,
      expectedConfigVersion: 1,
      mcpServerId: "mcp-room-tools",
      toolName: "room.snapshot",
    });
    assert.equal(injected.status, 400);
    assert.equal(executorCalls.length, 1);

    const stale = await request("/v1/worker/mcp/call", {
      arguments: { roomId: workRoom.roomId },
      expectedAssignmentVersion: 9,
      expectedConfigVersion: 1,
      mcpServerId: "mcp-room-tools",
      toolName: "room.snapshot",
    });
    assert.equal(stale.status, 409);
    assert.equal(executorCalls.length, 1);

    const timeout = await request("/v1/worker/mcp/call", {
      arguments: { hang: true },
      expectedAssignmentVersion: 1,
      expectedConfigVersion: 1,
      mcpServerId: "mcp-room-tools",
      toolName: "room.snapshot",
    });
    assert.equal(timeout.status, 504);
    assert.equal(
      ((await jsonObject(timeout)).error as { code: string }).code,
      "managed_mcp_timeout",
    );
  } finally {
    await service.close();
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
