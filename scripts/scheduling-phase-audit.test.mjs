import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditDatabase, summarizeRun } from "./scheduling-phase-audit.mjs";

const run = {
  runAttemptId: "run-1",
  activationId: "activation-1",
  createdAt: "2026-09-21T00:00:00.000Z",
  startedAt: "2026-09-21T00:00:01.000Z",
  finishedAt: "2026-09-21T00:00:12.000Z",
  state: "exited",
};
test("turn/init markers never masquerade as model requests or usage", () => {
  const result = summarizeRun(
    run,
    [
      {
        at: "2026-09-21T00:00:02.000Z",
        kind: "status",
        detailKind: "model_request_started",
      },
      { at: "2026-09-21T00:00:03.000Z", kind: "tool_start" },
      { at: "2026-09-21T00:00:06.000Z", kind: "tool_start" },
    ],
    ["2026-09-21T00:00:09.000Z"],
  );
  assert.equal(result.modelRequestsBeforeReply, null);
  assert.equal(result.firstRequestInputTokens, null);
  assert.equal(result.startMarkerCount, 1);
  assert.equal(result.firstToolAfterRunMs, 2000);
  assert.equal(result.firstAttributedPostAfterRunMs, 8000);
  assert.equal(result.postToFinishMs, 3000);
});
test("retry age is not queue time and absent reply is not zero latency", () => {
  const result = summarizeRun(
    { ...run, startedAt: "2026-09-21T00:00:11.000Z" },
    [],
    [],
  );
  assert.equal(result.activationAgeAtRunStartMs, 11000);
  assert.equal(result.firstAttributedPostAfterRunMs, null);
  assert.equal(result.postToFinishMs, null);
  assert.equal(result.firstToolAfterRunMs, null);
});
test("only events inside this attempt interval count; incomplete run stays incomplete", () => {
  const result = summarizeRun({ ...run, finishedAt: null }, [], []);
  assert.equal(result.runDurationMs, null);
  const bounded = summarizeRun(
    run,
    [{ at: "2026-09-21T00:00:00.000Z", kind: "tool_start" }],
    ["2026-09-21T00:00:00.000Z", "2026-09-21T00:00:20.000Z"],
  );
  assert.equal(bounded.firstAttributedPostAfterRunMs, null);
  assert.equal(bounded.firstToolAfterRunMs, null);
});

test("database audit is read-only and never exports message or tool content", () => {
  const dir = mkdtempSync(join(tmpdir(), "rah-phase-audit-"));
  const path = join(dir, "room.db");
  try {
    const db = new DatabaseSync(path);
    db.exec(`CREATE TABLE activations(activation_id, created_at, from_seq, to_seq);
      CREATE TABLE run_attempts(run_attempt_id, activation_id, room_id, participant_id, attempt_number, state, started_at, finished_at);
      CREATE TABLE run_trajectory_entries(run_attempt_id, observed_at, entry_json);
      CREATE TABLE room_events(type, actor_id, payload_json, created_at);
      INSERT INTO activations VALUES('activation-1', '2026-09-21T00:00:00.000Z', 1, 2);
      INSERT INTO run_attempts VALUES('run-1', 'activation-1', 'room-1', 'agent-1', 1, 'exited', '2026-09-21T00:00:01.000Z', '2026-09-21T00:00:12.000Z');
      INSERT INTO room_events VALUES('message.posted', 'agent-1', '{"activationId":"activation-1","body":"PRIVATE"}', '2026-09-21T00:00:09.000Z');
      INSERT INTO run_trajectory_entries VALUES('run-1', '2026-09-21T00:00:03.000Z', '{"kind":"tool_start","text":"SECRET"}');`);
    db.close();
    const before = readFileSync(path);
    const result = auditDatabase(path);
    assert.equal(result.runs[0].firstAttributedPostAfterRunMs, 8000);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|SECRET/);
    assert.deepEqual(readFileSync(path), before);
    assert.throws(() => auditDatabase(path, 1001), /limit/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
