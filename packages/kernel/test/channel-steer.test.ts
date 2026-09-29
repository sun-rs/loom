import assert from "node:assert/strict";
import test from "node:test";
import { migrateChannelSteerV78 } from "../src/channel-steer.ts";
import {
  ClientRoomCreateRequestSchema,
  ClientRoomUpdateRequestSchema,
} from "@rah-os/protocol";
import {
  roleInstanceFixture,
  startInstanceRunFromQueue,
} from "./role-instance-fixture.ts";

test("channel steer defaults on, is independently persisted, and update replay preserves intent", () => {
  const f = roleInstanceFixture();
  try {
    const input = ClientRoomCreateRequestSchema.parse({
      workspaceId: f.workspace.workspace.workspaceId,
      basedOnControlRoomSeq: f.head(f.controlRoomId),
      idempotencyKey: "quiet-channel",
      kind: "channel",
      name: "quiet",
      slug: "quiet",
      steerEnabled: false,
    });
    const made = f.kernel.createWorkspaceRoom(f.actor, input);
    assert.equal(made.room.steerEnabled, false);
    assert.equal(
      f.kernel.createWorkspaceRoom(f.actor, input).deduplicated,
      true,
    );
    assert.throws(
      () =>
        f.kernel.createWorkspaceRoom(f.actor, { ...input, steerEnabled: true }),
      /idempotency/i,
    );
    const update = ClientRoomUpdateRequestSchema.parse({
      roomId: f.home.roomId,
      name: "home",
      visibility: "private",
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "off",
      steerEnabled: false,
    });
    assert.equal(f.home.steerEnabled, true);
    assert.equal(
      f.kernel.updateWorkspaceRoom(f.actor, update).room.steerEnabled,
      false,
    );
    const on = {
      ...update,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "on",
      steerEnabled: true,
    };
    assert.equal(
      f.kernel.updateWorkspaceRoom(f.actor, on).room.steerEnabled,
      true,
    );
    assert.equal(
      f.kernel.updateWorkspaceRoom(f.actor, update).deduplicated,
      true,
    );
    assert.throws(
      () =>
        f.kernel.updateWorkspaceRoom(f.actor, {
          ...update,
          steerEnabled: true,
        }),
      /idempotency/i,
    );
    const rename = {
      ...update,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "rename",
      name: "renamed",
    };
    delete (rename as { steerEnabled?: boolean }).steerEnabled;
    assert.equal(
      f.kernel.updateWorkspaceRoom(f.actor, rename).room.steerEnabled,
      true,
    );
  } finally {
    f.close();
  }
});

test("turning channel steer off suppresses busy hints but preserves queued delivery; enabling it exposes unread hints", () => {
  const f = roleInstanceFixture();
  try {
    f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      recipients: [{ participantId: f.instance.instanceId, reason: "mention" }],
      body: "start",
      idempotencyKey: "start",
    });
    const work = startInstanceRunFromQueue(f);
    const notice = () =>
      f.kernel.readPendingRuntimeNotice(f.host, {
        activationId: work.activation.activationId,
        runAttemptId: work.run.runAttemptId,
      });
    const set = (enabled: boolean, key: string) =>
      f.kernel.updateWorkspaceRoom(f.actor, {
        roomId: f.home.roomId,
        name: "home",
        visibility: "private",
        basedOnRoomSeq: f.head(f.home.roomId),
        idempotencyKey: key,
        steerEnabled: enabled,
      });
    set(false, "off");
    const later = f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      recipients: [{ participantId: f.instance.instanceId, reason: "mention" }],
      body: "new human guidance",
      idempotencyKey: "later",
    });
    assert.equal(notice(), undefined);
    assert.equal(
      f.db
        .prepare(
          "SELECT state FROM inbox_items WHERE event_id=? AND participant_id=?",
        )
        .get(later.event.eventId, f.instance.instanceId)?.state,
      "pending",
    );
    assert.equal(
      f.db
        .prepare(
          "SELECT COUNT(*) n FROM activations WHERE room_id=? AND participant_id=? AND state='queued'",
        )
        .get(f.home.roomId, f.instance.instanceId)?.n,
      1,
    );
    set(true, "on");
    assert.deepEqual(notice()?.eventIds, [later.event.eventId]);
    assert.equal(
      f.db
        .prepare(
          "SELECT state FROM inbox_items WHERE event_id=? AND participant_id=?",
        )
        .get(later.event.eventId, f.instance.instanceId)?.state,
      "pending",
    );
  } finally {
    f.close();
  }
});

