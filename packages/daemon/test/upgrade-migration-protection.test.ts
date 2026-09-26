import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { RoomKernel } from "@rah-os/kernel";

import {
  prepareLocalWorkbench,
  type LocalWorkbenchRuntimeSpec,
} from "../src/local-workbench-bootstrap.ts";
import {
  preflightKernelUpgrade,
  protectKernelSchemaMigration,
  restoreStateSnapshot,
  snapshotStateBeforeMigration,
  snapshotReceiptPath,
  stateWriteEvidence,
  type StateSnapshotReceipt,
} from "../src/state-backup.ts";

function fakeRuntimeSpec(workspaceCwd: string): LocalWorkbenchRuntimeSpec {
  return {
    adapterKind: "generic-process/v1",
    agentHandle: "TestAgent",
    avatarKey: "test-agent",
    cliId: "test",
    description: "A persistent fake Agent for upgrade verification.",
    displayName: "Test Agent",
    executable: process.execPath,
    instructions: "Prove upgrades keep durable Room state.",
    reasoning: "default",
    role: "Persistent test Agent",
    runtimeProfileId: "local-workbench-profile-test",
    toolAccessMode: "full_access",
    workspaceCwd,
  };
}

type Workbench = {
  cleanup: () => void;
  home: string;
  humanAccessToken: string;
  stateDirectory: string;
  workspaceCwd: string;
};

async function bootstrapWorkbench(label: string): Promise<Workbench> {
  const home = mkdtempSync(join(tmpdir(), `rah-upgrade-${label}-`));
  const stateDirectory = join(home, "state");
  const workspaceCwd = join(home, "workspace");
  mkdirSync(workspaceCwd);
  const prepared = await prepareLocalWorkbench({
    runtimeSpecs: [fakeRuntimeSpec(workspaceCwd)],
    stateDirectory,
    workspaceCwd,
  });
  return {
    cleanup: () => rmSync(home, { force: true, recursive: true }),
    home,
    humanAccessToken: prepared.humanAccessToken,
    stateDirectory,
    workspaceCwd,
  };
}

