import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { RoomKernel } from "../src/index.ts";
import { ROOM_DELETION_REFERENCED_TABLES } from "../src/room-deletion-service.ts";
import {
  ROOM_FILE_GC_GLOBAL_CLAIM_SQL,
  ROOM_FILE_GC_SCOPED_CLAIM_SQL,
} from "../src/room-file-gc.ts";
import { recordWorkerTargetReadPosition } from "../src/worker-target-read-position.ts";

async function* bytes(value: string) {
  yield Buffer.from(value);
}

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function fixture(options: { now?: () => Date } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "rah-room-delete-"));
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({
    databasePath,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  kernel.initialize();
  const owner = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
  const member = kernel.provisionPrincipal({ handle: "member", kind: "human" });
  const ownerActor = kernel.authenticateAccessToken(owner.accessToken);
  const memberActor = kernel.authenticateAccessToken(member.accessToken);
  const workspace = kernel.createWorkspace(ownerActor, {
    idempotencyKey: "workspace-create",
    name: "Delete fixture",
    slug: "delete-fixture",
  });
  kernel.addMember(ownerActor, {
    principalId: member.principal.principalId,
    roomId: workspace.controlRoom.roomId,
  });
  const channel = kernel.createWorkspaceRoom(ownerActor, {
    basedOnControlRoomSeq: kernel.sync(ownerActor, {
      consumerId: "create-channel",
      roomId: workspace.controlRoom.roomId,
    }).latestRoomSeq,
    idempotencyKey: "channel-create",
    kind: "channel",
    name: "Delete me",
    slug: "delete-me",
    visibility: "public",
    workspaceId: workspace.workspace.workspaceId,
  });
  const head = () =>
    kernel.sync(ownerActor, {
      consumerId: "delete-head",
      roomId: channel.room.roomId,
    }).latestRoomSeq;
  return {
    channel,
    databasePath,
    directory,
    head,
    kernel,
    memberActor,
    owner,
    ownerActor,
    workspace,
    close() {
      kernel.close();
      rmSync(directory, { force: true, recursive: true });
    },
  };
}

test("permanent Room deletion is strict, manager-only, kind-safe, stale-safe, and blocks active work", () => {
  const f = fixture();
  try {
    assert.throws(
      () =>
        f.kernel.deleteWorkspaceRoom(f.memberActor, {
          basedOnRoomSeq: f.head(),
          idempotencyKey: "member-delete",
          roomId: f.channel.room.roomId,
        }),
      /owner or admin/i,
    );
    assert.throws(
      () =>
        f.kernel.deleteWorkspaceRoom(f.ownerActor, {
          basedOnRoomSeq: f.head(),
          idempotencyKey: "control-delete",
          roomId: f.workspace.controlRoom.roomId,
        }),
      /regular Channels/i,
    );
    const stale = f.head();
    f.kernel.postRoomMessage(f.ownerActor, {
      basedOnRoomSeq: stale,
      body: "advance the Room",
      idempotencyKey: "advance-room",
      roomId: f.channel.room.roomId,
    });
    assert.throws(
      () =>
        f.kernel.deleteWorkspaceRoom(f.ownerActor, {
          basedOnRoomSeq: stale,
          idempotencyKey: "stale-delete",
          roomId: f.channel.room.roomId,
        }),
      /stale/i,
    );
    f.kernel.createTask(f.ownerActor, {
      idempotencyKey: "active-task",
      roomId: f.channel.room.roomId,
      title: "Still active",
    });
    assert.throws(
      () =>
        f.kernel.deleteWorkspaceRoom(f.ownerActor, {
          basedOnRoomSeq: f.head(),
          idempotencyKey: "active-delete",
          roomId: f.channel.room.roomId,
        }),
      /active collaboration work/i,
    );
  } finally {
    f.close();
  }
});

test("permanent Room deletion erases canonical and personal projections and replays one durable receipt", async () => {
  const f = fixture();
  try {
    const message = f.kernel.postRoomMessage(f.ownerActor, {
      basedOnRoomSeq: f.head(),
      body: "Room content that must disappear",
      idempotencyKey: "message",
      roomId: f.channel.room.roomId,
    });
    f.kernel.messageSocial.react(f.ownerActor, {
      active: true,
      basedOnRoomSeq: f.head(),
      emoji: "👍",
      idempotencyKey: "reaction",
      messageId: message.event.aggregateId,
      roomId: f.channel.room.roomId,
    });
    f.kernel.messageSocial.save(f.ownerActor, {
      idempotencyKey: "save",
      messageId: message.event.aggregateId,
      roomId: f.channel.room.roomId,
      saved: true,
    });
    const sidebarKey = `room:${f.channel.room.roomId}`;
    f.kernel.humanSidebar.patch(f.ownerActor, {
      expectedVersion: 0,
      idempotencyKey: "sidebar-reference",
      patch: {
        channelOrder: [sidebarKey],
        expandedLongMessages: [sidebarKey],
        mutedActivity: [sidebarKey],
        notifyAllMessages: [sidebarKey],
        pinned: [sidebarKey],
      },
      workspaceId: f.workspace.workspace.workspaceId,
    });
    const upload = f.kernel.files.prepare(f.ownerActor, {
      filename: "evidence.txt",
      idempotencyKey: "file",
      mimeType: "text/plain",
      roomId: f.channel.room.roomId,
      size: 5,
    });
    await f.kernel.files.upload(
      f.ownerActor,
      upload.attachmentId,
      bytes("hello"),
    );
    f.kernel.postRoomMessage(f.ownerActor, {
      attachmentIds: [upload.attachmentId],
      basedOnRoomSeq: f.head(),
      body: "",
      idempotencyKey: "file-message",
      roomId: f.channel.room.roomId,
    });
    const blob = join(f.directory, "room-files", upload.attachmentId);
    assert.equal(existsSync(blob), true);
    assert.equal(
      f.kernel.searchWorkspace(f.ownerActor, {
        query: "Room content",
        workspaceId: f.workspace.workspace.workspaceId,
      }).total,
      1,
    );
    const forwardAudit = new DatabaseSync(f.databasePath);
    forwardAudit
      .prepare(
        `INSERT INTO message_forward_requests(
           actor_id,request_id,source_room_id,workspace_id,
           source_message_ids_json,destination_room_ids_json,note,
           forwarded_bundle_json,created_at
         ) VALUES(?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        f.owner.principal.principalId,
        "forward-before-source-delete",
        f.channel.room.roomId,
        f.workspace.workspace.workspaceId,
        JSON.stringify([message.event.aggregateId]),
        JSON.stringify([]),
        "",
        JSON.stringify({ sourceRoomId: f.channel.room.roomId }),
        "2026-09-04T00:00:00.000Z",
      );
    forwardAudit.close();

    const input = {
      basedOnRoomSeq: f.head(),
      idempotencyKey: "delete-room",
      roomId: f.channel.room.roomId,
    };
    const deleted = f.kernel.deleteWorkspaceRoom(f.ownerActor, input);
    assert.equal(deleted.deduplicated, false);
    assert.deepEqual(deleted.fileGc, {
      failed: 0,
      pending: 0,
      reclaimed: 1,
      total: 1,
    });
    assert.equal(existsSync(blob), false);
    assert.equal(
      f.kernel
        .listRooms(f.ownerActor, {
          workspaceId: f.workspace.workspace.workspaceId,
        })
        .some(({ roomId }) => roomId === f.channel.room.roomId),
      false,
    );
    assert.equal(
      f.kernel.messageSocial.saved(f.ownerActor, {
        workspaceId: f.workspace.workspace.workspaceId,
      }).items.length,
      0,
    );
    const auditDatabase = new DatabaseSync(f.databasePath, { readOnly: true });
    assert.equal(
      Number(
        auditDatabase
          .prepare(
            "SELECT COUNT(*) AS count FROM message_forward_requests WHERE source_room_id=?",
          )
          .get(f.channel.room.roomId)?.count ?? 0,
      ),
      0,
    );
    const rawPreferences = JSON.parse(
      String(
        auditDatabase
          .prepare(
            `SELECT preferences_json FROM human_sidebar_preferences
             WHERE principal_id=? AND workspace_id=?`,
          )
          .get(f.owner.principal.principalId, f.workspace.workspace.workspaceId)
          ?.preferences_json,
      ),
    ) as Record<string, unknown>;
    auditDatabase.close();
    assert.equal(rawPreferences.version, 2);
    for (const field of [
      "channelOrder",
      "expandedLongMessages",
      "mutedActivity",
      "notifyAllMessages",
      "pinned",
    ]) {
      assert.deepEqual(rawPreferences[field], []);
    }
    assert.equal(
      f.kernel.searchWorkspace(f.ownerActor, {
        query: "Room content",
        workspaceId: f.workspace.workspace.workspaceId,
      }).total,
      0,
    );
    assert.equal(
      f.kernel
        .listHumanActivity(f.ownerActor, {
          workspaceId: f.workspace.workspace.workspaceId,
        })
        .items.some(({ roomId }) => roomId === f.channel.room.roomId),
      false,
    );
    assert.throws(
      () =>
        f.kernel.getMessageContext(f.ownerActor, {
          messageId: message.event.aggregateId,
          roomId: f.channel.room.roomId,
        }),
      /unavailable|not found|member/i,
    );
    assert.throws(
      () =>
        f.kernel.humanNavigation.resolve(f.ownerActor, {
          target: { kind: "room", roomId: f.channel.room.roomId },
        }),
      /unavailable|not found|forbidden/i,
    );
    assert.deepEqual(f.kernel.deleteWorkspaceRoom(f.ownerActor, input), {
      ...deleted,
      deduplicated: true,
    });
    assert.throws(
      () =>
        f.kernel.deleteWorkspaceRoom(f.ownerActor, {
          ...input,
          roomId: f.workspace.controlRoom.roomId,
        }),
      /idempotency/i,
    );
  } finally {
    f.close();
  }
});

test("failed post-commit blob GC honors backoff and is recovered by a later bounded sweep", async () => {
  let nowMs = Date.parse("2026-09-03T00:00:00.000Z");
  const now = () => new Date(nowMs);
  const f = fixture({ now });
  const originalRoot = join(f.directory, "room-files");
  const heldRoot = join(f.directory, "room-files-held");
  try {
    const upload = f.kernel.files.prepare(f.ownerActor, {
      filename: "recovery.txt",
      idempotencyKey: "recovery-file",
      mimeType: "text/plain",
      roomId: f.channel.room.roomId,
      size: 5,
    });
    await f.kernel.files.upload(
      f.ownerActor,
      upload.attachmentId,
      bytes("hello"),
    );
    renameSync(originalRoot, heldRoot);
    symlinkSync(heldRoot, originalRoot, "dir");

    const deleted = f.kernel.deleteWorkspaceRoom(f.ownerActor, {
      basedOnRoomSeq: f.head(),
      idempotencyKey: "recovery-delete",
      roomId: f.channel.room.roomId,
    });
    assert.equal(deleted.fileGc.failed, 1);
    assert.equal(existsSync(join(heldRoot, upload.attachmentId)), true);
    rmSync(originalRoot);
    renameSync(heldRoot, originalRoot);

    assert.deepEqual(
      f.kernel.files.reclaimRoomDeletionBlobs(deleted.deletionId),
      {
        failed: 1,
        pending: 0,
        reclaimed: 0,
        total: 1,
      },
    );
    let database = new DatabaseSync(f.databasePath, { readOnly: true });
    assert.equal(
      Number(
        database
          .prepare(
            "SELECT attempt_count FROM room_file_gc_receipts WHERE attachment_id=?",
          )
          .get(upload.attachmentId)?.attempt_count,
      ),
      1,
    );
    database.close();

    nowMs += 60_000;
    assert.deepEqual(f.kernel.files.reconcileRoomDeletionGc({ limit: 50 }), {
      attempted: 1,
      failed: 0,
      outstandingFailures: 0,
      reclaimed: 1,
      remainingDue: 0,
    });
    assert.equal(existsSync(join(originalRoot, upload.attachmentId)), false);
    database = new DatabaseSync(f.databasePath, { readOnly: true });
    const receipt = database
      .prepare(
        "SELECT state,attempt_count,last_error,tombstone_pass FROM room_file_gc_receipts WHERE attachment_id=?",
      )
      .get(upload.attachmentId);
    database.close();
    assert.deepEqual(
      { ...receipt },
      {
        attempt_count: 2,
        last_error: null,
        state: "tombstoned",
        tombstone_pass: 0,
      },
    );
  } finally {
    try {
      f.kernel.close();
    } catch {}
    rmSync(f.directory, { force: true, recursive: true });
  }
});

test("a tombstone pass reclaims a partial upload that materializes after the first delete", async () => {
  let nowMs = Date.parse("2026-09-03T00:00:00.000Z");
  const f = fixture({ now: () => new Date(nowMs) });
  try {
    const upload = f.kernel.files.prepare(f.ownerActor, {
      filename: "late.txt",
      idempotencyKey: "late-file",
      mimeType: "text/plain",
      roomId: f.channel.room.roomId,
      size: 5,
    });
    await f.kernel.files.upload(
      f.ownerActor,
      upload.attachmentId,
      bytes("hello"),
    );
    f.kernel.postRoomMessage(f.ownerActor, {
      attachmentIds: [upload.attachmentId],
      basedOnRoomSeq: f.head(),
      body: "",
      idempotencyKey: "late-file-message",
      roomId: f.channel.room.roomId,
    });
    const deleteInput = {
      basedOnRoomSeq: f.head(),
      idempotencyKey: "late-delete",
      roomId: f.channel.room.roomId,
    };
    const deleted = f.kernel.deleteWorkspaceRoom(f.ownerActor, deleteInput);

    const latePart = join(
      f.directory,
      "room-files",
      `${upload.attachmentId}.part`,
    );
    writeFileSync(latePart, "late", { mode: 0o600 });
    nowMs += 14 * 60_000;
    assert.equal(
      f.kernel.files.reconcileRoomDeletionGc({ limit: 50 }).attempted,
      0,
    );
    assert.equal(existsSync(latePart), true);

    nowMs += 60_000;
    assert.deepEqual(f.kernel.files.reconcileRoomDeletionGc({ limit: 50 }), {
      attempted: 1,
      failed: 0,
      outstandingFailures: 0,
      reclaimed: 1,
      remainingDue: 0,
    });
    assert.equal(existsSync(latePart), false);

    for (const delay of [60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000]) {
      nowMs += delay;
      assert.equal(
        f.kernel.files.reconcileRoomDeletionGc({ limit: 50 }).attempted,
        1,
      );
    }
    const audit = new DatabaseSync(f.databasePath, { readOnly: true });
    assert.equal(
      Number(
        audit
          .prepare(
            "SELECT COUNT(*) AS count FROM room_file_gc_receipts WHERE deletion_id=?",
          )
          .get(deleted.deletionId)?.count,
      ),
      0,
    );
    assert.equal(
      Number(
        audit
          .prepare(
            "SELECT gc_reclaimed_count FROM room_deletion_receipts WHERE deletion_id=?",
          )
          .get(deleted.deletionId)?.gc_reclaimed_count,
      ),
      1,
    );
    audit.close();
    assert.deepEqual(
      f.kernel.deleteWorkspaceRoom(f.ownerActor, deleteInput).fileGc,
      { failed: 0, pending: 0, reclaimed: 1, total: 1 },
    );
  } finally {
    f.close();
  }
});

test("an unexpired GC lease fences another sweep and an expired lease is recovered", () => {
  let nowMs = Date.parse("2026-09-03T00:00:00.000Z");
  const f = fixture({ now: () => new Date(nowMs) });
  try {
    const attachmentId = randomUUID();
    const deletionId = "room_deletion_lease_fixture";
    const database = new DatabaseSync(f.databasePath);
    database
      .prepare(
        `INSERT INTO room_deletion_receipts(
           deletion_id,actor_id,workspace_id,room_id,room_name,room_slug,
           based_on_room_seq,idempotency_key,file_count,deleted_at
         ) VALUES(?,?,?,?,?,?,0,?,1,?)`,
      )
      .run(
        deletionId,
        f.owner.principal.principalId,
        f.workspace.workspace.workspaceId,
        "room_deleted_lease_fixture",
        "Lease fixture",
        "lease-fixture",
        "lease-fixture",
        new Date(nowMs).toISOString(),
      );
    database
      .prepare(
        `INSERT INTO room_file_gc_receipts(
           deletion_id,attachment_id,state,attempt_count,last_error,
           created_at,updated_at,next_attempt_at_ms,lease_token,
           lease_expires_at_ms,tombstone_pass
         ) VALUES(?,?,'deleting',1,NULL,?,?,?,?,?,-1)`,
      )
      .run(
        deletionId,
        attachmentId,
        new Date(nowMs).toISOString(),
        new Date(nowMs).toISOString(),
        nowMs,
        "crashed-worker",
        nowMs + 120_000,
      );
    database.close();

    assert.equal(
      f.kernel.files.reconcileRoomDeletionGc({ limit: 50 }).attempted,
      0,
    );
    nowMs += 120_000;
    assert.deepEqual(f.kernel.files.reconcileRoomDeletionGc({ limit: 50 }), {
      attempted: 1,
      failed: 0,
      outstandingFailures: 0,
      reclaimed: 1,
      remainingDue: 0,
    });
  } finally {
    f.close();
  }
});

test("one Room file GC sweep is bounded by attempts even when a backlog remains", () => {
  const f = fixture();
  try {
    const database = new DatabaseSync(f.databasePath);
    const now = new Date().toISOString();
    const insert = database.prepare(
      `INSERT INTO room_files(
         attachment_id,room_id,actor_id,request_key,filename,mime_type,size,
         state,expires_at,created_at
       ) VALUES(?,?,?,?,?,'text/plain',0,'pending',?,?)`,
    );
    for (let index = 0; index < 51; index += 1) {
      insert.run(
        randomUUID(),
        f.channel.room.roomId,
        f.owner.principal.principalId,
        `bounded-${index}`,
        `bounded-${index}.txt`,
        new Date(Date.now() + 60_000).toISOString(),
        now,
      );
    }
    database.close();

    const deleted = f.kernel.deleteWorkspaceRoom(f.ownerActor, {
      basedOnRoomSeq: f.head(),
      idempotencyKey: "bounded-delete",
      roomId: f.channel.room.roomId,
    });
    assert.deepEqual(deleted.fileGc, {
      failed: 0,
      pending: 1,
      reclaimed: 50,
      total: 51,
    });
    assert.deepEqual(f.kernel.files.reconcileRoomDeletionGc({ limit: 50 }), {
      attempted: 1,
      failed: 0,
      outstandingFailures: 0,
      reclaimed: 1,
      remainingDue: 0,
    });
  } finally {
    f.close();
  }
});

test("Room file GC due selection stays index-backed for global and deletion-scoped sweeps", () => {
  const f = fixture();
  try {
    const database = new DatabaseSync(f.databasePath, { readOnly: true });
    const globalPlan = database
      .prepare(`EXPLAIN QUERY PLAN ${ROOM_FILE_GC_GLOBAL_CLAIM_SQL}`)
      .all(Date.now(), Date.now())
      .map((row) => String(row.detail))
      .join("\n");
    const scopedPlan = database
      .prepare(`EXPLAIN QUERY PLAN ${ROOM_FILE_GC_SCOPED_CLAIM_SQL}`)
      .all("room_deletion_fixture", Date.now(), Date.now())
      .map((row) => String(row.detail))
      .join("\n");
    database.close();

    assert.match(globalPlan, /idx_room_file_gc_pending/);
    assert.match(scopedPlan, /idx_room_file_gc_scoped_due/);
    assert.doesNotMatch(globalPlan, /SCAN room_file_gc_receipts|TEMP B-TREE/);
    assert.doesNotMatch(scopedPlan, /SCAN room_file_gc_receipts|TEMP B-TREE/);
  } finally {
    f.close();
  }
});

test("current schema preserves a schema v40 reclaimed file receipt while adding retry fencing", () => {
  const f = fixture();
  const attachmentId = randomUUID();
  try {
    const deleted = f.kernel.deleteWorkspaceRoom(f.ownerActor, {
      basedOnRoomSeq: f.head(),
      idempotencyKey: "migration-delete",
      roomId: f.channel.room.roomId,
    });
    f.kernel.close();

    const legacy = new DatabaseSync(f.databasePath);
    legacy.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN IMMEDIATE;
      DROP INDEX idx_room_file_gc_pending;
      ALTER TABLE room_file_gc_receipts RENAME TO room_file_gc_receipts_v41;
      DROP TABLE room_file_gc_receipts_v41;
      ALTER TABLE room_deletion_receipts RENAME TO room_deletion_receipts_v41;
      CREATE TABLE room_deletion_receipts (
        deletion_id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL REFERENCES principals(principal_id),
        workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
        room_id TEXT NOT NULL,
        room_name TEXT NOT NULL,
        room_slug TEXT NOT NULL,
        based_on_room_seq INTEGER NOT NULL CHECK (based_on_room_seq >= 0),
        idempotency_key TEXT NOT NULL,
        file_count INTEGER NOT NULL CHECK (file_count >= 0),
        deleted_at TEXT NOT NULL,
        UNIQUE (actor_id, idempotency_key)
      ) STRICT;
      INSERT INTO room_deletion_receipts(
        deletion_id,actor_id,workspace_id,room_id,room_name,room_slug,
        based_on_room_seq,idempotency_key,file_count,deleted_at
      )
      SELECT deletion_id,actor_id,workspace_id,room_id,room_name,room_slug,
             based_on_room_seq,idempotency_key,1,deleted_at
      FROM room_deletion_receipts_v41;
      DROP TABLE room_deletion_receipts_v41;
      CREATE TABLE room_file_gc_receipts (
        deletion_id TEXT NOT NULL REFERENCES room_deletion_receipts(deletion_id),
        attachment_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'reclaimed', 'failed')),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (deletion_id, attachment_id),
        UNIQUE (attachment_id)
      ) STRICT;
      CREATE INDEX idx_room_file_gc_pending
        ON room_file_gc_receipts(state, updated_at, deletion_id, attachment_id);
      PRAGMA user_version = 40;
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
    legacy
      .prepare(
        `INSERT INTO room_file_gc_receipts(
           deletion_id,attachment_id,state,attempt_count,last_error,
           created_at,updated_at
         ) VALUES(?,?,'reclaimed',4,NULL,?,?)`,
      )
      .run(
        deleted.deletionId,
        attachmentId,
        "2026-09-02T00:00:00.000Z",
        "2026-09-02T01:00:00.000Z",
      );
    legacy.close();

    const migrated = new RoomKernel({ databasePath: f.databasePath });
    migrated.initialize();
    migrated.close();
    const audit = new DatabaseSync(f.databasePath, { readOnly: true });
    assert.equal(
      Number(audit.prepare("PRAGMA user_version").get()?.user_version),
      85,
    );
    assert.deepEqual(audit.prepare("PRAGMA foreign_key_check").all(), []);
    assert.deepEqual(
      audit
        .prepare("PRAGMA table_info(room_file_gc_receipts)")
        .all()
        .map((row) => String(row.name))
        .filter((name) =>
          [
            "next_attempt_at_ms",
            "lease_token",
            "lease_expires_at_ms",
            "tombstone_pass",
          ].includes(name),
        ),
      [
        "next_attempt_at_ms",
        "lease_token",
        "lease_expires_at_ms",
        "tombstone_pass",
      ],
    );
    assert.equal(
      audit
        .prepare(
          "SELECT 1 AS present FROM room_file_gc_receipts WHERE attachment_id=?",
        )
        .get(attachmentId),
      undefined,
    );
    assert.equal(
      Number(
        audit
          .prepare(
            "SELECT gc_reclaimed_count FROM room_deletion_receipts WHERE deletion_id=?",
          )
          .get(deleted.deletionId)?.gc_reclaimed_count,
      ),
      1,
    );
    audit.close();
  } finally {
    try {
      f.kernel.close();
    } catch {}
    rmSync(f.directory, { force: true, recursive: true });
  }
});

test("current schema atomically replaces the schema v41 GC scan index", () => {
  const f = fixture();
  try {
    f.kernel.close();
    const legacy = new DatabaseSync(f.databasePath);
    legacy.exec(`
      DROP INDEX idx_room_file_gc_pending;
      DROP INDEX idx_room_file_gc_scoped_due;
      DROP INDEX idx_room_file_gc_failures;
      CREATE INDEX idx_room_file_gc_pending
        ON room_file_gc_receipts(
          state,next_attempt_at_ms,lease_expires_at_ms,deletion_id,attachment_id
        );
      PRAGMA user_version=41;
    `);
    legacy.close();

    const migrated = new RoomKernel({ databasePath: f.databasePath });
    migrated.initialize();
    migrated.close();
    const audit = new DatabaseSync(f.databasePath, { readOnly: true });
    assert.equal(
      Number(audit.prepare("PRAGMA user_version").get()?.user_version),
      85,
    );
    assert.deepEqual(
      audit
        .prepare("PRAGMA index_info(idx_room_file_gc_pending)")
        .all()
        .map((row) => String(row.name)),
      [
        "next_attempt_at_ms",
        "created_at",
        "deletion_id",
        "attachment_id",
        "state",
        "lease_expires_at_ms",
      ],
    );
    assert.deepEqual(
      audit
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_room_file_gc_%' ORDER BY name",
        )
        .all()
        .map((row) => String(row.name)),
      [
        "idx_room_file_gc_failures",
        "idx_room_file_gc_pending",
        "idx_room_file_gc_scoped_due",
      ],
    );
    audit.close();
  } finally {
    try {
      f.kernel.close();
    } catch {}
    rmSync(f.directory, { force: true, recursive: true });
  }
});

test("Room deletion GC rejects a malformed attachment identity even when the blob root is absent", () => {
  let nowMs = Date.parse("2026-09-03T00:00:00.000Z");
  const f = fixture({ now: () => new Date(nowMs) });
  try {
    const deletionId = "room_deletion_invalid_attachment_fixture";
    const database = new DatabaseSync(f.databasePath);
    database
      .prepare(
        `INSERT INTO room_deletion_receipts(
           deletion_id,actor_id,workspace_id,room_id,room_name,room_slug,
           based_on_room_seq,idempotency_key,file_count,deleted_at
         ) VALUES(?,?,?,?,?,?,0,?,1,?)`,
      )
      .run(
        deletionId,
        f.owner.principal.principalId,
        f.workspace.workspace.workspaceId,
        "room_deleted_invalid_attachment_fixture",
        "Invalid attachment fixture",
        "invalid-attachment-fixture",
        "invalid-attachment-fixture",
        new Date(nowMs).toISOString(),
      );
    database
      .prepare(
        `INSERT INTO room_file_gc_receipts(
           deletion_id,attachment_id,state,attempt_count,last_error,
           created_at,updated_at,next_attempt_at_ms
         ) VALUES(?,?,'pending',0,NULL,?,?,0)`,
      )
      .run(
        deletionId,
        "../../not-a-server-id",
        new Date(nowMs).toISOString(),
        new Date(nowMs).toISOString(),
      );
    database.close();

    for (let attempt = 1; attempt <= 12; attempt += 1) {
      assert.deepEqual(f.kernel.files.reconcileRoomDeletionGc({ limit: 50 }), {
        attempted: 1,
        failed: 1,
        outstandingFailures: 1,
        reclaimed: 0,
        remainingDue: 0,
      });
      const audit = new DatabaseSync(f.databasePath, { readOnly: true });
      const row = audit
        .prepare(
          `SELECT attempt_count,next_attempt_at_ms
           FROM room_file_gc_receipts WHERE attachment_id=?`,
        )
        .get("../../not-a-server-id");
      audit.close();
      const expectedBackoff = Math.min(
        60_000 * 2 ** (attempt - 1),
        60 * 60_000,
      );
      assert.equal(Number(row?.attempt_count), attempt);
      assert.equal(Number(row?.next_attempt_at_ms), nowMs + expectedBackoff);
      nowMs += expectedBackoff;
    }
    assert.deepEqual(f.kernel.files.roomDeletionGcSummary(deletionId), {
      failed: 1,
      pending: 0,
      reclaimed: 0,
      total: 1,
    });
  } finally {
    f.close();
  }
});

test("Room deletion GC keeps bytes and backs off when a canonical attachment reference still exists", () => {
  const f = fixture();
  try {
    const upload = f.kernel.files.prepare(f.ownerActor, {
      filename: "referenced.txt",
      idempotencyKey: "referenced-file",
      mimeType: "text/plain",
      roomId: f.channel.room.roomId,
      size: 1,
    });
    const deletionId = "room_deletion_reference_fixture";
    const database = new DatabaseSync(f.databasePath);
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO room_deletion_receipts(
           deletion_id,actor_id,workspace_id,room_id,room_name,room_slug,
           based_on_room_seq,idempotency_key,file_count,deleted_at
         ) VALUES(?,?,?,?,?,?,0,?,1,?)`,
      )
      .run(
        deletionId,
        f.owner.principal.principalId,
        f.workspace.workspace.workspaceId,
        "room_deleted_reference_fixture",
        "Reference fixture",
        "reference-fixture",
        "reference-fixture",
        now,
      );
    database
      .prepare(
        `INSERT INTO room_file_gc_receipts(
           deletion_id,attachment_id,state,attempt_count,last_error,
           created_at,updated_at,next_attempt_at_ms
         ) VALUES(?,?,'pending',0,NULL,?,?,0)`,
      )
      .run(deletionId, upload.attachmentId, now, now);
    database.close();

    assert.deepEqual(f.kernel.files.reconcileRoomDeletionGc({ limit: 50 }), {
      attempted: 1,
      failed: 1,
      outstandingFailures: 1,
      reclaimed: 0,
      remainingDue: 0,
    });
    const audit = new DatabaseSync(f.databasePath, { readOnly: true });
    assert.equal(
      Number(
        audit
          .prepare(
            "SELECT COUNT(*) AS count FROM room_files WHERE attachment_id=?",
          )
          .get(upload.attachmentId)?.count,
      ),
      1,
    );
    assert.match(
      String(
        audit
          .prepare(
            "SELECT last_error FROM room_file_gc_receipts WHERE attachment_id=?",
          )
          .get(upload.attachmentId)?.last_error,
      ),
      /still referenced/i,
    );
    audit.close();
  } finally {
    f.close();
  }
});

test("a mid-transaction deletion fault rolls back the Room graph, receipts, and blob ownership", async () => {
  const f = fixture();
  try {
    const message = f.kernel.postRoomMessage(f.ownerActor, {
      basedOnRoomSeq: f.head(),
      body: "must survive a rolled-back deletion",
      idempotencyKey: "rollback-message",
      roomId: f.channel.room.roomId,
    });
    const upload = f.kernel.files.prepare(f.ownerActor, {
      filename: "rollback.txt",
      idempotencyKey: "rollback-file",
      mimeType: "text/plain",
      roomId: f.channel.room.roomId,
      size: 5,
    });
    await f.kernel.files.upload(
      f.ownerActor,
      upload.attachmentId,
      bytes("hello"),
    );
    f.kernel.postRoomMessage(f.ownerActor, {
      attachmentIds: [upload.attachmentId],
      basedOnRoomSeq: f.head(),
      body: "",
      idempotencyKey: "rollback-file-message",
      roomId: f.channel.room.roomId,
    });
    const blob = join(f.directory, "room-files", upload.attachmentId);

    const fault = new DatabaseSync(f.databasePath);
    fault.exec(`CREATE TRIGGER room_delete_fault
      BEFORE DELETE ON messages
      WHEN OLD.message_id = '${message.event.aggregateId}'
      BEGIN
        SELECT RAISE(ABORT, 'injected room deletion fault');
      END;`);
    fault.close();

    assert.throws(
      () =>
        f.kernel.deleteWorkspaceRoom(f.ownerActor, {
          basedOnRoomSeq: f.head(),
          idempotencyKey: "rollback-delete",
          roomId: f.channel.room.roomId,
        }),
      /injected room deletion fault/i,
    );
    assert.equal(existsSync(blob), true);
    assert.equal(
      f.kernel
        .listRooms(f.ownerActor, {
          workspaceId: f.workspace.workspace.workspaceId,
        })
        .some(({ roomId }) => roomId === f.channel.room.roomId),
      true,
    );
    const database = new DatabaseSync(f.databasePath, { readOnly: true });
    assert.equal(
      Number(
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM room_deletion_receipts WHERE room_id=?",
          )
          .get(f.channel.room.roomId)?.count ?? 0,
      ),
      0,
    );
    assert.equal(
      Number(
        database
          .prepare("SELECT COUNT(*) AS count FROM room_files WHERE room_id=?")
          .get(f.channel.room.roomId)?.count ?? 0,
      ),
      1,
    );
    database.close();
  } finally {
    f.close();
  }
});

