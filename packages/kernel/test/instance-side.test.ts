import assert from "node:assert/strict";
import { test } from "node:test";
import {
  roleInstanceFixture,
  startInstanceRun,
  claimInstanceRun,
} from "./role-instance-fixture.ts";

test("Side is a private independent native branch, never a source member or delivery recipient", async () => {
  const f = roleInstanceFixture();
  try {
    const sourceRun = startInstanceRun(f);
    f.kernel.instanceSessions.record(f.host, {
      runAttemptId: sourceRun.run.runAttemptId,
      runtimeRunId: sourceRun.runtime.runtimeRunId,
    });
    f.kernel.memory.write(sourceRun.execution, {
      name: "source-fact",
      type: "project",
      description: "fixture",
      body: "shared knowledge",
      idempotencyKey: "source-memory",
    });
    sourceRun.finish(0);
    const before = f.head(f.home.roomId);
    const input = {
      instanceId: f.instance.instanceId,
      basedOnRoomSeq: before,
      idempotencyKey: "side-one",
    };
    let copies = 0;
    const result = await f.kernel.roles.createSide(
      f.actor,
      f.host,
      input,
      async () => {
        copies++;
      },
    );
    const side = result.side;
    assert.notEqual(side.instanceId, f.instance.instanceId);
    assert.equal(side.sourceInstanceId, f.instance.instanceId);
    assert.equal(f.head(f.home.roomId), before);
    assert.equal(
      f.db
        .prepare("SELECT 1 FROM memberships WHERE room_id=? AND principal_id=?")
        .get(f.home.roomId, side.instanceId),
      undefined,
    );
    assert.equal(
      f.db.prepare("SELECT kind FROM rooms WHERE room_id=?").get(side.roomId)
        ?.kind,
      "direct",
    );
    assert.equal(
      f.kernel.roles
        .list(f.actor, { controlRoomId: f.controlRoomId })
        .instances.some((i) => i.instanceId === side.instanceId),
      false,
    );
    const replay = await f.kernel.roles.createSide(
      f.actor,
      f.host,
      input,
      async () => {
        copies++;
      },
    );
    assert.equal(replay.side.instanceId, side.instanceId);
    assert.equal(copies, 1);
    f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      body: "source only",
      idempotencyKey: "source-only",
      recipients: [],
    });
    assert.equal(
      f.db
        .prepare("SELECT count(*) AS n FROM inbox_items WHERE participant_id=?")
        .get(side.instanceId)?.n,
      0,
    );
    f.kernel.postMessage(f.actor, {
      roomId: side.roomId,
      body: "private question",
      idempotencyKey: "side-question",
      recipients: [{ participantId: side.instanceId, reason: "mention" }],
    });
    assert.throws(
      () =>
        f.kernel.roles.discardSide(f.actor, {
          sideId: side.instanceId,
          basedOnRoomSeq: f.head(side.roomId),
          idempotencyKey: "discard-queued",
        }),
      /pending|running/,
    );
    const run = claimInstanceRun({
      ...f,
      home: { ...f.home, roomId: side.roomId },
      instance: {
        ...f.instance,
        instanceId: side.instanceId,
        agentId: side.agentId,
        channelId: side.roomId,
      },
      agentId: side.agentId,
      revisionId: result.agent.currentRevision.agentDefinitionRevisionId,
    });
    assert.equal(run.agentContext?.instanceSessionRequired, true);
    assert.equal(
      f.kernel.memory.read(run.execution, { name: "source-fact" }).entry.body,
      "shared knowledge",
    );
    assert.throws(
      () =>
        f.kernel.memory.write(run.execution, {
          name: "forbidden",
          type: "project",
          description: "no",
          body: "no",
          idempotencyKey: "side-write",
        }),
      /side/,
    );
    assert.throws(
      () =>
        f.kernel.createWorkerTask(run.execution, {
          title: "forbidden",
          basedOnRoomSeq: run.scope.toSeq,
          idempotencyKey: "side-task",
          leaseMs: 60000,
        }),
      /Side/,
    );
    const sourceReceipts = () =>
      JSON.stringify([
        f.db
          .prepare("SELECT * FROM subscription_cursors WHERE participant_id=?")
          .all(f.instance.instanceId),
        f.db
          .prepare(
            "SELECT * FROM worker_target_read_positions WHERE participant_id=?",
          )
          .all(f.instance.instanceId),
        f.db
          .prepare("SELECT * FROM inbox_items WHERE participant_id=?")
          .all(f.instance.instanceId),
      ]);
    const receiptsBefore = sourceReceipts();
    const sourceHead = f.head(f.home.roomId);
    const history = f.kernel.workerReads.history(run.execution, {
      channel: f.home.roomId,
      limit: 50,
    });
    assert.ok(history.messages.some((m) => m.body === "source only"));
    assert.equal(sourceReceipts(), receiptsBefore);
    assert.equal(history.readReceiptId, undefined);
    assert.throws(
      () =>
        f.kernel.workerReads.history(run.execution, {
          channel: f.privateBox.roomId,
          limit: 50,
        }),
      /unavailable|scope/,
    );
    assert.throws(
      () =>
        f.kernel.roles.discardSide(f.actor, {
          sideId: side.instanceId,
          basedOnRoomSeq: f.head(side.roomId),
          idempotencyKey: "discard-busy",
        }),
      /pending|running/,
    );
    assert.equal(f.head(f.home.roomId), sourceHead);
    assert.throws(
      () =>
        f.kernel.postWorkerMessage(run.execution, {
          channel: f.home.roomId,
          body: "forbidden",
          basedOnRoomSeq: sourceHead,
          idempotencyKey: "escape",
        }),
      /Side|side|scope|member|unavailable/,
    );
    f.kernel.postWorkerMessage(run.execution, {
      body: "private reply @Reviewer-1",
      basedOnRoomSeq: run.scope.toSeq,
      idempotencyKey: "side-reply",
    });
    assert.equal(
      sourceReceipts(),
      receiptsBefore,
      "mentioning the source in a private Side reply does not deliver to it",
    );
    assert.equal(f.head(f.home.roomId), sourceHead);
    f.kernel.presentWorkerMessages(run.execution);
    const memoryWindow = () =>
      String(
        f.db
          .prepare(
            "SELECT memory_json FROM activation_presented_windows WHERE run_attempt_id=?",
          )
          .get(run.run.runAttemptId)?.memory_json,
      );
    assert.ok(memoryWindow().includes("fixture"));
    f.kernel.memory.humanDelete(f.actor, {
      entryId: f.kernel.memory.read(run.execution, { name: "source-fact" })
        .entry.entryId,
      expectedRevision: 1,
      reason: "remove source fact",
      idempotencyKey: "delete-source-fact",
    });
    assert.ok(
      !memoryWindow().includes("fixture"),
      "deletion also clears descriptions in Side's online delivery snapshot",
    );
    f.kernel.memory.updatePolicy(f.actor, {
      channelId: f.home.roomId,
      expectedRevision: 0,
      overrides: [
        { instanceId: f.instance.instanceId, read: false, write: true },
      ],
      idempotencyKey: "disable-source-memory",
    });
    assert.throws(
      () => f.kernel.memory.read(run.execution, { name: "source-fact" }),
      /turned off/,
    );
    assert.equal(
      f.kernel.readInstanceMemoryIndex(f.host, {
        participantId: side.instanceId,
      }).readEnabled,
      false,
    );
    f.detachFromChannel();
    assert.throws(
      () =>
        f.kernel.workerReads.history(run.execution, {
          channel: f.home.roomId,
          limit: 50,
        }),
      /permission/,
    );
    assert.ok(
      f.kernel.workerReads
        .history(run.execution, { channel: side.roomId, limit: 50 })
        .messages.some((m) => m.body === "private reply @Reviewer-1"),
    );
    run.finish(0);
    const headAtDiscard = f.head(f.home.roomId);
    const discarded = f.kernel.roles.discardSide(f.actor, {
      sideId: side.instanceId,
      basedOnRoomSeq: f.head(side.roomId),
      idempotencyKey: "discard",
    });
    assert.equal(discarded.side.state, "discarded");
    assert.throws(
      () =>
        f.kernel.deleteWorkspaceRoom(f.actor, {
          roomId: f.home.roomId,
          basedOnRoomSeq: f.head(f.home.roomId),
          idempotencyKey: "delete-side-source",
        }),
      /Role instances/,
    );
    assert.throws(
      () =>
        f.kernel.deleteWorkspaceRoom(f.actor, {
          roomId: side.roomId,
          basedOnRoomSeq: f.head(side.roomId),
          idempotencyKey: "delete-side-room",
        }),
      /regular Channels/,
    );

    assert.equal(f.head(f.home.roomId), headAtDiscard);
    assert.throws(
      () =>
        f.kernel.postMessage(f.actor, {
          roomId: side.roomId,
          body: "after discard",
          idempotencyKey: "after",
          recipients: [],
        }),
      /Side|side|archived|inactive/,
    );
  } finally {
    f.close();
  }
});

