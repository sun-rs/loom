import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ComputerServiceReplacementCoordinator,
  createComputerServiceOwnershipProofToken,
  DaemonAlreadyRunningError,
  readComputerServiceOwnershipProof,
  UnixSocketInstanceLock,
} from "../src/index.ts";

const fixture = new URL(
  "./fixtures/computer-service-candidate.mjs",
  import.meta.url,
);

test("a real candidate process proves the exclusive service socket before commit", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "rah-csr-"));
  const incumbent = new UnixSocketInstanceLock({
    directory,
    hostId: "computer-service",
  });
  await incumbent.acquire();
  let child: ChildProcess | undefined;
  context.after(async () => {
    if (child?.pid !== undefined && alive(child.pid)) child.kill("SIGTERM");
    await waitForExit(child);
    await incumbent.release();
    await rm(directory, { force: true, recursive: true });
  });
  const controlToken = createComputerServiceOwnershipProofToken();
  const coordinator = new ComputerServiceReplacementCoordinator({
    candidateShutdownTimeoutMs: 100,
    currentProcessId: process.pid,
    isProcessAlive: alive,
    nowMs: Date.now,
    readCandidateAttestation: async ({ candidateProcessId, timeoutMs }) =>
      await readComputerServiceOwnershipProof({
        candidateProcessId,
        controlToken,
        socketPath: incumbent.socketPath,
        timeoutMs: Math.max(1, timeoutMs),
      }),
    releaseOwnership: async () => await incumbent.release(),
    restoreOwnership: async () => await incumbent.acquire(),
    scheduleIncumbentExit: () => undefined,
    signalProcess: (processId, signal) => process.kill(processId, signal),
    snapshotManagedAttachmentIdentities: async () => ({
      primary: "connection-primary",
      secondary: "connection-secondary",
    }),
    spawnCandidate: async ({ expectedBuildVersion, sourceProcessId }) => {
      child = launchCandidate({
        buildVersion: expectedBuildVersion,
        controlToken,
        directory,
        sourceProcessId,
      });
      assert.ok(child.pid !== undefined);
      await waitForCandidateReady(child);
      return child.pid;
    },
    takeoverTimeoutMs: 2_000,
    wait,
  });

  const prepared = await coordinator.prepare({
    expectedBuildVersion: "computer/2.0.0",
    operationId: "real-replacement",
  });
  assert.equal(prepared.candidateProcessId, child?.pid);
  assert.equal(alive(prepared.candidateProcessId), true);
  assert.equal(
    (await coordinator.commit("real-replacement")).state,
    "committed",
  );
});

test("a real mismatched candidate is terminated before incumbent ownership returns", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "rah-csr-f-"));
  const incumbent = new UnixSocketInstanceLock({
    directory,
    hostId: "computer-service",
  });
  await incumbent.acquire();
  let child: ChildProcess | undefined;
  context.after(async () => {
    if (child?.pid !== undefined && alive(child.pid)) child.kill("SIGKILL");
    await waitForExit(child);
    await incumbent.release();
    await rm(directory, { force: true, recursive: true });
  });
  const controlToken = createComputerServiceOwnershipProofToken();
  const coordinator = new ComputerServiceReplacementCoordinator({
    attestationPollIntervalMs: 10,
    candidateShutdownTimeoutMs: 100,
    currentProcessId: process.pid,
    isProcessAlive: alive,
    nowMs: Date.now,
    readCandidateAttestation: async ({ candidateProcessId, timeoutMs }) =>
      await readComputerServiceOwnershipProof({
        candidateProcessId,
        controlToken,
        socketPath: incumbent.socketPath,
        timeoutMs: Math.max(1, timeoutMs),
      }),
    releaseOwnership: async () => await incumbent.release(),
    restoreOwnership: async () => await incumbent.acquire(),
    scheduleIncumbentExit: () => undefined,
    signalProcess: (processId, signal) => process.kill(processId, signal),
    snapshotManagedAttachmentIdentities: async () => ({
      primary: "connection-primary",
      secondary: "connection-secondary",
    }),
    spawnCandidate: async ({ sourceProcessId }) => {
      child = launchCandidate({
        buildVersion: "computer/forged",
        controlToken,
        directory,
        sourceProcessId,
      });
      assert.ok(child.pid !== undefined);
      await waitForCandidateReady(child);
      return child.pid;
    },
    takeoverTimeoutMs: 100,
    wait,
  });

  await assert.rejects(
    coordinator.prepare({
      expectedBuildVersion: "computer/2.0.0",
      operationId: "real-replacement-failure",
    }),
    /exclusive ownership and identity/u,
  );
  assert.equal(child?.pid === undefined || alive(child.pid), false);
  const competitor = new UnixSocketInstanceLock({
    directory,
    hostId: "computer-service",
  });
  await assert.rejects(competitor.acquire(), DaemonAlreadyRunningError);
});

function launchCandidate(input: {
  buildVersion: string;
  controlToken: string;
  directory: string;
  sourceProcessId: number;
}): ChildProcess {
  return spawn(process.execPath, [fixture.pathname], {
    env: {
      RAH_TEST_COMPUTER_SERVICE_CONFIG: JSON.stringify({
        buildVersion: input.buildVersion,
        candidateComputerInstanceId: "candidate-computer-boot",
        directory: input.directory,
        hostId: "computer-service",
        managedAttachmentIds: ["primary", "secondary"],
        managedAttachmentIdentities: {
          primary: "connection-primary",
          secondary: "connection-secondary",
        },
        serviceGeneration: "candidate-service-generation",
        sourceProcessId: input.sourceProcessId,
      }),
      RAH_TEST_COMPUTER_SERVICE_TOKEN: input.controlToken,
    },
    shell: false,
    stdio: ["ignore", "ignore", "pipe", "pipe"],
  });
}

function alive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForExit(child: ChildProcess | undefined): Promise<void> {
  if (
    child === undefined ||
    child.exitCode !== null ||
    child.signalCode !== null
  )
    return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 2_000);
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// The fixture announces readiness only after acquiring the socket and setting
// its owner-private permissions. Readiness does not replace the signed proof.
async function waitForCandidateReady(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const pipe = child.stdio[3];
    let body = "";
    const finish = (error?: Error) => {
      clearTimeout(timer);
      pipe?.off("data", data);
      child.off("exit", exited);
      child.off("error", finish);
      if (error) reject(error);
      else resolve();
    };
    const exited = () => finish(new Error("Candidate exited before readiness"));
    const data = (chunk: Buffer) => {
      body += chunk.toString("utf8");
      if (body.length > 1024)
        return finish(new Error("Invalid candidate readiness"));
      if (!body.includes("\n")) return;
      try {
        assert.equal(JSON.parse(body.trim()).processId, child.pid);
        finish();
      } catch (error) {
        finish(error as Error);
      }
    };
    const timer = setTimeout(
      () => finish(new Error("Candidate readiness timed out")),
      2000,
    );
    pipe?.on("data", data);
    child.once("exit", exited);
    child.once("error", finish);
  });
}
