import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { KERNEL_SCHEMA_VERSION, RoomKernel } from "../src/room-kernel.ts";
import { compareSchema, schemaObjects } from "../src/kernel-schema-state.ts";

function temporaryDatabase(): { databasePath: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), "rah-kernel-migration-"));
  return {
    databasePath: join(directory, "room.db"),
    cleanup: () => rmSync(directory, { force: true, recursive: true }),
  };
}

function digest(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function initialized(databasePath: string): RoomKernel {
  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  return kernel;
}

test("schema inspection reports pending work before a migration and none after", () => {
  const { databasePath, cleanup } = temporaryDatabase();
  try {
    new DatabaseSync(databasePath).close();
    const empty = RoomKernel.inspectSchemaState(databasePath);
    assert.equal(empty.databaseSchemaVersion, 0);
    assert.equal(empty.kernelSchemaVersion, KERNEL_SCHEMA_VERSION);
    assert.equal(empty.supported, true);
    assert.ok(empty.pending.length > 0);
    assert.ok(
      empty.pending.some((change) => change.kind === "schema_version"),
      "an empty database must report the version transition",
    );

    initialized(databasePath).close();

    const migrated = RoomKernel.inspectSchemaState(databasePath);
    assert.equal(migrated.databaseSchemaVersion, KERNEL_SCHEMA_VERSION);
    assert.deepEqual(migrated.pending, []);
    assert.deepEqual(migrated.unknownObjects, []);
  } finally {
    cleanup();
  }
});

test("schema inspection never writes to the database it inspects", () => {
  const { databasePath, cleanup } = temporaryDatabase();
  try {
    initialized(databasePath).close();
    const before = digest(databasePath);
    const state = RoomKernel.inspectSchemaState(databasePath);
    assert.equal(state.openMode, "read-only");
    assert.equal(digest(databasePath), before);
  } finally {
    cleanup();
  }
});

test("a database written by a newer build is refused, not migrated", () => {
  const { databasePath, cleanup } = temporaryDatabase();
  try {
    initialized(databasePath).close();
    const database = new DatabaseSync(databasePath);
    database.exec(`PRAGMA user_version = ${KERNEL_SCHEMA_VERSION + 3}`);
    database.close();

    const state = RoomKernel.inspectSchemaState(databasePath);
    assert.equal(state.supported, false);
    assert.equal(state.databaseSchemaVersion, KERNEL_SCHEMA_VERSION + 3);

    const before = digest(databasePath);
    const kernel = new RoomKernel({ databasePath });
    assert.throws(() => kernel.initialize(), /newer Kernel schema/);
    kernel.close();
    assert.equal(digest(databasePath), before);
  } finally {
    cleanup();
  }
});

test("a failing migration unit leaves no half-applied schema", () => {
  const { databasePath, cleanup } = temporaryDatabase();
  try {
    // A name collision makes one statement of the base-schema unit fail after
    // earlier statements in the same unit already ran.
    const seed = new DatabaseSync(databasePath);
    seed.exec(
      "CREATE TABLE idx_outbox_unpublished (blocker TEXT); PRAGMA user_version = 0;",
    );
    seed.close();

    const kernel = new RoomKernel({ databasePath });
    assert.throws(() => kernel.initialize());
    kernel.close();

    const probe = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const objects = probe
        .prepare("SELECT name FROM sqlite_schema ORDER BY name")
        .all()
        .map((row) => String(row.name));
      assert.deepEqual(
        objects.filter(
          (name) =>
            name !== "idx_outbox_unpublished" &&
            !name.includes("kernel_schema_migration_journal"),
        ),
        [],
        "the failed unit must not leave any of its tables behind",
      );
      assert.equal(
        Number(
          Object.values(probe.prepare("PRAGMA user_version").get() ?? {})[0],
        ),
        0,
      );
    } finally {
      probe.close();
    }

    const repair = new DatabaseSync(databasePath);
    repair.exec("DROP TABLE idx_outbox_unpublished");
    repair.close();
    initialized(databasePath).close();
    assert.deepEqual(RoomKernel.inspectSchemaState(databasePath).pending, []);
  } finally {
    cleanup();
  }
});

