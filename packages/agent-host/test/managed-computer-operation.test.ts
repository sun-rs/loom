import assert from "node:assert/strict";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  ComputerOperationAcknowledgeRequest,
  ComputerOperationAcknowledgeResponse,
  ComputerOperationAssignment,
  ComputerOperationClaimResponse,
} from "@rah-os/computer-protocol";

import {
  ComputerOperationReceiptStore,
  ManagedComputerOperationExecutor,
  type ComputerOperationReceipt,
  type ComputerOperationReceiptStorePort,
  type ManagedComputerOperationControlPort,
  type ManagedComputerOperationEffects,
} from "../src/index.ts";

class MemoryReceiptStore implements ComputerOperationReceiptStorePort {
  receipt: ComputerOperationReceipt | null = null;

  async clear(operationId: string): Promise<void> {
    if (this.receipt?.operationId === operationId) this.receipt = null;
  }

  async read(): Promise<ComputerOperationReceipt | null> {
    return this.receipt === null ? null : { ...this.receipt };
  }

  async save(receipt: ComputerOperationReceipt): Promise<void> {
    this.receipt = { ...receipt };
  }
}

class FakeOperationControl implements ManagedComputerOperationControlPort {
  readonly acknowledgements: ComputerOperationAcknowledgeRequest[] = [];
  operation: ComputerOperationAssignment | null;
  throwAfterAcceptingPhase: string | undefined;

  constructor(operation: ComputerOperationAssignment | null) {
    this.operation = operation;
  }

  async acknowledgeOperation(
    request: ComputerOperationAcknowledgeRequest,
  ): Promise<ComputerOperationAcknowledgeResponse> {
    this.acknowledgements.push(request);
    if (
      request.kind === "operation.progress" &&
      request.phase === this.throwAfterAcceptingPhase
    ) {
      this.throwAfterAcceptingPhase = undefined;
      throw new Error("ambiguous response after canonical acceptance");
    }
    if (request.kind === "operation.ready") this.operation = null;
    return {
      accepted: true,
      terminal: request.kind !== "operation.progress",
    };
  }

  async claimOperation(): Promise<ComputerOperationClaimResponse> {
    return { operation: this.operation };
  }
}

function effects(events: string[]): ManagedComputerOperationEffects {
  return {
    activateReplacement: async ({ operationId }) => {
      events.push(`activate:${operationId}`);
    },
    downloadUpgrade: async ({ targetBuildVersion }) => {
      events.push(`download:${targetBuildVersion}`);
    },
    drain: async ({ operationId }) => {
      events.push(`drain:${operationId}`);
    },
    prepareReplacement: async ({ action }) => {
      events.push(`prepare:${action}`);
    },
    stageUpgrade: async ({ targetBuildVersion }) => {
      events.push(`stage:${targetBuildVersion}`);
    },
    verifyUpgrade: async ({ targetBuildVersion }) => {
      events.push(`verify:${targetBuildVersion}`);
    },
  };
}

test("managed upgrade persists every phase and only a successor acknowledges ready", async () => {
  const assignment: ComputerOperationAssignment = {
    action: "upgrade",
    operationId: "managed-upgrade-1",
    requestedAt: "2026-08-28T00:00:00.000Z",
    targetBuildVersion: "computer/2.0.0",
  };
  const control = new FakeOperationControl(assignment);
  const receipts = new MemoryReceiptStore();
  const incumbentEvents: string[] = [];
  const incumbent = new ManagedComputerOperationExecutor({
    buildVersion: "computer/1.0.0",
    computerInstanceId: "computer-boot-incumbent",
    control,
    effects: effects(incumbentEvents),
    receipts,
  });

  assert.deepEqual(await incumbent.executeOnce(), {
    kind: "replacement_requested",
    operationId: assignment.operationId,
  });
  assert.deepEqual(incumbentEvents, [
    "drain:managed-upgrade-1",
    "download:computer/2.0.0",
    "verify:computer/2.0.0",
    "stage:computer/2.0.0",
    "prepare:upgrade",
    "activate:managed-upgrade-1",
  ]);
  assert.deepEqual(
    control.acknowledgements.map((entry) =>
      entry.kind === "operation.progress" ? entry.phase : entry.kind,
    ),
    [
      "draining",
      "downloading",
      "verifying",
      "staging",
      "replacing",
      "restarting",
    ],
  );
  assert.equal(receipts.receipt?.phase, "restarting");

  const successorEvents: string[] = [];
  const successor = new ManagedComputerOperationExecutor({
    buildVersion: "computer/2.0.0",
    computerInstanceId: "computer-boot-successor",
    control,
    effects: effects(successorEvents),
    receipts,
  });
  assert.deepEqual(await successor.executeOnce(), {
    kind: "ready_acknowledged",
    operationId: assignment.operationId,
  });
  assert.deepEqual(successorEvents, []);
  assert.equal(receipts.receipt, null);
  assert.deepEqual(control.acknowledgements.at(-1), {
    kind: "operation.ready",
    observedBuildVersion: "computer/2.0.0",
    operationId: assignment.operationId,
  });
});

