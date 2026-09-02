import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ActivationCancellationRequestedError,
  RoomKernel,
} from "../src/index.ts";

test("Room SOS fences only the target Room until terminal proof and resumes with canonical guidance", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-room-sos-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  try {
    kernel.initialize();
    const owner = kernel.provisionPrincipal({
      handle: "sos-owner",
      kind: "human",
    });
    const agent = kernel.provisionPrincipal({
      handle: "sos-agent",
      kind: "agent",
    });
    const ownerActor = kernel.authenticateAccessToken(owner.accessToken);
    const targetRoom = kernel.createRoom(ownerActor, {
      name: "Target",
      slug: "target",
    });
    const otherRoom = kernel.createRoom(ownerActor, {
      name: "Other",
      slug: "other",
    });
    kernel.addMember(ownerActor, {
      principalId: agent.principal.principalId,
      roomId: targetRoom.roomId,
    });
    kernel.addMember(ownerActor, {
      principalId: agent.principal.principalId,
      roomId: otherRoom.roomId,
    });
    const host = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId: "sos-host",
        participantIds: [agent.principal.principalId],
      }).accessToken,
    );
    kernel.heartbeatHost(host);

    kernel.postMessage(ownerActor, {
      body: "target work",
      idempotencyKey: "target-work",
      recipients: [
        { participantId: agent.principal.principalId, reason: "mention" },
      ],
      roomId: targetRoom.roomId,
    });
    const targetActivation = kernel.leaseNextActivation(host, {
      leaseMs: 30_000,
    });
    assert.equal(targetActivation?.roomId, targetRoom.roomId);

    const requested = kernel.roomAgentSos.requestStop(ownerActor, {
      basedOnRoomSeq: latestSeq(kernel, ownerActor, targetRoom.roomId),
      idempotencyKey: "stop-target-room",
      roomId: targetRoom.roomId,
    });
    assert.equal(requested.operation.state, "stopping");
    assert.equal(requested.operation.pendingTargetCount, 1);
    assert.throws(
      () =>
        kernel.roomAgentSos.continueStop(ownerActor, {
          operationId: requested.operation.operationId,
        }),
      /terminal proof/i,
    );
    assert.throws(
      () =>
        kernel.renewActivationLease(host, {
          activationId: targetActivation!.activationId,
          leaseMs: 30_000,
        }),
      ActivationCancellationRequestedError,
    );
    kernel.resolveActivationCancellation(host, {
      activationId: targetActivation!.activationId,
    });
    const stopped = kernel.roomAgentSos.continueStop(ownerActor, {
      operationId: requested.operation.operationId,
    });
    assert.equal(stopped.operation.state, "stopped");
    assert.equal(stopped.operation.pendingTargetCount, 0);
    assert.equal(kernel.leaseNextActivation(host, { leaseMs: 30_000 }), null);

    const resumed = kernel.roomAgentSos.resume(ownerActor, {
      basedOnRoomSeq: latestSeq(kernel, ownerActor, targetRoom.roomId),
      guidance: "重新读取最新 Room 事实，只执行修正后的方案。",
      idempotencyKey: "resume-target-room",
      roomId: targetRoom.roomId,
    });
    assert.equal(resumed.operation.state, "resumed");
    assert.equal(resumed.event.type, "room.agent_sos_resumed");
    assert.equal(
      resumed.event.payload.guidance,
      "重新读取最新 Room 事实，只执行修正后的方案。",
    );
    assert.equal(
      kernel.leaseNextActivation(host, { leaseMs: 30_000 })?.roomId,
      targetRoom.roomId,
    );
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Room SOS does not cancel the same Agent while it is working in another Room", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-room-sos-isolation-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  try {
    kernel.initialize();
    const owner = kernel.provisionPrincipal({
      handle: "isolation-owner",
      kind: "human",
    });
    const agent = kernel.provisionPrincipal({
      handle: "isolation-agent",
      kind: "agent",
    });
    const ownerActor = kernel.authenticateAccessToken(owner.accessToken);
    const heldRoom = kernel.createRoom(ownerActor, {
      name: "Held",
      slug: "held",
    });
    const activeRoom = kernel.createRoom(ownerActor, {
      name: "Active",
      slug: "active",
    });
    for (const room of [heldRoom, activeRoom]) {
      kernel.addMember(ownerActor, {
        principalId: agent.principal.principalId,
        roomId: room.roomId,
      });
    }
    const host = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId: "isolation-host",
        participantIds: [agent.principal.principalId],
      }).accessToken,
    );
    kernel.heartbeatHost(host);
    kernel.postMessage(ownerActor, {
      body: "other Room work",
      idempotencyKey: "other-room-work",
      recipients: [
        { participantId: agent.principal.principalId, reason: "mention" },
      ],
      roomId: activeRoom.roomId,
    });
    const otherActivation = kernel.leaseNextActivation(host, {
      leaseMs: 30_000,
    });
    assert.equal(otherActivation?.roomId, activeRoom.roomId);

    const stopped = kernel.roomAgentSos.requestStop(ownerActor, {
      basedOnRoomSeq: latestSeq(kernel, ownerActor, heldRoom.roomId),
      idempotencyKey: "stop-held-room",
      roomId: heldRoom.roomId,
    });
    assert.equal(stopped.operation.state, "stopped");
    assert.doesNotThrow(() =>
      kernel.renewActivationLease(host, {
        activationId: otherActivation!.activationId,
        leaseMs: 30_000,
      }),
    );
    assert.throws(
      () =>
        kernel.roomAgentSos.resume(ownerActor, {
          basedOnRoomSeq: latestSeq(kernel, ownerActor, heldRoom.roomId),
          guidance: "  ",
          idempotencyKey: "empty-guidance",
          roomId: heldRoom.roomId,
        }),
      /guidance/i,
    );
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

function latestSeq(
  kernel: RoomKernel,
  actor: Parameters<RoomKernel["sync"]>[0],
  roomId: string,
): number {
  return kernel.sync(actor, { consumerId: `sos-${roomId}`, roomId })
    .latestRoomSeq;
}
