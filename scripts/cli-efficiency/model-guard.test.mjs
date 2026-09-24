import test from "node:test";
import assert from "node:assert/strict";
import { assertAuthorizedRequest, listenPlan } from "./model-guard.mjs";
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
test("warm --listen unix:// is fenced by a proxy on the driver's socket path", () => {
  assert.equal(listenPlan(["app-server", "--config", "x"]), null);
  assert.deepEqual(
    listenPlan([
      "app-server",
      "-c",
      "a=1",
      "--listen",
      "unix:///s/d/app-server.sock",
    ]),
    {
      args: ["app-server", "-c", "a=1", "--listen", "unix:///s/d/u.sock"],
      listenPath: "/s/d/app-server.sock",
      upstreamPath: "/s/d/u.sock",
    },
  );
  for (const bad of [
    ["app-server", "--listen", "ws://127.0.0.1:1"],
    ["app-server", "--listen=unix:///s/a.sock"],
    ["app-server", "--listen"],
  ])
    assert.throws(() => listenPlan(bad), /listen/);
});
test("stdio listen (the per-turn Codex driver) passes through without a proxy", async () => {
  const { listenPlan } = await import("./model-guard.mjs");
  assert.equal(listenPlan(["app-server", "--listen", "stdio://"]), null);
  assert.equal(listenPlan(["app-server"]), null);
  assert.throws(() =>
    listenPlan(["app-server", "--listen", "ws://127.0.0.1:1"]),
  );
});