test("an interrupted migration converges and preserves committed history", () => {
  const { databasePath, cleanup } = temporaryDatabase();
  try {
    const kernel = initialized(databasePath);
    const human = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
    const actor = kernel.authenticateHumanAccessToken(human.accessToken);
    const workspace = kernel.createWorkspace(actor, {
      idempotencyKey: "migration-protection-workspace",
      name: "Migration",
      slug: "migration-protection",
    });
    const room = kernel.createWorkspaceRoom(actor, {
      basedOnControlRoomSeq: workspace.event.roomSeq,
      idempotencyKey: "migration-protection-room",
      kind: "channel",
      name: "History",
      slug: "history",
      workspaceId: workspace.workspace.workspaceId,
    });
    kernel.postMessage(actor, {
      basedOnRoomSeq: kernel.sync(actor, {
        consumerId: "migration-protection",
        roomId: room.room.roomId,
      }).latestRoomSeq,
      body: "durable history",
      idempotencyKey: "migration-protection-message",
      recipients: [],
      roomId: room.room.roomId,
    });
    const before = new DatabaseSync(databasePath, { readOnly: true });
    const counts = {
      events: before.prepare("SELECT count(*) AS n FROM room_events").get()?.n,
      members: before.prepare("SELECT count(*) AS n FROM memberships").get()?.n,
      messages: before.prepare("SELECT count(*) AS n FROM messages").get()?.n,
      principals: before.prepare("SELECT count(*) AS n FROM principals").get()
        ?.n,
    };
    before.close();
    kernel.close();

    // Simulate an upgrade interrupted before its last units committed.
    const interrupted = new DatabaseSync(databasePath);
    interrupted.exec(
      "DROP INDEX idx_outbox_unpublished; PRAGMA user_version = 49;",
    );
    interrupted.close();

    const pending = RoomKernel.inspectSchemaState(databasePath);
    assert.ok(pending.pending.length > 0);

    initialized(databasePath).close();
    assert.deepEqual(RoomKernel.inspectSchemaState(databasePath).pending, []);

    const after = new DatabaseSync(databasePath, { readOnly: true });
    try {
      assert.deepEqual(
        {
          events: after.prepare("SELECT count(*) AS n FROM room_events").get()
            ?.n,
          members: after.prepare("SELECT count(*) AS n FROM memberships").get()
            ?.n,
          messages: after.prepare("SELECT count(*) AS n FROM messages").get()
            ?.n,
          principals: after
            .prepare("SELECT count(*) AS n FROM principals")
            .get()?.n,
        },
        counts,
      );
      assert.equal(
        after.prepare("SELECT body FROM messages").get()?.body,
        "durable history",
      );
    } finally {
      after.close();
    }
  } finally {
    cleanup();
  }
});

test("the migration journal records units only while a migration is pending", () => {
  const { databasePath, cleanup } = temporaryDatabase();
  try {
    initialized(databasePath).close();
    const read = () => {
      const database = new DatabaseSync(databasePath, { readOnly: true });
      try {
        return database
          .prepare(
            "SELECT unit, state, attempts FROM kernel_schema_migration_journal ORDER BY unit",
          )
          .all()
          .map((row) => ({
            unit: String(row.unit),
            state: String(row.state),
            attempts: Number(row.attempts),
          }));
      } finally {
        database.close();
      }
    };
    const created = read();
    assert.ok(created.length > 0, "the first migration must be journalled");
    assert.ok(created.every((row) => row.state === "completed"));

    initialized(databasePath).close();
    assert.deepEqual(
      read(),
      created,
      "an ordinary start with nothing pending must not rewrite the journal",
    );
  } finally {
    cleanup();
  }
});

test("schema comparison is structural: ALTER-grown tables and reformatted indexes are not drift", () => {
  const reference = new DatabaseSync(":memory:");
  const live = new DatabaseSync(":memory:");
  try {
    reference.exec(`
      CREATE TABLE probe (a TEXT NOT NULL, b INTEGER DEFAULT 0);
      CREATE UNIQUE INDEX idx_probe ON probe(a, b) WHERE b IS NOT NULL;
      CREATE VIEW probe_view AS SELECT a FROM probe;
    `);
    // The same structure as an upgraded install actually records it: the column
    // arrived through ALTER TABLE, and the index text was formatted differently.
    live.exec(`
      CREATE TABLE probe (a TEXT NOT NULL);
      ALTER TABLE probe ADD COLUMN b integer DEFAULT 0;
      CREATE UNIQUE INDEX   idx_probe
        ON probe ( a ,
        b ) WHERE b IS NOT NULL;
      CREATE VIEW probe_view AS
        SELECT   a FROM probe;
    `);
    const compared = compareSchema({
      database: live,
      databaseSchemaVersion: KERNEL_SCHEMA_VERSION,
      kernelSchemaVersion: KERNEL_SCHEMA_VERSION,
      reference: schemaObjects(reference),
    });
    assert.deepEqual(
      compared.pending,
      [],
      "text drift that no migration can clear must never be reported as pending",
    );
    assert.deepEqual(compared.unknownObjects, []);
  } finally {
    reference.close();
    live.close();
  }
});

test("structural differences are still reported, and a reformatted real index clears", () => {
  const { databasePath, cleanup } = temporaryDatabase();
  try {
    initialized(databasePath).close();
    const database = new DatabaseSync(databasePath);
    const sql = String(
      database
        .prepare("SELECT sql FROM sqlite_schema WHERE name = ?")
        .get("idx_room_file_gc_pending")?.sql,
    );
    database.exec(
      `DROP INDEX idx_room_file_gc_pending; ${sql.replace(/\s+/g, "\n   ")};`,
    );
    database.close();
    assert.deepEqual(
      RoomKernel.inspectSchemaState(databasePath).pending,
      [],
      "the live failure: reformatted index text is not a pending migration",
    );

    // A genuine structural change is still visible.
    const structural = new DatabaseSync(databasePath);
    structural.exec(
      "DROP INDEX idx_room_file_gc_pending; CREATE INDEX idx_room_file_gc_pending ON room_files(attachment_id);",
    );
    structural.close();
    const drifted = RoomKernel.inspectSchemaState(databasePath);
    assert.deepEqual(drifted.pending, []);
    assert.deepEqual(
      drifted.drift.map((change) => `${change.kind}:${change.name}`),
      ["unexpected_drift:index:idx_room_file_gc_pending"],
    );
    const kernel = new RoomKernel({ databasePath });
    assert.throws(() => kernel.initialize(), /unrecognized schema drift/);
    kernel.close();
  } finally {
    cleanup();
  }
});

