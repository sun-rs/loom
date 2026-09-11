import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RuntimeGuideSettings } from "../src/runtime-guide-settings.ts";

test("Guide defaults on for supported Runtimes, survives restart, and rejects unsupported/stale changes", () => {
  const dir = mkdtempSync(join(tmpdir(), "rah-guide-"));
  try {
    const path = join(dir, "guide.json");
    const store = new RuntimeGuideSettings(path);
    assert.equal(store.enabled("codex"), true);
    assert.equal(store.enabled("unknown"), false);
    const first = store.update({
      runtimeId: "codex",
      enabled: false,
      expectedRevision: 0,
    });
    assert.equal(first.revision, 1);
    assert.equal(store.enabled("codex"), false);
    assert.equal(store.enabled("claude"), true);
    assert.equal(new RuntimeGuideSettings(path).enabled("codex"), false);
    assert.throws(
      () =>
        store.update({
          runtimeId: "claude",
          enabled: true,
          expectedRevision: 0,
        }),
      /revision/,
    );
    assert.throws(
      () =>
        store.update({ runtimeId: "kimi", enabled: true, expectedRevision: 1 }),
      /unavailable/,
    );
    store.update({ runtimeId: "codex", enabled: false, expectedRevision: 1 });
    assert.equal(new RuntimeGuideSettings(path).enabled("codex"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
