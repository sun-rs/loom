import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { afterEach } from "node:test";

import {
  ConflictError,
  LeaseConflictError,
  RoomKernel,
  type AuthenticatedHostContext,
  UnauthenticatedError,
} from "../src/index.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) {
      rmSync(directory, { force: true, recursive: true });
    }
  }
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-agent-fence-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "kernel.db");
  let nowMs = Date.parse("2026-08-30T00:00:00.000Z");
  const now = () => new Date(nowMs);
  const kernel = new RoomKernel({ databasePath, now });
  kernel.initialize();
  const humanProvisioning = kernel.provisionPrincipal({
    handle: "owner",
    kind: "human",
  });
  const agent = kernel.provisionPrincipal({
    handle: "alice",
    kind: "agent",
  }).principal;
  const otherAgent = kernel.provisionPrincipal({
    handle: "bob",
    kind: "agent",
  }).principal;
  const human = kernel.authenticateAccessToken(humanProvisioning.accessToken);
  const room = kernel.createRoom(human, {
    name: "Fence test",
    slug: "fence-test",
  });
  kernel.addMember(human, {
    principalId: agent.principalId,
    roomId: room.roomId,
  });
  kernel.addMember(human, {
    principalId: otherAgent.principalId,
    roomId: room.roomId,
  });
  return {
    advance(milliseconds: number) {
      nowMs += milliseconds;
    },
    agent,
    databasePath,
    human,
    kernel,
    now,
    otherAgent,
    room,
  };
}

function host(
  kernel: RoomKernel,
  hostId: string,
  participantIds: string[],
): AuthenticatedHostContext {
  const authenticated = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({ hostId, participantIds }).accessToken,
  );
  kernel.heartbeatHost(authenticated);
  return authenticated;
}

test("an active Agent operation fence preserves queued work and blocks every legacy lease", () => {
  const state = fixture();
  const firstHost = host(state.kernel, "host-a", [state.agent.principalId]);
  const secondHost = host(state.kernel, "host-b", [state.agent.principalId]);
  const otherHost = host(state.kernel, "host-c", [
    state.otherAgent.principalId,
  ]);
  state.kernel.postMessage(state.human, {
    body: "Alice should wait behind maintenance",
    idempotencyKey: "message-alice",
    recipients: [{ participantId: state.agent.principalId, reason: "mention" }],
    roomId: state.room.roomId,
  });
  state.kernel.postMessage(state.human, {
    body: "Bob remains runnable",
    idempotencyKey: "message-bob",
    recipients: [
      { participantId: state.otherAgent.principalId, reason: "mention" },
    ],
    roomId: state.room.roomId,
  });

  const fence = state.kernel.acquireAgentExclusiveOperationLease(firstHost, {
    kind: "memory_maintenance",
    leaseMs: 10_000,
    operationId: "operation-memory-maintenance-a",
    participantId: state.agent.principalId,
  });
  assert.equal(fence.state, "active");
  assert.equal(fence.ownerHostId, firstHost.hostId);
  assert.equal(fence.ownerHostInstanceId, firstHost.instanceId);
  assert.equal(
    state.kernel.leaseNextActivation(secondHost, { leaseMs: 5_000 }),
    null,
  );
  assert.equal(
    state.kernel.leaseNextActivation(otherHost, { leaseMs: 5_000 })
      ?.participantId,
    state.otherAgent.principalId,
  );
  assert.equal(
    state.kernel.listActivations({ participantId: state.agent.principalId })[0]
      ?.state,
    "queued",
  );

  const released = state.kernel.releaseAgentExclusiveOperationLease(firstHost, {
    leaseId: fence.leaseId,
    operationId: fence.operationId,
  });
  assert.equal(released.state, "released");
  const releaseReplay = state.kernel.releaseAgentExclusiveOperationLease(
    firstHost,
    {
      leaseId: fence.leaseId,
      operationId: fence.operationId,
    },
  );
  assert.equal(releaseReplay.releasedAt, released.releasedAt);
  assert.equal(
    state.kernel.leaseNextActivation(secondHost, { leaseMs: 5_000 })
      ?.participantId,
    state.agent.principalId,
  );
  state.kernel.close();
});

