import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { RuntimeProfileManifestV2 } from "@rah-os/protocol";

import {
  buildRuntimeOfferFromProfile,
  GenericProcessAdapter,
  RuntimeCredentialEnvironmentBinding,
  RuntimeImplementationRegistry,
  RuntimeProfileRegistry,
} from "../src/index.ts";

function createDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "rah-runtime-factory-"));
  chmodSync(directory, 0o700);
  return directory;
}

function manifest(
  overrides: Partial<RuntimeProfileManifestV2> = {},
): RuntimeProfileManifestV2 {
  return {
    adapter: {
      config: { diagnosticByteLimit: 262_144, terminationGraceMs: 1_000 },
      executable: process.execPath,
      fixedArgs: [
        "-e",
        "process.stdout.write(process.env.PROVIDER_TOKEN ?? 'missing')",
      ],
      kind: "generic-process/v1",
    },
    credentialSlots: [
      {
        slotId: "provider-token",
        target: { kind: "environment", variable: "PROVIDER_TOKEN" },
      },
    ],
    declaredCapabilities: ["worker_commands"],
    displayName: "Fake Node worker",
    manifestVersion: 2,
    protocolFamily: "rah-worker-process/v1",
    recoveryDrivers:
      process.platform === "win32" ? [] : ["rah-process-supervisor-v1"],
    runtimeProfileId: "fake-node-worker",
    staticEnv: { PROVIDER_MODE: "plan" },
    workspacePolicy: { allowedModes: ["in_place"] },
    ...overrides,
  };
}

