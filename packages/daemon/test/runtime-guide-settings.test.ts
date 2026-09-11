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

test("Provider arguments persist independently of Guide, reject stale writes and reset to defaults", () => {
  const dir = mkdtempSync(join(tmpdir(), "rah-launch-settings-"));
  try {
    const path = join(dir, "guide.json");
    const store = new RuntimeGuideSettings(path);
    const updated = store.update({
      runtimeId: "kimi",
      additionalArgs: ["--debug"],
      expectedRevision: 0,
    });
    assert.deepEqual(
      updated.runtimes.find((r) => r.runtimeId === "kimi")!.additionalArgs,
      ["--debug"],
    );
    assert.equal(store.enabled("kimi"), false);
    assert.deepEqual(new RuntimeGuideSettings(path).read(), updated);
    assert.throws(
      () =>
        store.update({
          runtimeId: "kimi",
          additionalArgs: [],
          expectedRevision: 0,
        }),
      /revision/,
    );
    assert.throws(
      () =>
        store.update({
          runtimeId: "claude",
          additionalArgs: ["--input-format", "text"],
          expectedRevision: 1,
        }),
      /managed/,
    );
    store.update({
      runtimeId: "kimi",
      additionalArgs: [],
      expectedRevision: 1,
    });
    assert.deepEqual(
      new RuntimeGuideSettings(path)
        .read()
        .runtimes.find((r) => r.runtimeId === "kimi")!.additionalArgs,
      [],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("override replaces defaults, survives Guide changes and resets without reviving old additions", () => {
  const dir = mkdtempSync(join(tmpdir(), "rah-launch-override-"));
  try {
    const path = join(dir, "settings.json");
    const store = new RuntimeGuideSettings(path);
    store.update({
      runtimeId: "claude",
      additionalArgs: ["--debug"],
      expectedRevision: 0,
    });
    const defaults = store
      .read()
      .runtimes.find((r) => r.runtimeId === "claude")!.defaultArgs;
    const override = [...defaults, "--debug", "api"];
    const changed = store.update({
      runtimeId: "claude",
      overrideArgs: override,
      expectedRevision: 1,
    });
    assert.deepEqual(
      changed.runtimes.find((r) => r.runtimeId === "claude")!.effectiveArgs,
      override,
    );
    changed.runtimes
      .find((r) => r.runtimeId === "claude")!
      .effectiveArgs.push("--unexpected");
    assert.deepEqual(
      store.read().runtimes.find((r) => r.runtimeId === "claude")!
        .effectiveArgs,
      override,
    );
    store.update({ runtimeId: "claude", enabled: false, expectedRevision: 2 });
    const restored = new RuntimeGuideSettings(path);
    assert.deepEqual(
      restored.read().runtimes.find((r) => r.runtimeId === "claude")!
        .effectiveArgs,
      override,
    );
    const envelope = JSON.parse(
      restored.runtimeOptions().launchEnvironment("claude")
        .RAH_PROVIDER_LAUNCH_ARGS_JSON!,
    );
    assert.deepEqual(envelope.overrideArgs, override);
    assert.throws(
      () =>
        restored.update({
          runtimeId: "claude",
          overrideArgs: [],
          expectedRevision: 3,
        }),
      /managed|required/,
    );
    restored.update({
      runtimeId: "claude",
      overrideArgs: null,
      expectedRevision: 3,
    });
    assert.deepEqual(
      restored.read().runtimes.find((r) => r.runtimeId === "claude")!
        .effectiveArgs,
      defaults,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