test("deleting a cross-Room Reminder target clears its durable Reminder graph without deleting the source Room", () => {
  const f = fixture();
  try {
    const controlRoomId = f.workspace.controlRoom.roomId;
    const source = f.kernel.createWorkspaceRoom(f.ownerActor, {
      basedOnControlRoomSeq: f.kernel.sync(f.ownerActor, {
        consumerId: "cross-reminder-control-head",
        roomId: controlRoomId,
      }).latestRoomSeq,
      idempotencyKey: "cross-reminder-source-room",
      kind: "channel",
      name: "Reminder source",
      slug: "reminder-source",
      visibility: "private",
      workspaceId: f.workspace.workspace.workspaceId,
    }).room;
    const agent = f.kernel.provisionPrincipal({
      handle: "reminder-owner",
      kind: "agent",
    });
    f.kernel.addMember(f.ownerActor, {
      principalId: agent.principal.principalId,
      roomId: controlRoomId,
    });
    const policy = f.kernel.createExecutionPolicy(f.ownerActor, {
      basedOnRoomSeq: f.kernel.sync(f.ownerActor, {
        consumerId: "cross-reminder-policy-head",
        roomId: controlRoomId,
      }).latestRoomSeq,
      controlRoomId,
      idempotencyKey: "cross-reminder-policy",
      modelIntent: {
        fallback: "disabled",
        reasoning: "default",
        serviceTier: "default",
      },
      preferred: [],
      required: {
        allowedProtocolFamilies: ["rah-worker-process/v1"],
        capabilities: [],
        minimumIsolation: "process",
        workspaceMode: "in_place",
      },
      retryPolicyRef: {
        artifactId: "retry-policy",
        contentDigest: digest("c"),
        versionId: "retry-policy-v1",
      },
      sessionPolicy: "fresh",
    });
    const definition = f.kernel.createAgentDefinition(f.ownerActor, {
      basedOnRoomSeq: f.kernel.sync(f.ownerActor, {
        consumerId: "cross-reminder-definition-head",
        roomId: controlRoomId,
      }).latestRoomSeq,
      controlRoomId,
      executionPolicyRevisionId: policy.policy.executionPolicyRevisionId,
      idempotencyKey: "cross-reminder-definition",
      instructionRefs: [],
      memoryPolicyRef: {
        artifactId: "memory-policy",
        contentDigest: digest("d"),
        versionId: "memory-policy-v1",
      },
      participantId: agent.principal.principalId,
      role: "Reminder owner",
      skillRefs: [],
    });
    const anchor = f.kernel.postRoomMessage(f.ownerActor, {
      body: "Cross-Room Reminder anchor",
      idempotencyKey: "cross-reminder-anchor",
      roomId: source.roomId,
    });
    const database = new DatabaseSync(f.databasePath);
    const now = "2026-09-03T00:00:00.000Z";
    database
      .prepare(
        `INSERT INTO reminders(
           reminder_id,owner_agent_id,owner_participant_id,room_id,
           target_room_id,thread_id,root_message_id,title,fire_at,fire_at_ms,
           status,message_id,payload_json,repeat_rule,timezone,version,
           created_at,updated_at
         ) VALUES(?,?,?,?,?,NULL,NULL,?,?,?,?,?,NULL,NULL,NULL,1,?,?)`,
      )
      .run(
        "reminder_cross_target",
        definition.definition.agentId,
        agent.principal.principalId,
        source.roomId,
        f.channel.room.roomId,
        "Target will be deleted",
        "2027-09-03T00:00:00.000Z",
        Date.parse("2027-09-03T00:00:00.000Z"),
        "scheduled",
        anchor.event.aggregateId,
        now,
        now,
      );
    database
      .prepare(
        `INSERT INTO reminder_events(
           event_id,reminder_id,event_type,actor_type,actor_id,occurred_at,
           next_fire_at,metadata_json
         ) VALUES(?,?,'scheduled','agent',?,?,?,NULL)`,
      )
      .run(
        "reminder_event_cross_target",
        "reminder_cross_target",
        agent.principal.principalId,
        now,
        "2027-09-03T00:00:00.000Z",
      );
    database.close();

    f.kernel.deleteWorkspaceRoom(f.ownerActor, {
      basedOnRoomSeq: f.head(),
      idempotencyKey: "cross-reminder-target-delete",
      roomId: f.channel.room.roomId,
    });

    const audited = new DatabaseSync(f.databasePath, { readOnly: true });
    assert.equal(
      Number(
        audited
          .prepare(
            "SELECT COUNT(*) AS count FROM reminders WHERE reminder_id=?",
          )
          .get("reminder_cross_target")?.count ?? 0,
      ),
      0,
    );
    assert.equal(
      Number(
        audited
          .prepare(
            "SELECT COUNT(*) AS count FROM reminder_events WHERE reminder_id=?",
          )
          .get("reminder_cross_target")?.count ?? 0,
      ),
      0,
    );
    audited.close();
    assert.equal(
      f.kernel.getMessageContext(f.ownerActor, {
        messageId: anchor.event.aggregateId,
        roomId: source.roomId,
      }).message.body,
      "Cross-Room Reminder anchor",
    );
  } finally {
    f.close();
  }
});