test("permanent legacy constraint drift is reported separately and never pending", () => {
  const reference = new DatabaseSync(":memory:");
  const live = new DatabaseSync(":memory:");
  try {
    reference.exec(`
      CREATE TABLE reminders (target_room_id TEXT NOT NULL);
      CREATE TABLE room_file_gc_receipts (next_attempt_at_ms INTEGER DEFAULT 0);
      CREATE TABLE room_files (created_at TEXT NOT NULL);
    `);
    // What an upgraded install actually has: ALTER TABLE ADD COLUMN cannot add
    // NOT NULL without a default, and historical CREATE text omitted defaults.
    live.exec(`
      CREATE TABLE reminders (target_room_id TEXT);
      CREATE TABLE room_file_gc_receipts (next_attempt_at_ms INTEGER);
      CREATE TABLE room_files (created_at TEXT);
    `);
    const compared = compareSchema({
      database: live,
      databaseSchemaVersion: KERNEL_SCHEMA_VERSION,
      kernelSchemaVersion: KERNEL_SCHEMA_VERSION,
      reference: schemaObjects(reference),
    });
    assert.deepEqual(
      compared.pending,
      [],
      "drift no migration can act on must never gate a snapshot or a start",
    );
    assert.deepEqual(compared.drift.map((change) => change.name).sort(), [
      "table:reminders",
      "table:room_file_gc_receipts",
      "table:room_files",
    ]);
    assert.ok(compared.drift.every((change) => change.kind === "legacy_drift"));

    // A genuinely missing object is still pending and still actionable.
    live.exec("DROP TABLE room_files");
    assert.deepEqual(
      compareSchema({
        database: live,
        databaseSchemaVersion: KERNEL_SCHEMA_VERSION,
        kernelSchemaVersion: KERNEL_SCHEMA_VERSION,
        reference: schemaObjects(reference),
      }).pending,
      [{ kind: "missing_object", name: "table:room_files" }],
    );
  } finally {
    reference.close();
    live.close();
  }
});

test("schema signatures preserve predicates, literal case, constraints and index collation", () => {
  for (const [referenceSql, liveSql] of [
    [
      "CREATE TABLE t (state TEXT); CREATE UNIQUE INDEX i ON t(state) WHERE state='active'",
      "CREATE TABLE t (state TEXT); CREATE UNIQUE INDEX i ON t(state) WHERE state='other'",
    ],
    [
      "CREATE TABLE t (v TEXT DEFAULT 'ABC')",
      "CREATE TABLE t (v TEXT DEFAULT 'abc')",
    ],
    [
      "CREATE TABLE t (v TEXT CHECK(v IN ('a','b')))",
      "CREATE TABLE t (v TEXT CHECK(v IN ('a','c')))",
    ],
    ["CREATE TABLE t (v TEXT UNIQUE)", "CREATE TABLE t (v TEXT)"],
    [
      "CREATE TABLE p (id TEXT PRIMARY KEY); CREATE TABLE t (v TEXT REFERENCES p(id))",
      "CREATE TABLE p (id TEXT PRIMARY KEY); CREATE TABLE t (v TEXT)",
    ],
    [
      "CREATE TABLE t (v TEXT); CREATE INDEX i ON t(v COLLATE NOCASE)",
      "CREATE TABLE t (v TEXT); CREATE INDEX i ON t(v)",
    ],
    [
      "CREATE TABLE t (v TEXT); CREATE INDEX i ON t(lower(v))",
      "CREATE TABLE t (v TEXT); CREATE INDEX i ON t(upper(v))",
    ],
    [
      "CREATE TABLE reminders (target_room_id TEXT NOT NULL, name TEXT NOT NULL)",
      "CREATE TABLE reminders (target_room_id TEXT, name TEXT)",
    ],
  ]) {
    const reference = new DatabaseSync(":memory:");
    const live = new DatabaseSync(":memory:");
    try {
      reference.exec(referenceSql!);
      live.exec(liveSql!);
      const state = compareSchema({
        database: live,
        databaseSchemaVersion: KERNEL_SCHEMA_VERSION,
        kernelSchemaVersion: KERNEL_SCHEMA_VERSION,
        reference: schemaObjects(reference),
      });
      assert.ok(
        state.drift.some((change) => change.kind === "unexpected_drift"),
        liveSql,
      );
    } finally {
      reference.close();
      live.close();
    }
  }
});
