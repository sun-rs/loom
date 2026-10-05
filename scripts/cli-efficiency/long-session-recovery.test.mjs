import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { recoverFailedProductRound } from "./long-session-recovery.mjs";
function fixture(fn) {
  const directory = mkdtempSync(join(tmpdir(), "loom-cost-recovery-"));
  const db = new DatabaseSync(join(directory, "room.db"));
  db.exec(`CREATE TABLE run_attempts(run_attempt_id TEXT, room_id TEXT, participant_id TEXT, started_at TEXT, finished_at TEXT, instance_runtime_id TEXT, state TEXT);
 CREATE TABLE instance_runtimes(instance_runtime_id TEXT, native_session_id TEXT);
 CREATE TABLE run_attempt_usage(run_attempt_id TEXT,response_id TEXT,input_tokens INTEGER,cached_input_tokens INTEGER,output_tokens INTEGER,reasoning_output_tokens INTEGER,observed_at TEXT);
 CREATE TABLE run_attempt_usage_gaps(run_attempt_id TEXT,kind TEXT);
 INSERT INTO instance_runtimes VALUES ('runtime','native-session');`);
  const add = (id, start, input = 100, room = "room", session = "runtime") => {
    db.prepare("INSERT INTO run_attempts VALUES (?,?,?,?,?,?,?)").run(
      id,
      room,
      "participant",
      start,
      null,
      session,
      "failed",
    );
    if (input !== null)
      db.prepare("INSERT INTO run_attempt_usage VALUES (?,?,?,?,?,?,?)").run(
        id,
        "response",
        input,
        40,
        5,
        0,
        "2026-10-05T01:05:00.000Z",
      );
  };
  try {
    fn({ directory, db, add });
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
const request = (directory, extra = {}) => ({
  stateDirectory: directory,
  roomId: "room",
  participantId: "participant",
  round: {
    round: 2,
    startedAt: "2026-10-05T01:00:00.000Z",
    finishedAt: "2026-10-05T01:04:00.000Z",
    ...extra,
  },
});
test("failed product recovers all attempts, late usage and unique session without claiming completeness", () =>
  fixture(({ directory, db, add }) => {
    add("prior", "2026-10-05T00:59:00.000Z", 900);
    add("one", "2026-10-05T01:01:00.000Z");
    add("two", "2026-10-05T01:02:00.000Z", 150);
    add("outside", "2026-10-05T01:03:00.000Z", 900, "other");
    add("future", "2026-10-05T01:06:00.000Z", 900);
    db.prepare("INSERT INTO run_attempt_usage_gaps VALUES (?,?)").run(
      "two",
      "parse_error",
    );
    const r = recoverFailedProductRound(request(directory));
    assert.equal(r.metrics.input, 250);
    assert.equal(r.metrics.cached, 80);
    assert.equal(r.metrics.uncached, 170);
    assert.equal(r.metrics.output, 10);
    assert.equal(r.metrics.generations, 2);
    assert.equal(r.sessionId, "native-session");
    assert.equal(r.metrics.productUsage.completeness, "incomplete");
    assert.ok(r.metrics.productUsage.gaps.length >= 2);
    assert.deepEqual(r.usageRecoveryEvidence.runAttemptIds, ["one", "two"]);
    assert.equal(r.longStageSucceeded, undefined);
  }));
test("zero reported rows remain missing; unreported attempt stays visible", () =>
  fixture(({ directory, add }) => {
    add("one", "2026-10-05T01:01:00.000Z", null);
    const r = recoverFailedProductRound(request(directory));
    assert.equal(r.metrics.input, undefined);
    assert.equal(r.metrics.generations, undefined);
    assert.deepEqual(r.usageRecoveryEvidence.unreportedRunAttemptIds, ["one"]);
  }));
test("existing metrics are not overwritten or double counted", () =>
  fixture(({ directory, add }) => {
    add("one", "2026-10-05T01:01:00.000Z");
    const metrics = { input: 17 };
    const r = recoverFailedProductRound(request(directory, { metrics }));
    assert.equal(r.metrics, undefined);
    assert.equal(metrics.input, 17);
  }));
test("mixed native sessions retain cost but never invent continuity", () =>
  fixture(({ directory, db, add }) => {
    db.prepare("INSERT INTO instance_runtimes VALUES (?,?)").run(
      "second",
      "another-session",
    );
    add("one", "2026-10-05T01:01:00.000Z");
    add("two", "2026-10-05T01:02:00.000Z", 100, "room", "second");
    const r = recoverFailedProductRound(request(directory));
    assert.equal(r.metrics.input, 200);
    assert.equal(r.sessionId, undefined);
    assert.equal(r.usageRecoveryEvidence.nativeSessionIds.length, 2);
  }));
test("missing scope or database returns missing evidence without creating a database", () => {
  const r = recoverFailedProductRound(request("/nonexistent-loom-test"));
  assert.equal(r.metrics, undefined);
  assert.match(r.usageRecoveryError, /./);
});
