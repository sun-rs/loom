import test from "node:test";
import assert from "node:assert/strict";
import { providerLaunchSwitches } from "../../packages/agent-host/src/provider-launch-arguments.js";
import { codexNativeArgs } from "./native.mjs";

// Codex review of batches 3-4 P2-2: the native Codex arm must run under the
// same process switches (memory and autonomy) as the product app-server.
const pairs = (args) => {
  const out = [];
  for (let i = 0; i < args.length; i++)
    if (args[i] === "-c") out.push(args[++i]);
  return out;
};

test("native Codex arm carries every product launch-policy -c switch", () => {
  // The resolved product policy: fixed switches plus per-name MCP disables.
  const launchArgs = [
    ...providerLaunchSwitches("codex").args,
    "-c",
    "mcp_servers.user_mcp.enabled=false",
  ];
  const policy = pairs(launchArgs);
  assert.equal(
    policy.some((arg) => arg.startsWith("features.multi_agent=")),
    false,
  );
  assert.ok(policy.includes("features.goals=false"));
  assert.ok(policy.includes("memories.use_memories=false"));
  for (const sessionId of [undefined, "019a0000-0000-7000-8000-000000000001"]) {
    const args = codexNativeArgs({
      model: "gpt-6-luna",
      effort: "low",
      sessionId,
      prompt: "q",
      launchArgs,
    });
    const configured = pairs(args);
    for (const entry of policy) assert.ok(configured.includes(entry), entry);
    assert.deepEqual(
      configured.filter((c) => !c.startsWith("model_reasoning_effort=")),
      policy,
    );
    assert.equal(args[args.indexOf("-m") + 1], "gpt-6-luna");
    assert.ok(configured.includes('model_reasoning_effort="low"'));
    assert.equal(args.at(-1), "q");
    assert.equal(args.includes("resume"), Boolean(sessionId));
    if (sessionId) assert.equal(args[args.indexOf("resume") + 1], sessionId);
  }
});

test("native Codex environment carries the product launch-policy environment", async () => {
  const { codexNativeEnvironment } = await import("./native.mjs");
  const env = codexNativeEnvironment({ RAH_X: "1", PATH: "/bin" });
  assert.equal(env.RAH_X, undefined);
  assert.equal(env.PATH, "/bin");
  for (const [k, v] of Object.entries(
    providerLaunchSwitches("codex").environment,
  ))
    assert.equal(env[k], v);
});
