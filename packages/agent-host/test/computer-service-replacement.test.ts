import assert from "node:assert/strict";
import test from "node:test";

import {
  ComputerServiceReplacementBusyError,
  ComputerServiceReplacementCoordinator,
  ComputerServiceReplacementRecoveryError,
  type ComputerServiceReplacementAttestation,
} from "../src/index.ts";

function attestation(
  overrides: Partial<ComputerServiceReplacementAttestation> = {},
): ComputerServiceReplacementAttestation {
  return {
    buildVersion: "computer/2.0.0",
    candidateComputerInstanceId: "candidate-computer-boot",
    candidateProcessId: 202,
    managedAttachmentIds: ["primary", "secondary"],
    managedAttachmentIdentities: {
      primary: "connection-primary",
      secondary: "connection-secondary",
    },
    serviceGeneration: "candidate-service-generation",
    sourceProcessId: 101,
    ...overrides,
  };
}

test("replacement commits only after exact process, build, and managed attachment attestation", async () => {
  const events: string[] = [];
  const attestations: Array<ComputerServiceReplacementAttestation | null> = [
    null,
    attestation(),
  ];
  let nowMs = 1_000;
  const coordinator = new ComputerServiceReplacementCoordinator({
    beforeCommitExit: async () => {
      events.push("before-commit");
    },
    candidateShutdownTimeoutMs: 100,
    currentProcessId: 101,
    isProcessAlive: () => true,
    nowMs: () => nowMs,
    readCandidateAttestation: async () => attestations.shift() ?? null,
    releaseOwnership: async () => {
      events.push("release");
    },
    restoreOwnership: async () => {
      events.push("restore");
    },
    scheduleIncumbentExit: () => {
      events.push("schedule-exit");
    },
    signalProcess: () => {
      throw new Error("a proven candidate is never terminated");
    },
    snapshotManagedAttachmentIdentities: async () => ({
      secondary: "connection-secondary",
      primary: "connection-primary",
    }),
    spawnCandidate: async (input) => {
      events.push(
        `spawn:${input.operationId}:${input.expectedBuildVersion}:${String(input.sourceProcessId)}`,
      );
      return 202;
    },
    takeoverTimeoutMs: 1_000,
    wait: async (milliseconds) => {
      nowMs += milliseconds;
      events.push(`wait:${String(milliseconds)}`);
    },
  });

  assert.deepEqual(
    await coordinator.prepare({
      expectedBuildVersion: "computer/2.0.0",
      operationId: "replacement-operation-1",
    }),
    {
      candidateComputerInstanceId: "candidate-computer-boot",
      candidateProcessId: 202,
      operationId: "replacement-operation-1",
      serviceGeneration: "candidate-service-generation",
      state: "prepared",
    },
  );
  assert.deepEqual(events, [
    "release",
    "spawn:replacement-operation-1:computer/2.0.0:101",
    "wait:100",
  ]);
  assert.deepEqual(
    await coordinator.prepare({
      expectedBuildVersion: "computer/2.0.0",
      operationId: "replacement-operation-1",
    }),
    coordinator.snapshot(),
    "same operation replay returns the proven candidate",
  );
  await assert.rejects(
    coordinator.prepare({
      expectedBuildVersion: "computer/2.0.0",
      operationId: "replacement-operation-2",
    }),
    ComputerServiceReplacementBusyError,
  );

  assert.deepEqual(await coordinator.commit("replacement-operation-1"), {
    candidateComputerInstanceId: "candidate-computer-boot",
    candidateProcessId: 202,
    operationId: "replacement-operation-1",
    serviceGeneration: "candidate-service-generation",
    state: "committed",
  });
  assert.deepEqual(events.slice(-2), ["before-commit", "schedule-exit"]);
  assert.equal(events.includes("restore"), false);
});

test("replacement kills an unattested candidate and restores incumbent ownership", async () => {
  const signals: string[] = [];
  let nowMs = 2_000;
  let alive = true;
  let restoreAttempts = 0;
  const coordinator = new ComputerServiceReplacementCoordinator({
    candidateShutdownTimeoutMs: 100,
    currentProcessId: 303,
    isProcessAlive: () => alive,
    nowMs: () => nowMs,
    readCandidateAttestation: async () =>
      attestation({
        buildVersion: "computer/forged",
        candidateProcessId: 404,
        sourceProcessId: 303,
      }),
    releaseOwnership: async () => undefined,
    restoreOwnership: async () => {
      restoreAttempts += 1;
      if (restoreAttempts === 1) throw new Error("transient lock contention");
    },
    restoreOwnershipTimeoutMs: 200,
    scheduleIncumbentExit: () => {
      throw new Error("unattested candidate cannot commit");
    },
    signalProcess: (_processId, signal) => {
      signals.push(signal);
      if (signal === "SIGKILL") alive = false;
    },
    snapshotManagedAttachmentIdentities: async () => ({
      primary: "connection-primary",
      secondary: "connection-secondary",
    }),
    spawnCandidate: async () => 404,
    takeoverTimeoutMs: 200,
    wait: async (milliseconds) => {
      nowMs += milliseconds;
    },
  });

  await assert.rejects(
    coordinator.prepare({
      expectedBuildVersion: "computer/2.0.0",
      operationId: "replacement-operation-failure",
    }),
    /exclusive ownership and identity/u,
  );
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(alive, false);
  assert.equal(restoreAttempts, 2);
  assert.deepEqual(coordinator.snapshot(), { state: "idle" });
});

