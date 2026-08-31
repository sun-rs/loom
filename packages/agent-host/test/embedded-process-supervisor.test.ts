import assert from "node:assert/strict";
import test from "node:test";

import { runEmbeddedProcessSupervisor } from "../src/index.ts";

test("embedded process supervisor executes only the immutable SEA asset", async () => {
  const source = 'const { platform } = require("node:os"); void platform;';
  let executed = "";
  assert.equal(
    await runEmbeddedProcessSupervisor({
      getAsset: (key, encoding) => {
        assert.equal(key, "process-supervisor.cjs");
        assert.equal(encoding, "utf8");
        return source;
      },
      executeModule: (value) => {
        executed = value;
      },
      isSea: () => true,
    }),
    0,
  );
  assert.equal(executed, source);
});

test("embedded process supervisor fails closed outside a SEA", async () => {
  await assert.rejects(
    runEmbeddedProcessSupervisor({
      getAsset: () => {
        throw new Error("must not read an asset");
      },
      executeModule: () => undefined,
      isSea: () => false,
    }),
    /only available inside the Computer SEA/u,
  );
});
