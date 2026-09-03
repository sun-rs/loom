import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RoomKernel } from "../src/index.ts";

const KEY_A = `upload_png_${"a".repeat(40)}`;
const KEY_B = `upload_png_${"b".repeat(40)}`;

test("profile image upload intent is consumed by profile binding and old content is reclaimed only after settle", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-profile-image-life-"));
  let now = new Date("2026-09-03T00:00:00.000Z");
  const kernel = new RoomKernel({
    databasePath: join(directory, "room.db"),
    now: () => now,
  });
  kernel.initialize();
  try {
    const provisioned = kernel.provisionPrincipal({
      handle: "owner",
      kind: "human",
    });
    const actor = kernel.authenticateHumanAccessToken(provisioned.accessToken);
    const upload = kernel.profileImages.recordUpload(actor, {
      avatarKey: KEY_A,
    });

    const bound = kernel.updateAuthenticatedPrincipal(actor, {
      avatarKey: KEY_A,
      avatarUploadIntentId: upload.uploadIntentId,
      displayName: "Owner",
    });
    assert.equal(bound.avatarKey, KEY_A);
    assert.deepEqual(kernel.profileImages.reconcile({ reclaimBlob() {} }), {
      attempted: 0,
      failed: 0,
      reclaimed: 0,
      remainingDue: 0,
    });

    kernel.updateAuthenticatedPrincipal(actor, {
      avatarKey: null,
      displayName: "Owner",
    });
    const reclaimed: string[] = [];
    now = new Date("2026-09-03T00:14:59.999Z");
    assert.equal(
      kernel.profileImages.reconcile({
        reclaimBlob: (avatarKey) => reclaimed.push(avatarKey),
      }).attempted,
      0,
    );
    now = new Date("2026-09-03T00:15:00.000Z");
    const result = kernel.profileImages.reconcile({
      reclaimBlob: (avatarKey) => reclaimed.push(avatarKey),
    });
    assert.equal(result.attempted, 1);
    assert.equal(result.reclaimed, 1);
    assert.deepEqual(reclaimed, [KEY_A]);
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("profile image GC claim fences a late profile bind", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-profile-image-fence-"));
  let now = new Date("2026-09-03T00:00:00.000Z");
  const kernel = new RoomKernel({
    databasePath: join(directory, "room.db"),
    now: () => now,
  });
  kernel.initialize();
  try {
    const provisioned = kernel.provisionPrincipal({
      handle: "owner",
      kind: "human",
    });
    const actor = kernel.authenticateHumanAccessToken(provisioned.accessToken);
    const upload = kernel.profileImages.recordUpload(actor, {
      avatarKey: KEY_B,
    });
    now = new Date("2026-09-03T00:15:00.000Z");
    kernel.profileImages.reconcile({ reclaimBlob() {} });

    assert.throws(
      () =>
        kernel.updateAuthenticatedPrincipal(actor, {
          avatarKey: KEY_B,
          avatarUploadIntentId: upload.uploadIntentId,
          displayName: "Owner",
        }),
      /upload intent.*no longer pending/u,
    );
    assert.equal(kernel.getAuthenticatedPrincipal(actor).avatarKey, undefined);
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("profile image upload intent is actor-bound and a referenced object is never deleted", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-profile-image-owner-"));
  let now = new Date("2026-09-03T00:00:00.000Z");
  const kernel = new RoomKernel({
    databasePath: join(directory, "room.db"),
    now: () => now,
  });
  kernel.initialize();
  try {
    const first = kernel.provisionPrincipal({ handle: "first", kind: "human" });
    const second = kernel.provisionPrincipal({
      handle: "second",
      kind: "human",
    });
    const firstActor = kernel.authenticateHumanAccessToken(first.accessToken);
    const secondActor = kernel.authenticateHumanAccessToken(second.accessToken);
    const upload = kernel.profileImages.recordUpload(firstActor, {
      avatarKey: KEY_A,
    });
    assert.throws(
      () =>
        kernel.updateAuthenticatedPrincipal(secondActor, {
          avatarKey: KEY_A,
          avatarUploadIntentId: upload.uploadIntentId,
          displayName: "Second",
        }),
      /upload intent.*no longer pending/u,
    );
    kernel.updateAuthenticatedPrincipal(firstActor, {
      avatarKey: KEY_A,
      avatarUploadIntentId: upload.uploadIntentId,
      displayName: "First",
    });

    now = new Date("2026-09-03T00:15:00.000Z");
    const reclaimed: string[] = [];
    assert.deepEqual(
      kernel.profileImages.reconcile({
        reclaimBlob: (avatarKey) => reclaimed.push(avatarKey),
      }),
      { attempted: 1, failed: 0, reclaimed: 0, remainingDue: 0 },
    );
    assert.equal(reclaimed.length, 0);

    kernel.updateAuthenticatedPrincipal(firstActor, {
      avatarKey: null,
      displayName: "First",
    });
    now = new Date("2026-09-03T00:30:00.000Z");
    assert.equal(
      kernel.profileImages.reconcile({
        reclaimBlob: (avatarKey) => reclaimed.push(avatarKey),
      }).reclaimed,
      1,
    );
    assert.deepEqual(reclaimed, [KEY_A]);
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("a forwarded author snapshot keeps its uploaded avatar reachable", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-profile-image-forward-"));
  let now = new Date("2026-09-03T00:00:00.000Z");
  const kernel = new RoomKernel({
    databasePath: join(directory, "room.db"),
    now: () => now,
  });
  kernel.initialize();
  try {
    const provisioned = kernel.provisionPrincipal({
      handle: "owner",
      kind: "human",
    });
    const actor = kernel.authenticateHumanAccessToken(provisioned.accessToken);
    const upload = kernel.profileImages.recordUpload(actor, {
      avatarKey: KEY_A,
    });
    kernel.updateAuthenticatedPrincipal(actor, {
      avatarKey: KEY_A,
      avatarUploadIntentId: upload.uploadIntentId,
      displayName: "Snapshot Owner",
    });
    const source = kernel.createRoom(actor, {
      name: "Snapshot Source",
      slug: "snapshot-source",
    });
    const target = kernel.createRoom(actor, {
      name: "Snapshot Target",
      slug: "snapshot-target",
    });
    const message = kernel.postMessage(actor, {
      body: "keep the historic face",
      idempotencyKey: "snapshot-source",
      recipients: [],
      roomId: source.roomId,
    });
    const forwarded = kernel.forwardMessages(actor, {
      destinationRoomIds: [target.roomId],
      requestId: "snapshot-forward",
      sourceMessageIds: [message.event.aggregateId],
      sourceRoomId: source.roomId,
    });
    assert.equal(forwarded.results[0]?.status, "delivered");
    kernel.updateAuthenticatedPrincipal(actor, {
      avatarKey: null,
      displayName: "Snapshot Owner",
    });

    now = new Date("2026-09-03T00:15:00.000Z");
    const reclaimed: string[] = [];
    assert.deepEqual(
      kernel.profileImages.reconcile({
        reclaimBlob: (avatarKey) => reclaimed.push(avatarKey),
      }),
      { attempted: 1, failed: 0, reclaimed: 0, remainingDue: 0 },
    );
    assert.deepEqual(reclaimed, []);
    assert.equal(
      kernel.listMessages(actor, { roomId: target.roomId }).messages[0]
        ?.forwardedBundle?.items[0]?.actor.avatarKey,
      KEY_A,
    );
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("a failed Workspace mutation rolls back intent consumption for a fresh retry", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-profile-image-rollback-"));
  const kernel = new RoomKernel({
    databasePath: join(directory, "room.db"),
  });
  kernel.initialize();
  try {
    const provisioned = kernel.provisionPrincipal({
      handle: "owner",
      kind: "human",
    });
    const actor = kernel.authenticateHumanAccessToken(provisioned.accessToken);
    const created = kernel.createWorkspace(actor, {
      idempotencyKey: "create-workspace",
      name: "Workspace",
      slug: "workspace",
    });
    const upload = kernel.profileImages.recordUpload(actor, {
      avatarKey: KEY_B,
    });
    assert.throws(
      () =>
        kernel.updateWorkspace(actor, {
          avatarKey: KEY_B,
          avatarUploadIntentId: upload.uploadIntentId,
          basedOnControlRoomSeq: 0,
          idempotencyKey: "stale-update",
          name: "Stale",
          workspaceId: created.workspace.workspaceId,
        }),
      /sequence/u,
    );
    const saved = kernel.updateWorkspace(actor, {
      avatarKey: KEY_B,
      avatarUploadIntentId: upload.uploadIntentId,
      basedOnControlRoomSeq: created.event.roomSeq,
      idempotencyKey: "fresh-update",
      name: "Fresh",
      workspaceId: created.workspace.workspaceId,
    });
    assert.equal(saved.workspace.avatarKey, KEY_B);
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("startup inventory registers an old unreferenced legacy blob for GC", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-profile-image-inventory-"));
  const now = new Date("2026-09-03T01:00:00.000Z");
  const kernel = new RoomKernel({
    databasePath: join(directory, "room.db"),
    now: () => now,
  });
  kernel.initialize();
  try {
    kernel.profileImages.registerInventory([
      { avatarKey: KEY_A, modifiedAtMs: now.getTime() - 16 * 60_000 },
    ]);
    const reclaimed: string[] = [];
    const result = kernel.profileImages.reconcile({
      reclaimBlob: (avatarKey) => reclaimed.push(avatarKey),
    });
    assert.equal(result.reclaimed, 1);
    assert.deepEqual(reclaimed, [KEY_A]);
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("profile image GC backs off an isolated delete failure and later recovers", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-profile-image-backoff-"));
  let now = new Date("2026-09-03T00:00:00.000Z");
  const kernel = new RoomKernel({
    databasePath: join(directory, "room.db"),
    now: () => now,
  });
  kernel.initialize();
  try {
    const human = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
    const actor = kernel.authenticateHumanAccessToken(human.accessToken);
    kernel.profileImages.recordUpload(actor, { avatarKey: KEY_A });
    now = new Date("2026-09-03T00:15:00.000Z");
    assert.deepEqual(
      kernel.profileImages.reconcile({
        reclaimBlob: () => {
          throw new Error("disk busy");
        },
      }),
      { attempted: 1, failed: 1, reclaimed: 0, remainingDue: 0 },
    );
    assert.equal(
      kernel.profileImages.reconcile({ reclaimBlob() {} }).attempted,
      0,
    );
    now = new Date("2026-09-03T00:16:00.000Z");
    assert.equal(
      kernel.profileImages.reconcile({ reclaimBlob() {} }).reclaimed,
      1,
    );
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("one profile image GC sweep is bounded while preserving due backlog", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-profile-image-bounded-"));
  const now = new Date("2026-09-03T01:00:00.000Z");
  const kernel = new RoomKernel({
    databasePath: join(directory, "room.db"),
    now: () => now,
  });
  kernel.initialize();
  try {
    kernel.profileImages.registerInventory(
      Array.from({ length: 55 }, (_, index) => ({
        avatarKey: `upload_png_${index.toString(16).padStart(40, "0")}`,
        modifiedAtMs: now.getTime() - 16 * 60_000,
      })),
    );
    const result = kernel.profileImages.reconcile({ reclaimBlob() {} });
    assert.equal(result.attempted, 50);
    assert.equal(result.reclaimed, 50);
    assert.equal(result.remainingDue, 5);
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
