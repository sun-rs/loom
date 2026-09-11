import assert from "node:assert/strict";
import test from "node:test";
import {
  providerLaunchArguments,
  validateProviderLaunchArgs,
} from "../src/provider-launch-arguments.js";

test("all four launchers preserve argv boundaries and isolate provider settings", () => {
  for (const runtimeId of ["codex", "claude", "kimi", "opencode"]) {
    const args = providerLaunchArguments(runtimeId, {
      RAH_PROVIDER_LAUNCH_ARGS_JSON: JSON.stringify({
        runtimeId,
        additionalArgs: ["--example", "a path; not a shell command"],
      }),
    });
    assert.deepEqual(args.slice(-2), [
      "--example",
      "a path; not a shell command",
    ]);
    assert.equal(
      providerLaunchArguments(runtimeId, {
        RAH_PROVIDER_LAUNCH_ARGS_JSON: JSON.stringify({
          runtimeId: "other",
          additionalArgs: ["--example"],
        }),
      }).includes("--example"),
      false,
    );
  }
});
test("managed transport, memory/config and model switches cannot be overridden", () => {
  for (const args of [
    ["--input-format=text"],
    ["-c", "features.memories=true"],
    ["--settings", "{}"],
    ["--model", "other"],
    ["--port", "9999"],
    ["--"],
    ["--help"],
  ])
    assert.throws(() => validateProviderLaunchArgs(args), /managed/);
  assert.throws(
    () => validateProviderLaunchArgs(["--test\n--help"]),
    /Invalid/,
  );
});

test("full override removes an ordinary default and preserves required transport", async () => {
  const { providerLaunchDefaults } =
    await import("../src/provider-launch-arguments.js");
  const overrideArgs = providerLaunchDefaults("opencode").filter(
    (arg) => arg !== "--pure",
  );
  const actual = providerLaunchArguments("opencode", {
    RAH_PROVIDER_LAUNCH_ARGS_JSON: JSON.stringify({
      runtimeId: "opencode",
      overrideArgs,
    }),
  });
  assert.deepEqual(actual, overrideArgs);
  assert.equal(actual.includes("--pure"), false);
  assert.throws(
    () =>
      providerLaunchArguments("opencode", {
        RAH_PROVIDER_LAUNCH_ARGS_JSON: JSON.stringify({
          runtimeId: "opencode",
          overrideArgs: [],
        }),
      }),
    /required|Required/,
  );
});

test("Claude stream-json requires verbose according to the installed CLI", async () => {
  const { providerLaunchDefaults } =
    await import("../src/provider-launch-arguments.js");
  assert.throws(
    () =>
      providerLaunchArguments("claude", {
        RAH_PROVIDER_LAUNCH_ARGS_JSON: JSON.stringify({
          runtimeId: "claude",
          overrideArgs: providerLaunchDefaults("claude").filter(
            (arg) => arg !== "--verbose",
          ),
        }),
      }),
    /verbose/,
  );
});

test("memory policy displayed in settings is the same launch contract consumed by drivers", async () => {
  const { providerLaunchPolicy } =
    await import("../src/provider-launch-arguments.js");
  assert.deepEqual(providerLaunchPolicy("claude").environment, {
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  });
  assert.deepEqual(providerLaunchPolicy("codex").args, [
    "-c",
    "features.memories=false",
    "-c",
    "memories.generate_memories=false",
    "-c",
    "memories.use_memories=false",
  ]);
});
