import assert from "node:assert/strict";
import {
  chmodSync,
  closeSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  ComputerHeartbeatRequest,
  ComputerHeartbeatResponse,
  ComputerPlacementClaimRequest,
  ComputerPlacementClaimResponse,
  ComputerRuntimeOfferPublishRequest,
  ComputerRuntimeOfferPublishResponse,
  ComputerSessionOpenRequest,
  ComputerSessionOpenResponse,
} from "@rah-os/computer-protocol";
import type { RuntimeProfileManifestV2 } from "@rah-os/protocol";

import {
  ComputerAttachmentStore,
  NODE_K_CARRIER_COMPUTER_SERVICE_CONFIGURATION_SCHEMA_VERSION,
  NODE_K_CARRIER_COMPUTER_SERVICE_OWNERSHIP_HOST_ID,
  NODE_K_CARRIER_COMPUTER_SERVICE_UPGRADE_CONTROL_HOST_ID,
  readNodeKCarrierComputerServiceConfiguration,
  RuntimeImplementationRegistry,
  RuntimeProfileRegistry,
  runNodeKCarrierComputerServiceCommand,
  runNodeKCarrierComputerServiceFromConfiguration,
  UnixSocketInstanceLock,
  type ComputerControlClientPort,
  type NodeKCarrierComputerServiceConfiguration,
  type NodeKCarrierComputerUpgradeProcessConfiguration,
} from "../src/index.ts";

function configuration(
  directory: string,
): NodeKCarrierComputerServiceConfiguration {
  return {
    activationLeaseMs: 30_000,
    attachmentReconcileIntervalMs: 5_000,
    attachmentStatePath: join(directory, "attachments.json"),
    buildVersion: "1.2.3",
    capacity: 2,
    controlRequestTimeoutMs: 5_000,
    runtimeProtocolVersion: 1,
    runtimeRegistryOwnerId: "computer-runtime-owner",
    runtimes: [
      {
        credentialBindings: {
          "provider-token": {
            path: join(directory, "provider-token"),
            source: "file",
          },
        },
        offer: {
          leaseMs: 60_000,
          maxConcurrent: 2,
          runtimeOfferId: "offer-primary",
        },
        registryDatabasePath: join(directory, "runtime-registry.db"),
        runtimeProfileId: "runtime-primary",
      },
    ],
    socketDirectory: join(directory, "sockets"),
    supervisorDirectory: join(directory, "run-supervisors"),
    upgradeConfigurationPath: join(directory, "upgrade.json"),
    workspace: {
      cwd: directory,
      mode: "in_place",
      workspaceDefinitionId: "workspace-primary",
      workspaceMountDigest: `sha256:${"a".repeat(64)}`,
      workspaceMountRevisionId: "workspace-mount-primary-v1",
    },
  };
}

