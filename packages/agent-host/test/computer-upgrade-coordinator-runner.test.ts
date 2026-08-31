import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { OperationRead } from "@rah-os/k-carrier";

import {
  ComputerUpgradeCoordinatorRequestStore,
  ComputerUpgradeCoordinatorRunner,
  type ComputerUpgradeCoordinatorPort,
  type ComputerUpgradeCoordinatorRequest,
  type ManagedComputerOperationResult,
} from "../src/index.ts";

function request(
  currentArtifactPath: string,
): ComputerUpgradeCoordinatorRequest {
  return {
    carrier: "rah-k",
    controlAttachmentId: "primary",
    currentArtifactPath,
    managedAttachmentIdentities: { primary: "connection-primary" },
    mode: "upgrade",
    operationId: "upgrade-runner-1",
    requestedAt: "2026-08-28T12:00:00.000Z",
    sourceBuildVersion: "1.0.0",
    sourceComputerInstanceId: "incumbent-computer-instance",
    targetBuildVersion: "2.0.0",
  };
}

test("coordinator runner bootstraps K and retains request until successor ready", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-k-runner-"));
  chmodSync(directory, 0o700);
  const stateDir = join(directory, "k");
  const requestPath = join(directory, "request.json");
  const artifactPath = join(directory, "computer");
  await mkdir(stateDir, { mode: 0o700 });
  writeFileSync(artifactPath, "trusted-current-build", { mode: 0o700 });
  const store = new ComputerUpgradeCoordinatorRequestStore({ requestPath });
  await store.save(request(artifactPath));
  const executions: unknown[] = [];
  const ready: unknown[] = [];
  const coordinator: ComputerUpgradeCoordinatorPort = {
    acknowledgeSuccessorReady: async (input) => {
      ready.push(input);
      return {
        kind: "ready_acknowledged",
        operationId: "upgrade-runner-1",
      };
    },
    execute: async (input) => {
      assert.equal(
        readFileSync(join(stateDir, "slots", "stable", "VERSION"), "utf8"),
        "1.0.0",
      );
      assert.equal(
        readFileSync(join(stateDir, "slots", "stable", "artifact.bin"), "utf8"),
        "trusted-current-build",
      );
      executions.push(input);
      return {
        kind: "replacement_requested",
        operationId: "upgrade-runner-1",
      };
    },
    operation: async () => ({ kind: "genesis" }) as OperationRead,
  };
  try {
    const runner = new ComputerUpgradeCoordinatorRunner({
      createCoordinator: async (stored) => {
        assert.deepEqual(
          JSON.parse(JSON.stringify(stored)),
          request(artifactPath),
        );
        return coordinator;
      },
      requestStore: store,
      stateDir,
    });
    assert.deepEqual(await runner.run(), {
      kind: "awaiting_successor",
      operationId: "upgrade-runner-1",
    });
    assert.equal(executions.length, 1);
    assert.notEqual(await store.read(), null);

    assert.deepEqual(
      await runner.acknowledgeSuccessorReady({
        observedBuildVersion: "2.0.0",
        operationId: "upgrade-runner-1",
        successorComputerInstanceId: "successor-computer-instance",
      }),
      { kind: "ready_acknowledged", operationId: "upgrade-runner-1" },
    );
    assert.deepEqual(ready, [
      {
        observedBuildVersion: "2.0.0",
        operationId: "upgrade-runner-1",
        successorComputerInstanceId: "successor-computer-instance",
      },
    ]);
    assert.equal(await store.read(), null);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("coordinator runner clears only a server-terminal failure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-k-runner-failed-"));
  chmodSync(directory, 0o700);
  const stateDir = join(directory, "k");
  const requestPath = join(directory, "request.json");
  const artifactPath = join(directory, "computer");
  await mkdir(stateDir, { mode: 0o700 });
  writeFileSync(artifactPath, "trusted-current-build", { mode: 0o700 });
  const store = new ComputerUpgradeCoordinatorRequestStore({ requestPath });
  await store.save(request(artifactPath));
  const terminalFailure: ManagedComputerOperationResult = {
    failureCode: "replacement_failed",
    kind: "failed",
    operationId: "upgrade-runner-1",
    phase: "replacing",
  };
  try {
    const runner = new ComputerUpgradeCoordinatorRunner({
      createCoordinator: async () => ({
        acknowledgeSuccessorReady: async () => {
          throw new Error("not used");
        },
        execute: async () => terminalFailure,
        operation: async () => ({ kind: "genesis" }) as OperationRead,
      }),
      requestStore: store,
      stateDir,
    });
    assert.deepEqual(await runner.run(), terminalFailure);
    assert.equal(await store.read(), null);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("coordinator runner preserves request when execution is ambiguous", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-k-runner-ambiguous-"));
  chmodSync(directory, 0o700);
  const stateDir = join(directory, "k");
  const requestPath = join(directory, "request.json");
  const artifactPath = join(directory, "computer");
  await mkdir(stateDir, { mode: 0o700 });
  writeFileSync(artifactPath, "trusted-current-build", { mode: 0o700 });
  const store = new ComputerUpgradeCoordinatorRequestStore({ requestPath });
  await store.save(request(artifactPath));
  try {
    const runner = new ComputerUpgradeCoordinatorRunner({
      createCoordinator: async () => ({
        acknowledgeSuccessorReady: async () => {
          throw new Error("not used");
        },
        execute: async () => {
          throw new Error("ambiguous process boundary");
        },
        operation: async () => ({ kind: "genesis" }) as OperationRead,
      }),
      requestStore: store,
      stateDir,
    });
    await assert.rejects(runner.run(), /ambiguous process boundary/u);
    assert.equal(existsSync(requestPath), true);
    assert.notEqual(await store.read(), null);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
