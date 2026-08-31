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

import {
  ComputerUpgradeCoordinatorRequestStore,
  NODE_K_CARRIER_COMPUTER_UPGRADE_PROCESS_CONFIGURATION_SCHEMA_VERSION,
  readNodeKCarrierComputerUpgradeProcessConfiguration,
  verifyNodeKCarrierComputerUpgradeSuccessor,
} from "../src/index.ts";

test("detached K process configuration is strict and owner-private", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-k-process-config-"));
  chmodSync(directory, 0o700);
  const configurationPath = join(directory, "coordinator.json");
  const configuration = {
    attachmentStatePath: join(directory, "attachments.json"),
    ownershipControlToken: "a".repeat(64),
    ownershipSocketPath: join(directory, "ownership.sock"),
    receiptStatePath: join(directory, "receipt.json"),
    releaseBaseUrl: "https://releases.example/rah-computer",
    releasePublicKeyPem:
      "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n-----END PUBLIC KEY-----\n",
    requestPath: join(directory, "request.json"),
    runtimeProtocolVersion: 1,
    serviceConfigurationPath: configurationPath,
    stateDir: join(directory, "k"),
    supervisorControlSocketPath: join(directory, "supervisor.sock"),
    supervisorControlTimeoutMs: 2_000,
    supervisorControlToken: "c".repeat(64),
    upgradeControlSocketPath: join(directory, "upgrade.sock"),
    upgradeControlToken: "b".repeat(64),
  };
  writeFileSync(
    configurationPath,
    `${JSON.stringify({
      configuration,
      schemaVersion:
        NODE_K_CARRIER_COMPUTER_UPGRADE_PROCESS_CONFIGURATION_SCHEMA_VERSION,
    })}\n`,
    { mode: 0o600 },
  );
  let descriptor = openSync(configurationPath, "r");
  try {
    assert.deepEqual(
      JSON.parse(
        JSON.stringify(
          readNodeKCarrierComputerUpgradeProcessConfiguration(descriptor),
        ),
      ),
      configuration,
    );
  } finally {
    closeSync(descriptor);
  }

  const {
    supervisorControlSocketPath: _socketPath,
    supervisorControlTimeoutMs: _timeoutMs,
    supervisorControlToken: _controlToken,
    ...withoutSupervisor
  } = configuration;
  writeFileSync(
    configurationPath,
    `${JSON.stringify({
      configuration: withoutSupervisor,
      schemaVersion:
        NODE_K_CARRIER_COMPUTER_UPGRADE_PROCESS_CONFIGURATION_SCHEMA_VERSION,
    })}\n`,
    { mode: 0o600 },
  );
  descriptor = openSync(configurationPath, "r");
  try {
    assert.throws(
      () => readNodeKCarrierComputerUpgradeProcessConfiguration(descriptor),
      /supervisor/u,
    );
  } finally {
    closeSync(descriptor);
  }

  chmodSync(configurationPath, 0o644);
  descriptor = openSync(configurationPath, "r");
  try {
    assert.throws(
      () => readNodeKCarrierComputerUpgradeProcessConfiguration(descriptor),
      /owner-private/u,
    );
  } finally {
    closeSync(descriptor);
    rmSync(directory, { force: true, recursive: true });
  }
});

test("successor ready requires the calling process to own the live singleton", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-k-successor-proof-"));
  chmodSync(directory, 0o700);
  const requestPath = join(directory, "request.json");
  const artifactPath = join(directory, "computer");
  writeFileSync(artifactPath, "trusted", { mode: 0o700 });
  await new ComputerUpgradeCoordinatorRequestStore({ requestPath }).save({
    carrier: "rah-k",
    controlAttachmentId: "primary",
    currentArtifactPath: artifactPath,
    managedAttachmentIdentities: { primary: "connection-primary" },
    mode: "upgrade",
    operationId: "successor-proof-1",
    requestedAt: "2026-08-28T16:00:00.000Z",
    sourceBuildVersion: "1.0.0",
    sourceComputerInstanceId: "source-instance",
    targetBuildVersion: "2.0.0",
  });
  const configuration = {
    attachmentStatePath: join(directory, "attachments.json"),
    ownershipControlToken: "a".repeat(64),
    ownershipSocketPath: join(directory, "ownership.sock"),
    receiptStatePath: join(directory, "receipt.json"),
    releaseBaseUrl: "https://releases.example/rah-computer",
    releasePublicKeyPem: "unused-by-attestation-gate",
    requestPath,
    runtimeProtocolVersion: 1,
    serviceConfigurationPath: join(directory, "service.json"),
    stateDir: join(directory, "k"),
    supervisorControlSocketPath: join(directory, "supervisor.sock"),
    supervisorControlTimeoutMs: 2_000,
    supervisorControlToken: "c".repeat(64),
    upgradeControlSocketPath: join(directory, "upgrade.sock"),
    upgradeControlToken: "b".repeat(64),
  };
  const ready = {
    observedBuildVersion: "2.0.0",
    operationId: "successor-proof-1",
    successorComputerInstanceId: "successor-instance",
  };
  try {
    await assert.rejects(
      verifyNodeKCarrierComputerUpgradeSuccessor(configuration, ready, {
        currentProcessId: 42,
        readLiveAttestation: async () => ({
          buildVersion: "2.0.0",
          candidateComputerInstanceId: "successor-instance",
          candidateProcessId: 41,
          managedAttachmentIds: ["primary"],
          managedAttachmentIdentities: { primary: "connection-primary" },
          serviceGeneration: "successor-generation",
          sourceProcessId: 40,
        }),
      }),
      /calling process does not own the live Computer singleton/u,
    );

    await assert.doesNotReject(
      verifyNodeKCarrierComputerUpgradeSuccessor(configuration, ready, {
        currentProcessId: 42,
        readLiveAttestation: async () => ({
          buildVersion: "2.0.0",
          candidateComputerInstanceId: "successor-instance",
          candidateProcessId: 42,
          managedAttachmentIds: ["primary"],
          managedAttachmentIdentities: { primary: "connection-primary" },
          serviceGeneration: "successor-generation",
          sourceProcessId: 40,
        }),
      }),
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
