import assert from "node:assert/strict";
import test from "node:test";
import { gateReplyTransport } from "./reply-transport.mjs";
test("reply transport is explicit and clears unrelated inherited experiment switches", () => {
  const worker = gateReplyTransport("codex", "worker");
  assert.equal(worker.mode, "worker");
  assert.ok(Object.values(worker.environment).every((v) => v === "0"));
  for (const [provider, flag] of [
    ["codex", "LOOM_CODEX_NATIVE_FINAL_TRIAL"],
    ["kimi", "LOOM_KIMI_NATIVE_FINAL_TRIAL"],
    ["claude", "LOOM_CLAUDE_NATIVE_FINAL_TRIAL"],
    ["opencode", "LOOM_OPENCODE_NATIVE_FINAL_TRIAL"],
  ]) {
    const p = gateReplyTransport(provider, "native-final");
    assert.equal(p.environment[flag], "1");
    assert.equal(
      Object.values(p.environment).filter((v) => v === "1").length,
      1,
    );
    assert.notDeepEqual(p, worker);
  }
  assert.throws(() => gateReplyTransport("codex", "typo"));
  assert.throws(() => gateReplyTransport("unknown", "native-final"));
});
