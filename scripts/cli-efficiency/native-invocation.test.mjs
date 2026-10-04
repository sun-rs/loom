import assert from "node:assert/strict";
import test from "node:test";
import { nativeInvocationArgs } from "./native-invocation.mjs";
const options = {
  model: "approved-fixture",
  effort: "low",
  prompt: "<question>",
  launchArgs: [],
};
test("OpenCode baseline distinguishes the corrected fixture directory policy", async () => {
  const { nativeInvocationPolicy } = await import("./native-invocation.mjs");
  assert.equal(
    nativeInvocationPolicy("opencode").cwdPolicy,
    "spawn-cwd-and-PWD/v1",
  );
});
test("baseline records each provider real native initial and same-session resume argv", () => {
  const codex = nativeInvocationArgs("codex", options);
  assert.equal(codex[0], "exec");
  assert.ok(codex.includes("--json"));
  const claude = nativeInvocationArgs("claude", options);
  assert.equal(claude[0], "-p");
  assert.ok(claude.includes("--model"));
  assert.ok(claude.includes("--effort"));
  const kimi = nativeInvocationArgs("kimi", options);
  assert.deepEqual(kimi, [
    "-p",
    "<question>",
    "--output-format",
    "stream-json",
    "-m",
    "approved-fixture",
  ]);
  const opencode = nativeInvocationArgs("opencode", options);
  assert.equal(opencode[0], "run");
  assert.ok(opencode.includes("--pure"));
  assert.ok(opencode.includes("--variant"));
  assert.ok(opencode.includes("--title"));
  for (const provider of ["codex", "claude", "kimi", "opencode"]) {
    const args = nativeInvocationArgs(provider, {
      ...options,
      sessionId: "same-session",
    });
    const flag = {
      codex: "resume",
      claude: "--resume",
      kimi: "--session",
      opencode: "--session",
    }[provider];
    assert.equal(args[args.indexOf(flag) + 1], "same-session");
  }
  assert.throws(() => nativeInvocationArgs("unknown", options));
});

test("Claude baseline records connection resolver policy without connection values", async () => {
  const { nativeInvocationPolicy } = await import("./native-invocation.mjs");
  const { providerLaunchSwitches } =
    await import("../../packages/agent-host/src/provider-launch-arguments.js");
  assert.deepEqual(nativeInvocationPolicy("claude"), {
    ...providerLaunchSwitches("claude"),
    connectionPolicy: "claude-connection-environment/v1",
  });
  assert.deepEqual(
    nativeInvocationPolicy("codex"),
    providerLaunchSwitches("codex"),
  );
  assert.ok(
    !JSON.stringify(nativeInvocationPolicy("claude")).includes("https://"),
  );
});