test("schema 78 preserves channel data, defaults migrated channels on, and keeps stored overrides on rerun", () => {
  const f = roleInstanceFixture();
  try {
    f.db.exec("ALTER TABLE rooms DROP COLUMN channel_steer_enabled");
    migrateChannelSteerV78(f.db);
    assert.equal(
      f.db
        .prepare("SELECT channel_steer_enabled FROM rooms WHERE room_id=?")
        .get(f.home.roomId)?.channel_steer_enabled,
      1,
    );
    f.db
      .prepare("UPDATE rooms SET channel_steer_enabled=0 WHERE room_id=?")
      .run(f.home.roomId);
    migrateChannelSteerV78(f.db);
    assert.equal(
      f.db
        .prepare("SELECT channel_steer_enabled FROM rooms WHERE room_id=?")
        .get(f.home.roomId)?.channel_steer_enabled,
      0,
    );
    assert.equal(
      f.db.prepare("PRAGMA integrity_check").get()?.integrity_check,
      "ok",
    );
    assert.equal(f.privateBox.steerEnabled, undefined);
  } finally {
    f.close();
  }
});

test("channel steer updates retain manager and freshness checks", () => {
  const f = roleInstanceFixture();
  try {
    const outsider = f.kernel.provisionPrincipal({
      handle: "outsider",
      kind: "human",
    });
    const input = {
      roomId: f.home.roomId,
      name: "home",
      visibility: "private" as const,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "protected-off",
      steerEnabled: false,
    };
    assert.throws(
      () =>
        f.kernel.updateWorkspaceRoom(
          f.kernel.authenticateAccessToken(outsider.accessToken),
          input,
        ),
      /member|manager|permission|access/i,
    );
    f.kernel.updateWorkspaceRoom(f.actor, {
      ...input,
      idempotencyKey: "first",
      steerEnabled: true,
    });
    assert.throws(
      () => f.kernel.updateWorkspaceRoom(f.actor, input),
      /stale|context|sequence/i,
    );
    assert.equal(
      f.db
        .prepare("SELECT channel_steer_enabled FROM rooms WHERE room_id=?")
        .get(f.home.roomId)?.channel_steer_enabled,
      1,
    );
  } finally {
    f.close();
  }
});

test("a disabled channel never disables its private box's own Human follow-up", () => {
  const f = roleInstanceFixture();
  try {
    f.kernel.updateWorkspaceRoom(f.actor, {
      roomId: f.home.roomId,
      name: "home",
      visibility: "private",
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "off",
      steerEnabled: false,
    });
    f.kernel.postMessage(f.actor, {
      roomId: f.privateBox.roomId,
      recipients: [{ participantId: f.instance.instanceId, reason: "mention" }],
      body: "private start",
      idempotencyKey: "private-start",
    });
    const work = startInstanceRunFromQueue(f);
    const later = f.kernel.postMessage(f.actor, {
      roomId: f.privateBox.roomId,
      recipients: [{ participantId: f.instance.instanceId, reason: "mention" }],
      body: "private guidance",
      idempotencyKey: "private-guide",
    });
    const notice = f.kernel.readPendingRuntimeNotice(f.host, {
      activationId: work.activation.activationId,
      runAttemptId: work.run.runAttemptId,
    });
    assert.deepEqual(notice?.eventIds, [later.event.eventId]);
  } finally {
    f.close();
  }
});
