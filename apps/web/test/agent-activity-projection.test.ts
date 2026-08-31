import assert from "node:assert/strict";
import test from "node:test";

import type { RuntimeTrajectoryRecord } from "@rah-os/protocol";

import {
  agentTrajectoryTone,
  agentTrajectoryPulses,
  projectAgentActivityRows,
} from "../src/agent-activity-projection.ts";

test("Raft trajectory dots distinguish output, action, system and compaction results", () => {
  for (const [entry, tone] of [
    [{ kind: "text", text: "output" }, "output"],
    [{ kind: "slock_action", title: "Claimed", text: "#1" }, "action"],
    [{ kind: "system", title: "Notice", text: "detail" }, "warning"],
    [{ kind: "compaction_started" }, "warning"],
    [{ kind: "compaction_finished" }, "success"],
    [{ kind: "tool_start", toolName: "read" }, "active"],
    [{ kind: "thinking", text: "summary" }, "active"],
    [{ kind: "status", activity: "online" }, "success"],
    [{ kind: "status", activity: "working" }, "active"],
    [{ kind: "status", activity: "thinking" }, "active"],
    [{ kind: "status", activity: "error" }, "error"],
    [{ kind: "status", activity: "offline" }, "neutral"],
  ] satisfies [RuntimeTrajectoryRecord["entry"], string][]) {
    assert.equal(
      agentTrajectoryTone(record(1, entry)),
      tone,
      JSON.stringify(entry),
    );
    assert.equal(
      agentTrajectoryPulses(record(1, entry)),
      entry.kind === "thinking" ||
        (entry.kind === "status" &&
          (entry.activity === "thinking" || entry.activity === "working")),
      JSON.stringify(entry),
    );
  }
});

function record(
  serverSequence: number,
  entry: RuntimeTrajectoryRecord["entry"],
): RuntimeTrajectoryRecord {
  return {
    activityId: `activity-${serverSequence}`,
    entry,
    observedAt: `2026-08-29T10:00:${String(serverSequence).padStart(2, "0")}.000Z`,
    participantId: "agent-1",
    producerSequence: serverSequence,
    recordedAt: `2026-08-29T10:00:${String(serverSequence).padStart(2, "0")}.100Z`,
    roomId: "room-1",
    runAttemptId: "run-1",
    runtimeRunId: "runtime-run-1",
    serverSequence,
  };
}

test("Agent activity projection coalesces Provider text chunks into one visible output row", () => {
  const projected = projectAgentActivityRows([
    record(1, { kind: "text", producerFactId: "part-1", text: "package" }),
    record(2, { kind: "text", producerFactId: "part-1", text: ".json" }),
    record(3, { kind: "text", producerFactId: "part-1", text: " is rah-os" }),
  ]);

  assert.equal(projected.length, 1);
  assert.deepEqual(projected[0]?.entry, {
    kind: "text",
    producerFactId: "part-1",
    text: "package.json is rah-os",
  });
  assert.equal(projected[0]?.serverSequence, 3);
});

test("Agent activity projection never merges text across a tool or RunAttempt boundary", () => {
  const projected = projectAgentActivityRows([
    record(1, { kind: "text", text: "before" }),
    record(2, { kind: "tool_start", toolName: "read" }),
    record(3, { kind: "text", text: "after" }),
    {
      ...record(4, { kind: "text", text: "next run" }),
      runAttemptId: "run-2",
      runtimeRunId: "runtime-run-2",
    },
  ]);

  assert.equal(projected.length, 4);
  assert.equal(projected[0]?.entry.kind, "text");
  assert.equal(projected[1]?.entry.kind, "tool_start");
  assert.equal(projected[2]?.entry.kind, "text");
  assert.equal(projected[3]?.entry.kind, "text");
});
