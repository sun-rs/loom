import assert from "node:assert/strict";
import test from "node:test";

import { runEmbeddedRuntimeDriver } from "../src/index.ts";

test("embedded Provider drivers select bounded immutable SEA assets", async () => {
  const assets: string[] = [];
  const executed: string[] = [];
  const runtime = {
    getAsset: (key: string, encoding: "utf8") => {
      assert.equal(encoding, "utf8");
      assets.push(key);
      return `export const driver = ${JSON.stringify(key)};`;
    },
    executeModule: async (source: string) => {
      executed.push(source);
      return 0 as const;
    },
    isSea: () => true,
  };

  assert.equal(
    await runEmbeddedRuntimeDriver("claude-stream-json", [], runtime),
    0,
  );
  assert.equal(
    await runEmbeddedRuntimeDriver("codex-app-server", [], runtime),
    0,
  );
  assert.equal(await runEmbeddedRuntimeDriver("kimi-acp", [], runtime), 0);
  assert.equal(
    await runEmbeddedRuntimeDriver("opencode-server", [], runtime),
    0,
  );
  assert.deepEqual(assets, [
    "claude-stream-json-driver.cjs",
    "codex-app-server-driver.cjs",
    "kimi-acp-driver.cjs",
    "opencode-server-driver.cjs",
  ]);
  assert.equal(executed.length, 4);
  assert.match(executed[0]!, /claude-stream-json-driver\.cjs/u);
  assert.match(executed[1]!, /codex-app-server-driver\.cjs/u);
  assert.match(executed[2]!, /kimi-acp-driver\.cjs/u);
  assert.match(executed[3]!, /opencode-server-driver\.cjs/u);
});

test("embedded Provider drivers reject non-SEA and oversized sources", async () => {
  await assert.rejects(
    runEmbeddedRuntimeDriver("codex-app-server", [], { isSea: () => false }),
    /only available inside a SEA/u,
  );
  await assert.rejects(
    runEmbeddedRuntimeDriver("kimi-acp", [], {
      getAsset: () => "x".repeat(512 * 1_024 + 1),
      executeModule: async () => 0,
      isSea: () => true,
    }),
    /asset size is invalid/u,
  );
});
