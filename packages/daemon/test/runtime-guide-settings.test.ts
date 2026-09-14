import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RuntimeGuideSettings } from "../src/runtime-guide-settings.ts";

test("Provider settings reject global launch mutations without changing durable state", () => {
  const dir = mkdtempSync(join(tmpdir(), "rah-readonly-provider-"));
  try {
    const path = join(dir, "guide.json");
    const legacy = {
      revision: 4,
      enabled: ["claude"],
      additionalArgs: {
        claude: [],
        kimi: [],
        opencode: [],
        codex: ["--debug"],
      },
      environment: { codex: { LABEL: "legacy" } },
      overrides: {
        codex: null,
        claude: null,
        opencode: null,
        kimi: ["legacy"],
      },
    };
    writeFileSync(path, JSON.stringify(legacy));
    const store = new RuntimeGuideSettings(path);
    for (const change of [
      { enabled: true, environment: {} },
      { additionalArgs: [] },
      { environment: {} },
      { overrideArgs: null },
    ]) {
      assert.throws(
        () =>
          store.update({ runtimeId: "codex", expectedRevision: 4, ...change }),
        /read.only|Agent/i,
      );
      assert.equal(store.read().revision, 4);
      assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), legacy);
    }
    assert.equal(store.enabled("codex"), false);
    assert.equal(store.enabled("claude"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Legacy global launch overlays are retained but never exposed or executed; Agent settings stay isolated", () => {
  const dir = mkdtempSync(join(tmpdir(), "rah-agent-launch-"));
  try {
    const path = join(dir, "guide.json");
    const legacy = {
      revision: 0,
      enabled: ["codex", "claude"],
      additionalArgs: {
        claude: [],
        kimi: [],
        opencode: [],
        codex: ["--debug", "global"],
      },
      environment: { codex: { LABEL: "global", SHARED: "secret" } },
      overrides: {
        claude: null,
        kimi: null,
        opencode: null,
        codex: ["legacy"],
      },
    };
    writeFileSync(path, JSON.stringify(legacy));
    const store = new RuntimeGuideSettings(path);
    store.update({
      agentDefinitionId: "a",
      runtimeId: "codex",

      environment: { LABEL: "agent" },
      expectedRevision: 0,
    });
    const a = store.runtimeOptions().launchEnvironment("codex", "a");
    assert.equal(a.LABEL, "agent");
    assert.equal(a.SHARED, undefined);
    assert.deepEqual(JSON.parse(a.RAH_PROVIDER_LAUNCH_ARGS_JSON!), {
      runtimeId: "codex",
      overrideArgs: null,
      additionalArgs: [],
    });
    for (const id of [undefined, "b"]) {
      const env = store.runtimeOptions().launchEnvironment("codex", id);
      assert.equal(env.LABEL, undefined);
      assert.equal(env.SHARED, undefined);
      assert.deepEqual(
        JSON.parse(env.RAH_PROVIDER_LAUNCH_ARGS_JSON!).additionalArgs,
        [],
      );
    }
    const row = store.read().runtimes.find((r) => r.runtimeId === "codex")!;
    assert.deepEqual(row.environment, {});
    assert.deepEqual(row.inheritedEnvironment, {});
    assert.deepEqual(row.additionalArgs, []);
    assert.deepEqual(row.effectiveArgs, row.defaultArgs);
    assert.equal(row.overrideArgs, null);
    const saved = JSON.parse(readFileSync(path, "utf8"));
    for (const key of ["additionalArgs", "environment", "overrides"] as const)
      assert.deepEqual(saved[key], legacy[key]);
    assert.equal(
      new RuntimeGuideSettings(path)
        .runtimeOptions()
        .launchEnvironment("codex", "a").LABEL,
      "agent",
    );
    for (const change of [
      { environment: { RAH_WORKER_TOKEN: "bad" } },
      { additionalArgs: ["--model", "other"] },
    ]) {
      assert.throws(
        () =>
          store.update({
            agentDefinitionId: "a",
            runtimeId: "codex",
            expectedRevision: 1,
            ...change,
          }),
        /managed|protected|reserved|environment variables only/i,
      );
    }
    assert.throws(
      () =>
        store.update({
          agentDefinitionId: "a",
          runtimeId: "codex",
          expectedRevision: 0,
          environment: {},
        }),
      /revision/,
    );
    assert.equal(store.read().revision, 1);
    store.update({
      agentDefinitionId: "a",
      runtimeId: "codex",
      expectedRevision: 1,
      environment: {},
    });
    assert.equal(
      store.runtimeOptions().launchEnvironment("codex", "a").LABEL,
      undefined,
    );
    assert.deepEqual(
      store
        .read({ agentDefinitionId: "a" })
        .runtimes.find((r) => r.runtimeId === "codex")!.effectiveArgs,
      row.defaultArgs,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Guide toggles independently while global launch configuration remains read-only", () => {
  const dir = mkdtempSync(join(tmpdir(), "rah-guide-toggle-"));
  try {
    const path = join(dir, "guide.json"),
      store = new RuntimeGuideSettings(path);
    store.update({ runtimeId: "codex", enabled: false, expectedRevision: 0 });
    assert.equal(new RuntimeGuideSettings(path).enabled("codex"), false);
    assert.equal(store.enabled("claude"), true);
    assert.throws(
      () =>
        store.update({
          runtimeId: "codex",
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
    assert.equal(store.read().revision, 1);
    store.update({ runtimeId: "codex", enabled: true, expectedRevision: 1 });
    assert.equal(new RuntimeGuideSettings(path).enabled("codex"), true);
    assert.deepEqual(
      store.read().runtimes.find((r) => r.runtimeId === "codex")!
        .additionalArgs,
      [],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Agent CLI arguments are retired while environment reaches an isolated child process", async () => {
  const { execFileSync } = await import("node:child_process");
  const dir = mkdtempSync(join(tmpdir(), "rah-env-only-"));
  try {
    const path = join(dir, "guide.json");
    const legacy = {
      revision: 0,
      enabled: ["codex"],
      agents: {
        a: {
          codex: { additionalArgs: ["--debug"], environment: { LABEL: "old" } },
        },
      },
    };
    writeFileSync(path, JSON.stringify(legacy));
    const store = new RuntimeGuideSettings(path);
    assert.throws(
      () =>
        store.update({
          agentDefinitionId: "a",
          runtimeId: "codex",
          expectedRevision: 0,
          additionalArgs: ["--debug"],
        }),
      /environment|环境变量/i,
    );
    assert.deepEqual(
      store.read({ agentDefinitionId: "a" }).runtimes[0]!.additionalArgs,
      [],
    );
    for (const runtimeId of ["codex", "claude", "kimi", "opencode"] as const) {
      store.update({
        agentDefinitionId: "a",
        runtimeId,
        expectedRevision: store.read().revision,
        environment: { LABEL: "agent-value" },
      });
      const env = store.runtimeOptions().launchEnvironment(runtimeId, "a");
      assert.equal(
        execFileSync(
          process.execPath,
          ["-e", "process.stdout.write(process.env.LABEL)"],
          { env, encoding: "utf8" },
        ),
        "agent-value",
      );
      assert.equal(
        store.runtimeOptions().launchEnvironment(runtimeId, "b").LABEL,
        undefined,
      );
      assert.deepEqual(
        JSON.parse(env.RAH_PROVIDER_LAUNCH_ARGS_JSON!).additionalArgs,
        [],
      );
    }
    assert.deepEqual(
      JSON.parse(readFileSync(path, "utf8")).agents.a.codex.additionalArgs,
      ["--debug"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
