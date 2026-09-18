import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAgentEnvironment } from "../src/agent-launch-environment.ts";

test("launch environment preserves per-Agent values and rejects ambiguous or managed keys", () => {
  assert.deepEqual(
    parseAgentEnvironment([
      { key: "ANTHROPIC_BASE_URL", value: "https://example.invalid" },
      { key: "", value: "" },
    ]),
    { ANTHROPIC_BASE_URL: "https://example.invalid" },
  );
  assert.throws(
    () =>
      parseAgentEnvironment([
        { key: "EXAMPLE", value: "1" },
        { key: "EXAMPLE", value: "2" },
      ]),
    /重复/,
  );
  assert.throws(
    () => parseAgentEnvironment([{ key: "PATH", value: "override" }]),
    /protected/,
  );
});
