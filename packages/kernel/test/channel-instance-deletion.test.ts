import assert from "node:assert/strict";
import test from "node:test";
import { roleInstanceFixture } from "./role-instance-fixture.ts";
for (const order of ["channel-first", "role-first", "instance-first"]) {
  test(`channel deletion removes instance/private history but preserves unrelated data: ${order}`, () => {
    const f = roleInstanceFixture();
    try {
      const role = f.kernel.roles.list(f.actor, {
        controlRoomId: f.controlRoomId,
      }).roles[0]!;
      const otherRoom = f.channel("unrelated");
      const other = f.kernel.roles.instantiate(f.actor, {
        roleId: role.roleId,
        channelId: otherRoom.roomId,
        basedOnRoomSeq: f.head(otherRoom.roomId),
        idempotencyKey: "other-instance",
      }).instance;
      const otherSeq = f.head(otherRoom.roomId);
      if (order === "role-first")
        f.kernel.roles.delete(f.actor, {
          roleId: role.roleId,
          expectedRoleRevisionId: role.roleRevisionId,
          basedOnRoomSeq: f.head(f.controlRoomId),
          idempotencyKey: "delete-role",
        });
      if (order === "instance-first")
        f.kernel.removeRoomMember(f.actor, {
          roomId: f.home.roomId,
          principalId: f.instance.instanceId,
          basedOnRoomSeq: f.head(f.home.roomId),
          idempotencyKey: "remove-instance",
        });
      const input = {
        roomId: f.home.roomId,
        basedOnRoomSeq: f.head(f.home.roomId),
        idempotencyKey: "delete-channel",
      };
      f.kernel.deleteWorkspaceRoom(f.actor, input);
      assert.equal(
        f.db.prepare("select 1 from rooms where room_id=?").get(f.home.roomId),
        undefined,
      );
      assert.equal(
        f.db
          .prepare("select 1 from rooms where room_id=?")
          .get(f.privateBox.roomId),
        undefined,
      );
      assert.equal(
        f.db
          .prepare("select 1 from role_instances where instance_id=?")
          .get(f.instance.instanceId),
        undefined,
      );
      assert.ok(
        f.db
          .prepare("select 1 from role_templates where role_id=?")
          .get(role.roleId),
      );
      assert.ok(
        f.db
          .prepare("select 1 from role_instances where instance_id=?")
          .get(other.instanceId),
      );
      assert.equal(f.head(otherRoom.roomId), otherSeq);
      assert.deepEqual(f.db.prepare("pragma foreign_key_check").all(), []);
      assert.equal(
        f.kernel.deleteWorkspaceRoom(f.actor, input).deduplicated,
        true,
      );
    } finally {
      f.close();
    }
  });
}
test("stale deletion cannot disable members and active deletion keeps data until terminal proof", async () => {
  const { startInstanceRun } = await import("./role-instance-fixture.ts");
  const f = roleInstanceFixture();
  try {
    const peer = f.kernel.roles.instantiate(f.actor, {
      roleId: f.role.roleId,
      channelId: f.home.roomId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "second-instance",
    }).instance;
    const old = f.head(f.home.roomId),
      run = startInstanceRun(f);
    assert.throws(
      () =>
        f.kernel.deleteWorkspaceRoom(f.actor, {
          roomId: f.home.roomId,
          basedOnRoomSeq: old,
          idempotencyKey: "stale-delete",
        }),
      /stale/i,
    );
    assert.equal(
      f.db
        .prepare(
          "select state from agent_definitions where agent_definition_id=?",
        )
        .get(f.agentId)?.state,
      "enabled",
    );
    assert.throws(
      () =>
        f.kernel.deleteWorkspaceRoom(f.actor, {
          roomId: f.home.roomId,
          basedOnRoomSeq: f.head(f.home.roomId),
          idempotencyKey: "busy-delete",
        }),
      /terminal proof/i,
    );
    assert.ok(
      f.db.prepare("select 1 from rooms where room_id=?").get(f.home.roomId),
    );
    assert.ok(
      f.db
        .prepare(
          "select 1 from room_events where aggregate_id=? and type='agent.deletion_requested'",
        )
        .get(f.agentId),
    );
    assert.equal(
      f.db
        .prepare(
          "select state from agent_definitions where agent_definition_id=?",
        )
        .get(peer.agentId)?.state,
      "tombstoned",
      "other members must also receive the deletion request despite the first busy member",
    );
    f.kernel.recordRuntimeTermination(f.host, {
      runAttemptId: run.run.runAttemptId,
      runtimeRunId: run.runtime.runtimeRunId,
      exit: { code: null, signal: "SIGTERM" },
    });
    f.kernel.finishRunAttempt(f.host, {
      runAttemptId: run.run.runAttemptId,
      state: "cancelled",
      exitSignal: "SIGTERM",
    });
    f.kernel.retryActivation(f.host, {
      activationId: run.activation.activationId,
      error: "Agent disabled",
      retryAfterMs: 1000,
    });
    f.kernel.reconcileAgentDeletions();
    f.kernel.deleteWorkspaceRoom(f.actor, {
      roomId: f.home.roomId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "after-stop-delete",
    });
    assert.equal(
      f.db.prepare("select 1 from rooms where room_id=?").get(f.home.roomId),
      undefined,
    );
  } finally {
    f.close();
  }
});
test("deleting a source channel also erases its Side while keeping the Role reusable", async () => {
  const { startInstanceRun } = await import("./role-instance-fixture.ts");
  const f = roleInstanceFixture();
  try {
    const r = startInstanceRun(f);
    f.kernel.instanceSessions.record(f.host, {
      runAttemptId: r.run.runAttemptId,
      runtimeRunId: r.runtime.runtimeRunId,
    });
    r.finish(0);
    const s = await f.kernel.roles.createSide(
      f.actor,
      f.host,
      {
        instanceId: f.instance.instanceId,
        basedOnRoomSeq: f.head(f.home.roomId),
        idempotencyKey: "side",
      },
      async () => {},
    );
    f.kernel.deleteWorkspaceRoom(f.actor, {
      roomId: f.home.roomId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "delete-source",
    });
    assert.equal(
      f.db.prepare("select 1 from rooms where room_id=?").get(s.side.roomId),
      undefined,
    );
    assert.deepEqual(f.db.prepare("pragma foreign_key_check").all(), []);
  } finally {
    f.close();
  }
});