test("the explicit Room eraser covers every table whose foreign keys can reach rooms or that carries a room_id", () => {
  const f = fixture();
  try {
    const database = new DatabaseSync(f.databasePath, { readOnly: true });
    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => String(row.name));
    const edges: Array<{ from: string; to: string }> = [];
    for (const table of tables) {
      for (const foreignKey of database
        .prepare(`PRAGMA foreign_key_list("${table}")`)
        .all()) {
        edges.push({ from: table, to: String(foreignKey.table) });
      }
    }
    // FK-less room-scoped bookkeeping (a plain room_id column) must be erased
    // too; only the deletion tombstone itself outlives the Room.
    const roomScoped = tables.filter(
      (table) =>
        table !== "room_deletion_receipts" &&
        database
          .prepare(`PRAGMA table_info("${table}")`)
          .all()
          .some((column) => String(column.name) === "room_id"),
    );
    database.close();
    const reachable = new Set(["rooms", ...roomScoped]);
    for (let changed = true; changed;) {
      changed = false;
      for (const edge of edges) {
        if (reachable.has(edge.to) && !reachable.has(edge.from)) {
          reachable.add(edge.from);
          changed = true;
        }
      }
    }
    assert.deepEqual(
      [...reachable].sort(),
      [...ROOM_DELETION_REFERENCED_TABLES].sort(),
    );
  } finally {
    f.close();
  }
});

