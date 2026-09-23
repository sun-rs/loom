import test from "node:test";
import assert from "node:assert/strict";
import { assertAuthorizedRequest } from "./model-guard.mjs";
test("rejects every unapproved session before forwarding to installed CLI", () => {
  assert.throws(
    () =>
      assertAuthorizedRequest({
        method: "thread/start",
        params: { model: "gpt-5.5", config: { model_reasoning_effort: "low" } },
      }),
    /model/,
  );
  assert.throws(
    () =>
      assertAuthorizedRequest({
        method: "thread/resume",
        params: {
          model: "gpt-5.6-luna",
          config: { model_reasoning_effort: "high" },
        },
      }),
    /effort/,
  );
  assert.throws(
    () => assertAuthorizedRequest({ method: "thread/start", params: {} }),
    /model/,
  );
  assert.doesNotThrow(() =>
    assertAuthorizedRequest({
      method: "thread/start",
      params: {
        model: "gpt-5.6-luna",
        config: { model_reasoning_effort: "low" },
      },
    }),
  );
});
