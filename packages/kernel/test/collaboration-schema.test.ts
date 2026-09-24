import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { KERNEL_SCHEMA_VERSION, RoomKernel } from "../src/index.ts";

test("schema v7 migrates legacy Rooms into one Workspace with proven Human owners", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-collaboration-v7-"));
  const databasePath = join(directory, "room.db");
  try {
    const legacy = new DatabaseSync(databasePath);
    createLegacyCollaborationSchema(legacy, "human");
    legacy.close();

    const kernel = new RoomKernel({ databasePath });
    kernel.initialize();
    kernel.close();

    const migrated = new DatabaseSync(databasePath);
    migrated.exec("PRAGMA foreign_keys = ON");
    assert.equal(KERNEL_SCHEMA_VERSION, 64);
    assert.equal(
      (
        migrated.prepare("PRAGMA user_version").get() as {
          user_version: number;
        }
      ).user_version,
      KERNEL_SCHEMA_VERSION,
    );
    assert.deepEqual(
      migrated
        .prepare(
          "SELECT workspace_id, slug, name, state FROM workspaces ORDER BY workspace_id",
        )
        .all()
        .map((row) => ({ ...row })),
      [
        {
          name: "Legacy Workspace",
          slug: "legacy",
          state: "active",
          workspace_id: "workspace_legacy",
        },
      ],
    );
    assert.ok(
      migrated
        .prepare("PRAGMA index_list(room_events)")
        .all()
        .some(
          (row) =>
            (row as { name: string }).name ===
            "idx_room_events_message_aggregate",
        ),
    );
    assert.ok(
      migrated
        .prepare("PRAGMA table_info(task_submissions)")
        .all()
        .some((row) => (row as { name: string }).name === "evidence_json"),
    );
    assert.ok(
      migrated
        .prepare("PRAGMA index_list(task_submissions)")
        .all()
        .some(
          (row) =>
            (row as { name: string }).name ===
            "idx_task_submissions_room_created",
        ),
    );
    assert.ok(
      migrated
        .prepare("PRAGMA index_list(task_reviews)")
        .all()
        .some(
          (row) =>
            (row as { name: string }).name === "idx_task_reviews_room_created",
        ),
    );
    assert.deepEqual(
      migrated
        .prepare(
          "SELECT room_id, workspace_id, kind, archived_at FROM rooms ORDER BY room_id",
        )
        .all()
        .map((row) => ({ ...row })),
      [
        {
          archived_at: null,
          kind: "channel",
          room_id: "room-legacy",
          workspace_id: "workspace_legacy",
        },
      ],
    );
    assert.deepEqual(
      migrated
        .prepare(
          "SELECT principal_id, role FROM memberships ORDER BY principal_id",
        )
        .all()
        .map((row) => ({ ...row })),
      [
        { principal_id: "agent-legacy", role: "member" },
        { principal_id: "human-legacy", role: "owner" },
      ],
    );
    assert.ok(
      migrated
        .prepare("PRAGMA table_info(messages)")
        .all()
        .some((row) => (row as { name: string }).name === "thread_id"),
    );
    assert.deepEqual(
      migrated
        .prepare("PRAGMA table_info(agent_thread_follows)")
        .all()
        .map((row) => (row as { name: string }).name),
      ["participant_id", "thread_id", "following", "source", "updated_at"],
    );
    assert.deepEqual(
      migrated
        .prepare("PRAGMA table_info(agent_thread_follower_undo)")
        .all()
        .map((row) => (row as { name: string }).name),
      [
        "undo_token",
        "actor_id",
        "participant_id",
        "thread_id",
        "previous_source",
        "expires_at",
        "created_at",
      ],
    );

    migrated
      .prepare(
        `INSERT INTO threads(
           thread_id, room_id, root_message_id, created_by, reply_count, created_at
         ) VALUES(?, ?, ?, ?, 0, ?)`,
      )
      .run(
        "thread-legacy",
        "room-legacy",
        "message-root",
        "human-legacy",
        "2026-08-26T00:00:02.000Z",
      );
    migrated
      .prepare(
        `INSERT INTO messages(
           message_id, room_id, actor_id, thread_id, body, created_at
         ) VALUES(?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "message-reply",
        "room-legacy",
        "agent-legacy",
        "thread-legacy",
        "Reply",
        "2026-08-26T00:00:03.000Z",
      );
    assert.throws(() =>
      migrated
        .prepare(
          `INSERT INTO messages(
             message_id, room_id, actor_id, thread_id, body, created_at
           ) VALUES(?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "message-orphan-reply",
          "room-legacy",
          "agent-legacy",
          "thread-missing",
          "Orphan",
          "2026-08-26T00:00:04.000Z",
        ),
    );
    assert.deepEqual(migrated.prepare("PRAGMA foreign_key_check").all(), []);
    migrated.close();

    const reopened = new RoomKernel({ databasePath });
    reopened.initialize();
    reopened.close();
    const backfilled = new DatabaseSync(databasePath);
    assert.deepEqual(
      backfilled
        .prepare(
          `SELECT participant_id, thread_id, following, source
           FROM agent_thread_follows
           ORDER BY participant_id, thread_id`,
        )
        .all()
        .map((row) => ({ ...row })),
      [
        {
          following: 1,
          participant_id: "agent-legacy",
          source: "participation",
          thread_id: "thread-legacy",
        },
      ],
    );
    backfilled.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("schema v7 fails closed when a legacy Room has no provable Human owner", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-collaboration-owner-"));
  const databasePath = join(directory, "room.db");
  try {
    const legacy = new DatabaseSync(databasePath);
    createLegacyCollaborationSchema(legacy, "agent");
    legacy.close();

    const kernel = new RoomKernel({ databasePath });
    assert.throws(() => kernel.initialize(), /provable Human owner/);
    kernel.close();

    const unchanged = new DatabaseSync(databasePath);
    assert.equal(
      (
        unchanged.prepare("PRAGMA user_version").get() as {
          user_version: number;
        }
      ).user_version,
      6,
    );
    assert.equal(
      unchanged
        .prepare("PRAGMA table_info(rooms)")
        .all()
        .some((row) => (row as { name: string }).name === "workspace_id"),
      false,
    );
    unchanged.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("fresh Rooms enter the canonical Workspace with a Human owner", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-collaboration-fresh-"));
  const databasePath = join(directory, "room.db");
  try {
    const kernel = new RoomKernel({ databasePath });
    kernel.initialize();
    const human = kernel.provisionPrincipal({
      handle: "workspace-human",
      kind: "human",
    });
    const agent = kernel.provisionPrincipal({
      handle: "workspace-agent",
      kind: "agent",
    });
    const humanActor = kernel.authenticateAccessToken(human.accessToken);
    const agentActor = kernel.authenticateAccessToken(agent.accessToken);
    assert.throws(
      () =>
        kernel.createRoom(agentActor, {
          name: "Agent-owned Room",
          slug: "agent-owned-room",
        }),
      /Human principals can create Rooms/,
    );
    const room = kernel.createRoom(humanActor, {
      name: "Human-owned Room",
      slug: "human-owned-room",
    });
    assert.deepEqual(room, {
      createdAt: room.createdAt,
      kind: "channel",
      name: "Human-owned Room",
      roomId: room.roomId,
      slug: "human-owned-room",
      workspaceId: "workspace_legacy",
    });
    kernel.close();

    const stored = new DatabaseSync(databasePath);
    assert.deepEqual(
      {
        ...stored
          .prepare(
            "SELECT principal_id, role FROM memberships WHERE room_id = ?",
          )
          .get(room.roomId),
      },
      { principal_id: human.principal.principalId, role: "owner" },
    );
    stored.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createLegacyCollaborationSchema(
  database: DatabaseSync,
  creatorKind: "agent" | "human",
): void {
  const creatorId = `${creatorKind}-legacy`;
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA user_version = 6;
    CREATE TABLE principals (
      principal_id TEXT PRIMARY KEY,
      handle TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK (kind IN ('human', 'agent', 'service')),
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE rooms (
      room_id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      next_seq INTEGER NOT NULL DEFAULT 1 CHECK (next_seq > 0),
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE memberships (
      room_id TEXT NOT NULL REFERENCES rooms(room_id),
      principal_id TEXT NOT NULL REFERENCES principals(principal_id),
      joined_at TEXT NOT NULL,
      PRIMARY KEY (room_id, principal_id)
    ) STRICT;
    CREATE TABLE messages (
      message_id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(room_id),
      actor_id TEXT NOT NULL REFERENCES principals(principal_id),
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE room_events (
      event_id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(room_id),
      room_seq INTEGER NOT NULL CHECK (room_seq > 0),
      type TEXT NOT NULL,
      actor_id TEXT NOT NULL REFERENCES principals(principal_id),
      aggregate_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      schema_version INTEGER NOT NULL CHECK (schema_version > 0),
      created_at TEXT NOT NULL,
      UNIQUE (room_id, room_seq),
      UNIQUE (room_id, idempotency_key)
    ) STRICT;
    INSERT INTO principals VALUES
      ('human-legacy', 'human-legacy', 'human', '2026-08-26T00:00:00.000Z'),
      ('agent-legacy', 'agent-legacy', 'agent', '2026-08-26T00:00:00.000Z');
    INSERT INTO rooms VALUES(
      'room-legacy', 'room-legacy', 'Legacy Room', 2,
      '2026-08-26T00:00:00.000Z'
    );
    INSERT INTO memberships VALUES
      ('room-legacy', 'human-legacy', '2026-08-26T00:00:00.000Z'),
      ('room-legacy', 'agent-legacy', '2026-08-26T00:00:00.000Z');
    INSERT INTO messages VALUES(
      'message-root', 'room-legacy', 'human-legacy', 'Root',
      '2026-08-26T00:00:01.000Z'
    );
    INSERT INTO room_events VALUES(
      'event-room-created', 'room-legacy', 1, 'room.created', '${creatorId}',
      'room', 'room-legacy', '{}', 'room.create:room-legacy', 1,
      '2026-08-26T00:00:00.000Z'
    );
  `);
}
