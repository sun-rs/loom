import assert from "node:assert/strict";
import test from "node:test";

import { realCliGateProfile } from "./real-cli-gate-profile.ts";

test("real CLI gate profiles pin the user-approved non-Ultra models", () => {
  const codex = realCliGateProfile("codex", {
    model: "gpt-5.6-sol",
    reasoning: "low",
  });
  assert.deepEqual(codex.args("/tmp/work", "gate"), [
    "exec",
    "--ephemeral",
    "--ignore-rules",
    "--ignore-user-config",
    "--skip-git-repo-check",
    "--model",
    "gpt-5.6-sol",
    "--config",
    "model_reasoning_effort=low",
    "--sandbox",
    "danger-full-access",
    "--cd",
    "/tmp/work",
    "gate",
  ]);
  assert.deepEqual(
    realCliGateProfile("opencode", {
      model: "deepseek/deepseek-v4-flash",
      reasoning: "max",
    }).args("/tmp/work", "gate"),
    [
      "run",
      "--auto",
      "--pure",
      "--dir",
      "/tmp/work",
      "--model",
      "deepseek/deepseek-v4-flash",
      "--variant",
      "max",
      "gate",
    ],
  );
  assert.deepEqual(
    realCliGateProfile("kimi", { model: "kimi-code/k3" }).args(
      "/tmp/work",
      "gate",
    ),
    ["--output-format", "text", "--model", "kimi-code/k3", "--prompt", "gate"],
  );
});

test("real CLI gate profiles categorically reject Ultra", () => {
  assert.throws(
    () =>
      realCliGateProfile("codex", {
        model: "gpt-5.6-sol",
        reasoning: "ultra",
      }),
    /Ultra is forbidden/u,
  );
});