test("replacement is single-flight and replays only the identical preparation", async () => {
  let releases = 0;
  let spawns = 0;
  let releasePreparation: (() => void) | undefined;
  const preparationGate = new Promise<void>((resolve) => {
    releasePreparation = resolve;
  });
  const coordinator = new ComputerServiceReplacementCoordinator({
    candidateShutdownTimeoutMs: 10,
    currentProcessId: 101,
    isProcessAlive: () => false,
    nowMs: () => 1_000,
    readCandidateAttestation: async () => attestation(),
    releaseOwnership: async () => {
      releases += 1;
      await preparationGate;
    },
    restoreOwnership: async () => undefined,
    scheduleIncumbentExit: () => undefined,
    signalProcess: () => undefined,
    snapshotManagedAttachmentIdentities: async () => ({
      primary: "connection-primary",
      secondary: "connection-secondary",
    }),
    spawnCandidate: async () => {
      spawns += 1;
      return 202;
    },
    takeoverTimeoutMs: 100,
    wait: async () => undefined,
  });

  const first = coordinator.prepare({
    expectedBuildVersion: "computer/2.0.0",
    operationId: "single-flight-operation",
  });
  const replay = coordinator.prepare({
    expectedBuildVersion: "computer/2.0.0",
    operationId: "single-flight-operation",
  });
  await assert.rejects(
    coordinator.prepare({
      expectedBuildVersion: "computer/2.0.1",
      operationId: "single-flight-operation",
    }),
    ComputerServiceReplacementBusyError,
  );
  releasePreparation?.();
  assert.deepEqual(await replay, await first);
  assert.equal(releases, 1);
  assert.equal(spawns, 1);
});

test("a failed pre-commit hook rolls back the candidate before returning idle", async () => {
  const events: string[] = [];
  let alive = true;
  const coordinator = new ComputerServiceReplacementCoordinator({
    beforeCommitExit: async () => {
      throw new Error("local pre-commit flush failed");
    },
    candidateShutdownTimeoutMs: 10,
    currentProcessId: 101,
    isProcessAlive: () => alive,
    nowMs: () => 1_000,
    readCandidateAttestation: async () => attestation(),
    releaseOwnership: async () => undefined,
    restoreOwnership: async () => {
      events.push("restore");
    },
    scheduleIncumbentExit: () => {
      events.push("exit");
    },
    signalProcess: (_processId, signal) => {
      events.push(signal);
      alive = false;
    },
    snapshotManagedAttachmentIdentities: async () => ({
      primary: "connection-primary",
      secondary: "connection-secondary",
    }),
    spawnCandidate: async () => 202,
    takeoverTimeoutMs: 100,
    wait: async () => undefined,
  });

  await coordinator.prepare({
    expectedBuildVersion: "computer/2.0.0",
    operationId: "commit-failure-operation",
  });
  await assert.rejects(
    coordinator.commit("commit-failure-operation"),
    /commit failed safely/u,
  );
  assert.deepEqual(events, ["SIGTERM", "restore"]);
  assert.deepEqual(coordinator.snapshot(), { state: "idle" });
});

test("an unkillable candidate fences all further replacements for operator recovery", async () => {
  let restoreAttempts = 0;
  let nowMs = 1_000;
  const coordinator = new ComputerServiceReplacementCoordinator({
    candidateShutdownTimeoutMs: 10,
    currentProcessId: 101,
    isProcessAlive: () => true,
    nowMs: () => nowMs,
    readCandidateAttestation: async () => null,
    releaseOwnership: async () => undefined,
    restoreOwnership: async () => {
      restoreAttempts += 1;
    },
    scheduleIncumbentExit: () => undefined,
    signalProcess: () => undefined,
    snapshotManagedAttachmentIdentities: async () => ({
      primary: "connection-primary",
    }),
    spawnCandidate: async () => 202,
    takeoverTimeoutMs: 10,
    wait: async (milliseconds) => {
      nowMs += milliseconds;
    },
  });

  await assert.rejects(
    coordinator.prepare({
      expectedBuildVersion: "computer/2.0.0",
      operationId: "recovery-required-operation",
    }),
    ComputerServiceReplacementRecoveryError,
  );
  assert.deepEqual(coordinator.snapshot(), {
    candidateProcessId: 202,
    operationId: "recovery-required-operation",
    reason: "candidate_alive",
    state: "recovery_required",
  });
  assert.equal(restoreAttempts, 0, "split-brain ownership is not restored");
  await assert.rejects(
    coordinator.prepare({
      expectedBuildVersion: "computer/2.0.0",
      operationId: "another-operation",
    }),
    ComputerServiceReplacementRecoveryError,
  );
});
