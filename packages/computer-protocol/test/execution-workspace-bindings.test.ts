import assert from "node:assert/strict";
import test from "node:test";
import { HOST_EXECUTION_WORKSPACE_BINDING_LIMIT } from "@rah-os/protocol";
import { ComputerHeartbeatResponseSchema } from "../src/index.ts";

const binding = (index: number) => ({
  participantId: `agent-${index}`,
  agentDefinitionRevisionId: `revision-${index}`,
  workspaceDefinitionId: `workspace-${index}`,
  executionWorkspace: { kind: "agent_private" as const },
});
const heartbeat = (count: number) => ({
  host: {
    hostId: "host-a",
    instanceId: "instance-a",
    lastSeenAt: "2026-09-11T00:00:00.000Z",
    participantIds: Array.from({ length: count }, (_, i) => `agent-${i}`),
    state: "online",
  },
  serverTime: "2026-09-11T00:00:00.000Z",
  sessionExpiresAt: "2026-09-11T01:00:00.000Z",
});

test("legacy heartbeat without execution bindings remains parseable and distinct from empty snapshot", () => {
  const legacy = ComputerHeartbeatResponseSchema.parse(heartbeat(1));
  assert.equal(legacy.executionWorkspaceBindings, undefined);
  const empty = ComputerHeartbeatResponseSchema.parse({
    ...heartbeat(0),
    executionWorkspaceBindings: [],
  });
  assert.deepEqual(empty.executionWorkspaceBindings, []);
});

test("maximum 512-binding heartbeat retains the complete ordered snapshot", () => {
  assert.equal(HOST_EXECUTION_WORKSPACE_BINDING_LIMIT, 512);
  const bindings = Array.from({ length: 512 }, (_, index) => binding(index));
  const response = ComputerHeartbeatResponseSchema.parse({
    ...heartbeat(512),
    executionWorkspaceBindings: bindings,
  });
  assert.deepEqual(response.executionWorkspaceBindings, bindings);
  assert.equal(
    response.executionWorkspaceBindings?.at(-1)?.participantId,
    "agent-511",
  );
});

test("513-binding heartbeat explicitly fails validation instead of returning a truncated snapshot", () => {
  const input = {
    ...heartbeat(513),
    executionWorkspaceBindings: Array.from({ length: 513 }, (_, index) =>
      binding(index),
    ),
  };
  const result = ComputerHeartbeatResponseSchema.safeParse(input);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(
      result.error.issues.some(
        (issue) =>
          issue.code === "too_big" &&
          issue.path[0] === "executionWorkspaceBindings",
      ),
    );
  }
  assert.equal(input.executionWorkspaceBindings.length, 513);
});