test("expiry remains fail-closed across Kernel restart and only the owning Host generation can recover", () => {
  const state = fixture();
  const owner = host(state.kernel, "host-owner", [state.agent.principalId]);
  const contender = host(state.kernel, "host-contender", [
    state.agent.principalId,
  ]);
  const fence = state.kernel.acquireAgentExclusiveOperationLease(owner, {
    kind: "memory_reset",
    leaseMs: 1_000,
    operationId: "operation-memory-reset-a",
    participantId: state.agent.principalId,
  });
  state.advance(60_000);

  const restarted = new RoomKernel({
    databasePath: state.databasePath,
    now: state.now,
  });
  restarted.initialize();
  assert.equal(
    restarted.getAgentExclusiveOperationLease(fence.operationId).state,
    "active",
  );
  assert.throws(
    () =>
      restarted.acquireAgentExclusiveOperationLease(contender, {
        kind: "memory_reset",
        leaseMs: 1_000,
        operationId: "operation-memory-reset-b",
        participantId: state.agent.principalId,
      }),
    ConflictError,
  );
  assert.throws(
    () =>
      restarted.releaseAgentExclusiveOperationLease(contender, {
        leaseId: fence.leaseId,
        operationId: fence.operationId,
      }),
    LeaseConflictError,
  );
  const renewed = restarted.renewAgentExclusiveOperationLease(owner, {
    leaseId: fence.leaseId,
    leaseMs: 5_000,
    operationId: fence.operationId,
  });
  assert.equal(Date.parse(renewed.leaseUntil), state.now().getTime() + 5_000);
  restarted.releaseAgentExclusiveOperationLease(owner, {
    leaseId: fence.leaseId,
    operationId: fence.operationId,
  });
  restarted.close();
  state.kernel.close();
});

test("acquire is idempotent for one operation but rejects an Agent with an active canonical lane", () => {
  const state = fixture();
  const owner = host(state.kernel, "host-owner", [state.agent.principalId]);
  const first = state.kernel.acquireAgentExclusiveOperationLease(owner, {
    kind: "task_reassignment",
    leaseMs: 10_000,
    operationId: "operation-reassign-a",
    participantId: state.agent.principalId,
  });
  const replay = state.kernel.acquireAgentExclusiveOperationLease(owner, {
    kind: "task_reassignment",
    leaseMs: 10_000,
    operationId: "operation-reassign-a",
    participantId: state.agent.principalId,
  });
  assert.equal(replay.leaseId, first.leaseId);
  assert.throws(
    () =>
      state.kernel.acquireAgentExclusiveOperationLease(owner, {
        kind: "memory_reset",
        leaseMs: 10_000,
        operationId: "operation-reassign-a",
        participantId: state.agent.principalId,
      }),
    ConflictError,
  );
  state.kernel.releaseAgentExclusiveOperationLease(owner, {
    leaseId: first.leaseId,
    operationId: first.operationId,
  });

  state.kernel.postMessage(state.human, {
    body: "Lease this Activation first",
    idempotencyKey: "message-active-lane",
    recipients: [{ participantId: state.agent.principalId, reason: "mention" }],
    roomId: state.room.roomId,
  });
  assert.notEqual(
    state.kernel.leaseNextActivation(owner, { leaseMs: 10_000 }),
    null,
  );
  assert.throws(
    () =>
      state.kernel.acquireAgentExclusiveOperationLease(owner, {
        kind: "execution_restart",
        leaseMs: 10_000,
        operationId: "operation-restart-active",
        participantId: state.agent.principalId,
      }),
    ConflictError,
  );
  state.kernel.close();
});

test("a replacement generation of the same Host cannot release an orphaned operation", () => {
  const state = fixture();
  const credential = state.kernel.provisionHostCredential({
    hostId: "host-generation",
    participantIds: [state.agent.principalId],
  });
  const owner = state.kernel.authenticateHostAccessToken(
    credential.accessToken,
  );
  state.kernel.heartbeatHost(owner);
  const fence = state.kernel.acquireAgentExclusiveOperationLease(owner, {
    kind: "execution_restart",
    leaseMs: 1_000,
    operationId: "operation-generation-fence",
    participantId: state.agent.principalId,
  });
  state.advance(60_000);

  const replacement = state.kernel.authenticateHostAccessToken(
    credential.accessToken,
  );
  state.kernel.heartbeatHost(replacement, { takeoverAfterMs: 1_000 });
  assert.throws(
    () =>
      state.kernel.releaseAgentExclusiveOperationLease(replacement, {
        leaseId: fence.leaseId,
        operationId: fence.operationId,
      }),
    LeaseConflictError,
  );
  assert.throws(
    () =>
      state.kernel.releaseAgentExclusiveOperationLease(owner, {
        leaseId: fence.leaseId,
        operationId: fence.operationId,
      }),
    UnauthenticatedError,
  );
  assert.equal(
    state.kernel.getAgentExclusiveOperationLease(fence.operationId).state,
    "active",
  );
  state.kernel.close();
});