test("built-in runtime implementations produce profile-bound immutable probe evidence", async () => {
  const directory = createDirectory();
  try {
    const profileRegistry = new RuntimeProfileRegistry({
      databasePath: join(directory, "runtime-registry.db"),
      hostId: "host-runtime-factory",
    });
    profileRegistry.initialize();
    const revision = profileRegistry.importManifest(manifest());
    const implementations = new RuntimeImplementationRegistry();
    assert.equal(
      implementations.adapterImplementationVersion("generic-process/v1"),
      "generic-process-adapter/v1",
    );
    assert.equal(
      implementations.adapterImplementationVersion("unknown-adapter/v1"),
      undefined,
    );
    assert.equal(
      implementations.recoveryDriverImplementationVersion(
        "unknown-recovery-driver/v1",
      ),
      undefined,
    );
    const observation = await implementations.probeRevision(revision, {
      cwd: directory,
    });
    assert.equal(observation.available, true);
    assert.equal(observation.adapter.kind, "generic-process/v1");
    assert.equal(
      observation.executableIdentity?.requestedExecutable,
      process.execPath,
    );
    assert.match(
      observation.executableIdentity?.contentDigest ?? "",
      /^sha256:[a-f0-9]{64}$/,
    );

    const report = profileRegistry.recordProbeReport(observation);
    assert.equal(report.runtimeProfileDigest, revision.contentDigest);
    const active = profileRegistry.activateRevision({
      contentDigest: revision.contentDigest,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    });
    if (process.platform !== "win32") {
      const recoveryRuntime = implementations.createRecoveryRuntime(
        active,
        "rah-process-supervisor-v1",
        { cwd: directory, supervisorDirectory: join(directory, "supervisors") },
      );
      assert.equal(typeof recoveryRuntime.recover, "function");
      assert.throws(
        () =>
          implementations.createRecoveryRuntime(
            active,
            "unknown-recovery-driver/v1",
            { cwd: directory },
          ),
        /unsupported runtime recovery driver/,
      );
    }
    profileRegistry.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("unknown recovery drivers fail closed instead of becoming an offer", async () => {
  const directory = createDirectory();
  try {
    const profileRegistry = new RuntimeProfileRegistry({
      databasePath: join(directory, "runtime-registry.db"),
      hostId: "host-unknown-driver",
    });
    profileRegistry.initialize();
    const revision = profileRegistry.importManifest(
      manifest({ recoveryDrivers: ["unknown-recovery-driver/v1"] }),
    );
    const observation = await new RuntimeImplementationRegistry().probeRevision(
      revision,
      { cwd: directory },
    );
    assert.equal(observation.available, false);
    assert.equal(observation.failureCode, "recovery_driver_unavailable");
    profileRegistry.recordProbeReport(observation);
    assert.throws(
      () =>
        profileRegistry.activateRevision({
          contentDigest: revision.contentDigest,
          runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
        }),
      /latest probe report is not successful/,
    );
    profileRegistry.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("credential slots resolve only before spawn and are redacted from diagnostics", async () => {
  const directory = createDirectory();
  const secret = "provider-secret-that-must-be-redacted";
  try {
    const profileRegistry = new RuntimeProfileRegistry({
      databasePath: join(directory, "runtime-registry.db"),
      hostId: "host-secret-binding",
    });
    profileRegistry.initialize();
    const revision = profileRegistry.importManifest(manifest());
    const implementations = new RuntimeImplementationRegistry();
    const probeReport = profileRegistry.recordProbeReport(
      await implementations.probeRevision(revision, { cwd: directory }),
    );
    profileRegistry.activateRevision({
      contentDigest: revision.contentDigest,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    });
    const activeRevision = profileRegistry.getActiveRevision(
      revision.runtimeProfileId,
    );
    assert.ok(activeRevision);

    let resolutions = 0;
    const credentials = new RuntimeCredentialEnvironmentBinding({
      manifest: activeRevision.manifest,
      resolvers: {
        "provider-token": async () => {
          resolutions += 1;
          return secret;
        },
      },
    });
    const runtime = implementations.createRuntime(activeRevision, probeReport, {
      activationEnvironment: async () => await credentials.resolve(),
      cwd: directory,
      supervisorDirectory: join(directory, "supervisors"),
    });
    assert.ok(runtime instanceof GenericProcessAdapter);
    assert.equal(resolutions, 0);

    const handle = await runtime.start(
      {
        activationId: "activation-secret",
        consumerId: "consumer-secret",
        fromSeq: 1,
        hostId: "host-secret-binding",
        participantId: "participant-secret",
        reason: "manual",
        roomId: "room-secret",
        runAttemptId: "run-secret",
        toSeq: 1,
      },
      { registerPrepared: async () => undefined },
    );
    assert.equal(resolutions, 1);
    if (process.platform !== "win32") {
      assert.deepEqual(
        {
          recoveryImplementationVersion:
            handle.recoveryDescriptor?.recoveryImplementationVersion,
          runtimeProfileDigest: handle.recoveryDescriptor?.runtimeProfileDigest,
          runtimeProfileRevisionId:
            handle.recoveryDescriptor?.runtimeProfileRevisionId,
        },
        {
          recoveryImplementationVersion: "rah-process-supervisor/v1",
          runtimeProfileDigest: activeRevision.contentDigest,
          runtimeProfileRevisionId: activeRevision.runtimeProfileRevisionId,
        },
      );
    }
    assert.equal((await runtime.reap(handle)).code, 0);
    const diagnostics = runtime.diagnostics(handle);
    assert.equal(diagnostics.stdout.includes(secret), false);
    assert.match(diagnostics.stdout, /\[REDACTED\]/);
    runtime.release(handle);
    profileRegistry.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("credential bindings reject missing and extra slots before runtime creation", () => {
  assert.throws(
    () =>
      new RuntimeCredentialEnvironmentBinding({
        manifest: manifest(),
        resolvers: {},
      }),
    /missing credential slot provider-token/,
  );
  assert.throws(
    () =>
      new RuntimeCredentialEnvironmentBinding({
        manifest: manifest({ credentialSlots: [] }),
        resolvers: { unexpected: async () => "secret" },
      }),
    /unknown credential slot unexpected/,
  );
  assert.throws(
    () =>
      new RuntimeCredentialEnvironmentBinding({
        manifest: manifest({
          credentialSlots: [
            {
              slotId: "toString",
              target: { kind: "environment", variable: "PROVIDER_TOKEN" },
            },
          ],
        }),
        resolvers: {},
      }),
    /missing credential slot toString/,
  );
});

test("credential bindings reject secrets too large for bounded diagnostic redaction", async () => {
  const credentials = new RuntimeCredentialEnvironmentBinding({
    manifest: manifest(),
    resolvers: {
      "provider-token": async () => "x".repeat(65_537),
    },
  });
  await assert.rejects(credentials.resolve(), /safe byte limit/);
});

test("active profile projection exposes only a probe reference and redacted descriptors", async () => {
  const directory = createDirectory();
  try {
    const profileRegistry = new RuntimeProfileRegistry({
      databasePath: join(directory, "runtime-registry.db"),
      hostId: "host-offer",
    });
    profileRegistry.initialize();
    const revision = profileRegistry.importManifest(manifest());
    const implementations = new RuntimeImplementationRegistry();
    const report = profileRegistry.recordProbeReport(
      await implementations.probeRevision(revision, { cwd: directory }),
    );
    const active = profileRegistry.activateRevision({
      contentDigest: revision.contentDigest,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    });
    const offer = buildRuntimeOfferFromProfile({
      hostId: "host-offer",
      hostInstanceId: "host-instance-offer",
      leaseUntil: "2026-08-26T00:02:00.000Z",
      maxConcurrent: 1,
      observedAt: "2026-08-26T00:00:00.000Z",
      probeReport: report,
      runtimeOfferId: "runtime-offer-main",
      runtimeProfileRevision: active,
      state: "available",
      workspaceMountDescriptors: [
        {
          modes: ["in_place"],
          workspaceDefinitionId: "workspace-offer",
          workspaceMountDigest: `sha256:${"a".repeat(64)}`,
          workspaceMountRevisionId: "workspace-mount-offer-v1",
        },
      ],
    });
    assert.deepEqual(offer.probeReportRef, {
      probeDigest: report.probeDigest,
      probeReportId: report.probeReportId,
    });
    assert.deepEqual(offer.capabilityEvidence, [
      { capability: "worker_commands", evidence: "declared" },
    ]);
    assert.deepEqual(offer.workspaceMountDescriptors, [
      {
        modes: ["in_place"],
        workspaceDefinitionId: "workspace-offer",
        workspaceMountDigest: `sha256:${"a".repeat(64)}`,
        workspaceMountRevisionId: "workspace-mount-offer-v1",
      },
    ]);
    assert.throws(
      () =>
        buildRuntimeOfferFromProfile({
          hostId: "host-offer",
          hostInstanceId: "host-instance-offer",
          leaseUntil: "2026-08-26T00:02:00.000Z",
          maxConcurrent: 1,
          observedAt: "2026-08-26T00:00:00.000Z",
          probeReport: report,
          runtimeOfferId: "runtime-offer-invalid-workspace",
          runtimeProfileRevision: active,
          state: "available",
          workspaceMountDescriptors: [
            {
              modes: ["worktree"],
              workspaceDefinitionId: "workspace-offer",
              workspaceMountDigest: `sha256:${"b".repeat(64)}`,
              workspaceMountRevisionId: "workspace-mount-offer-v2",
            },
          ],
        }),
      /does not allow workspace mode worktree/,
    );
    const serialized = JSON.stringify(offer);
    assert.equal(serialized.includes(process.execPath), false);
    assert.equal(serialized.includes("provider-token"), false);
    assert.equal(serialized.includes("PROVIDER_MODE"), false);
    assert.equal(serialized.includes("resolvedExecutablePath"), false);
    profileRegistry.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("a newer failed probe fences activation even when an older probe succeeded", async () => {
  if (process.platform === "win32") return;
  const directory = createDirectory();
  try {
    const executablePath = join(directory, "temporary-worker");
    writeFileSync(executablePath, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    const profileRegistry = new RuntimeProfileRegistry({
      databasePath: join(directory, "runtime-registry.db"),
      hostId: "host-probe-fence",
    });
    profileRegistry.initialize();
    const revision = profileRegistry.importManifest(
      manifest({
        adapter: {
          ...manifest().adapter,
          executable: executablePath,
          fixedArgs: [],
        },
      }),
    );
    const implementations = new RuntimeImplementationRegistry();
    const successful = await implementations.probeRevision(revision, {
      cwd: directory,
    });
    assert.equal(successful.available, true);
    profileRegistry.recordProbeReport(successful);
    profileRegistry.activateRevision({
      contentDigest: revision.contentDigest,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    });

    rmSync(executablePath);
    const failed = await implementations.probeRevision(revision, {
      cwd: directory,
    });
    assert.equal(failed.available, false);
    profileRegistry.recordProbeReport(failed);
    assert.throws(
      () =>
        profileRegistry.activateRevision({
          contentDigest: revision.contentDigest,
          runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
        }),
      /latest probe report is not successful/,
    );
    profileRegistry.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("probe rejects a manifest snapshot that no longer matches its immutable revision digest", async () => {
  const directory = createDirectory();
  try {
    const profileRegistry = new RuntimeProfileRegistry({
      databasePath: join(directory, "runtime-registry.db"),
      hostId: "host-tampered-probe",
    });
    profileRegistry.initialize();
    const revision = profileRegistry.importManifest(
      manifest({ staticEnv: { PATH: join(directory, "missing-bin") } }),
    );
    const tampered = structuredClone(revision);
    assert.equal(tampered.manifest.manifestVersion, 2);
    tampered.manifest.staticEnv.PATH = process.env.PATH ?? "";
    await assert.rejects(
      new RuntimeImplementationRegistry().probeRevision(tampered, {
        cwd: directory,
      }),
      /manifest digest does not match immutable revision/,
    );
    profileRegistry.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("spawn revalidates executable identity before loading credentials or preparing a run", async () => {
  if (process.platform === "win32") return;
  const directory = createDirectory();
  try {
    const executablePath = join(directory, "replaceable-worker");
    writeFileSync(executablePath, "#!/bin/sh\necho ORIGINAL\n", {
      mode: 0o700,
    });
    const profileRegistry = new RuntimeProfileRegistry({
      databasePath: join(directory, "runtime-registry.db"),
      hostId: "host-spawn-fence",
    });
    profileRegistry.initialize();
    const revision = profileRegistry.importManifest(
      manifest({
        adapter: {
          ...manifest().adapter,
          executable: executablePath,
          fixedArgs: [],
        },
      }),
    );
    const implementations = new RuntimeImplementationRegistry();
    const report = profileRegistry.recordProbeReport(
      await implementations.probeRevision(revision, { cwd: directory }),
    );
    const active = profileRegistry.activateRevision({
      contentDigest: revision.contentDigest,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    });
    let credentialLoads = 0;
    let preparedRuns = 0;
    const runtime = implementations.createRuntime(active, report, {
      activationEnvironment: async () => {
        credentialLoads += 1;
        return { env: { PROVIDER_TOKEN: "not-loaded" } };
      },
      cwd: directory,
      supervisorDirectory: join(directory, "supervisors"),
    });

    writeFileSync(executablePath, "#!/bin/sh\necho REPLACED\n", {
      mode: 0o700,
    });
    await assert.rejects(
      runtime.start(
        {
          activationId: "activation-spawn-fence",
          consumerId: "consumer-spawn-fence",
          fromSeq: 1,
          hostId: "host-spawn-fence",
          participantId: "participant-spawn-fence",
          reason: "manual",
          roomId: "room-spawn-fence",
          runAttemptId: "run-spawn-fence",
          toSeq: 1,
        },
        {
          registerPrepared: async () => {
            preparedRuns += 1;
          },
        },
      ),
      /executable identity changed after probe/,
    );
    assert.equal(credentialLoads, 0);
    assert.equal(preparedRuns, 0);
    profileRegistry.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("the process supervisor revalidates executable identity after credential loading and before target launch", async () => {
  if (process.platform === "win32") return;
  const directory = createDirectory();
  try {
    const executablePath = join(directory, "launch-race-worker");
    writeFileSync(executablePath, "#!/bin/sh\necho ORIGINAL_A\n", {
      mode: 0o700,
    });
    const profileRegistry = new RuntimeProfileRegistry({
      databasePath: join(directory, "runtime-registry.db"),
      hostId: "host-launch-race",
    });
    profileRegistry.initialize();
    const revision = profileRegistry.importManifest(
      manifest({
        adapter: {
          ...manifest().adapter,
          executable: executablePath,
          fixedArgs: [],
        },
        credentialSlots: [],
      }),
    );
    const implementations = new RuntimeImplementationRegistry();
    const report = profileRegistry.recordProbeReport(
      await implementations.probeRevision(revision, { cwd: directory }),
    );
    const active = profileRegistry.activateRevision({
      contentDigest: revision.contentDigest,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    });
    const runtime = implementations.createRuntime(active, report, {
      activationEnvironment: async () => {
        writeFileSync(executablePath, "#!/bin/sh\necho REPLACED_B\n", {
          mode: 0o700,
        });
        return { env: {} };
      },
      cwd: directory,
      supervisorDirectory: join(directory, "supervisors"),
    });
    let prepared:
      Awaited<ReturnType<GenericProcessAdapter["start"]>> | undefined;
    await assert.rejects(
      runtime.start(
        {
          activationId: "activation-launch-race",
          consumerId: "consumer-launch-race",
          fromSeq: 1,
          hostId: "host-launch-race",
          participantId: "participant-launch-race",
          reason: "manual",
          roomId: "room-launch-race",
          runAttemptId: "run-launch-race",
          toSeq: 1,
        },
        {
          registerPrepared: async (candidate) => {
            prepared = candidate;
          },
        },
      ),
      /executable identity changed after probe/,
    );
    assert.ok(prepared);
    assert.equal(
      runtime.diagnostics(prepared).stdout.includes("REPLACED_B"),
      false,
    );
    assert.deepEqual(await runtime.reap(prepared), {
      code: null,
      signal: "RAH_START_FAILED",
    });
    assert.ok(prepared.recoveryDescriptor);
    const recoveringRuntime = implementations.createRecoveryRuntime(
      active,
      prepared.recoveryDescriptor.driver,
      { cwd: directory, supervisorDirectory: join(directory, "supervisors") },
    );
    assert.deepEqual(
      await recoveringRuntime.recover!({
        recoveryDescriptor: prepared.recoveryDescriptor,
        runAttemptId: "run-launch-race",
        runtimeRunId: prepared.runId,
      }),
      { code: null, signal: "RAH_START_FAILED" },
    );
    profileRegistry.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("a frozen runtime refuses future launches after its profile active revision changes", async () => {
  const directory = createDirectory();
  try {
    const profileRegistry = new RuntimeProfileRegistry({
      databasePath: join(directory, "runtime-registry.db"),
      hostId: "host-profile-lifecycle-fence",
    });
    profileRegistry.initialize();
    const implementations = new RuntimeImplementationRegistry();
    const original = profileRegistry.importManifest(
      manifest({ credentialSlots: [] }),
    );
    const originalReport = profileRegistry.recordProbeReport(
      await implementations.probeRevision(original, { cwd: directory }),
    );
    const activeOriginal = profileRegistry.activateRevision({
      contentDigest: original.contentDigest,
      runtimeProfileRevisionId: original.runtimeProfileRevisionId,
    });
    const runtime = implementations.createRuntime(
      activeOriginal,
      originalReport,
      {
        beforeStart: () => {
          const current = profileRegistry.getActiveRevision(
            activeOriginal.runtimeProfileId,
          );
          if (
            current?.runtimeProfileRevisionId !==
              activeOriginal.runtimeProfileRevisionId ||
            current.contentDigest !== activeOriginal.contentDigest
          ) {
            throw new Error("runtime profile active revision changed");
          }
        },
        cwd: directory,
        supervisorDirectory: join(directory, "supervisors"),
      },
    );
    const replacement = profileRegistry.importManifest(
      manifest({
        credentialSlots: [],
        displayName: "Replacement Node worker",
      }),
    );
    profileRegistry.recordProbeReport(
      await implementations.probeRevision(replacement, { cwd: directory }),
    );
    profileRegistry.activateRevision({
      contentDigest: replacement.contentDigest,
      runtimeProfileRevisionId: replacement.runtimeProfileRevisionId,
    });

    assert.deepEqual(await runtime.probe(), {
      available: false,
      detail: "runtime profile active revision changed",
    });
    let preparedRuns = 0;
    await assert.rejects(
      runtime.start(
        {
          activationId: "activation-lifecycle-fence",
          consumerId: "consumer-lifecycle-fence",
          fromSeq: 1,
          hostId: "host-profile-lifecycle-fence",
          participantId: "participant-lifecycle-fence",
          reason: "manual",
          roomId: "room-lifecycle-fence",
          runAttemptId: "run-lifecycle-fence",
          toSeq: 1,
        },
        {
          registerPrepared: async () => {
            preparedRuns += 1;
          },
        },
      ),
      /runtime profile active revision changed/,
    );
    assert.equal(preparedRuns, 0);
    profileRegistry.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
