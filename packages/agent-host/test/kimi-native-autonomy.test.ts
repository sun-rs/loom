import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertKimiResumeSafe,
  assertKimiSafeMode,
  foldKimiMainWire,
  inspectKimiSession,
  isKimiGoalMutationTool,
  KIMI_NATIVE_GOAL_ACTIVE,
  KIMI_UNSAFE_PERMISSION_MODE,
} from "../src/kimi-native-autonomy.js";

/**
 * Codex review of batches 3-4 P1-1. kimi-code 0.39.1 (agent-core-v2, the
 * default `kimi acp` server) persists each agent's durable events in
 * `<sessionDir>/agents/main/wire.jsonl`, located through
 * `<KIMI_CODE_HOME>/session_index.jsonl` ({sessionId, sessionDir, workDir}).
 * The goal reducer: `goal.create` -> active, `goal.update.status` sets the
 * status, `goal.clear` / `forked` -> no goal; `permission.set_mode` carries
 * the persisted permission mode (default `manual`).
 */
const line = (value: unknown) => JSON.stringify(value);

test("fold: goal lifecycle and persisted permission mode follow the native reducer", () => {
  assert.deepEqual(foldKimiMainWire(""), {
    goal: null,
    permissionMode: "manual",
  });
  const created = [
    line({ type: "metadata", protocol_version: "1.5" }),
    line({
      type: "goal.create",
      agentId: "main",
      goalId: "g1",
      objective: "x",
    }),
  ];
  assert.deepEqual(foldKimiMainWire(created.join("\n")).goal, {
    goalId: "g1",
    status: "active",
  });
  const paused = [
    ...created,
    line({ type: "goal.update", agentId: "main", status: "paused" }),
    line({ type: "goal.update", agentId: "main", turnsUsed: 3 }),
  ];
  assert.equal(foldKimiMainWire(paused.join("\n")).goal?.status, "paused");
  const resumed = [
    ...paused,
    line({ type: "goal.update", agentId: "main", status: "active" }),
  ];
  assert.equal(foldKimiMainWire(resumed.join("\n")).goal?.status, "active");
  assert.equal(
    foldKimiMainWire(
      [...resumed, line({ type: "goal.clear", agentId: "main" })].join("\n"),
    ).goal,
    null,
  );
  assert.equal(
    foldKimiMainWire(
      [...resumed, line({ type: "forked", agentId: "main" })].join("\n"),
    ).goal,
    null,
  );
  const auto = [
    line({ type: "permission.set_mode", agentId: "main", mode: "auto" }),
  ];
  assert.equal(foldKimiMainWire(auto.join("\n")).permissionMode, "auto");
  // A torn last line (a concurrent append) is skipped, never guessed.
  assert.equal(
    foldKimiMainWire(`${created.join("\n")}\n{"type":"goal.cl`).goal?.status,
    "active",
  );
});

test("inspect: the resumed session's main wire is found through the Kimi session index", () => {
  const home = mkdtempSync(join(tmpdir(), "loom-kimi-home-"));
  try {
    assert.deepEqual(
      inspectKimiSession("session_a", { KIMI_CODE_HOME: home }),
      {
        state: "unavailable",
        reason: "session index unreadable",
      },
    );
    const sessionDir = join(home, "sessions", "wd_x", "session_a");
    writeFileSync(
      join(home, "session_index.jsonl"),
      `${line({ sessionId: "session_other", sessionDir: join(home, "nope"), workDir: "/w" })}\n${line({ sessionId: "session_a", sessionDir, workDir: "/w" })}\n`,
    );
    assert.deepEqual(
      inspectKimiSession("session_missing", { KIMI_CODE_HOME: home }),
      { state: "unavailable", reason: "session not in the Kimi session index" },
    );
    assert.deepEqual(
      inspectKimiSession("session_a", { KIMI_CODE_HOME: home }),
      {
        state: "unavailable",
        reason: "main agent wire unreadable",
      },
    );
    mkdirSync(join(sessionDir, "agents", "main"), { recursive: true });
    writeFileSync(
      join(sessionDir, "agents", "main", "wire.jsonl"),
      `${line({ type: "goal.create", agentId: "main", goalId: "g1", objective: "x" })}\n`,
    );
    assert.deepEqual(
      inspectKimiSession("session_a", { KIMI_CODE_HOME: home }),
      {
        state: "read",
        goal: { goalId: "g1", status: "active" },
        permissionMode: "manual",
      },
    );
  } finally {
    rmSync(home, { force: true, recursive: true });
  }
});

test("an active native goal refuses the resume with a diagnosable code; no/paused/blocked goals and unreadable state pass", () => {
  assert.throws(
    () =>
      assertKimiResumeSafe({
        state: "read",
        goal: { goalId: "g1", status: "active" },
        permissionMode: "manual",
      }),
    (error: Error) =>
      error.message.startsWith(`${KIMI_NATIVE_GOAL_ACTIVE}:`) &&
      /g1/u.test(error.message),
  );
  for (const goal of [
    null,
    { goalId: "g1", status: "paused" },
    { goalId: "g1", status: "blocked" },
  ])
    assert.doesNotThrow(() =>
      assertKimiResumeSafe({ state: "read", goal, permissionMode: "auto" }),
    );
  assert.doesNotThrow(() =>
    assertKimiResumeSafe({ state: "unavailable", reason: "x" }),
  );
});

test("only a confirmed `default` ACP mode (manual permission) is safe", () => {
  assert.doesNotThrow(() => assertKimiSafeMode("default"));
  for (const effective of ["auto", "yolo", "plan", undefined])
    assert.throws(
      () => assertKimiSafeMode(effective),
      (error: Error) =>
        error.message.startsWith(`${KIMI_UNSAFE_PERMISSION_MODE}:`),
    );
});

test("goal mutation tools are the ones that create or resume autonomous goal turns", () => {
  for (const title of ["CreateGoal", "UpdateGoal", "SetGoalBudget"])
    assert.ok(isKimiGoalMutationTool(title), title);
  for (const title of ["GetGoal", "Bash", "createGoal", undefined])
    assert.ok(!isKimiGoalMutationTool(title), String(title));
});
