import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  chmodSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readProviderPromptFile } from "../src/provider-prompt-file.js";

test("provider prompt file accepts the full private document and refuses symlinks or public files", () => {
  const root = mkdtempSync(join(tmpdir(), "rah-provider-prompt-"));
  const path = join(root, "prompt.md");
  const value = "\uFEFFFull prompt\r\n".repeat(10000);
  try {
    writeFileSync(path, value, { mode: 0o600 });
    assert.equal(readProviderPromptFile(path), value);
    const link = join(root, "link");
    symlinkSync(path, link);
    assert.throws(() => readProviderPromptFile(link));
    chmodSync(path, 0o644);
    assert.throws(() => readProviderPromptFile(path), /private/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
