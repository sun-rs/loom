import assert from "node:assert/strict";
import test from "node:test";
import type { RuntimeTrajectoryRecord } from "@rah-os/protocol";
import { mergeTrajectoryWindow } from "../src/agent-trajectory-window.ts";

const row = (sequence: number): RuntimeTrajectoryRecord => ({
  activityId: `a${sequence}`,
  observedAt: "2026-08-30T00:00:00.000Z",
  recordedAt: "2026-08-30T00:00:00.000Z",
  participantId: "a",
  roomId: "r",
  runAttemptId: "run",
  runtimeRunId: "runtime",
  producerSequence: sequence,
  serverSequence: sequence,
  entry: { kind: "text", text: String(sequence) },
});
test("paging older than 500 entries reveals the requested older page instead of silently discarding it", () => {
  const existing = Array.from({ length: 500 }, (_, i) => row(i + 51));
  const older = Array.from({ length: 50 }, (_, i) => row(i + 1));
  const merged = mergeTrajectoryWindow(existing, older);
  assert.equal(merged.length, 500);
  assert.equal(merged[0]?.serverSequence, 1);
  assert.equal(merged.at(-1)?.serverSequence, 500);
  assert.equal(mergeTrajectoryWindow(merged, older).length, 500);
});
