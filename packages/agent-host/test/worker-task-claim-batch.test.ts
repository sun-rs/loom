import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runWorkerCliCommand } from "../src/index.ts";

/**
 * Raft submits the entire selector list once. Results preserve every success
 * and ordinary failure; freshness hold is one unapplied batch result.
 */
function fixture(responses: Array<{ body: unknown; status: number }>) {
  const directory = mkdtempSync(join(tmpdir(), "rah-claim-batch-"));
  chmodSync(directory, 0o700);
  const tokenPath = join(directory, "token");
  writeFileSync(tokenPath, "worker-secret", { mode: 0o600 });
  let stdout = "";
  let stderr = "";
  let call = 0;
  return {
    directory,
    calls: () => call,
    runtime: {
      env: {
        RAH_ACTIVATION_ID: "activation-batch-1",
        RAH_WORKER_API_URL: "http://127.0.0.1:43123",
        RAH_WORKER_SESSION_FILE: tokenPath,
      },
      fetch: async () => {
        const next = responses[call] ?? responses.at(-1)!;
        call += 1;
        return new Response(JSON.stringify(next.body), {
          headers: { "content-type": "application/json" },
          status: next.status,
        });
      },
      stderr: { write: (value: string) => (stderr += value) },
      stdout: { write: (value: string) => (stdout += value) },
    },
    stderr: () => stderr,
    stdout: () => stdout,
  };
}

const args = [
  "worker",
  "task-claim",
  "--target",
  "#work",
  "--number",
  "1",
  "--number",
  "2",
  "--number",
  "3",
];
const success = (taskNumber: number) => ({
  success: true,
  taskNumber,
  taskId: `task-${taskNumber}`,
  messageId: `message-${taskNumber}`,
  threadId: `thread-${taskNumber}`,
  state: "claimed",
});
test("batch claim makes one request and reports all ordinary conflicts without hiding successes", async () => {
  const state = fixture([
    {
      status: 200,
      body: {
        roomId: "room-1",
        results: [
          success(1),
          { success: false, taskNumber: 2, reason: "already owned" },
          success(3),
        ],
        tasks: [],
        deduplicated: false,
      },
    },
  ]);
  try {
    assert.equal(
      await runWorkerCliCommand(args, state.runtime),
      0,
      state.stderr(),
    );
    assert.equal(state.calls(), 1);
    assert.match(state.stdout(), /2 claimed, 1 failed/);
    assert.match(state.stdout(), /#3.*claimed/);
    assert.match(state.stdout(), /#2: FAILED/);
    assert.doesNotMatch(state.stdout(), /not attempted/);
  } finally {
    rmSync(state.directory, { recursive: true, force: true });
  }
});
test("batch transport failure makes no further requests or invented claims", async () => {
  const state = fixture([
    { status: 503, body: { error: "offline", code: "unavailable" } },
  ]);
  try {
    assert.equal(await runWorkerCliCommand(args, state.runtime), 1);
    assert.equal(state.calls(), 1);
    assert.equal(state.stdout(), "");
  } finally {
    rmSync(state.directory, { recursive: true, force: true });
  }
});
test("batch freshness hold never prints an earlier applied claim", async () => {
  const state = fixture([
    {
      status: 200,
      body: {
        state: "held",
        newerMessages: [],
        newerMessageCount: 0,
        newerTaskEventCount: 1,
      },
    },
  ]);
  try {
    assert.equal(
      await runWorkerCliCommand(args, state.runtime),
      0,
      state.stderr(),
    );
    assert.equal(state.calls(), 1);
    assert.match(state.stdout(), /claim was not applied/);
    assert.doesNotMatch(state.stdout(), /#1.*claimed/);
  } finally {
    rmSync(state.directory, { recursive: true, force: true });
  }
});
