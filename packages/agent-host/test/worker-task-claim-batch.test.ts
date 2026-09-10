import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runWorkerCliCommand } from "../src/index.ts";

/**
 * `task-claim --number 1 --number 2` is RAH's only fan-out: upstream takes every
 * number in one request and renders one block with per-Task outcomes, RAH sends
 * one request per Task and each commits on its own. So a refusal on a later
 * Task says nothing about the earlier ones, and hiding them would make the CLI
 * state something the ledger contradicts.
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

const claimed = (taskNumber: number) => ({
  body: {
    deduplicated: false,
    event: { roomSeq: taskNumber, type: "task.claimed" },
    task: {
      sourceMessageId: `message-${taskNumber}`,
      state: "claimed",
      taskNumber,
    },
  },
  status: 200,
});

test("a refused second claim never erases the first, and says what was not attempted", async () => {
  const state = fixture([
    claimed(1),
    {
      body: { code: "conflict", message: "Task is owned by another Agent" },
      status: 409,
    },
  ]);
  try {
    const code = await runWorkerCliCommand(
      [
        "worker",
        "task-claim",
        "--target",
        "#room",
        "--number",
        "1",
        "--number",
        "2",
        "--number",
        "3",
      ],
      state.runtime,
    );
    assert.equal(
      code,
      1,
      "RAH's server refuses per request, so this is an error",
    );
    assert.match(
      state.stdout(),
      /#1 \(msg:message-1\): claimed/,
      "the claim that landed must still be reported",
    );
    assert.match(
      state.stdout(),
      /1 of 3 Tasks in this command were not attempted\./,
      "not attempted is a different fact from failed",
    );
    assert.match(
      state.stderr(),
      /^Error: /mu,
      "the refusal itself is still raised on stderr",
    );
    assert.equal(state.calls(), 2, "the third Task is not attempted");
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("a clean batch reports every claim and nothing about attempts", async () => {
  const state = fixture([claimed(1), claimed(2)]);
  try {
    const code = await runWorkerCliCommand(
      [
        "worker",
        "task-claim",
        "--target",
        "#room",
        "--number",
        "1",
        "--number",
        "2",
      ],
      state.runtime,
    );
    assert.equal(code, 0);
    assert.match(state.stdout(), /Claim results \(2 claimed\)/);
    assert.doesNotMatch(state.stdout(), /not attempted/);
    assert.equal(state.stderr(), "");
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});
