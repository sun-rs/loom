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
