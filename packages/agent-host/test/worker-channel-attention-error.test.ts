import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runWorkerCliCommand } from "../src/index.ts";
import { workerServerFailureError } from "../src/worker-cli-error.ts";

// Raft SEA 1.0.18 main.js:675452-675456 uses action-specific codes for non-5xx.
test("mute failures carry operation code while preserving backend diagnosis and next action", () => {
  for (const [action, code] of [
    ["mute", "MUTE_FAILED"],
    ["unmute", "UNMUTE_FAILED"],
  ] as const) {
    const error = workerServerFailureError(
      {
        error: {
          code: "forbidden",
          message: "membership required",
          next_action: "Join the Channel",
        },
      },
      403,
      "READ_FAILED",
      `/v1/worker/channels/${action}`,
    );
    assert.equal(error.code, code);
    assert.match(error.message, /membership required/);
    assert.equal(error.suggestedNextAction, "Join the Channel");
  }
});
test("mute route mapping leaves 5xx and unrelated operation mappings unchanged", () => {
  assert.equal(
    workerServerFailureError(
      { error: { code: "internal_error" } },
      500,
      "READ_FAILED",
      "/v1/worker/channels/mute",
    ).code,
    "SERVER_5XX",
  );
  assert.equal(
    workerServerFailureError(
      {},
      403,
      "READ_FAILED",
      "/v1/worker/messages/history",
    ).code,
    "READ_FAILED",
  );
});
test("CLI passes mute and unmute request path to error rendering with optional current Room target", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rah-mute-error-"));
  const token = join(dir, "token");
  writeFileSync(token, "fixture-token", { mode: 0o600 });
  try {
    for (const action of ["mute", "unmute"]) {
      let stderr = "",
        stdout = "",
        calls = 0;
      const code = await runWorkerCliCommand(["worker", `channel-${action}`], {
        env: {
          RAH_ACTIVATION_ID: "activation-1",
          RAH_WORKER_API_URL: "http://127.0.0.1:43123",
          RAH_WORKER_SESSION_FILE: token,
        },
        fetch: async () => {
          calls++;
          return new Response(
            JSON.stringify({
              error: { code: "forbidden", message: "membership required" },
            }),
            { status: 403 },
          );
        },
        stdout: { write: (t) => (stdout += t) },
        stderr: { write: (t) => (stderr += t) },
      });
      assert.equal(code, 1);
      assert.equal(calls, 1);
      assert.equal(stdout, "");
      assert.match(stderr, new RegExp(`${action.toUpperCase()}_FAILED`));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
