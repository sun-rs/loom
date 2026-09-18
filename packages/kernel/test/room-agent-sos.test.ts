import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ActivationCancellationRequestedError,
  RoomKernel,
} from "../src/index.ts";

for (const timing of ["before-terminal", "after-terminal"] as const)
  test(`composer correction is in the first resumed execution (${timing})`, () => {
    const directory = mkdtempSync(join(tmpdir(), "rah-sos-correction-range-"));
    const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
    try {
      kernel.initialize();
      const human = kernel.provisionPrincipal({
        handle: "human",
        kind: "human",
      });
      const agent = kernel.provisionPrincipal({
        handle: "agent",
        kind: "agent",
      });
      const actor = kernel.authenticateAccessToken(human.accessToken);
      const room = kernel.createRoom(actor, {
        name: "Correction",
        slug: "correction",
      });
      kernel.addMember(actor, {
        roomId: room.roomId,
        principalId: agent.principal.principalId,
      });
      const host = kernel.authenticateHostAccessToken(
        kernel.provisionHostCredential({
          hostId: "host",
          participantIds: [agent.principal.principalId],
        }).accessToken,
      );
      kernel.heartbeatHost(host);
      kernel.postRoomMessage(actor, {
        roomId: room.roomId,
        body: "Old instruction",
        idempotencyKey: "old",
      });
      const old = kernel.leaseNextActivation(host, { leaseMs: 30000 })!;
      kernel.roomAgentSos.requestStop(actor, {
        roomId: room.roomId,
        basedOnRoomSeq: latestSeq(kernel, actor, room.roomId),
        idempotencyKey: "stop",
        resumeOnMessage: true,
      });
      const correct = () =>
        kernel.postRoomMessage(actor, {
          roomId: room.roomId,
          body: "Use this correction instead",
          idempotencyKey: "correction",
          basedOnRoomSeq: latestSeq(kernel, actor, room.roomId),
        });
      const early = timing === "before-terminal" ? correct() : undefined;
      assert.equal(kernel.leaseNextActivation(host, { leaseMs: 30000 }), null);
      kernel.resolveActivationCancellation(host, {
        activationId: old.activationId,
      });
      const correction = early ?? correct();
      const next = kernel.leaseNextActivation(host, { leaseMs: 30000 })!;
      assert.ok(
        next.toSeq >= correction.event.roomSeq,
        "the first resumed run must include the correction",
      );
      assert.equal(next.activationId, old.activationId);
      assert.equal(kernel.leaseNextActivation(host, { leaseMs: 30000 }), null);
    } finally {
      kernel.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

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
    assert.throws(
      () =>
        kernel.roomAgentSos.requestStop(ownerActor, {
          roomId: targetRoom.roomId,
          basedOnRoomSeq: latestSeq(kernel, ownerActor, targetRoom.roomId),
          idempotencyKey: "stop-target-room",
          resumeOnMessage: true,
        }),
      /idempotency/,
    );
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

for (const recovery of [false, true])
  test(`a correction sent during stopping resumes without the HTTP caller after ${recovery ? "host recovery" : "startup retry"}`, () => {
    const directory = mkdtempSync(join(tmpdir(), "rah-stop-race-"));
    let now = Date.now();
    const kernel = new RoomKernel({
      databasePath: join(directory, "room.db"),
      now: () => new Date(now),
    });
    try {
      kernel.initialize();
      const human = kernel.provisionPrincipal({
        handle: "owner",
        kind: "human",
      });
      const agent = kernel.provisionPrincipal({
        handle: "worker",
        kind: "agent",
      });
      const actor = kernel.authenticateAccessToken(human.accessToken);
      const room = kernel.createRoom(actor, { name: "Race", slug: "race" });
      kernel.addMember(actor, {
        roomId: room.roomId,
        principalId: agent.principal.principalId,
      });
      const host = kernel.authenticateHostAccessToken(
        kernel.provisionHostCredential({
          hostId: "host",
          participantIds: [agent.principal.principalId],
        }).accessToken,
      );
      kernel.heartbeatHost(host);
      kernel.postMessage(actor, {
        roomId: room.roomId,
        body: "Incomplete",
        idempotencyKey: "initial",
        recipients: [
          { participantId: agent.principal.principalId, reason: "mention" },
        ],
      });
      const activation = kernel.leaseNextActivation(host, { leaseMs: 30000 })!;
      const run = kernel.createRunAttempt(host, {
        activationId: activation.activationId,
      });
      kernel.roomAgentSos.requestStop(actor, {
        roomId: room.roomId,
        basedOnRoomSeq: latestSeq(kernel, actor, room.roomId),
        idempotencyKey: "stop",
        resumeOnMessage: true,
      });
      kernel.postRoomMessage(actor, {
        roomId: room.roomId,
        body: "Correction",
        basedOnRoomSeq: latestSeq(kernel, actor, room.roomId),
        idempotencyKey: "correction",
        recipients: [
          { participantId: agent.principal.principalId, reason: "mention" },
        ],
      });
      assert.equal(
        kernel.roomAgentSos.read(actor, { roomId: room.roomId }).operation
          ?.state,
        "stopping",
      );
      assert.equal(kernel.leaseNextActivation(host, { leaseMs: 30000 }), null);
      let recoveredActivation;
      if (recovery) {
        now += 60000;
        kernel.heartbeatHost(host);
        recoveredActivation = kernel.leaseNextActivation(host, {
          leaseMs: 30000,
        });
      } else {
        kernel.finishRunAttempt(host, {
          runAttemptId: run.runAttemptId,
          state: "failed",
          error: "startup fenced",
        });
        kernel.retryActivation(host, {
          activationId: activation.activationId,
          error: "startup fenced",
          retryAfterMs: 1000,
        });
      }
      assert.equal(
        kernel.roomAgentSos.read(actor, { roomId: room.roomId }).operation,
        null,
      );
      if (recovery) {
        assert.equal(recoveredActivation?.roomId, room.roomId);
        assert.equal(
          kernel.leaseNextActivation(host, { leaseMs: 30000 }),
          null,
        );
        return;
      }
      kernel.roomAgentSos.requestStop(actor, {
        roomId: room.roomId,
        basedOnRoomSeq: latestSeq(kernel, actor, room.roomId),
        idempotencyKey: "stop-task",
        resumeOnMessage: true,
      });
      kernel.createTask(actor, {
        roomId: room.roomId,
        title: "Corrected task",
        basedOnRoomSeq: latestSeq(kernel, actor, room.roomId),
        idempotencyKey: "corrected-task",
      });
      assert.equal(
        kernel.roomAgentSos.read(actor, { roomId: room.roomId }).operation,
        null,
      );
      assert.equal(
        kernel.leaseNextActivation(host, { leaseMs: 30000 })?.roomId,
        room.roomId,
      );
      assert.equal(kernel.leaseNextActivation(host, { leaseMs: 30000 }), null);
    } finally {
      kernel.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

for (const direct of [false, true])
  test(`composer stop supports ${direct ? "DM" : "Channel"} and resumes only with a new Human message`, () => {
    const directory = mkdtempSync(join(tmpdir(), "rah-composer-stop-"));
    const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
    try {
      kernel.initialize();
      const human = kernel.provisionPrincipal({
        handle: "owner",
        kind: "human",
      });
      const agent = kernel.provisionPrincipal({
        handle: "worker",
        kind: "agent",
      });
      const actor = kernel.authenticateAccessToken(human.accessToken);
      const agentActor = kernel.authenticateAccessToken(agent.accessToken);
      const workspace = kernel.createWorkspace(actor, {
        name: "Stop",
        slug: "stop",
        idempotencyKey: "ws",
      });
      kernel.addMember(actor, {
        roomId: workspace.controlRoom.roomId,
        principalId: agent.principal.principalId,
      });
      const room = direct
        ? kernel.openDirectRoom(actor, {
            workspaceId: workspace.workspace.workspaceId,
            peerPrincipalId: agent.principal.principalId,
            basedOnControlRoomSeq: latestSeq(
              kernel,
              actor,
              workspace.controlRoom.roomId,
            ),
            idempotencyKey: "dm",
          })
        : kernel.createRoom(actor, { name: "Chat", slug: "chat" });
      if (!direct)
        kernel.addMember(actor, {
          roomId: room.roomId,
          principalId: agent.principal.principalId,
        });
      const stopped = kernel.roomAgentSos.requestStop(actor, {
        roomId: room.roomId,
        basedOnRoomSeq: latestSeq(kernel, actor, room.roomId),
        idempotencyKey: "stop",
        resumeOnMessage: true,
      });
      assert.equal(stopped.operation.state, "stopped");
      assert.throws(
        () =>
          kernel.roomAgentSos.requestStop(agentActor, {
            roomId: room.roomId,
            basedOnRoomSeq: latestSeq(kernel, actor, room.roomId),
            idempotencyKey: "forbidden",
          }),
        /Human/,
      );
      kernel.postRoomMessage(actor, {
        roomId: room.roomId,
        body: "Corrected instruction",
        recipients: [],
        basedOnRoomSeq: latestSeq(kernel, actor, room.roomId),
        idempotencyKey: "correction",
      });
      assert.equal(
        kernel.roomAgentSos.read(actor, { roomId: room.roomId }).operation,
        null,
      );
      const manual = kernel.roomAgentSos.requestStop(actor, {
        roomId: room.roomId,
        basedOnRoomSeq: latestSeq(kernel, actor, room.roomId),
        idempotencyKey: "manual",
      });
      kernel.postRoomMessage(actor, {
        roomId: room.roomId,
        body: "Manual SOS stays held",
        recipients: [],
        basedOnRoomSeq: latestSeq(kernel, actor, room.roomId),
        idempotencyKey: "after-manual",
      });
      assert.equal(
        kernel.roomAgentSos.read(actor, { roomId: room.roomId }).operation
          ?.operationId,
        manual.operation.operationId,
      );
    } finally {
      kernel.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
