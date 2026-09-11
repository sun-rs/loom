import assert from "node:assert/strict";
import test from "node:test";
import { workerServerFailureError } from "../src/worker-cli-error.ts";
// Raft SEA 1.0.18 main.js:730455-730460.
test("task status update exposes UPDATE_FAILED for non-5xx without losing diagnosis", () => {
  const error = workerServerFailureError(
    {
      error: {
        code: "forbidden",
        message: "Human approval required",
        next_action: "Ask the Human to approve",
      },
    },
    403,
    "READ_FAILED",
    "/v1/worker/tasks/update-status",
  );
  assert.equal(error.code, "UPDATE_FAILED");
  assert.match(error.message, /Human approval required/);
  assert.equal(error.suggestedNextAction, "Ask the Human to approve");
});
test("status update mapping preserves 5xx and unrelated Task operation errors", () => {
  assert.equal(
    workerServerFailureError(
      { error: { code: "internal_error" } },
      500,
      "READ_FAILED",
      "/v1/worker/tasks/update-status",
    ).code,
    "SERVER_5XX",
  );
  assert.equal(
    workerServerFailureError(
      { error: { code: "forbidden" } },
      403,
      "READ_FAILED",
      "/v1/worker/tasks/claim",
    ).code,
    "forbidden",
  );
});
