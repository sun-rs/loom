import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RoomKernel } from "../src/index.ts";

for (const running of [false, true])
  test(`explicit pause overrides composer auto-resume while ${running ? "stopping" : "stopped"} and survives restart`, () => {
    const directory = mkdtempSync(join(tmpdir(), "rah-persistent-pause-"));
    const databasePath = join(directory, "room.db");
    let kernel = new RoomKernel({ databasePath });
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
        name: "Council",
        slug: "council",
      });
      kernel.addMember(actor, {
        roomId: room.roomId,
        principalId: agent.principal.principalId,
      });
      const credential = kernel.provisionHostCredential({
        hostId: "host",
        participantIds: [agent.principal.principalId],
      });
      let host = kernel.authenticateHostAccessToken(credential.accessToken);
      kernel.heartbeatHost(host);
      const latest = () =>
        kernel.sync(actor, {
          roomId: room.roomId,
          consumerId: "human",
          limit: 500,
        }).latestRoomSeq;
      kernel.postRoomMessage(actor, {
        roomId: room.roomId,
        body: "Old work",
        idempotencyKey: "old-work",
      });
      const active = running
        ? kernel.leaseNextActivation(host, { leaseMs: 30000 })
        : null;
      const stop = {
        roomId: room.roomId,
        basedOnRoomSeq: latest(),
        idempotencyKey: "composer-stop",
        resumeOnMessage: true,
      };
      const original = kernel.roomAgentSos.requestStop(actor, stop);
      const pause = {
        roomId: room.roomId,
        basedOnRoomSeq: latest(),
        idempotencyKey: "persistent-pause",
        resumeOnMessage: false,
      };
      assert.throws(
        () =>
          kernel.roomAgentSos.requestStop(actor, {
            ...pause,
            basedOnRoomSeq: 0,
          }),
        /stale/i,
      );
      const tightened = kernel.roomAgentSos.requestStop(actor, pause);
      assert.equal(tightened.deduplicated, false);
      assert.equal(
        tightened.operation.operationId,
        original.operation.operationId,
      );
      assert.equal(tightened.operation.pendingTargetCount, running ? 1 : 0);
      assert.equal(tightened.event.payload.resumeOnMessage, false);
      assert.equal(
        kernel.roomAgentSos.requestStop(actor, pause).deduplicated,
        true,
      );
      assert.equal(
        kernel.roomAgentSos.requestStop(actor, stop).deduplicated,
        true,
      );
      assert.throws(
        () =>
          kernel.roomAgentSos.requestStop(actor, {
            ...pause,
            resumeOnMessage: true,
          }),
        /idempotency/i,
      );
      // A late composer request must not weaken an explicit manual pause.
      kernel.roomAgentSos.requestStop(actor, {
        ...stop,
        idempotencyKey: "late-composer-stop",
        basedOnRoomSeq: latest(),
      });
      kernel.postRoomMessage(actor, {
        roomId: room.roomId,
        body: "A new message is not permission to resume",
        idempotencyKey: "after-pause",
        basedOnRoomSeq: latest(),
      });
      assert.equal(kernel.leaseNextActivation(host, { leaseMs: 30000 }), null);
      if (active)
        kernel.resolveActivationCancellation(host, {
          activationId: active.activationId,
        });
      assert.equal(
        kernel.roomAgentSos.read(actor, { roomId: room.roomId }).operation
          ?.state,
        "stopped",
      );

      const task = kernel.createTask(actor, {
        roomId: room.roomId,
        title: "Withdrawn work",
        idempotencyKey: "task",
        basedOnRoomSeq: latest(),
      });
      kernel.cancelTask(actor, {
        taskId: task.task.taskId,
        basedOnRoomSeq: latest(),
        idempotencyKey: "cancel",
        reason: "Human withdrew the work",
      });
      const before = kernel.listActivations({ roomId: room.roomId });
      assert.ok(before.some((item) => item.state === "queued"));
      assert.equal(kernel.leaseNextActivation(host, { leaseMs: 30000 }), null);
      kernel.heartbeatHost(host, { state: "offline" });
      kernel.close();
      kernel = new RoomKernel({ databasePath });
      kernel.initialize();
      host = kernel.authenticateHostAccessToken(credential.accessToken);
      kernel.heartbeatHost(host);
      assert.deepEqual(kernel.listActivations({ roomId: room.roomId }), before);
      assert.equal(kernel.leaseNextActivation(host, { leaseMs: 30000 }), null);
      assert.equal(
        kernel.roomAgentSos.read(actor, { roomId: room.roomId }).operation
          ?.state,
        "stopped",
      );
      const other = kernel.createRoom(actor, { name: "Other", slug: "other" });
      kernel.addMember(actor, {
        roomId: other.roomId,
        principalId: agent.principal.principalId,
      });
      kernel.postRoomMessage(actor, {
        roomId: other.roomId,
        body: "Other work",
        idempotencyKey: "other-work",
      });
      assert.equal(
        kernel.leaseNextActivation(host, { leaseMs: 30000 })?.roomId,
        other.roomId,
      );
      const resumed = kernel.roomAgentSos.resume(actor, {
        roomId: room.roomId,
        basedOnRoomSeq: latest(),
        idempotencyKey: "explicit-resume",
        guidance: "Read the latest state; do not resume withdrawn work.",
      });
      assert.equal(resumed.operation.state, "resumed");
      assert.equal(
        kernel.roomAgentSos.read(actor, { roomId: room.roomId }).operation,
        null,
      );
    } finally {
      kernel.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
