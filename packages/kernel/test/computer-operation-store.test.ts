import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ComputerOperationStore,
  IdempotencyConflictError,
  RoomKernel,
} from "../src/index.ts";

test("Computer operations require a successor generation and exact upgrade attestation", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-computer-operation-"));
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath });
  try {
    kernel.initialize();
    const agent = kernel.provisionPrincipal({
      handle: "operation-agent",
      kind: "agent",
    });
    const credential = kernel.provisionHostCredential({
      hostId: "operation-computer",
      participantIds: [agent.principal.principalId],
    });
    const incumbent = kernel.authenticateHostAccessToken(
      credential.accessToken,
    );
    kernel.heartbeatHost(incumbent, {
      buildVersion: "1.0.0",
      state: "online",
    });
    const operations = new ComputerOperationStore({ databasePath });
    const requested = operations.request({
      action: "upgrade",
      hostId: incumbent.hostId,
      idempotencyKey: "upgrade-to-2",
      targetBuildVersion: "2.0.0",
    });
    assert.equal(requested.state, "pending");
    assert.equal(
      operations.claim(incumbent)?.operationId,
      requested.operationId,
    );
    for (const phase of [
      "draining",
      "downloading",
      "verifying",
      "staging",
      "replacing",
      "restarting",
    ] as const) {
      operations.acknowledge(incumbent, {
        kind: "operation.progress",
        operationId: requested.operationId,
        phase,
      });
    }
    assert.throws(
      () =>
        operations.acknowledge(incumbent, {
          kind: "operation.ready",
          observedBuildVersion: "2.0.0",
          operationId: requested.operationId,
        }),
      /successor Host generation/,
    );

    kernel.heartbeatHost(incumbent, { state: "offline" });
    const replacement = kernel.authenticateHostAccessToken(
      credential.accessToken,
    );
    kernel.heartbeatHost(replacement, {
      buildVersion: "2.0.0",
      state: "online",
    });
    assert.equal(
      operations.claim(replacement)?.operationId,
      requested.operationId,
    );
    const completed = operations.acknowledge(replacement, {
      kind: "operation.ready",
      observedBuildVersion: "2.0.0",
      operationId: requested.operationId,
    });
    assert.equal(completed.state, "succeeded");
    assert.equal(
      operations.acknowledge(replacement, {
        kind: "operation.ready",
        observedBuildVersion: "2.0.0",
        operationId: requested.operationId,
      }).state,
      "succeeded",
    );
    assert.equal(operations.claim(replacement), null);
    operations.close();
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Computer operation requests and progress are idempotent, monotonic, and content-free", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-computer-operation-"));
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath });
  try {
    kernel.initialize();
    const agent = kernel.provisionPrincipal({
      handle: "operation-idempotency-agent",
      kind: "agent",
    });
    const credential = kernel.provisionHostCredential({
      hostId: "operation-idempotency-computer",
      participantIds: [agent.principal.principalId],
    });
    const host = kernel.authenticateHostAccessToken(credential.accessToken);
    kernel.heartbeatHost(host, { buildVersion: "1.0.0", state: "online" });
    const operations = new ComputerOperationStore({ databasePath });
    const first = operations.request({
      action: "restart",
      hostId: host.hostId,
      idempotencyKey: "restart-1",
    });
    assert.equal(
      operations.request({
        action: "restart",
        hostId: host.hostId,
        idempotencyKey: "restart-1",
      }).operationId,
      first.operationId,
    );
    assert.throws(
      () =>
        operations.request({
          action: "upgrade",
          hostId: host.hostId,
          idempotencyKey: "restart-1",
          targetBuildVersion: "2.0.0",
        }),
      IdempotencyConflictError,
    );
    operations.claim(host);
    operations.acknowledge(host, {
      kind: "operation.progress",
      operationId: first.operationId,
      phase: "draining",
    });
    assert.equal(
      operations.acknowledge(host, {
        kind: "operation.progress",
        operationId: first.operationId,
        phase: "draining",
      }).phase,
      "draining",
    );
    assert.throws(() =>
      operations.acknowledge(host, {
        kind: "operation.progress",
        operationId: first.operationId,
        phase: "downloading",
      }),
    );
    operations.acknowledge(host, {
      failureCode: "control_unavailable",
      kind: "operation.failed",
      operationId: first.operationId,
      phase: "draining",
    });
    const stored = operations.get(first.operationId);
    assert.equal(stored.failureCode, "control_unavailable");
    assert.equal("log" in stored, false);
    assert.equal("command" in stored, false);
    operations.close();
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Computer restart completion attests the incumbent build on a successor generation", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-computer-restart-"));
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath });
  try {
    kernel.initialize();
    const agent = kernel.provisionPrincipal({
      handle: "restart-attestation-agent",
      kind: "agent",
    });
    const credential = kernel.provisionHostCredential({
      hostId: "restart-attestation-computer",
      participantIds: [agent.principal.principalId],
    });
    const incumbent = kernel.authenticateHostAccessToken(
      credential.accessToken,
    );
    kernel.heartbeatHost(incumbent, {
      buildVersion: "computer/1.4.0",
      state: "online",
    });
    const operations = new ComputerOperationStore({ databasePath });
    const requested = operations.request({
      action: "restart",
      hostId: incumbent.hostId,
      idempotencyKey: "restart-same-build",
    });
    assert.equal(
      operations.claim(incumbent)?.observedBuildVersion,
      "computer/1.4.0",
    );
    operations.acknowledge(incumbent, {
      kind: "operation.progress",
      operationId: requested.operationId,
      phase: "draining",
    });
    kernel.heartbeatHost(incumbent, { state: "offline" });
    const recovery = kernel.authenticateHostAccessToken(credential.accessToken);
    kernel.heartbeatHost(recovery, {
      buildVersion: "computer/1.4.0",
      state: "online",
    });
    assert.equal(
      operations.claim(recovery)?.claimedHostInstanceId,
      recovery.instanceId,
      "a successor with the frozen build resumes an interrupted pre-restart phase",
    );
    operations.acknowledge(recovery, {
      kind: "operation.progress",
      operationId: requested.operationId,
      phase: "restarting",
    });
    kernel.heartbeatHost(recovery, { state: "offline" });
    const successor = kernel.authenticateHostAccessToken(
      credential.accessToken,
    );
    kernel.heartbeatHost(successor, {
      buildVersion: "computer/1.5.0",
      state: "online",
    });
    operations.claim(successor);
    assert.throws(
      () =>
        operations.acknowledge(successor, {
          kind: "operation.ready",
          observedBuildVersion: "computer/1.5.0",
          operationId: requested.operationId,
        }),
      /expected build version/u,
    );
    kernel.heartbeatHost(successor, {
      buildVersion: "computer/1.4.0",
      state: "online",
    });
    assert.equal(
      operations.acknowledge(successor, {
        kind: "operation.ready",
        observedBuildVersion: "computer/1.4.0",
        operationId: requested.operationId,
      }).state,
      "succeeded",
    );
    operations.close();
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
