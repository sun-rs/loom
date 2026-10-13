import assert from "node:assert/strict";
import test from "node:test";
import type {
  RuntimeProfileProbeReport,
  ResolvedModel,
} from "@rah-os/protocol";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPiPrintRuntime } from "../src/pi-print-runtime.ts";
import { RuntimeProfileRegistry } from "../src/runtime-profile-registry.ts";
test("Pi is an explicit cold profile and rejects unverified attached directories", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-runtime-"));
  const profiles = new RuntimeProfileRegistry({
    databasePath: join(directory, "registry.sqlite"),
    hostId: "pi-test-host",
  });
  profiles.initialize();
  try {
    const revision = profiles.importManifest({
      manifestVersion: 3,
      runtimeProfileId: "pi-test",
      displayName: "Pi test",
      protocolFamily: "rah-worker-process/v1",
      adapter: {
        kind: "pi-print-json/v1",
        fixedArgs: [],
        config: {},
        executable: "pi",
      },
      modelCatalogProbe: { kind: "pi-cli/v1" },
      credentialSlots: [],
      declaredCapabilities: ["worker_commands"],
      recoveryDrivers: ["rah-process-supervisor-v1"],
      workspacePolicy: { allowedModes: ["in_place"] },
      staticEnv: {},
    });
    assert.ok(revision.manifest.manifestVersion === 3);
    const manifest = revision.manifest;
    assert.throws(
      () =>
        createPiPrintRuntime(revision, {
          cwd: process.cwd(),
          additionalDirectories: ["/attached"],
        }),
      /attached/,
    );
    assert.throws(
      () =>
        createPiPrintRuntime(
          {
            ...revision,
            manifest: {
              ...manifest,
              adapter: { ...manifest.adapter, kind: "codex-exec/v1" },
            },
          },
          { cwd: process.cwd() },
        ),
      /explicit/,
    );
    assert.ok(createPiPrintRuntime(revision, { cwd: process.cwd() }));
    const report: RuntimeProfileProbeReport = {
      reportVersion: 2,
      probeReportId: "probe",
      probeDigest: "sha256:probe",
      runtimeProfileId: revision.runtimeProfileId,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
      runtimeProfileDigest: revision.contentDigest,
      adapter: { kind: "pi-print-json/v1", implementationVersion: "test" },
      available: true,
      recoveryDrivers: [],
      observedAt: new Date().toISOString(),
      modelBindings: [
        {
          modelBindingId: "exact",
          provider: "configured",
          modelId: "configured/exact",
          capabilityClasses: [],
          supportedReasoning: ["low"],
          supportedServiceTiers: [],
          evidence: "probed",
          adapterMapping: { kind: "pi-print-json/v1", config: {} },
        },
      ],
    };
    const selected: ResolvedModel = {
      source: "explicit_binding",
      modelBindingId: "exact",
      provider: "configured",
      modelId: "configured/exact",
      reasoning: "low",
    };
    assert.ok(
      createPiPrintRuntime(revision, { cwd: process.cwd() }, report, selected),
    );
    assert.throws(
      () =>
        createPiPrintRuntime(revision, { cwd: process.cwd() }, report, {
          ...selected,
          modelId: "configured/other",
        }),
      /model.*binding/i,
    );
  } finally {
    profiles.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ProviderSessionStore } from "../src/provider-session-store.ts";
import type { ActivationEnvelope } from "../src/runtime.ts";

test("Pi runtime resumes a bound native fork file on successive Host instances and never opens a blank deterministic path", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-fork-runtime-"));
  const registry = new RuntimeProfileRegistry({
    databasePath: join(directory, "registry.sqlite"),
    hostId: "host",
  });
  registry.initialize();
  try {
    const revision = registry.importManifest({
      manifestVersion: 3,
      runtimeProfileId: "pi-fork",
      displayName: "fixture",
      protocolFamily: "rah-worker-process/v1",
      adapter: {
        kind: "pi-print-json/v1",
        fixedArgs: [],
        config: {},
        executable: fileURLToPath(
          new URL("./fixtures/fake-pi-print.mjs", import.meta.url),
        ),
      },
      modelCatalogProbe: { kind: "pi-cli/v1" },
      credentialSlots: [],
      declaredCapabilities: ["worker_commands"],
      recoveryDrivers: ["rah-process-supervisor-v1"],
      workspacePolicy: { allowedModes: ["in_place"] },
      staticEnv: {},
    });
    const supervisor = join(directory, "supervisors"),
      native = join(supervisor, "pi-sessions");
    await mkdir(native, { recursive: true, mode: 0o700 });
    const path = join(native, "native-copy-child.jsonl");
    await writeFile(
      path,
      JSON.stringify({ type: "session", id: "copied-child" }) +
        "\n" +
        JSON.stringify({
          type: "message",
          id: "parent-message",
          parentId: null,
          message: { role: "user", content: "SYNTHETIC inherited" },
        }) +
        "\n",
      { mode: 0o600 },
    );
    const key = {
      participantId: "child",
      provider: "pi-print-json/v1",
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
      workspaceMountRevisionId: "mount",
    };
    const store = new ProviderSessionStore({
      rootDirectory: join(supervisor, "provider-sessions"),
    });
    await store.record(key, "copied-child", { instance: true });
    const report: RuntimeProfileProbeReport = {
      reportVersion: 2,
      probeReportId: "probe",
      probeDigest: "probe",
      runtimeProfileId: revision.runtimeProfileId,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
      runtimeProfileDigest: revision.contentDigest,
      adapter: { kind: "pi-print-json/v1", implementationVersion: "fixture" },
      available: true,
      recoveryDrivers: [],
      observedAt: new Date().toISOString(),
      modelBindings: [
        {
          modelBindingId: "fixture",
          modelId: "fixture/model",
          provider: "fixture",
          capabilityClasses: [],
          supportedReasoning: ["low"],
          supportedServiceTiers: [],
          evidence: "probed",
          adapterMapping: { kind: "pi-print-json/v1", config: {} },
        },
      ],
    };
    for (let round = 0; round < 2; round++) {
      const runtime = createPiPrintRuntime(
        revision,
        {
          cwd: directory,
          supervisorDirectory: supervisor,
          providerSessionStore: new ProviderSessionStore({
            rootDirectory: join(supervisor, "provider-sessions"),
          }),
          activationEnvironment: async () => ({
            env: { PI_FAKE_RECORD: join(directory, "launches") },
            standingPromptDigest: "changed-prompt-" + round,
          }),
        },
        report,
        {
          source: "explicit_binding",
          modelBindingId: "fixture",
          provider: "fixture",
          modelId: "fixture/model",
          reasoning: "low",
        },
      );
      const input = {
        activationId: "activation-" + round,
        consumerId: "consumer",
        fromSeq: 1,
        toSeq: 1,
        hostId: "host",
        participantId: "child",
        reason: "manual",
        roomId: "room",
        runAttemptId: "run-" + round,
        agent: { instanceChannelId: "room", instanceSessionRequired: true },
        contextManifest: {
          activationId: "activation-" + round,
          participantId: "child",
          roomId: "room",
          runAttemptId: "run-" + round,
          placement: {
            runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
            runtimeProfileDigest: revision.contentDigest,
            workspaceMountRevisionId: "mount",
          },
        },
      } as ActivationEnvelope;
      const run = await runtime.start(input, {
        registerPrepared: async () => {},
        recordInstanceSessionBinding: async () => {},
      });
      assert.equal((await runtime.reap(run)).code, 0);
    }
    const launches = (await readFile(join(directory, "launches"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(launches.length, 2);
    for (const launch of launches)
      assert.equal(launch.args[launch.args.indexOf("--session") + 1], path);
    assert.match(await readFile(path, "utf8"), /SYNTHETIC inherited/);
  } finally {
    registry.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
