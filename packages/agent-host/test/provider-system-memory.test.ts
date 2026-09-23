import assert from "node:assert/strict";
import test from "node:test";
import { ProviderSystemMemory } from "../src/provider-system-memory.ts";

test("resume retains the original system snapshot digest; changed files cannot masquerade as delivered memory", () => {
  const memory = new ProviderSystemMemory();
  const original = "a".repeat(64),
    changed = "b".repeat(64);
  const lease = { env: { RAH_AGENT_MEMORY_SYSTEM_SHA256: changed } };
  const resumed = memory.prepare("run-1", lease, {
    providerSessionId: "session-1",
    systemMemorySha256: original,
  });
  assert.equal(resumed.env.RAH_AGENT_MEMORY_SYSTEM_SHA256, original);
  assert.equal(memory.evidence("run-1", "session-1"), original);
  assert.equal(memory.evidence("run-1", "replacement-session"), changed);
  const unknown = memory.prepare("run-2", lease, {
    providerSessionId: "legacy",
  });
  assert.equal(unknown.env.RAH_AGENT_MEMORY_SYSTEM_SHA256, undefined);
  assert.equal(memory.evidence("run-2", "legacy"), undefined);
  assert.equal(
    memory.prepare("run-3", lease, null).env.RAH_AGENT_MEMORY_SYSTEM_SHA256,
    changed,
  );
  assert.equal(memory.evidence("run-3", "new"), changed);
});
