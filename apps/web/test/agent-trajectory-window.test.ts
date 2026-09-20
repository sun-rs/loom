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
test("live activity retains the latest 500 records with overlap deduplicated", () => {
  const existing = Array.from({ length: 500 }, (_, i) => row(i + 51));
  const older = Array.from({ length: 50 }, (_, i) => row(i + 1));
  const merged = mergeTrajectoryWindow(existing, older);
  assert.equal(merged.length, 500);
  assert.equal(merged[0]?.serverSequence, 51);
  assert.equal(merged.at(-1)?.serverSequence, 550);
  assert.equal(mergeTrajectoryWindow(merged, older).length, 500);
});

test("new polling tails extend the initial 50 instead of replacing them", () => {
  const initial = Array.from({ length: 50 }, (_, i) => row(50 - i));
  const incoming = Array.from({ length: 50 }, (_, i) => row(75 - i));
  const merged = mergeTrajectoryWindow(initial, incoming);
  assert.equal(merged.length, 75);
  assert.deepEqual(
    merged.map((entry) => entry.serverSequence),
    Array.from({ length: 75 }, (_, i) => i + 1),
  );
  assert.deepEqual(mergeTrajectoryWindow(merged, incoming), merged);
});