function databaseDigest(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function durableCounts(stateDirectory: string): Record<string, number> {
  const db = new DatabaseSync(join(stateDirectory, "room.db"), {
    readOnly: true,
  });
  try {
    const counts: Record<string, number> = {};
    for (const table of [
      "room_events",
      "messages",
      "memberships",
      "principals",
      "agent_definitions",
      "agent_definition_revisions",
      "execution_policy_revisions",
      "agent_memory_homes",
    ]) {
      counts[table] = Number(
        db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n ?? 0,
      );
    }
    return counts;
  } finally {
    db.close();
  }
}

/** Rewinds the state to look like it was written by an earlier build. */
function simulateOlderSchema(stateDirectory: string): void {
  const db = new DatabaseSync(join(stateDirectory, "room.db"));
  try {
    db.exec("DROP INDEX idx_outbox_unpublished; PRAGMA user_version = 49;");
  } finally {
    db.close();
  }
}

function backupEntries(home: string): string[] {
  const root = join(home, "backups");
  return existsSync(root) ? readdirSync(root).sort() : [];
}

test("an ordinary start with no pending schema change copies no state", async () => {
  const workbench = await bootstrapWorkbench("idle");
  try {
    assert.deepEqual(backupEntries(workbench.home), []);
    const before = databaseDigest(join(workbench.stateDirectory, "room.db"));
    const journalBefore = migrationJournal(workbench.stateDirectory);

    const outcome = await protectKernelSchemaMigration({
      stateDirectory: workbench.stateDirectory,
    });
    assert.equal(outcome.migrated, false);
    assert.deepEqual(backupEntries(workbench.home), []);
    assert.equal(
      databaseDigest(join(workbench.stateDirectory, "room.db")),
      before,
      "detection alone must not write to the live database",
    );

    await prepareLocalWorkbench({
      runtimeSpecs: [fakeRuntimeSpec(workbench.workspaceCwd)],
      stateDirectory: workbench.stateDirectory,
      workspaceCwd: workbench.workspaceCwd,
    });
    assert.deepEqual(
      backupEntries(workbench.home),
      [],
      "a repeated start must not copy the data directory",
    );
    assert.deepEqual(
      migrationJournal(workbench.stateDirectory),
      journalBefore,
      "a repeated start must not re-run migration units",
    );
  } finally {
    workbench.cleanup();
  }
});

function migrationJournal(
  stateDirectory: string,
): { attempts: number; state: string; unit: string }[] {
  const db = new DatabaseSync(join(stateDirectory, "room.db"), {
    readOnly: true,
  });
  try {
    return db
      .prepare(
        "SELECT unit, state, attempts FROM kernel_schema_migration_journal ORDER BY unit",
      )
      .all()
      .map((row) => ({
        attempts: Number(row.attempts),
        state: String(row.state),
        unit: String(row.unit),
      }));
  } finally {
    db.close();
  }
}

test("a pending schema change is snapshotted and verified before the Kernel migrates", async () => {
  const workbench = await bootstrapWorkbench("snapshot");
  try {
    const expected = durableCounts(workbench.stateDirectory);
    const evidence = stateWriteEvidence(workbench.stateDirectory);
    simulateOlderSchema(workbench.stateDirectory);

    const outcome = await protectKernelSchemaMigration({
      stateDirectory: workbench.stateDirectory,
    });
    assert.equal(outcome.migrated, true);
    assert.equal(outcome.schemaState.databaseSchemaVersion, 49);

    const snapshots = backupEntries(workbench.home).filter(
      (name) => name.startsWith("pre-migration-") && !name.endsWith(".json"),
    );
    assert.equal(snapshots.length, 1);
    const receipt = JSON.parse(
      readFileSync(
        snapshotReceiptPath(join(workbench.home, "backups", snapshots[0]!)),
        "utf8",
      ),
    ) as StateSnapshotReceipt;
    assert.equal(receipt.fromSchemaVersion, 49);
    assert.equal(receipt.toSchemaVersion, 75);
    assert.ok(receipt.pendingChanges.length > 0);
    assert.deepEqual(receipt.writeEvidence, evidence);
    assert.match(
      receipt.backup.databaseHashes["room.db"] ?? "",
      /^[a-f0-9]{64}$/,
    );

    // The snapshot is a usable copy of the pre-migration database.
    assert.deepEqual(
      durableCounts(join(workbench.home, "backups", snapshots[0]!)),
      expected,
    );
    // History, Agent configuration, memory homes and memberships survive.
    assert.deepEqual(durableCounts(workbench.stateDirectory), expected);
    assert.deepEqual(
      RoomKernel.inspectSchemaState(join(workbench.stateDirectory, "room.db"))
        .pending,
      [],
    );
    assert.ok(
      migrationJournal(workbench.stateDirectory).every(
        (row) => row.state === "completed",
      ),
    );
  } finally {
    workbench.cleanup();
  }
});

test("a snapshot that cannot be written aborts the migration and leaves the database untouched", async () => {
  const workbench = await bootstrapWorkbench("readonly");
  const backups = join(workbench.home, "backups");
  try {
    simulateOlderSchema(workbench.stateDirectory);
    const before = databaseDigest(join(workbench.stateDirectory, "room.db"));
    mkdirSync(backups, { mode: 0o500 });

    await assert.rejects(
      protectKernelSchemaMigration({
        stateDirectory: workbench.stateDirectory,
      }),
      /aborted/,
    );
    assert.equal(
      databaseDigest(join(workbench.stateDirectory, "room.db")),
      before,
      "a failed snapshot must not migrate the database",
    );
    assert.equal(
      RoomKernel.inspectSchemaState(join(workbench.stateDirectory, "room.db"))
        .databaseSchemaVersion,
      49,
    );
  } finally {
    chmodSync(backups, 0o700);
    workbench.cleanup();
  }
});

test("an older build refuses a newer database instead of migrating it", async () => {
  const workbench = await bootstrapWorkbench("newer");
  try {
    const db = new DatabaseSync(join(workbench.stateDirectory, "room.db"));
    db.exec("PRAGMA user_version = 4096");
    db.close();
    await assert.rejects(
      protectKernelSchemaMigration({
        stateDirectory: workbench.stateDirectory,
      }),
      /Artifact rollback does not roll back data/,
    );
    assert.deepEqual(backupEntries(workbench.home), []);
  } finally {
    workbench.cleanup();
  }
});

test("restore refuses a corrupt snapshot, a busy workbench and newer business writes", async () => {
  const workbench = await bootstrapWorkbench("restore-refusal");
  try {
    const { snapshotDirectory } = await snapshotStateBeforeMigration({
      schemaState: RoomKernel.inspectSchemaState(
        join(workbench.stateDirectory, "room.db"),
      ),
      snapshotRoot: join(workbench.home, "backups"),
      stateDirectory: workbench.stateDirectory,
    });

    await assert.rejects(
      restoreStateSnapshot({
        confirm: "restore-from-snapshot",
        runningPid: process.pid,
        snapshotDirectory,
        stateDirectory: workbench.stateDirectory,
      }),
      /still running/,
    );

    // A new Room message is a business write the snapshot does not contain.
    const kernel = new RoomKernel({
      databasePath: join(workbench.stateDirectory, "room.db"),
    });
    const actor = kernel.authenticateHumanAccessToken(
      workbench.humanAccessToken,
    );
    const roomId = kernel.listRooms(actor, {})[0]!.roomId;
    kernel.postMessage(actor, {
      basedOnRoomSeq: kernel.sync(actor, {
        consumerId: "upgrade-protection",
        roomId,
      }).latestRoomSeq,
      body: "written after the snapshot",
      idempotencyKey: "upgrade-protection-message",
      recipients: [],
      roomId,
    });
    kernel.close();

    await assert.rejects(
      restoreStateSnapshot({
        confirm: "restore-from-snapshot",
        snapshotDirectory,
        stateDirectory: workbench.stateDirectory,
      }),
      /new business writes/,
    );
    assert.equal(
      existsSync(join(workbench.stateDirectory, "room.db")),
      true,
      "a refused restore keeps the scene",
    );

    // A damaged snapshot can never be restored, even with no newer writes.
    const damaged = await snapshotStateBeforeMigration({
      schemaState: RoomKernel.inspectSchemaState(
        join(workbench.stateDirectory, "room.db"),
      ),
      snapshotRoot: join(workbench.home, "backups"),
      stateDirectory: workbench.stateDirectory,
    });
    writeFileSync(join(damaged.snapshotDirectory, "human.token"), "tampered");
    await assert.rejects(
      restoreStateSnapshot({
        confirm: "restore-from-snapshot",
        snapshotDirectory: damaged.snapshotDirectory,
        stateDirectory: workbench.stateDirectory,
      }),
      /digest mismatch/,
    );
  } finally {
    workbench.cleanup();
  }
});

test("a proven restore sets the current state aside instead of overwriting it", async () => {
  const workbench = await bootstrapWorkbench("restore-proven");
  try {
    const expected = durableCounts(workbench.stateDirectory);
    const { snapshotDirectory } = await snapshotStateBeforeMigration({
      schemaState: RoomKernel.inspectSchemaState(
        join(workbench.stateDirectory, "room.db"),
      ),
      snapshotRoot: join(workbench.home, "backups"),
      stateDirectory: workbench.stateDirectory,
    });

    await assert.rejects(
      restoreStateSnapshot({
        confirm: "restore" as "restore-from-snapshot",
        snapshotDirectory,
        stateDirectory: workbench.stateDirectory,
      }),
      /explicit operator confirmation/,
    );

    const restored = await restoreStateSnapshot({
      confirm: "restore-from-snapshot",
      snapshotDirectory,
      stateDirectory: workbench.stateDirectory,
    });
    assert.ok(existsSync(restored.supersededDirectory));
    assert.ok(existsSync(join(restored.supersededDirectory, "room.db")));
    assert.deepEqual(durableCounts(workbench.stateDirectory), expected);
    assert.ok(existsSync(join(workbench.stateDirectory, "human.token")));
  } finally {
    workbench.cleanup();
  }
});

test("restore refuses file and non-ledger database changes without losing the current state", async () => {
  for (const change of ["file", "database"] as const) {
    const workbench = await bootstrapWorkbench(`restore-${change}`);
    try {
      const { snapshotDirectory } = await snapshotStateBeforeMigration({
        schemaState: RoomKernel.inspectSchemaState(
          join(workbench.stateDirectory, "room.db"),
        ),
        snapshotRoot: join(workbench.home, "backups"),
        stateDirectory: workbench.stateDirectory,
      });
      if (change === "file")
        writeFileSync(
          join(workbench.stateDirectory, "human.token"),
          "rotated-token",
        );
      else {
        const db = new DatabaseSync(join(workbench.stateDirectory, "room.db"));
        db.exec("UPDATE agent_hosts SET last_seen_ms=last_seen_ms+1");
        db.exec("CREATE TABLE after_snapshot (value TEXT)");
        db.close();
      }
      await assert.rejects(
        restoreStateSnapshot({
          confirm: "restore-from-snapshot",
          snapshotDirectory,
          stateDirectory: workbench.stateDirectory,
        }),
        /state changed after.*snapshot/,
      );
      assert.ok(existsSync(join(workbench.stateDirectory, "room.db")));
      if (change === "file")
        assert.equal(
          readFileSync(join(workbench.stateDirectory, "human.token"), "utf8"),
          "rotated-token",
        );
    } finally {
      workbench.cleanup();
    }
  }
});

test("restart preflight runs migrations on a disposable copy and rejects drift before touching the incumbent", async () => {
  const workbench = await bootstrapWorkbench("preflight");
  const path = join(workbench.stateDirectory, "room.db");
  try {
    const old = new DatabaseSync(path);
    old.exec("DROP INDEX idx_outbox_unpublished; PRAGMA user_version=49");
    old.close();
    const before = databaseDigest(path);
    await preflightKernelUpgrade(path);
    assert.equal(databaseDigest(path), before);
    assert.equal(RoomKernel.inspectSchemaState(path).databaseSchemaVersion, 49);
    const bad = new DatabaseSync(path);
    bad.exec(
      "CREATE INDEX idx_outbox_unpublished ON outbox(room_id); PRAGMA user_version=56",
    );
    bad.close();
    const badBefore = databaseDigest(path);
    await assert.rejects(
      preflightKernelUpgrade(path),
      /unrecognized schema drift/,
    );
    assert.equal(databaseDigest(path), badBefore);
  } finally {
    workbench.cleanup();
  }
});

test("unknown drift blocks before migration; restoring the exact index allows startup", async () => {
  const workbench = await bootstrapWorkbench("drift");
  try {
    const drifted = new DatabaseSync(join(workbench.stateDirectory, "room.db"));
    const originalSql = String(
      drifted
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE name='idx_room_file_gc_pending'",
        )
        .get()!.sql,
    );
    drifted.exec(
      "DROP INDEX idx_room_file_gc_pending; CREATE INDEX idx_room_file_gc_pending ON room_files(attachment_id);",
    );
    drifted.close();

    const state = RoomKernel.inspectSchemaState(
      join(workbench.stateDirectory, "room.db"),
    );
    assert.deepEqual(state.pending, []);
    assert.deepEqual(
      state.drift.map((change) => change.name),
      ["index:idx_room_file_gc_pending"],
    );

    const before = databaseDigest(join(workbench.stateDirectory, "room.db"));
    await assert.rejects(
      protectKernelSchemaMigration({
        stateDirectory: workbench.stateDirectory,
      }),
      /unrecognized schema drift/,
    );
    assert.equal(
      databaseDigest(join(workbench.stateDirectory, "room.db")),
      before,
    );
    assert.deepEqual(
      backupEntries(workbench.home),
      [],
      "an unrecognized schema must be refused before copying or writing",
    );

    const repair = new DatabaseSync(join(workbench.stateDirectory, "room.db"));
    repair.exec(`DROP INDEX idx_room_file_gc_pending; ${originalSql}`);
    repair.close();

    const prepared = await prepareLocalWorkbench({
      runtimeSpecs: [fakeRuntimeSpec(workbench.workspaceCwd)],
      stateDirectory: workbench.stateDirectory,
      workspaceCwd: workbench.workspaceCwd,
    });
    assert.ok(prepared.metadata.workspaceId);
    assert.deepEqual(backupEntries(workbench.home), []);

    // A genuinely missing object still snapshots and still migrates.
    const missing = new DatabaseSync(join(workbench.stateDirectory, "room.db"));
    missing.exec("DROP TABLE kernel_schema_migration_journal");
    missing.close();
    const migrated = await protectKernelSchemaMigration({
      stateDirectory: workbench.stateDirectory,
    });
    assert.equal(migrated.migrated, true);
    assert.equal(
      backupEntries(workbench.home).filter(
        (name) => name.startsWith("pre-migration-") && !name.endsWith(".json"),
      ).length,
      1,
    );
    assert.deepEqual(
      RoomKernel.inspectSchemaState(join(workbench.stateDirectory, "room.db"))
        .pending,
      [],
    );
  } finally {
    workbench.cleanup();
  }
});
