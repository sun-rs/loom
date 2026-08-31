import assert from "node:assert/strict";
import test from "node:test";

import {
  ClientManagedMcpUsageListRequestSchema,
  ClientManagedMcpUsageListResponseSchema,
  ManagedMcpCatalogSchema,
  ManagedMcpCallRequestSchema,
  ManagedMcpCallResultSchema,
  ManagedMcpRuntimeAdapterSchema,
  ManagedMcpServerDefinitionSchema,
} from "../src/index.ts";

test("managed MCP usage projection is bounded and excludes arguments and results", () => {
  const request = ClientManagedMcpUsageListRequestSchema.parse({
    controlRoomId: "room-control",
    limit: 25,
    participantId: "agent-alice",
  });
  assert.equal(request.limit, 25);
  const response = ClientManagedMcpUsageListResponseSchema.parse({
    calls: [
      {
        assignmentVersion: 3,
        completedAt: "2026-08-28T12:00:01.000Z",
        configVersion: 7,
        createdAt: "2026-08-28T12:00:00.000Z",
        isError: false,
        managedMcpCallId: "mcp-call-1",
        mcpServerId: "mcp-room-tools",
        participantId: "agent-alice",
        roomId: "room-main",
        runAttemptId: "run-1",
        serverName: "RAH Room tools",
        state: "completed",
        toolName: "room.snapshot",
      },
    ],
  });
  assert.equal(response.calls[0]?.toolName, "room.snapshot");
  assert.equal("arguments" in response.calls[0]!, false);
  assert.equal("result" in response.calls[0]!, false);
  assert.throws(() =>
    ClientManagedMcpUsageListRequestSchema.parse({
      ...request,
      limit: 101,
    }),
  );
  assert.throws(() =>
    ClientManagedMcpUsageListResponseSchema.parse({
      calls: [
        {
          ...response.calls[0],
          failureCode: "executor_failed",
          state: "completed",
        },
      ],
    }),
  );
});

test("managed MCP Runtime adapters are explicit provider contracts", () => {
  for (const kind of [
    "claude-cli/v1",
    "codex-cli/v1",
    "kimi-cli/v1",
    "opencode-cli/v1",
  ] as const) {
    assert.deepEqual(ManagedMcpRuntimeAdapterSchema.parse({ kind }), { kind });
  }
  assert.throws(() =>
    ManagedMcpRuntimeAdapterSchema.parse({ kind: "infer-from-executable" }),
  );
});

function tool() {
  return {
    annotations: {
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      readOnlyHint: true,
    },
    assignmentVersion: 3,
    configVersion: 7,
    description: "Read the canonical Room snapshot.",
    inputSchema: {
      additionalProperties: false,
      properties: { roomId: { type: "string" } },
      required: ["roomId"],
      type: "object",
    },
    mcpServerId: "mcp-room-tools",
    runtimeName: "room_snapshot",
    serverName: "RAH Room tools",
    title: "Read Room",
    toolName: "room.snapshot",
  };
}

test("managed MCP catalog matches the Raft-observed versioned public shape", () => {
  const catalog = ManagedMcpCatalogSchema.parse({
    catalogVersion: 1,
    tools: [tool()],
  });
  assert.equal(catalog.tools[0]?.configVersion, 7);
  assert.equal(catalog.tools[0]?.assignmentVersion, 3);
  assert.equal("executorRef" in catalog.tools[0]!, false);
  assert.throws(() =>
    ManagedMcpCatalogSchema.parse({
      catalogVersion: 1,
      tools: [{ ...tool(), executorRef: "secret-provider" }],
    }),
  );
  assert.throws(() =>
    ManagedMcpCatalogSchema.parse({
      catalogVersion: 2,
      tools: [tool()],
    }),
  );
  const sharedRuntimeCatalog = ManagedMcpCatalogSchema.parse({
    catalogVersion: 1,
    tools: [
      tool(),
      {
        ...tool(),
        runtimeName: tool().runtimeName,
        toolName: "room.post-message",
      },
    ],
  });
  assert.equal(sharedRuntimeCatalog.tools.length, 2);
});

test("managed MCP calls carry exact config and assignment fencing", () => {
  const request = ManagedMcpCallRequestSchema.parse({
    arguments: { roomId: "room-1" },
    expectedAssignmentVersion: 3,
    expectedConfigVersion: 7,
    mcpServerId: "mcp-room-tools",
    toolName: "room.snapshot",
  });
  assert.deepEqual(request.arguments, { roomId: "room-1" });
  assert.throws(() =>
    ManagedMcpCallRequestSchema.parse({
      ...request,
      expectedAssignmentVersion: 0,
    }),
  );
  assert.throws(() =>
    ManagedMcpCallRequestSchema.parse({
      ...request,
      arguments: { payload: "x".repeat(65 * 1_024) },
    }),
  );
});

test("managed MCP result is bounded to the Raft-observed text and image content", () => {
  assert.deepEqual(
    ManagedMcpCallResultSchema.parse({
      content: [
        { text: "Room is active", type: "text" },
        { data: "aGVsbG8=", mimeType: "image/png", type: "image" },
      ],
      isError: false,
      structuredContent: { roomId: "room-1" },
    }).content,
    [
      { text: "Room is active", type: "text" },
      { data: "aGVsbG8=", mimeType: "image/png", type: "image" },
    ],
  );
  assert.throws(() =>
    ManagedMcpCallResultSchema.parse({
      content: [{ resource: {}, type: "resource" }],
      isError: false,
    }),
  );
  assert.throws(() =>
    ManagedMcpCallResultSchema.parse({
      content: [{ text: "x".repeat(513 * 1_024), type: "text" }],
      isError: false,
    }),
  );
});

test("managed MCP Server definition keeps executor routing out of the public catalog", () => {
  const definition = ManagedMcpServerDefinitionSchema.parse({
    executorRef: "executor-room-tools",
    runtimeName: "room_tools",
    serverName: "RAH Room tools",
    tools: [
      {
        annotations: tool().annotations,
        description: tool().description,
        inputSchema: tool().inputSchema,
        runtimeName: tool().runtimeName,
        title: tool().title,
        toolName: tool().toolName,
      },
    ],
  });
  assert.equal(definition.executorRef, "executor-room-tools");
  assert.equal(definition.tools[0]?.toolName, "room.snapshot");
  assert.throws(() =>
    ManagedMcpServerDefinitionSchema.parse({
      ...definition,
      tools: [...definition.tools, definition.tools[0]],
    }),
  );
  assert.equal(
    ManagedMcpServerDefinitionSchema.parse({
      ...definition,
      tools: [
        definition.tools[0],
        {
          ...definition.tools[0],
          toolName: "room.post-message",
        },
      ],
    }).tools.length,
    2,
  );
});
