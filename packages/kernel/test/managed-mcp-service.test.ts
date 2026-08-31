import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ConflictError,
  ForbiddenError,
  IdempotencyConflictError,
  RoomKernel,
  StaleContextError,
  UnauthenticatedError,
} from "../src/index.ts";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function latestRoomSeq(
  kernel: RoomKernel,
  actor: Parameters<RoomKernel["sync"]>[0],
  roomId: string,
): number {
  return kernel.sync(actor, {
    afterSeq: 0,
    consumerId: "managed-mcp-test",
    roomId,
  }).latestRoomSeq;
}

function serverDefinition() {
  return {
    executorRef: "executor-room-tools",
    runtimeName: "room_tools",
    serverName: "RAH Room tools",
    tools: [
      {
        annotations: { readOnlyHint: true },
        description: "Read a canonical Room snapshot.",
        inputSchema: {
          additionalProperties: false,
          properties: { roomId: { type: "string" } },
          required: ["roomId"],
          type: "object" as const,
        },
        runtimeName: "room_snapshot",
        toolName: "room.snapshot",
      },
    ],
  };
}

test("managed MCP configuration, assignment, catalog, and calls are durably version-fenced", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-managed-mcp-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  try {
    kernel.initialize();
    const human = kernel.provisionPrincipal({
      handle: "managed-mcp-human",
      kind: "human",
    });
    const agent = kernel.provisionPrincipal({
      handle: "managed-mcp-agent",
      kind: "agent",
    });
    const outsider = kernel.provisionPrincipal({
      handle: "managed-mcp-outsider",
      kind: "human",
    });
    const humanActor = kernel.authenticateAccessToken(human.accessToken);
    const outsiderActor = kernel.authenticateAccessToken(outsider.accessToken);
    const workspace = kernel.createWorkspace(humanActor, {
      idempotencyKey: "managed-mcp-workspace",
      name: "Managed MCP Workspace",
      slug: "managed-mcp-workspace",
    });
    const controlRoomId = workspace.controlRoom.roomId;
    const workRoom = kernel.createWorkspaceRoom(humanActor, {
      basedOnControlRoomSeq: workspace.event.roomSeq,
      idempotencyKey: "managed-mcp-work-room",
      kind: "channel",
      name: "Managed MCP Work",
      slug: "managed-mcp-work",
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
      idempotencyKey: "managed-mcp-policy",
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
    const agentDefinition = kernel.createAgentDefinition(humanActor, {
      basedOnRoomSeq: latestRoomSeq(kernel, humanActor, controlRoomId),
      controlRoomId,
      executionPolicyRevisionId: policy.policy.executionPolicyRevisionId,
      idempotencyKey: "managed-mcp-agent-definition",
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

    const createInput = {
      basedOnRoomSeq: latestRoomSeq(kernel, humanActor, controlRoomId),
      controlRoomId,
      definition: serverDefinition(),
      idempotencyKey: "managed-mcp-server-create",
      mcpServerId: "mcp-room-tools",
    };
    assert.throws(
      () =>
        kernel.managedMcp.createServer(outsiderActor, {
          ...createInput,
          idempotencyKey: "managed-mcp-outsider-create",
        }),
      ForbiddenError,
    );
    const created = kernel.managedMcp.createServer(humanActor, createInput);
    const server = created.server;
    assert.equal(created.deduplicated, false);
    assert.equal(created.event.type, "mcp_server.created");
    assert.equal(server.configVersion, 1);
    const replayedCreate = kernel.managedMcp.createServer(
      humanActor,
      createInput,
    );
    assert.equal(replayedCreate.deduplicated, true);
    assert.equal(replayedCreate.event.eventId, created.event.eventId);
    assert.equal(replayedCreate.server.configVersion, 1);
    assert.throws(
      () =>
        kernel.managedMcp.createServer(humanActor, {
          ...createInput,
          definition: {
            ...serverDefinition(),
            serverName: "Conflicting server",
          },
        }),
      IdempotencyConflictError,
    );
    assert.throws(
      () =>
        kernel.managedMcp.createServer(humanActor, {
          ...createInput,
          idempotencyKey: "managed-mcp-stale-create",
          mcpServerId: "mcp-stale",
        }),
      StaleContextError,
    );

    const assignmentInput = {
      allowedToolNames: ["room.snapshot"],
      basedOnRoomSeq: latestRoomSeq(kernel, humanActor, controlRoomId),
      idempotencyKey: "managed-mcp-assignment-create",
      mcpServerId: server.mcpServerId,
      participantId: agent.principal.principalId,
    };
    const assigned = kernel.managedMcp.assignServer(
      humanActor,
      assignmentInput,
    );
    const assignment = assigned.assignment;
    assert.equal(assigned.event.type, "mcp_assignment.created");
    assert.equal(assignment.assignmentVersion, 1);
    assert.deepEqual(
      kernel.managedMcp.listServers(humanActor, { controlRoomId }),
      [server],
    );
    assert.deepEqual(
      kernel.managedMcp.listAssignments(humanActor, { controlRoomId }),
      [assignment],
    );
    assert.throws(
      () => kernel.managedMcp.listServers(outsiderActor, { controlRoomId }),
      ForbiddenError,
    );

    kernel.postMessage(humanActor, {
      body: "Use the managed Room tool.",
      idempotencyKey: "managed-mcp-activation",
      recipients: [
        {
          participantId: agent.principal.principalId,
          reason: "mention",
        },
      ],
      roomId: workRoom.roomId,
    });
    const hostCredential = kernel.provisionHostCredential({
      hostId: "managed-mcp-host",
      participantIds: [agent.principal.principalId],
    });
    const host = kernel.authenticateHostAccessToken(hostCredential.accessToken);
    kernel.heartbeatHost(host);
    const activation = kernel.leaseNextActivation(host, { leaseMs: 30_000 });
    assert.ok(activation);
    const run = kernel.createRunAttempt(host, {
      activationId: activation.activationId,
    });
    kernel.prepareRunAttemptRuntime(host, {
      recoveryDescriptor: {
        driver: "fake-runtime",
        metadata: {},
        recoveryKey: "managed-mcp-runtime",
      },
      runAttemptId: run.runAttemptId,
      runtimeRunId: "managed-mcp-runtime",
    });
    kernel.markRunAttemptRunning(host, {
      recoveryDescriptor: {
        driver: "fake-runtime",
        metadata: {},
        recoveryKey: "managed-mcp-runtime",
      },
      runAttemptId: run.runAttemptId,
      runtimeRunId: "managed-mcp-runtime",
    });
    const execution = kernel.authorizeWorkerExecution(host, {
      activationId: activation.activationId,
      consumerId: "managed-mcp-worker",
      hostId: host.hostId,
      participantId: agent.principal.principalId,
      roomId: workRoom.roomId,
      runAttemptId: run.runAttemptId,
      toSeq: activation.toSeq,
    });
    const catalog = kernel.managedMcp.listCatalog(execution);
    assert.deepEqual(catalog.tools, [
      {
        ...serverDefinition().tools[0],
        assignmentVersion: 1,
        configVersion: 1,
        mcpServerId: "mcp-room-tools",
        serverName: "RAH Room tools",
      },
    ]);
    const authorized = kernel.managedMcp.authorizeCall(execution, {
      arguments: { roomId: workRoom.roomId },
      expectedAssignmentVersion: 1,
      expectedConfigVersion: 1,
      mcpServerId: "mcp-room-tools",
      toolName: "room.snapshot",
    });
    assert.equal(authorized.executorRef, "executor-room-tools");
    assert.equal(authorized.call.participantId, agent.principal.principalId);

    const revisedAssignment = kernel.managedMcp.reviseAssignment(humanActor, {
      allowedToolNames: ["room.snapshot"],
      basedOnRoomSeq: latestRoomSeq(kernel, humanActor, controlRoomId),
      expectedAssignmentVersion: 1,
      idempotencyKey: "managed-mcp-assignment-revise",
      mcpServerId: "mcp-room-tools",
      participantId: agent.principal.principalId,
    });
    assert.equal(revisedAssignment.assignment.assignmentVersion, 2);
    const replayedAssignment = kernel.managedMcp.assignServer(
      humanActor,
      assignmentInput,
    );
    assert.equal(replayedAssignment.deduplicated, true);
    assert.equal(replayedAssignment.assignment.assignmentVersion, 1);
    assert.throws(
      () =>
        kernel.managedMcp.authorizeCall(execution, {
          arguments: { roomId: workRoom.roomId },
          expectedAssignmentVersion: 1,
          expectedConfigVersion: 1,
          mcpServerId: "mcp-room-tools",
          toolName: "room.snapshot",
        }),
      ConflictError,
    );

    const disabledAssignment = kernel.managedMcp.setAssignmentState(
      humanActor,
      {
        basedOnRoomSeq: latestRoomSeq(kernel, humanActor, controlRoomId),
        expectedAssignmentVersion: 2,
        idempotencyKey: "managed-mcp-assignment-disable",
        mcpServerId: "mcp-room-tools",
        participantId: agent.principal.principalId,
        state: "disabled",
      },
    );
    assert.equal(disabledAssignment.assignment.assignmentVersion, 3);
    assert.equal(disabledAssignment.assignment.enabled, false);
    assert.deepEqual(kernel.managedMcp.listCatalog(execution).tools, []);
    const enabledAssignment = kernel.managedMcp.setAssignmentState(humanActor, {
      basedOnRoomSeq: latestRoomSeq(kernel, humanActor, controlRoomId),
      expectedAssignmentVersion: 3,
      idempotencyKey: "managed-mcp-assignment-enable",
      mcpServerId: "mcp-room-tools",
      participantId: agent.principal.principalId,
      state: "enabled",
    });
    assert.equal(enabledAssignment.assignment.assignmentVersion, 4);

    const disabledServer = kernel.managedMcp.setServerState(humanActor, {
      basedOnRoomSeq: latestRoomSeq(kernel, humanActor, controlRoomId),
      expectedConfigVersion: 1,
      idempotencyKey: "managed-mcp-server-disable",
      mcpServerId: "mcp-room-tools",
      state: "disabled",
    });
    assert.equal(disabledServer.server.configVersion, 2);
    assert.equal(disabledServer.server.state, "disabled");
    assert.deepEqual(kernel.managedMcp.listCatalog(execution).tools, []);
    const enabledServer = kernel.managedMcp.setServerState(humanActor, {
      basedOnRoomSeq: latestRoomSeq(kernel, humanActor, controlRoomId),
      expectedConfigVersion: 2,
      idempotencyKey: "managed-mcp-server-enable",
      mcpServerId: "mcp-room-tools",
      state: "enabled",
    });
    assert.equal(enabledServer.server.configVersion, 3);
    assert.equal(enabledServer.server.state, "enabled");
    assert.equal(
      kernel.managedMcp.listCatalog(execution).tools[0]?.configVersion,
      3,
    );
    assert.equal(
      kernel.managedMcp.listCatalog(execution).tools[0]?.assignmentVersion,
      4,
    );
    kernel.managedMcp.completeCall(execution, {
      managedMcpCallId: authorized.call.managedMcpCallId,
      result: {
        content: [{ text: "Room is active", type: "text" }],
        isError: false,
      },
    });
    const failedCall = kernel.managedMcp.authorizeCall(execution, {
      arguments: { roomId: workRoom.roomId },
      expectedAssignmentVersion: 4,
      expectedConfigVersion: 3,
      mcpServerId: "mcp-room-tools",
      toolName: "room.snapshot",
    });
    kernel.managedMcp.failCall(execution, {
      failureCode: "timeout",
      managedMcpCallId: failedCall.call.managedMcpCallId,
    });
    const usage = kernel.managedMcp.listUsage(humanActor, {
      controlRoomId,
      limit: 1,
      participantId: agent.principal.principalId,
    });
    assert.equal(usage.calls.length, 1);
    assert.equal(usage.calls[0]?.state, "failed");
    assert.equal(usage.calls[0]?.failureCode, "timeout");
    assert.equal(usage.calls[0]?.serverName, "RAH Room tools");
    assert.equal(usage.nextCursor, usage.calls[0]?.managedMcpCallId);
    const olderUsage = kernel.managedMcp.listUsage(humanActor, {
      beforeCallId: usage.nextCursor,
      controlRoomId,
      limit: 1,
      participantId: agent.principal.principalId,
    });
    assert.equal(olderUsage.calls[0]?.state, "completed");
    assert.equal(olderUsage.calls[0]?.isError, false);
    assert.equal(olderUsage.nextCursor, undefined);
    const activityIds: string[] = [];
    let activityCursor: string | undefined;
    do {
      const activityPage = kernel.listAgentActivity(humanActor, {
        agentDefinitionId: agentDefinition.definition.agentDefinitionId,
        ...(activityCursor === undefined
          ? {}
          : { beforeActivityId: activityCursor }),
        limit: 1,
      });
      activityIds.push(
        ...activityPage.activities.map(({ activityId }) => activityId),
      );
      activityCursor = activityPage.nextCursor;
    } while (activityCursor !== undefined);
    assert.equal(new Set(activityIds).size, activityIds.length);
    const agentActivity = kernel.listAgentActivity(humanActor, {
      agentDefinitionId: agentDefinition.definition.agentDefinitionId,
      limit: 100,
    });
    const toolActivity = agentActivity.activities.filter(
      ({ source }) => source === "managed_mcp_call",
    );
    assert.deepEqual(toolActivity.map(({ state }) => state).sort(), [
      "completed",
      "failed",
    ]);
    assert.ok(
      toolActivity.every(
        (activity) =>
          activity.serverName === "RAH Room tools" &&
          activity.toolName === "room.snapshot" &&
          !("arguments" in activity) &&
          !("result" in activity),
      ),
    );
    assert.throws(
      () =>
        kernel.managedMcp.listUsage(outsiderActor, {
          controlRoomId,
          participantId: agent.principal.principalId,
        }),
      ForbiddenError,
    );
    assert.throws(
      () =>
        kernel.managedMcp.reviseServer(humanActor, {
          basedOnRoomSeq: latestRoomSeq(kernel, humanActor, controlRoomId),
          definition: {
            ...serverDefinition(),
            tools: [
              {
                ...serverDefinition().tools[0]!,
                runtimeName: "other_tool",
                toolName: "room.other",
              },
            ],
          },
          expectedConfigVersion: 1,
          idempotencyKey: "managed-mcp-server-revise-invalid",
          mcpServerId: "mcp-room-tools",
        }),
      ConflictError,
    );

    const controlEvents = kernel
      .sync(humanActor, {
        afterSeq: 0,
        consumerId: "managed-mcp-control-events",
        roomId: controlRoomId,
      })
      .events.filter((event) => event.type.startsWith("mcp_"));
    assert.deepEqual(
      controlEvents.map((event) => event.type),
      [
        "mcp_server.created",
        "mcp_assignment.created",
        "mcp_assignment.revised",
        "mcp_assignment.disabled",
        "mcp_assignment.enabled",
        "mcp_server.disabled",
        "mcp_server.enabled",
      ],
    );

    kernel.revokeHostCredential(hostCredential.credentialId);
    assert.throws(
      () => kernel.managedMcp.listCatalog(execution),
      UnauthenticatedError,
    );
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
