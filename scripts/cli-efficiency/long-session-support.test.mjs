import assert from "node:assert/strict";
import test from "node:test";
import {
  checkLongSessionBudget,
  verifyLongSnapshot,
} from "./long-session-support.mjs";
import { createHash } from "node:crypto";

test("long budget includes startup and recovery cost, but never stops merely for a per-turn ratio", () => {
  const limits = { maxInput: 1000, maxMs: 100, startedAt: 0, now: 1 };
  assert.doesNotThrow(() => checkLongSessionBudget({ rounds: [] }, limits));
  const arm = { rounds: [{ metrics: { input: 900, generations: 6 } }] };
  assert.doesNotThrow(() => checkLongSessionBudget(arm, limits));
  arm.rounds.push({ metrics: { input: 100, generations: 1 } });
  assert.throws(() => checkLongSessionBudget(arm, limits), /RESOURCE_LIMIT/);
  assert.throws(
    () => checkLongSessionBudget({ rounds: [] }, { ...limits, now: 100 }),
    /RESOURCE_LIMIT/,
  );
  assert.throws(
    () => checkLongSessionBudget({ rounds: [{}] }, limits),
    /Missing observed input/,
  );
});

test("snapshot identity rejects changed, missing and extra source files before a paid arm", () => {
  const snapshot = { "scripts/a.mjs": Buffer.from("fixed") };
  const hashes = {
    "scripts/a.mjs": createHash("sha256").update("fixed").digest("hex"),
  };
  assert.doesNotThrow(() => verifyLongSnapshot(snapshot, hashes));
  assert.throws(() =>
    verifyLongSnapshot({ "scripts/a.mjs": "edited" }, hashes),
  );
  assert.throws(() => verifyLongSnapshot({}, hashes));
  assert.throws(() => verifyLongSnapshot({ ...snapshot, extra: "x" }, hashes));
});
