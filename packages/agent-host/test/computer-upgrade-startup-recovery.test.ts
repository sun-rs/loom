import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ComputerUpgradeCoordinatorRequestStore,
  planComputerUpgradeStartupRecovery,
  recoverNodeKCarrierComputerUpgradeOnServiceStartup,
  type ComputerUpgradeCoordinatorRequest,
} from "../src/index.ts";

const request: ComputerUpgradeCoordinatorRequest = {
  carrier: "rah-k",
  controlAttachmentId: "primary",
  currentArtifactPath: "/private/rah/computer-1.0.0",
  managedAttachmentIdentities: {
    primary: "connection-primary",
    secondary: "connection-secondary",
  },
  mode: "upgrade",
  operationId: "startup-recovery-1",
  requestedAt: "2026-08-28T17:00:00.000Z",
  sourceBuildVersion: "1.0.0",
  sourceComputerInstanceId: "source-instance",
  targetBuildVersion: "2.0.0",
};

test("startup recovery relaunches the coordinator from the frozen source service", () => {
  assert.deepEqual(
    planComputerUpgradeStartupRecovery({
      currentProcessId: 42,
      liveAttestation: attestation({
        buildVersion: "1.0.0",
        candidateComputerInstanceId: "source-instance",
        candidateProcessId: 42,
      }),
      request,
    }),
    {
      kind: "launch_coordinator",
      operationId: "startup-recovery-1",
    },
  );
});

test("startup recovery accepts a new source process generation on the frozen source build", () => {
  assert.deepEqual(
    planComputerUpgradeStartupRecovery({
      currentProcessId: 84,
      liveAttestation: attestation({
        candidateComputerInstanceId: "restarted-source-instance",
        candidateProcessId: 84,
      }),
      request,
    }),
    {
      kind: "launch_coordinator",
      operationId: "startup-recovery-1",
    },
  );
});

test("startup recovery lets only the target successor finish ready", () => {
  assert.deepEqual(
    planComputerUpgradeStartupRecovery({
      currentProcessId: 77,
      liveAttestation: attestation({
        buildVersion: "2.0.0",
        candidateComputerInstanceId: "successor-instance",
        candidateProcessId: 77,
      }),
      request,
    }),
    {
      kind: "acknowledge_successor",
      ready: {
        observedBuildVersion: "2.0.0",
        operationId: "startup-recovery-1",
        successorComputerInstanceId: "successor-instance",
      },
    },
  );
});

test("startup recovery fails closed on process, build, or attachment drift", () => {
  for (const liveAttestation of [
    attestation({ candidateProcessId: 41 }),
    attestation({ buildVersion: "3.0.0" }),
    attestation({
      managedAttachmentIdentities: { primary: "connection-changed" },
      managedAttachmentIds: ["primary"],
    }),
  ]) {
    assert.equal(
      planComputerUpgradeStartupRecovery({
        currentProcessId: 42,
        liveAttestation,
        request,
      }).kind,
      "recovery_required",
    );
  }
});

test("startup recovery is idle only when the current singleton has no request", () => {
  assert.deepEqual(
    planComputerUpgradeStartupRecovery({
      currentProcessId: 42,
      liveAttestation: attestation(),
      request: null,
    }),
    { kind: "idle" },
  );
});

test("startup recovery executor launches source recovery and successor ready through distinct effects", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-k-startup-executor-"));
  chmodSync(directory, 0o700);
  const requestPath = join(directory, "request.json");
  const artifactPath = join(directory, "computer");
  const configurationPath = join(directory, "configuration.json");
  writeFileSync(artifactPath, "trusted", { mode: 0o700 });
  writeFileSync(configurationPath, "{}", { mode: 0o600 });
  const durableRequest = {
    ...request,
    currentArtifactPath: artifactPath,
  };
  const requestStore = new ComputerUpgradeCoordinatorRequestStore({
    requestPath,
  });
  await requestStore.save(durableRequest);
  const configuration = {
    attachmentStatePath: join(directory, "attachments.json"),
    ownershipControlToken: "a".repeat(64),
    ownershipSocketPath: join(directory, "ownership.sock"),
    receiptStatePath: join(directory, "receipt.json"),
    releaseBaseUrl: "https://releases.example/rah-computer",
    releasePublicKeyPem: "fixture-public-key",
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
  const launchEffects: unknown[] = [];
  try {
    assert.deepEqual(
      await recoverNodeKCarrierComputerUpgradeOnServiceStartup({
        configuration,
        configurationPath,
        currentProcessId: 42,
        executablePath: "/private/rah/computer",
        runtime: {
          acknowledgeSuccessor: async () => {
            throw new Error("source must not acknowledge successor ready");
          },
          launchCoordinator: async (input) => {
            launchEffects.push(input);
            return { processId: 73, requestPath: input.requestPath };
          },
          readLiveAttestation: async () => attestation(),
        },
      }),
      {
        kind: "coordinator_launched",
        operationId: "startup-recovery-1",
        processId: 73,
      },
    );
    assert.deepEqual(launchEffects, [{ configurationPath, requestPath }]);

    const successorEffects: unknown[] = [];
    assert.deepEqual(
      await recoverNodeKCarrierComputerUpgradeOnServiceStartup({
        configuration,
        configurationPath,
        currentProcessId: 77,
        executablePath: "/private/rah/computer",
        runtime: {
          acknowledgeSuccessor: async (_configuration, ready) => {
            successorEffects.push(ready);
            return {
              kind: "ready_acknowledged",
              operationId: ready.operationId,
            };
          },
          launchCoordinator: async () => {
            throw new Error("successor must not relaunch the coordinator");
          },
          readLiveAttestation: async () =>
            attestation({
              buildVersion: "2.0.0",
              candidateComputerInstanceId: "successor-instance",
              candidateProcessId: 77,
            }),
        },
      }),
      {
        kind: "successor_acknowledged",
        operationId: "startup-recovery-1",
      },
    );
    assert.deepEqual(successorEffects, [
      {
        observedBuildVersion: "2.0.0",
        operationId: "startup-recovery-1",
        successorComputerInstanceId: "successor-instance",
      },
    ]);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

function attestation(
  overrides: Partial<{
    buildVersion: string;
    candidateComputerInstanceId: string;
    candidateProcessId: number;
    managedAttachmentIds: string[];
    managedAttachmentIdentities: Record<string, string>;
  }> = {},
) {
  return {
    buildVersion: "1.0.0",
    candidateComputerInstanceId: "source-instance",
    candidateProcessId: 42,
    managedAttachmentIds: ["primary", "secondary"],
    managedAttachmentIdentities: {
      primary: "connection-primary",
      secondary: "connection-secondary",
    },
    serviceGeneration: "service-generation",
    sourceProcessId: 1,
    ...overrides,
  };
}
