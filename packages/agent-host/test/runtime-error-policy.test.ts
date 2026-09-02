import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyRuntimeFailure,
  runtimeErrorRetryDelay,
} from "../src/runtime-error-policy.ts";

test("Raft runtime errors separate action-required, sticky, and recoverable branches", () => {
  assert.deepEqual(
    classifyRuntimeFailure("Authentication failed: please log in first"),
    {
      actionRequired: true,
      errorClass: "AuthError",
      message: "Authentication failed: please log in first",
      retryDisposition: "action_required",
      sticky: true,
    },
  );
  assert.equal(
    classifyRuntimeFailure("This model is not supported").retryDisposition,
    "sticky_terminal",
  );
  assert.equal(
    classifyRuntimeFailure("HTTP 503 provider unavailable").retryDisposition,
    "recoverable",
  );
});

test("Raft runtime retry delay is capped exponential backoff with positive-only jitter", () => {
  assert.equal(
    runtimeErrorRetryDelay(10_000, 1, 0.1, () => 0),
    10_000,
  );
  assert.equal(
    runtimeErrorRetryDelay(10_000, 1, 0.1, () => 1),
    11_000,
  );
  assert.equal(
    runtimeErrorRetryDelay(10_000, 2, 0.1, () => 1),
    22_000,
  );
  assert.equal(
    runtimeErrorRetryDelay(10_000, 99, 0.1, () => 1),
    5 * 60_000,
  );
});
