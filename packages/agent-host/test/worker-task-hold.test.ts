import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runWorkerCliCommand } from "../src/index.ts";

/**
 * Raft holds a Task claim, status update or amendment on stale context the same
 * way it holds a send: the bounded newer context is written to stdout and the
 * command exits 0. RAH used to raise a bare 409 here.
 */
function fixture(response: Record<string, unknown>) {
  const directory = mkdtempSync(join(tmpdir(), "rah-task-hold-"));
  chmodSync(directory, 0o700);
  const tokenPath = join(directory, "token");
  writeFileSync(tokenPath, "worker-secret", { mode: 0o600 });
  let stdout = "";
  let stderr = "";
  return {
    directory,
    runtime: {
      env: {
        RAH_ACTIVATION_ID: "activation-task-hold-1",
        RAH_WORKER_API_URL: "http://127.0.0.1:43123",
        RAH_WORKER_SESSION_FILE: tokenPath,
      },
      fetch: async () =>
        new Response(JSON.stringify(response), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      stderr: { write: (value: string) => (stderr += value) },
      stdout: { write: (value: string) => (stdout += value) },
    },
    stderr: () => stderr,
    stdout: () => stdout,
  };
}

const held = {
  basedOnRoomSeq: 4,
  newMessageCount: 3,
  newerMessages: [
    {
      actorId: "agent-peer",
      aggregateId: "message-9",
      aggregateType: "room",
      payload: { body: "I already started this task" },
      roomSeq: 5,
      type: "message.posted",
    },
  ],
  omittedMessageCount: 2,
  reason: "newer_messages_available",
  seenUpToSeq: 7,
  shownMessageCount: 1,
  state: "held",
};

test("a held task claim renders the newer context on stdout and exits 0", async () => {
  const state = fixture(held);
  try {
    const code = await runWorkerCliCommand(
      ["worker", "task-claim", "--target", "#room", "--number", "3"],
      state.runtime,
    );
    assert.equal(code, 0, "Raft's hold is a rendered result, not a failure");
    const stdout = state.stdout();
    assert.match(
      stdout,
      /Freshness hold: showing latest 1 of 3 newer messages\./,
    );
    assert.match(stdout, /Your task claim was not applied\./);
    assert.match(stdout, /2 earlier same-target messages omitted/);
    assert.match(stdout, /\[5\] agent-peer: I already started this task/);
    assert.match(
      stdout,
      /rerun the task claim command if it is still correct\./,
    );
    assert.equal(state.stderr(), "", "a hold is never an error");
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("a lifecycle command outside Raft's status setter is not held here", async () => {
  const state = fixture(held);
  try {
    // Raft's status setter takes todo/in_progress/in_review/done/closed, and
    // `blocked` is not among them, so unblock is a different command. RAH's
    // lifecycle split is not mapped onto those five statuses yet, so these
    // commands keep their existing behaviour rather than an invented mapping.
    const code = await runWorkerCliCommand(
      ["worker", "task-unblock", "--target", "#room", "--number", "3"],
      state.runtime,
    );
    assert.equal(code, 0);
    assert.doesNotMatch(state.stdout(), /Freshness hold/);
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});

test("an amendment carries its own wording", async () => {
  const state = fixture(held);
  try {
    const code = await runWorkerCliCommand(
      [
        "worker",
        "task-amend",
        "--target",
        "#room",
        "--number",
        "3",
        "--title",
        "new title",
      ],
      state.runtime,
    );
    assert.equal(code, 0);
    assert.match(state.stdout(), /Your task amendment was not applied\./);
    assert.match(
      state.stdout(),
      /rerun the task amend command if it is still correct\./,
    );
  } finally {
    rmSync(state.directory, { force: true, recursive: true });
  }
});
