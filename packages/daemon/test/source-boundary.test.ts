import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("DaemonApplication stays a composition root instead of absorbing runtime infrastructure", () => {
  const lines = readFileSync(
    new URL("../src/daemon-application.ts", import.meta.url),
    "utf8",
  )
    .trimEnd()
    .split(/\r?\n/u).length;

  assert.ok(
    lines <= 800,
    `daemon-application.ts has ${lines} lines; extract runtime infrastructure instead of raising the 800-line ratchet`,
  );
});