test("managed operation failures publish only a bounded failure code and clear terminal receipt", async () => {
  const assignment: ComputerOperationAssignment = {
    action: "upgrade",
    operationId: "managed-upgrade-failure",
    requestedAt: "2026-08-28T00:00:00.000Z",
    targetBuildVersion: "computer/3.0.0",
  };
  const control = new FakeOperationControl(assignment);
  const receipts = new MemoryReceiptStore();
  const operationEffects = effects([]);
  operationEffects.verifyUpgrade = async () => {
    throw new Error("secret path and untrusted downloader output");
  };
  const executor = new ManagedComputerOperationExecutor({
    buildVersion: "computer/2.0.0",
    computerInstanceId: "computer-failure-incumbent",
    control,
    effects: operationEffects,
    receipts,
  });

  assert.deepEqual(await executor.executeOnce(), {
    failureCode: "verification_failed",
    kind: "failed",
    operationId: assignment.operationId,
    phase: "verifying",
  });
  assert.deepEqual(control.acknowledgements.at(-1), {
    failureCode: "verification_failed",
    kind: "operation.failed",
    operationId: assignment.operationId,
    phase: "verifying",
  });
  assert.equal(
    JSON.stringify(control.acknowledgements).includes("secret path"),
    false,
  );
  assert.equal(receipts.receipt, null);
});

test("an ambiguous progress response resumes from pending acknowledgement without repeating its effect", async () => {
  const assignment: ComputerOperationAssignment = {
    action: "restart",
    operationId: "managed-restart-ambiguous",
    requestedAt: "2026-08-28T00:00:00.000Z",
  };
  const control = new FakeOperationControl(assignment);
  control.throwAfterAcceptingPhase = "draining";
  const receipts = new MemoryReceiptStore();
  const events: string[] = [];
  const executor = new ManagedComputerOperationExecutor({
    buildVersion: "computer/1.0.0",
    computerInstanceId: "computer-ambiguous-incumbent",
    control,
    effects: effects(events),
    receipts,
  });

  await assert.rejects(executor.executeOnce(), /ambiguous response/u);
  assert.equal(receipts.receipt?.phase, "claimed");
  assert.equal(receipts.receipt?.pendingPhase, "draining");
  assert.deepEqual(await executor.executeOnce(), {
    kind: "replacement_requested",
    operationId: assignment.operationId,
  });
  assert.equal(
    events.filter((event) => event.startsWith("drain:")).length,
    1,
    "a completed drain effect is not repeated after an ambiguous ack",
  );
});

test("operation receipt store is atomic, owner-private, strict, and symlink-safe", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-operation-receipt-"));
  const statePath = join(directory, "operation.json");
  const receipt: ComputerOperationReceipt = {
    action: "restart",
    operationId: "receipt-restart-1",
    phase: "restarting",
    requestedAt: "2026-08-28T00:00:00.000Z",
    sourceBuildVersion: "computer/1.0.0",
    sourceComputerInstanceId: "computer-receipt-incumbent",
  };
  try {
    const store = new ComputerOperationReceiptStore({ statePath });
    assert.equal(await store.read(), null);
    await store.save(receipt);
    assert.equal(lstatSync(statePath).mode & 0o777, 0o600);
    assert.deepEqual(await store.read(), receipt);
    await store.clear(receipt.operationId);
    assert.equal(await store.read(), null);

    writeFileSync(
      statePath,
      JSON.stringify({
        receipt: { ...receipt, command: "rm" },
        schemaVersion: 1,
      }),
      { mode: 0o600 },
    );
    await assert.rejects(store.read(), /expected keys/u);
    rmSync(statePath);
    const targetPath = join(directory, "target.json");
    writeFileSync(targetPath, "{}", { mode: 0o600 });
    symlinkSync(targetPath, statePath);
    await assert.rejects(store.read(), /symbolic link/u);
    await assert.rejects(store.save(receipt), /symbolic link/u);
    rmSync(statePath);
    chmodSync(directory, 0o755);
    await assert.rejects(store.save(receipt), /owner-private/u);
  } finally {
    chmodSync(directory, 0o700);
    rmSync(directory, { force: true, recursive: true });
  }
});