test("Computer service configuration is strict and owner-private", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-computer-service-config-"));
  chmodSync(directory, 0o700);
  const expected = configuration(directory);
  const path = join(directory, "service.json");
  writeFileSync(
    path,
    `${JSON.stringify({
      configuration: expected,
      schemaVersion:
        NODE_K_CARRIER_COMPUTER_SERVICE_CONFIGURATION_SCHEMA_VERSION,
    })}\n`,
    { mode: 0o600 },
  );
  const descriptor = openSync(path, "r");
  try {
    assert.deepEqual(
      JSON.parse(
        JSON.stringify(
          readNodeKCarrierComputerServiceConfiguration(descriptor),
        ),
      ),
      expected,
    );
  } finally {
    closeSync(descriptor);
  }

  const keychainExpected: NodeKCarrierComputerServiceConfiguration = {
    ...expected,
    runtimes: [
      {
        ...expected.runtimes[0]!,
        credentialBindings: {
          "provider-token": {
            account: "alice",
            service: "dev.rah-os.provider.codex",
            source: "macos-keychain",
          },
        },
      },
    ],
  };
  writeFileSync(
    path,
    `${JSON.stringify({
      configuration: keychainExpected,
      schemaVersion:
        NODE_K_CARRIER_COMPUTER_SERVICE_CONFIGURATION_SCHEMA_VERSION,
    })}\n`,
    { mode: 0o600 },
  );
  const keychain = openSync(path, "r");
  try {
    assert.deepEqual(
      JSON.parse(
        JSON.stringify(readNodeKCarrierComputerServiceConfiguration(keychain)),
      ),
      keychainExpected,
    );
  } finally {
    closeSync(keychain);
  }

  writeFileSync(
    path,
    JSON.stringify({
      configuration: { ...expected, arbitraryCommand: "/bin/sh" },
      schemaVersion:
        NODE_K_CARRIER_COMPUTER_SERVICE_CONFIGURATION_SCHEMA_VERSION,
    }),
    { mode: 0o600 },
  );
  const unknown = openSync(path, "r");
  try {
    assert.throws(
      () => readNodeKCarrierComputerServiceConfiguration(unknown),
      /configuration shape is invalid/u,
    );
  } finally {
    closeSync(unknown);
  }

  chmodSync(path, 0o640);
  const readable = openSync(path, "r");
  try {
    assert.throws(
      () => readNodeKCarrierComputerServiceConfiguration(readable),
      /owner-private/u,
    );
  } finally {
    closeSync(readable);
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Computer service command accepts only FD3 plus the supervisor FD4 lease", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "rah-computer-service-command-"),
  );
  chmodSync(directory, 0o700);
  const expected = configuration(directory);
  const observed: Array<{
    configuration: NodeKCarrierComputerServiceConfiguration;
    configurationFd: number;
    supervisorFd: number;
  }> = [];
  try {
    assert.equal(
      await runNodeKCarrierComputerServiceCommand(
        ["__computer-service", "--config-fd=3", "--supervisor-fd=4"],
        {
          readConfiguration: (descriptor) => {
            assert.equal(descriptor, 3);
            return expected;
          },
          runConfiguredService: async (input) => {
            observed.push({
              configuration: input.configuration,
              configurationFd: input.configurationFd,
              supervisorFd: input.supervisorFd,
            });
            return { kind: "stopped" };
          },
        },
      ),
      0,
    );
    assert.deepEqual(observed, [
      {
        configuration: expected,
        configurationFd: 3,
        supervisorFd: 4,
      },
    ]);
    await assert.rejects(
      runNodeKCarrierComputerServiceCommand(
        ["__computer-service", "--config-fd=3", "--supervisor-fd=4"],
        {
          artifactBuildVersion: () => "9.9.9",
          readConfiguration: () => expected,
          runConfiguredService: async () => {
            throw new Error("mismatched artifact must not start");
          },
        },
      ),
      /does not match the signed artifact build/u,
    );
    await assert.rejects(
      runNodeKCarrierComputerServiceCommand(
        ["__computer-service", "--config-fd=4", "--supervisor-fd=3"],
        {
          readConfiguration: () => expected,
          runConfiguredService: async () => ({ kind: "stopped" }),
        },
      ),
      /usage/u,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("configured Computer service opens active profiles and publishes their proven Offers", async () => {
  const directory = mkdtempSync("/tmp/rah-svc-entry-");
  chmodSync(directory, 0o700);
  const config = configuration(directory);
  for (const path of [
    config.socketDirectory,
    config.supervisorDirectory,
    join(directory, "k"),
  ]) {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(path, { mode: 0o700 });
  }
  writeFileSync(join(directory, "provider-token"), "provider-secret\n", {
    mode: 0o600,
  });
  const attachments = new ComputerAttachmentStore({
    statePath: config.attachmentStatePath,
  });
  await attachments.save([
    {
      attachmentId: "primary",
      connectionId: "connection-primary",
      createdAt: "2026-08-28T00:00:00.000Z",
      hostAccessToken: `rah_host_${"a".repeat(48)}`,
      origin: "https://control.example.test",
    },
  ]);
  const registry = new RuntimeProfileRegistry({
    databasePath: config.runtimes[0]!.registryDatabasePath,
    hostId: config.runtimeRegistryOwnerId,
  });
  registry.initialize();
  const imported = registry.importManifest(runtimeManifest());
  const implementations = new RuntimeImplementationRegistry();
  registry.recordProbeReport(
    await implementations.probeRevision(imported, { cwd: directory }),
  );
  registry.activateRevision({
    contentDigest: imported.contentDigest,
    runtimeProfileRevisionId: imported.runtimeProfileRevisionId,
  });
  registry.close();

  const ownershipToken = "b".repeat(64);
  const upgradeToken = "c".repeat(64);
  const upgradeConfiguration: NodeKCarrierComputerUpgradeProcessConfiguration =
    {
      attachmentStatePath: config.attachmentStatePath,
      ownershipControlToken: ownershipToken,
      ownershipSocketPath: new UnixSocketInstanceLock({
        directory: config.socketDirectory,
        hostId: NODE_K_CARRIER_COMPUTER_SERVICE_OWNERSHIP_HOST_ID,
      }).socketPath,
      receiptStatePath: join(directory, "operation-receipt.json"),
      releaseBaseUrl: "https://releases.example.test/computer",
      releasePublicKeyPem: "test-only",
      requestPath: join(directory, "upgrade-request.json"),
      runtimeProtocolVersion: config.runtimeProtocolVersion,
      serviceConfigurationPath: join(directory, "service.json"),
      stateDir: join(directory, "k"),
      supervisorControlSocketPath: join(directory, "supervisor.sock"),
      supervisorControlTimeoutMs: 1_000,
      supervisorControlToken: "d".repeat(64),
      upgradeControlSocketPath: new UnixSocketInstanceLock({
        directory: config.socketDirectory,
        hostId: NODE_K_CARRIER_COMPUTER_SERVICE_UPGRADE_CONTROL_HOST_ID,
      }).socketPath,
      upgradeControlToken: upgradeToken,
    };
  const client = new EntryControlClient();
  let recovered = 0;
  try {
    assert.deepEqual(
      await runNodeKCarrierComputerServiceFromConfiguration({
        configuration: config,
        configurationFd: 3,
        runtime: {
          computerInstanceId: "computer-service-entry-instance",
          createControlClient: () => client,
          loadUpgradeConfiguration: () => upgradeConfiguration,
          recoverUpgrade: async () => {
            recovered += 1;
            return { kind: "idle" };
          },
          runServiceProcess: async (options) => {
            assert.equal(options.buildVersion, "1.2.3");
            assert.equal(
              options.computerInstanceId,
              "computer-service-entry-instance",
            );
            assert.equal(options.ownershipControlToken, ownershipToken);
            assert.equal(options.upgradeControlToken, upgradeToken);
            const controller = new AbortController();
            const running = options.workload.run({
              signal: controller.signal,
            });
            try {
              await options.workload.ready();
              await Promise.race([
                waitFor(
                  () => client.publishedOffers.length >= 1,
                  () => `condition timed out; calls=${client.calls.join(",")}`,
                ),
                running.then(() => {
                  throw new Error("Computer workload stopped before Offer");
                }),
              ]);
              await options.startupRecovery?.();
            } finally {
              controller.abort("fixture complete");
              await running.catch(() => undefined);
            }
            return { kind: "stopped" };
          },
          selfCommand: {
            argumentPrefix: [],
            executablePath: process.execPath,
          },
          supervisorShutdownSignal: new AbortController().signal,
        },
        supervisorFd: 4,
      }),
      { kind: "stopped" },
    );
    assert.equal(recovered, 1);
    assert.deepEqual(
      client.publishedOffers.slice(0, 1).map((offer) => ({
        hostId: offer.hostId,
        maxConcurrent: offer.maxConcurrent,
        runtimeOfferId: offer.runtimeOfferId,
        state: offer.state,
        workspaceMountDescriptors: offer.workspaceMountDescriptors,
      })),
      [
        {
          hostId: "host-primary",
          maxConcurrent: 2,
          runtimeOfferId: "offer-primary",
          state: "available",
          workspaceMountDescriptors: [
            {
              modes: ["in_place"],
              workspaceDefinitionId: "workspace-primary",
              workspaceMountDigest: `sha256:${"a".repeat(64)}`,
              workspaceMountRevisionId: "workspace-mount-primary-v1",
            },
          ],
        },
      ],
    );

    const recoveryClient = new EntryControlClient();
    await assert.rejects(
      runNodeKCarrierComputerServiceFromConfiguration({
        configuration: config,
        configurationFd: 3,
        runtime: {
          computerInstanceId: "computer-service-recovery-instance",
          createControlClient: () => recoveryClient,
          loadUpgradeConfiguration: () => upgradeConfiguration,
          recoverUpgrade: async () => ({
            failureCode: "unexpected_service_identity",
            kind: "recovery_required",
          }),
          runServiceProcess: async (options) => {
            const controller = new AbortController();
            const running = options.workload.run({
              signal: controller.signal,
            });
            try {
              await options.workload.ready();
              await options.startupRecovery?.();
              assert.fail("startup recovery should fail closed");
            } finally {
              controller.abort("fixture complete");
              await running.catch(() => undefined);
            }
            return { kind: "stopped" };
          },
          selfCommand: {
            argumentPrefix: [],
            executablePath: process.execPath,
          },
          supervisorShutdownSignal: new AbortController().signal,
        },
        supervisorFd: 4,
      }),
      /startup recovery failed closed: unexpected_service_identity/u,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

function runtimeManifest(): RuntimeProfileManifestV2 {
  return {
    adapter: {
      config: { diagnosticByteLimit: 4_096, terminationGraceMs: 100 },
      executable: process.execPath,
      fixedArgs: ["-e", "process.exit(0)"],
      kind: "generic-process/v1",
    },
    credentialSlots: [
      {
        slotId: "provider-token",
        target: { kind: "environment", variable: "PROVIDER_TOKEN" },
      },
    ],
    declaredCapabilities: ["worker_commands"],
    displayName: "Computer service entry fixture",
    manifestVersion: 2,
    protocolFamily: "rah-worker-process/v1",
    recoveryDrivers:
      process.platform === "win32" ? [] : ["rah-process-supervisor-v1"],
    runtimeProfileId: "runtime-primary",
    staticEnv: {},
    workspacePolicy: { allowedModes: ["in_place"] },
  };
}

class EntryControlClient implements ComputerControlClientPort {
  readonly calls: string[] = [];
  readonly publishedOffers: ComputerRuntimeOfferPublishRequest["offer"][] = [];

  async acknowledgeOperation(): Promise<never> {
    throw new Error("managed operations are not used by this fixture");
  }

  async claimOperation(): Promise<never> {
    throw new Error("managed operations are not used by this fixture");
  }

  async commandExecution(): Promise<never> {
    throw new Error("execution commands are not used by this fixture");
  }

  async issueWorkerCredential(): Promise<never> {
    throw new Error("Worker credentials are not used by this fixture");
  }

  async revokeWorkerCredential(): Promise<never> {
    throw new Error("Worker credentials are not used by this fixture");
  }

  async openSession(
    request: ComputerSessionOpenRequest,
  ): Promise<ComputerSessionOpenResponse> {
    this.calls.push("open");
    assert.equal(request.computerInstanceId, "computer-service-entry-instance");
    return {
      acceptedControlApiVersion: 1,
      hostId: "host-primary",
      hostInstanceId: "instance-primary",
      serverTime: "2026-08-28T00:00:00.000Z",
      sessionAccessToken: `rah_host_session_${"e".repeat(32)}_primary`,
      sessionExpiresAt: "2026-08-28T00:01:00.000Z",
    };
  }

  async heartbeat(
    _token: string,
    request: ComputerHeartbeatRequest,
  ): Promise<ComputerHeartbeatResponse> {
    this.calls.push(`heartbeat:${request.state}`);
    return {
      host: {
        hostId: "host-primary",
        instanceId: "instance-primary",
        lastSeenAt: "2026-08-28T00:00:01.000Z",
        participantIds: ["agent-primary"],
        state: request.state,
      },
      serverTime: "2026-08-28T00:00:01.000Z",
      sessionExpiresAt: "2026-08-28T00:01:01.000Z",
    };
  }

  async publishRuntimeOffer(
    _token: string,
    request: ComputerRuntimeOfferPublishRequest,
  ): Promise<ComputerRuntimeOfferPublishResponse> {
    this.calls.push("offer");
    this.publishedOffers.push(request.offer);
    return {
      offer: {
        ...request.offer,
        acceptedAt: request.offer.observedAt,
        resolvedCertifications: [],
        runtimeOfferObservationId: "offer-observation-entry",
        runtimeOfferSnapshotDigest: `sha256:${"f".repeat(64)}`,
      },
    };
  }

  async claimPlacement(
    _token: string,
    _request: ComputerPlacementClaimRequest,
  ): Promise<ComputerPlacementClaimResponse> {
    this.calls.push("claim");
    return { claim: null };
  }
}

async function waitFor(
  predicate: () => boolean,
  message: () => string = () => "condition timed out",
): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message());
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
