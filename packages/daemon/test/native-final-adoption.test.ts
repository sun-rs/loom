import assert from "node:assert/strict";
import test from "node:test";
import { warmRuntimeAdapterKinds } from "../src/daemon-process-hygiene.ts";

test("native Claude adoption selects its required warm entry without overriding an explicit cold policy", () => {
  const before = process.env.LOOM_CLAUDE_NATIVE_FINAL_TRIAL;
  try {
    process.env.LOOM_CLAUDE_NATIVE_FINAL_TRIAL = "1";
    assert.ok(
      warmRuntimeAdapterKinds(undefined).has("claude-stream-json/v1"),
      "the local workbench has no explicit warm config; native adoption must reach the supported entry",
    );
    assert.equal(
      warmRuntimeAdapterKinds({ claude: { enabled: false } }).has(
        "claude-stream-json/v1",
      ),
      false,
      "an explicit cold policy keeps the existing Worker fallback",
    );
    process.env.LOOM_CLAUDE_NATIVE_FINAL_TRIAL = "0";
    assert.equal(
      warmRuntimeAdapterKinds(undefined).has("claude-stream-json/v1"),
      false,
      "rollback restores the previous local workbench entry",
    );
    process.env.LOOM_CLAUDE_NATIVE_FINAL_TRIAL = "true";
    assert.equal(
      warmRuntimeAdapterKinds(undefined).has("claude-stream-json/v1"),
      false,
    );
    assert.ok(
      warmRuntimeAdapterKinds({ claude: { enabled: true } }).has(
        "claude-stream-json/v1",
      ),
    );
  } finally {
    if (before === undefined) delete process.env.LOOM_CLAUDE_NATIVE_FINAL_TRIAL;
    else process.env.LOOM_CLAUDE_NATIVE_FINAL_TRIAL = before;
  }
});
