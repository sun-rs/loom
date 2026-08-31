import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { lstat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  createComputerServiceOwnershipProofToken,
  readComputerServiceLiveAttestation,
  requestComputerServiceUpgradeControl,
  runNodeKCarrierComputerServiceProcess,
  UnixSocketInstanceLock,
  type NodeKCarrierComputerServiceWorkload,
} from "../src/index.ts";

test("Node Computer service process owns singleton, upgrade control, recovery, and workload shutdown", async () => {
  const directory = mkdtempSync("/tmp/rah-svc-");
  chmodSync(directory, 0o700);
  const socketDirectory = join(directory, "sockets");
  await mkdir(socketDirectory, { mode: 0o700 });
  const ownershipControlToken = createComputerServiceOwnershipProofToken();
  const upgradeControlToken = createComputerServiceOwnershipProofToken();
  const signals = new EventEmitter();
  const workload = new FakeWorkload({ primary: "connection-primary" });
  let recovered = 0;
  const running = runNodeKCarrierComputerServiceProcess({
    buildVersion: "1.0.0",
    computerInstanceId: "computer-instance-1",
    ownershipControlToken,
    processId: 808,
    serviceGeneration: "service-generation-1",
    signalSource: signals,
    socketDirectory,
    sourceProcessId: 707,
    startupRecovery: async () => {
      recovered += 1;
    },
    upgradeControlToken,
    workload,
  });
  try {
    const ownershipSocketPath = new UnixSocketInstanceLock({
      directory: socketDirectory,
      hostId: "computer-service",
    }).socketPath;
    const upgradeControlSocketPath = new UnixSocketInstanceLock({
      directory: socketDirectory,
      hostId: "computer-service-upgrade-control",
    }).socketPath;
    const attestation = await waitForAttestation({
      controlToken: ownershipControlToken,
      socketPath: ownershipSocketPath,
    });
    assert.deepEqual(attestation, {
      buildVersion: "1.0.0",
      candidateComputerInstanceId: "computer-instance-1",
      candidateProcessId: 808,
      managedAttachmentIds: ["primary"],
      managedAttachmentIdentities: { primary: "connection-primary" },
      serviceGeneration: "service-generation-1",
      sourceProcessId: 707,
    });
    await requestComputerServiceUpgradeControl({
      controlToken: upgradeControlToken,
      expectedManagedAttachmentIdentities: {
        primary: "connection-primary",
      },
      expectedProcessId: 808,
      expectedServiceGeneration: "service-generation-1",
      operation: "hold",
      socketPath: upgradeControlSocketPath,
      timeoutMs: 1_000,
    });
    assert.deepEqual(workload.held, [{ primary: "connection-primary" }]);
    await requestComputerServiceUpgradeControl({
      controlToken: upgradeControlToken,
      expectedProcessId: 808,
      expectedServiceGeneration: "service-generation-1",
      operation: "release",
      socketPath: upgradeControlSocketPath,
      timeoutMs: 1_000,
    });
    assert.equal(workload.releases, 1);
    assert.equal(recovered, 1);
    signals.emit("SIGTERM");
    assert.deepEqual(await running, { kind: "stopped" });
    assert.equal(workload.stopped, true);
    assert.equal(
      await readComputerServiceLiveAttestation({
        controlToken: ownershipControlToken,
        socketPath: ownershipSocketPath,
        timeoutMs: 100,
      }),
      null,
    );
  } finally {
    signals.emit("SIGTERM");
    await running.catch(() => undefined);
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Node Computer service process rejects attachment drift before hold", async () => {
  const directory = mkdtempSync("/tmp/rah-svc-drift-");
  chmodSync(directory, 0o700);
  const socketDirectory = join(directory, "sockets");
  await mkdir(socketDirectory, { mode: 0o700 });
  const ownershipControlToken = createComputerServiceOwnershipProofToken();
  const upgradeControlToken = createComputerServiceOwnershipProofToken();
  const signals = new EventEmitter();
  const workload = new FakeWorkload({ primary: "connection-primary" });
  const running = runNodeKCarrierComputerServiceProcess({
    buildVersion: "1.0.0",
    ownershipControlToken,
    signalSource: signals,
    socketDirectory,
    upgradeControlToken,
    workload,
  });
  try {
    const ownershipSocketPath = new UnixSocketInstanceLock({
      directory: socketDirectory,
      hostId: "computer-service",
    }).socketPath;
    const upgradeControlSocketPath = new UnixSocketInstanceLock({
      directory: socketDirectory,
      hostId: "computer-service-upgrade-control",
    }).socketPath;
    const live = await waitForAttestation({
      controlToken: ownershipControlToken,
      socketPath: ownershipSocketPath,
    });
    await assert.rejects(
      requestComputerServiceUpgradeControl({
        controlToken: upgradeControlToken,
        expectedManagedAttachmentIdentities: {
          primary: "different-connection",
        },
        expectedProcessId: live.candidateProcessId,
        expectedServiceGeneration: live.serviceGeneration,
        operation: "hold",
        socketPath: upgradeControlSocketPath,
        timeoutMs: 1_000,
      }),
      /request was rejected/u,
    );
    assert.deepEqual(workload.held, []);
  } finally {
    signals.emit("SIGTERM");
    await running;
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Node Computer service attestation and startup recovery wait for workload readiness", async () => {
  const directory = mkdtempSync("/tmp/rah-svc-ready-");
  chmodSync(directory, 0o700);
  const socketDirectory = join(directory, "sockets");
  await mkdir(socketDirectory, { mode: 0o700 });
  const ownershipControlToken = createComputerServiceOwnershipProofToken();
  const signals = new EventEmitter();
  const workload = new FakeWorkload({ primary: "connection-primary" });
  workload.deferReady();
  let recovered = 0;
  const running = runNodeKCarrierComputerServiceProcess({
    buildVersion: "1.0.0",
    ownershipControlToken,
    signalSource: signals,
    socketDirectory,
    startupRecovery: async () => {
      recovered += 1;
    },
    upgradeControlToken: createComputerServiceOwnershipProofToken(),
    workload,
  });
  try {
    const ownershipSocketPath = new UnixSocketInstanceLock({
      directory: socketDirectory,
      hostId: "computer-service",
    }).socketPath;
    await waitUntil(async () => {
      try {
        return (await lstat(ownershipSocketPath)).isSocket();
      } catch {
        return false;
      }
    }, 2_000);
    assert.equal(recovered, 0);
    assert.equal(
      await readComputerServiceLiveAttestation({
        controlToken: ownershipControlToken,
        socketPath: ownershipSocketPath,
        timeoutMs: 20,
      }),
      null,
    );

    workload.resolveReady();
    assert.ok(
      await waitForAttestation({
        controlToken: ownershipControlToken,
        socketPath: ownershipSocketPath,
      }),
    );
    await waitUntil(() => recovered === 1, 2_000);
  } finally {
    workload.resolveReady();
    signals.emit("SIGTERM");
    await running;
    rmSync(directory, { force: true, recursive: true });
  }
});

class FakeWorkload implements NodeKCarrierComputerServiceWorkload {
  readonly held: Array<Readonly<Record<string, string>>> = [];
  releases = 0;
  stopped = false;
  readonly #identities: Readonly<Record<string, string>>;
  #readyPromise: Promise<void> = Promise.resolve();
  #resolveReady: (() => void) | undefined;

  constructor(identities: Readonly<Record<string, string>>) {
    this.#identities = identities;
  }

  deferReady(): void {
    this.#readyPromise = new Promise<void>((resolve) => {
      this.#resolveReady = resolve;
    });
  }

  resolveReady(): void {
    this.#resolveReady?.();
  }

  async holdManagedAttachments(
    expected: Readonly<Record<string, string>>,
  ): Promise<void> {
    this.held.push({ ...expected });
  }

  async managedAttachmentIdentities(): Promise<
    Readonly<Record<string, string>>
  > {
    return this.#identities;
  }

  async releaseManagedAttachmentsHold(): Promise<void> {
    this.releases += 1;
  }

  async ready(): Promise<void> {
    await this.#readyPromise;
  }

  async run(input: { signal: AbortSignal }): Promise<void> {
    await new Promise<void>((resolve) => {
      if (input.signal.aborted) {
        resolve();
        return;
      }
      input.signal.addEventListener("abort", () => resolve(), { once: true });
    });
    this.stopped = true;
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
      return false;
    }
  }, 2_000);
  return observed!;
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
