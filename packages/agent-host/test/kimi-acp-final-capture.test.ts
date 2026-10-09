import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  writeFileSync,
  appendFileSync,
  renameSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureKimiWire,
  readKimiWireSuffix,
} from "../src/kimi-acp-final-capture.mjs";
test("wire capture rejects replacement, prefix rewrite, truncation and symlink", () => {
  const d = mkdtempSync(join(tmpdir(), "kimi-final-"));
  try {
    const p = join(d, "wire");
    writeFileSync(p, '{"old":true}\n');
    const b = captureKimiWire(p);
    appendFileSync(p, '{"new":true}\n');
    assert.equal(readKimiWireSuffix(b).suffix, '{"new":true}\n');
    writeFileSync(p, '{"old":evil}\n{"new":true}\n');
    assert.throws(() => readKimiWireSuffix(b));
    writeFileSync(p, "");
    assert.throws(() => readKimiWireSuffix(b));
    renameSync(p, p + ".old");
    writeFileSync(p, '{"old":true}\n');
    assert.throws(() => readKimiWireSuffix(b));
    symlinkSync(p, p + ".link");
    assert.throws(() => captureKimiWire(p + ".link"));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
