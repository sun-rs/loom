import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ComputerOperationReceiptStore,
  ComputerUpgradeCoordinatorRequestStore,
  ComputerUpgradeParkedAttachmentStore,
  createComputerServiceOwnershipProofToken,
  createNodeKCarrierComputerUpgradeRunner,
  readComputerServiceLiveAttestation,
  UnixSocketInstanceLock,
  type ComputerReleaseSourcePort,
  type ManagedComputerUpgradeControlPort,
} from "../src/index.ts";

test("K black box replaces a real Computer service and resumes the exact managed set", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "rah-k-blackbox-"));
  chmodSync(directory, 0o700);
  const kStateDir = join(directory, "k");
  const receiptDirectory = join(directory, "receipts");
  const socketDirectory = join(directory, "sockets");
  await Promise.all(
    [kStateDir, receiptDirectory, socketDirectory].map(
      async (path) => await mkdir(path, { mode: 0o700 }),
    ),
  );
  const ownershipControlToken = createComputerServiceOwnershipProofToken();
  const upgradeControlToken = createComputerServiceOwnershipProofToken();
  const managedAttachmentIdentities = {
    primary: "connection-primary",
    secondary: "connection-secondary",
  };
  const fixturePath = join(
    import.meta.dirname,
    "fixtures",
    "k-computer-service-child.mjs",
  );
  const sourceArtifactPath = join(directory, "computer-1.0.0");
  const targetScript = Buffer.from(
    `#!/bin/sh\nexec "${process.execPath}" "${fixturePath}" --build-version=2.0.0 "$@"\n`,
  );
  writeFileSync(
    sourceArtifactPath,
    `#!/bin/sh\nexec "${process.execPath}" "${fixturePath}" --build-version=1.0.0 "$@"\n`,
    { mode: 0o700 },
  );
  chmodSync(sourceArtifactPath, 0o500);
  const serviceConfigurationPath = join(directory, "service-config.json");
  writeFileSync(
    serviceConfigurationPath,
    JSON.stringify({
      managedAttachmentIdentities,
      ownershipControlToken,
      parkedAttachmentStateDir: kStateDir,
      socketDirectory,
      upgradeControlToken,
    }),
    { mode: 0o600 },
  );
  const ownershipAddress = new UnixSocketInstanceLock({
    directory: socketDirectory,
    hostId: "computer-service",
  });
  const controlAddress = new UnixSocketInstanceLock({
    directory: socketDirectory,
    hostId: "computer-service-upgrade-control",
  });
  let incumbent: ChildProcess | undefined;
  let successorProcessId: number | undefined;
  context.after(async () => {
    if (successorProcessId !== undefined && alive(successorProcessId)) {
      process.kill(successorProcessId, "SIGTERM");
    }
    if (incumbent?.pid !== undefined && alive(incumbent.pid)) {
      incumbent.kill("SIGKILL");
    }
    await waitUntil(
      () =>
        (successorProcessId === undefined || !alive(successorProcessId)) &&
        (incumbent?.pid === undefined || !alive(incumbent.pid)),
      2_000,
    ).catch(() => undefined);
    rmSync(directory, { force: true, recursive: true });
  });

  incumbent = launchInitialService(
    sourceArtifactPath,
    serviceConfigurationPath,
  );
  const incumbentAttestation = await waitForAttestation({
    controlToken: ownershipControlToken,
    socketPath: ownershipAddress.socketPath,
  });
  assert.equal(incumbentAttestation.buildVersion, "1.0.0");
  assert.equal(incumbentAttestation.candidateProcessId, incumbent.pid);

  const requestStore = new ComputerUpgradeCoordinatorRequestStore({
    requestPath: join(directory, "upgrade-request.json"),
  });
  await requestStore.save({
    carrier: "rah-k",
    controlAttachmentId: "primary",
    currentArtifactPath: sourceArtifactPath,
    managedAttachmentIdentities,
    mode: "upgrade",
    operationId: "blackbox-upgrade-1",
    requestedAt: "2026-08-28T13:00:00.000Z",
    sourceBuildVersion: "1.0.0",
    sourceComputerInstanceId: incumbentAttestation.candidateComputerInstanceId,
    targetBuildVersion: "2.0.0",
  });
  const acknowledgements: unknown[] = [];
  const control: ManagedComputerUpgradeControlPort = {
    acknowledgeOperation: async (request) => {
      acknowledgements.push(request);
      return {
        accepted: true,
        terminal: request.kind !== "operation.progress",
      };
    },
  };
  const release: ComputerReleaseSourcePort = {
    checkForUpdate: async () => null,
    fetchRelease: async (version, input) => ({
      file: "computer",
      platformKey: input.platformKey,
      sha256: createHash("sha256").update(targetScript).digest("hex"),
      size: targetScript.byteLength,
      url: "https://releases.example/2.0.0/computer",
      version,
    }),
    materializeVerifiedRelease: async (input) => {
      writeFileSync(input.destinationPath, targetScript, { mode: 0o600 });
      return { ...input.release, path: input.destinationPath };
    },
  };
  const receipts = new ComputerOperationReceiptStore({
    statePath: join(receiptDirectory, "operation.json"),
  });
  const runner = createNodeKCarrierComputerUpgradeRunner({
    createControl: async (request) => {
      assert.equal(request.controlAttachmentId, "primary");
      return control;
    },
    onSlotServiceLaunched: (launch) => {
      successorProcessId = launch.processId;
    },
    ownershipControlToken,
    ownershipSocketPath: ownershipAddress.socketPath,
    receiptStatePath: join(receiptDirectory, "operation.json"),
    releaseSource: release,
    requestPath: join(directory, "upgrade-request.json"),
    requestTimeoutMs: 1_000,
    resumePollIntervalMs: 10,
    resumeTimeoutMs: 2_000,
    serviceConfigurationPath,
    stateDir: kStateDir,
    stopPollIntervalMs: 10,
    stopTimeoutMs: 2_000,
    upgradeControlSocketPath: controlAddress.socketPath,
    upgradeControlToken,
  });

  assert.deepEqual(await runner.run(), {
    kind: "awaiting_successor",
    operationId: "blackbox-upgrade-1",
  });
  assert.ok(successorProcessId !== undefined);
  assert.equal(alive(incumbentAttestation.candidateProcessId), false);
  const successor = await waitForAttestation({
    controlToken: ownershipControlToken,
    socketPath: ownershipAddress.socketPath,
  });
  assert.equal(successor.buildVersion, "2.0.0");
  assert.notEqual(
    successor.serviceGeneration,
    incumbentAttestation.serviceGeneration,
  );
  assert.equal(
    readFileSync(join(kStateDir, "slots", "stable", "VERSION"), "utf8"),
    "2.0.0",
  );
  assert.equal(
    await new ComputerUpgradeParkedAttachmentStore({
      stateDir: kStateDir,
    }).read(),
    null,
  );

  assert.deepEqual(
    await runner.acknowledgeSuccessorReady({
      observedBuildVersion: "2.0.0",
      operationId: "blackbox-upgrade-1",
      successorComputerInstanceId: successor.candidateComputerInstanceId,
    }),
    { kind: "ready_acknowledged", operationId: "blackbox-upgrade-1" },
  );
  assert.equal(await requestStore.read(), null);
  assert.equal(await receipts.read(), null);
  assert.equal(
    (acknowledgements.at(-1) as { kind?: string }).kind,
    "operation.ready",
  );
});

function launchInitialService(
  artifactPath: string,
  configurationPath: string,
): ChildProcess {
  const configuration = openSync(configurationPath, "r");
  try {
    const child = spawn(artifactPath, ["__computer-service", "--config-fd=3"], {
      detached: true,
      env: Object.create(null) as NodeJS.ProcessEnv,
      stdio: ["ignore", "ignore", "ignore", configuration],
      windowsHide: true,
    });
    child.unref();
    return child;
  } finally {
    closeSync(configuration);
  }
}

async function waitForAttestation(input: {
  controlToken: string;
  socketPath: string;
}) {
  let observed = null;
  await waitUntil(async () => {
    try {
      observed = await readComputerServiceLiveAttestation({
        ...input,
        timeoutMs: 100,
      });
      return observed !== null;
    } catch {
      // listen() precedes chmod(0600); only a later private socket is eligible.
      return false;
    }
  }, 3_000);
  return observed!;
}

function alive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
