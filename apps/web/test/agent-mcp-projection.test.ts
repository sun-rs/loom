import assert from "node:assert/strict";
import test from "node:test";

import type {
  ManagedMcpAssignmentRecord,
  ManagedMcpServerRecord,
  ManagedMcpUsageRecord,
} from "@rah-os/protocol";

import { projectAgentMcpServers } from "../src/agent-mcp-projection.ts";

const servers: ManagedMcpServerRecord[] = [
  {
    configVersion: 2,
    controlRoomId: "room_control",
    currentRevisionId: "mcp_revision_search",
    definition: {
      executorRef: "executor_search",
      runtimeName: "search-runtime",
      serverName: "Search Tools",
      tools: [
        {
          description: "Search the Web",
          inputSchema: { type: "object" },
          runtimeName: "search-runtime",
          toolName: "search",
        },
        {
          inputSchema: { type: "object" },
          runtimeName: "search-runtime",
          toolName: "open",
        },
      ],
    },
    mcpServerId: "mcp_search",
    state: "enabled",
  },
  {
    configVersion: 1,
    controlRoomId: "room_control",
    currentRevisionId: "mcp_revision_unused",
    definition: {
      executorRef: "executor_unused",
      runtimeName: "unused-runtime",
      serverName: "Unused",
      tools: [
        {
          inputSchema: { type: "object" },
          runtimeName: "unused-runtime",
          toolName: "noop",
        },
      ],
    },
    mcpServerId: "mcp_unused",
    state: "enabled",
  },
];

const assignments: ManagedMcpAssignmentRecord[] = [
  {
    allowedToolNames: ["search"],
    assignmentId: "assignment_search",
    assignmentVersion: 4,
    currentRevisionId: "assignment_revision_search",
    enabled: true,
    mcpServerId: "mcp_search",
    participantId: "agent_alice",
  },
  {
    allowedToolNames: ["noop"],
    assignmentId: "assignment_unused",
    assignmentVersion: 1,
    currentRevisionId: "assignment_revision_unused",
    enabled: true,
    mcpServerId: "mcp_unused",
    participantId: "agent_alice",
  },
];

const calls: ManagedMcpUsageRecord[] = [
  {
    assignmentVersion: 4,
    completedAt: "2026-09-01T10:00:01.000Z",
    configVersion: 2,
    createdAt: "2026-09-01T10:00:00.000Z",
    isError: false,
    managedMcpCallId: "call_1",
    mcpServerId: "mcp_search",
    participantId: "agent_alice",
    roomId: "room_work",
    runAttemptId: "run_1",
    serverName: "Search Tools",
    state: "completed",
    toolName: "search",
  },
  {
    assignmentVersion: 4,
    completedAt: "2026-09-01T11:00:01.000Z",
    configVersion: 2,
    createdAt: "2026-09-01T11:00:00.000Z",
    failureCode: "timeout",
    managedMcpCallId: "call_2",
    mcpServerId: "mcp_search",
    participantId: "agent_alice",
    roomId: "room_work",
    runAttemptId: "run_2",
    serverName: "Search Tools",
    state: "failed",
    toolName: "search",
  },
];

test("Agent MCP projection groups used servers and exposes only assigned tools", () => {
  assert.deepEqual(projectAgentMcpServers(servers, assignments, calls), [
    {
      assignmentEnabled: true,
      failedCount: 1,
      lastUsedAt: "2026-09-01T11:00:00.000Z",
      mcpServerId: "mcp_search",
      serverEnabled: true,
      serverName: "Search Tools",
      tools: [
        {
          description: "Search the Web",
          title: undefined,
          toolName: "search",
          usageCount: 2,
        },
      ],
      usageCount: 2,
    },
  ]);
});

test("Agent MCP projection stays empty for assigned but unused servers", () => {
  assert.deepEqual(projectAgentMcpServers(servers, assignments, []), []);
});
