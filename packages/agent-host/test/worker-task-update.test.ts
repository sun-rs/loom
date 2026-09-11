import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runWorkerCliCommand } from "../src/index.ts";

function fixture(response: unknown) {
  const directory = mkdtempSync(join(tmpdir(), "rah-task-update-"));
  const token = join(directory, "token");
  writeFileSync(token, "fixture-token", { mode: 0o600 });
  let stdout = "",
    stderr = "";
  const requests: { url: string; body: unknown }[] = [];
  return {
    requests,
    stdout: () => stdout,
    stderr: () => stderr,
    close: () => rmSync(directory, { recursive: true, force: true }),
    runtime: {
      env: {
        RAH_ACTIVATION_ID: "activation-1",
        RAH_WORKER_API_URL: "http://127.0.0.1:43123",
        RAH_WORKER_SESSION_FILE: token,
      },
      fetch: async (url: string | URL | Request, options?: RequestInit) => {
        requests.push({
          url: String(url),
          body: JSON.parse(String(options?.body)),
        });
        return new Response(JSON.stringify(response), { status: 200 });
      },
      stdout: { write: (text: string) => (stdout += text) },
      stderr: { write: (text: string) => (stderr += text) },
    },
  };
}
// Raft SEA 1.0.18 main.js730404-730474: one status setter, one request, no invented summary.
test("five-status CLI sends the requested state once and prints canonical result", async () => {
  for (const [status, state] of [
    ["todo", "todo"],
    ["in_progress", "in_progress"],
    ["in_review", "submitted"],
    ["done", "completed"],
    ["closed", "cancelled"],
  ]) {
    const f = fixture({ task: { taskNumber: 7, state } });
    try {
      assert.equal(
        await runWorkerCliCommand(
          [
            "worker",
            "task-update",
            "--target",
            "#work",
            "--number",
            "7",
            "--status",
            status!,
          ],
          f.runtime,
        ),
        0,
        f.stderr(),
      );
      assert.equal(f.requests.length, 1);
      assert.match(f.requests[0]!.url, /\/tasks\/update-status$/);
      assert.deepEqual(f.requests[0]!.body, {
        channel: "#work",
        taskNumber: 7,
        status,
      });
      assert.match(f.stdout(), new RegExp(`#7 moved to ${status}\\.`));
    } finally {
      f.close();
    }
  }
});
test("task update preserves supplied summary and legacy ID without inventing protocol parameters", async () => {
  const f = fixture({ task: { taskNumber: 7, state: "submitted" } });
  try {
    assert.equal(
      await runWorkerCliCommand(
        [
          "worker",
          "task-update",
          "--task-id",
          "task-7",
          "--status",
          "in_review",
          "--summary",
          "Verified result",
        ],
        f.runtime,
      ),
      0,
      f.stderr(),
    );
    assert.deepEqual(f.requests[0]!.body, {
      taskId: "task-7",
      status: "in_review",
      summary: "Verified result",
    });
  } finally {
    f.close();
  }
});
test("task update freshness hold is an unapplied result rather than a successful status line", async () => {
  const f = fixture({
    state: "held",
    newMessageCount: 0,
    shownMessageCount: 0,
    newerTaskEventCount: 1,
    newerMessages: [],
  });
  try {
    assert.equal(
      await runWorkerCliCommand(
        ["worker", "task-update", "--task-id", "task-7", "--status", "done"],
        f.runtime,
      ),
      0,
      f.stderr(),
    );
    assert.match(f.stdout(), /Your task status update was not applied/);
    assert.doesNotMatch(f.stdout(), /moved to/);
  } finally {
    f.close();
  }
});
test("unknown status and blank summary fail before making a request", async () => {
  for (const flags of [
    ["--status", "blocked"],
    ["--status", "in_review", "--summary", " "],
  ]) {
    const f = fixture({});
    try {
      assert.equal(
        await runWorkerCliCommand(
          ["worker", "task-update", "--task-id", "task-7", ...flags],
          f.runtime,
        ),
        1,
      );
      assert.equal(f.requests.length, 0);
    } finally {
      f.close();
    }
  }
});