test("Side rejects stale sources and failed native copies without publishing a conversation", async () => {
  const f = roleInstanceFixture();
  try {
    const run = startInstanceRun(f);
    f.kernel.instanceSessions.record(f.host, {
      runAttemptId: run.run.runAttemptId,
      runtimeRunId: run.runtime.runtimeRunId,
    });
    run.finish(0);
    const input = {
      instanceId: f.instance.instanceId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "side-failure",
    };
    const principalCount = () =>
      Number(f.db.prepare("SELECT count(*) AS n FROM principals").get()!.n);
    const before = principalCount();
    await assert.rejects(
      () =>
        f.kernel.roles.createSide(f.actor, f.host, input, async () => {
          throw new Error("native copy unavailable");
        }),
      /native copy unavailable/,
    );
    assert.equal(principalCount(), before);
    await assert.rejects(
      () =>
        f.kernel.roles.createSide(f.actor, f.host, input, async () => {
          f.kernel.roles.resetInstanceSession(f.actor, {
            ...input,
            idempotencyKey: "source-reset",
          });
        }),
      /source|sequence|changed/,
    );
    assert.equal(principalCount(), before);
    assert.equal(
      f.db.prepare("SELECT count(*) AS n FROM side_sessions").get()?.n,
      0,
    );
  } finally {
    f.close();
  }
});