test("Room deletion erases the Channel's instance wake guard and wake chain after real wakes and preserves another Room", () => {
  const f = fixture();
  try {
    const alpha = f.kernel.provisionPrincipal({
      handle: "wake-alpha",
      kind: "agent",
    });
    const beta = f.kernel.provisionPrincipal({
      handle: "wake-beta",
      kind: "agent",
    });
    for (const agent of [alpha, beta])
      f.kernel.addMember(f.ownerActor, {
        principalId: agent.principal.principalId,
        roomId: f.channel.room.roomId,
      });
    f.kernel.postRoomMessage(f.ownerActor, {
      basedOnRoomSeq: f.head(),
      body: "Human starts the Channel chain",
      idempotencyKey: "wake-human",
      roomId: f.channel.room.roomId,
    });
    f.kernel.postRoomMessage(f.ownerActor, {
      basedOnRoomSeq: f.kernel.sync(f.ownerActor, {
        consumerId: "wake-control-head",
        roomId: f.workspace.controlRoom.roomId,
      }).latestRoomSeq,
      body: "Human message in another Room",
      idempotencyKey: "wake-control-human",
      roomId: f.workspace.controlRoom.roomId,
    });
    const wake = f.kernel.postMessage(
      f.kernel.authenticateAccessToken(alpha.accessToken),
      {
        basedOnRoomSeq: f.head(),
        body: "@wake-beta please check",
        idempotencyKey: "wake-alpha-mentions-beta",
        recipients: [
          { participantId: beta.principal.principalId, reason: "mention" },
        ],
        roomId: f.channel.room.roomId,
      },
    );
    assert.equal(wake.activationIds.length, 1);
    const count = (table: string, roomId: string) => {
      const audited = new DatabaseSync(f.databasePath, { readOnly: true });
      try {
        return Number(
          audited
            .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE room_id=?`)
            .get(roomId)!.count,
        );
      } finally {
        audited.close();
      }
    };
    assert.equal(count("instance_wake_guards", f.channel.room.roomId), 1);
    assert.equal(count("instance_wake_chain", f.channel.room.roomId), 1);
    assert.equal(
      count("instance_wake_guards", f.workspace.controlRoom.roomId),
      1,
    );
    // Retire the derived wake; the active-work gate is tested separately.
    const writable = new DatabaseSync(f.databasePath);
    try {
      writable
        .prepare("UPDATE activations SET state='cancelled' WHERE room_id=?")
        .run(f.channel.room.roomId);
    } finally {
      writable.close();
    }
    f.kernel.deleteWorkspaceRoom(f.ownerActor, {
      basedOnRoomSeq: f.head(),
      idempotencyKey: "delete-wake-guard",
      roomId: f.channel.room.roomId,
    });
    assert.equal(count("instance_wake_guards", f.channel.room.roomId), 0);
    assert.equal(count("instance_wake_chain", f.channel.room.roomId), 0);
    assert.equal(
      count("instance_wake_guards", f.workspace.controlRoom.roomId),
      1,
      "another Room's guard survives",
    );
  } finally {
    f.close();
  }
});

test("Room deletion sweeps the server-side Worker target read positions", () => {
  const f = fixture();
  try {
    const writable = new DatabaseSync(f.databasePath);
    try {
      recordWorkerTargetReadPosition(writable, {
        participantId: f.owner.principal.principalId,
        roomId: f.channel.room.roomId,
        throughRoomSeq: f.head(),
        updatedAt: "2026-09-09T00:00:00.000Z",
      });
      assert.equal(
        Number(
          writable
            .prepare(
              "SELECT COUNT(*) AS count FROM worker_target_read_positions WHERE room_id=?",
            )
            .get(f.channel.room.roomId)!.count,
        ),
        1,
      );
    } finally {
      writable.close();
    }
    f.kernel.deleteWorkspaceRoom(f.ownerActor, {
      basedOnRoomSeq: f.head(),
      idempotencyKey: "delete-read-positions",
      roomId: f.channel.room.roomId,
    });
    const audited = new DatabaseSync(f.databasePath, { readOnly: true });
    try {
      assert.equal(
        Number(
          audited
            .prepare(
              "SELECT COUNT(*) AS count FROM worker_target_read_positions WHERE room_id=?",
            )
            .get(f.channel.room.roomId)!.count,
        ),
        0,
      );
    } finally {
      audited.close();
    }
  } finally {
    f.close();
  }
});

test("Room erasure removes delivery windows and batch receipts atomically and preserves another Room", () => {
  const f = fixture();
  const db = new DatabaseSync(f.databasePath);
  try {
    const agent = f.kernel.provisionPrincipal({
      handle: "receipt-agent",
      kind: "agent",
    });
    const roomIds = [f.channel.room.roomId, f.workspace.controlRoom.roomId];
    const activationIds: string[] = [];
    for (const [index, roomId] of roomIds.entries()) {
      f.kernel.addMember(f.ownerActor, {
        roomId,
        principalId: agent.principal.principalId,
      });
      f.kernel.postMessage(f.ownerActor, {
        roomId,
        body: `Receipt source ${index}`,
        idempotencyKey: `receipt-source-${index}`,
        recipients: [
          { participantId: agent.principal.principalId, reason: "mention" },
        ],
      });
      const activationId = String(
        db
          .prepare(
            "SELECT activation_id FROM activations WHERE room_id=? AND participant_id=? ORDER BY created_at DESC LIMIT 1",
          )
          .get(roomId, agent.principal.principalId)!.activation_id,
      );
      activationIds.push(activationId);
      // Seed retained terminal-Activation receipts; lifecycle gates are tested separately.
      db.prepare(
        "UPDATE activations SET state='cancelled' WHERE activation_id=?",
      ).run(activationId);
      db.prepare("INSERT INTO activation_delivery_windows VALUES(?,?,?)").run(
        activationId,
        "receipt-consumer",
        0,
      );
      db.prepare(
        "INSERT INTO task_batch_command_receipts VALUES(?,?,?,?,?,?,?,?,?)",
      ).run(
        agent.principal.principalId,
        roomId,
        "create",
        `receipt-${index}`,
        "fixture-digest",
        JSON.stringify({ roomId, results: [], tasks: [], deduplicated: false }),
        activationId,
        0,
        604800000,
      );
    }
    const counts = () =>
      roomIds.map((roomId, index) => [
        Number(
          db
            .prepare(
              "SELECT COUNT(*) AS n FROM activation_delivery_windows WHERE activation_id=?",
            )
            .get(activationIds[index]!)!.n,
        ),
        Number(
          db
            .prepare(
              "SELECT COUNT(*) AS n FROM task_batch_command_receipts WHERE room_id=?",
            )
            .get(roomId)!.n,
        ),
      ]);
    assert.deepEqual(counts(), [
      [1, 1],
      [1, 1],
    ]);
    db.exec(
      "CREATE TRIGGER reject_receipt_room_erasure BEFORE DELETE ON messages BEGIN SELECT RAISE(ABORT, 'receipt erase rollback'); END",
    );
    assert.throws(
      () =>
        f.kernel.deleteWorkspaceRoom(f.ownerActor, {
          roomId: f.channel.room.roomId,
          basedOnRoomSeq: f.head(),
          idempotencyKey: "receipt-delete",
        }),
      /receipt erase rollback/,
    );
    assert.deepEqual(
      counts(),
      [
        [1, 1],
        [1, 1],
      ],
      "later failure rolls back both new receipt removals",
    );
    db.exec("DROP TRIGGER reject_receipt_room_erasure");
    f.kernel.deleteWorkspaceRoom(f.ownerActor, {
      roomId: f.channel.room.roomId,
      basedOnRoomSeq: f.head(),
      idempotencyKey: "receipt-delete",
    });
    assert.deepEqual(counts(), [
      [0, 0],
      [1, 1],
    ]);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
    f.close();
  }
});

test("the explicit Room eraser also removes read-coverage bookkeeping, without touching another Room", () => {
  const f = fixture();
  const db = new DatabaseSync(f.databasePath);
  try {
    // Bookkeeping fixture: production currently refuses deletion of Channels with Role instances.
    // The eraser must still cover its complete Room graph independently of that MVP guard.
    const insert = db.prepare(
      "INSERT INTO worker_run_read_receipts(run_attempt_id,participant_id,room_id,room_seq,thread_key,generation) VALUES(?,?,?,?,?,?)",
    );
    insert.run(
      "run-deletion-fixture",
      "participant-fixture",
      f.channel.room.roomId,
      1,
      "",
      0,
    );
    insert.run(
      "run-keep-fixture",
      "participant-fixture",
      f.workspace.controlRoom.roomId,
      1,
      "",
      0,
    );
    f.kernel.deleteWorkspaceRoom(f.ownerActor, {
      roomId: f.channel.room.roomId,
      basedOnRoomSeq: f.head(),
      idempotencyKey: "delete-coverage",
    });
    assert.equal(
      db
        .prepare(
          "SELECT count(*) n FROM worker_run_read_receipts WHERE room_id=?",
        )
        .get(f.channel.room.roomId)?.n,
      0,
    );
    assert.equal(
      db
        .prepare(
          "SELECT count(*) n FROM worker_run_read_receipts WHERE room_id=?",
        )
        .get(f.workspace.controlRoom.roomId)?.n,
      1,
    );
  } finally {
    db.close();
    f.close();
  }
});
