import assert from "node:assert/strict";
import test from "node:test";

import type { RuntimeTrajectoryRecord } from "@rah-os/protocol";

import {
  MAX_AGENT_DIAGNOSTIC_BYTES,
  renderAgentActivityDiagnostics,
} from "../src/agent-activity-diagnostics.ts";

const activity: RuntimeTrajectoryRecord = {
  activityId: "activity-1",
  entry: {
    kind: "tool_start",
    producerFactId: "tool-1",
    toolInput: '{"apiKey":"must-not-leak"}',
    toolName: "room.snapshot",
  },
  observedAt: "2026-08-29T08:00:00.000Z",
  participantId: "agent-1",
  producerSequence: 1,
  recordedAt: "2026-08-29T08:00:00.100Z",
  roomId: "room-1",
  runAttemptId: "run-1",
  runtimeRunId: "runtime-run-1",
  serverSequence: 1,
};

test("Agent diagnostics exports a current metadata snapshot without trajectory records", () => {
  const output = renderAgentActivityDiagnostics(
    {
      agentId: "agent-definition-1",
      displayName: "Alice",
      handle: "alice",
      participantId: "agent-1",
    },
    [activity],
  );

  assert.match(output, /agentId: agent-definition-1/u);
  assert.match(output, /activityKind: tool_start/u);
  assert.match(output, /lastActivityAtUtc: 2026-08-29T08:00:00.000Z/u);
  assert.doesNotMatch(
    output,
    /must-not-leak|apiKey|toolInput|room.snapshot|run-1|activityId=/u,
  );
});

test("diagnostic snapshot stays constant size when history grows", () => {
  const activities = Array.from({ length: 300 }, (_, index) => ({
    ...activity,
    activityId: `activity-${index}-${"x".repeat(1_024)}`,
    producerSequence: index + 1,
    serverSequence: index + 1,
  }));
  const output = renderAgentActivityDiagnostics(
    {
      agentId: "agent-definition-1",
      displayName: "Alice",
      handle: "alice",
      participantId: "agent-1",
    },
    activities,
  );

  assert.ok(output.split("\n").length <= 16);
  assert.ok(
    new TextEncoder().encode(output).length <= MAX_AGENT_DIAGNOSTIC_BYTES,
  );
  assert.doesNotMatch(output, /activity-50-/u);
});
