import assert from "node:assert/strict";
import test from "node:test";

import type { RuntimeTrajectoryRecord } from "@rah-os/protocol";

import {
  MAX_AGENT_DIAGNOSTIC_ACTIVITIES,
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

test("Agent diagnostics export bounded trajectory metadata without Provider content", () => {
  const output = renderAgentActivityDiagnostics(
    {
      agentDefinitionId: "agent-definition-1",
      displayName: "Alice",
      handle: "alice",
      participantId: "agent-1",
    },
    [activity],
  );

  assert.match(output, /Alice \(@alice\)/u);
  assert.match(output, /kind=tool_start/u);
  assert.match(output, /tool="room\.snapshot"/u);
  assert.match(output, /runAttemptId="run-1"/u);
  assert.doesNotMatch(output, /must-not-leak|apiKey|toolInput/u);
});

test("Agent diagnostics export is capped by record count and UTF-8 bytes", () => {
  const activities = Array.from(
    { length: MAX_AGENT_DIAGNOSTIC_ACTIVITIES + 100 },
    (_, index) => ({
      ...activity,
      activityId: `activity-${index}-${"x".repeat(1_024)}`,
      producerSequence: index + 1,
      serverSequence: index + 1,
    }),
  );
  const output = renderAgentActivityDiagnostics(
    {
      agentDefinitionId: "agent-definition-1",
      displayName: "Alice",
      handle: "alice",
      participantId: "agent-1",
    },
    activities,
  );

  assert.match(output, /Activity total: 300/u);
  assert.match(output, /Exported records: 200/u);
  assert.ok(
    new TextEncoder().encode(output).length <= MAX_AGENT_DIAGNOSTIC_BYTES,
  );
  assert.doesNotMatch(output, /activity-50-/u);
});
