import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  symlink,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import {
  guardedStop,
  backupState,
  verifyStateBackup,
  assertWorkbenchIdle,
  assertWorkbenchRestartable,
} from "../../../scripts/workbench-restart-guard.mjs";

const stages = ["validate", "inspect", "backup", "verify", "recheck", "stop"];
test("an operator restart preserves inert quarantine but blocks every live execution owner", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE activations (state TEXT, lease_owner TEXT, lease_until TEXT, lease_until_ms INTEGER, room_id TEXT);
      CREATE TABLE room_agent_sos_holds (room_id TEXT, operation_id TEXT);
      CREATE TABLE room_agent_sos_operations (room_id TEXT, operation_id TEXT, state TEXT);
      CREATE TABLE run_attempts (state TEXT);
      CREATE TABLE runtime_processes (state TEXT);
      CREATE TABLE placements (state TEXT);
      CREATE TABLE agent_exclusive_operation_leases (state TEXT);
      INSERT INTO activations VALUES ('quarantined', NULL, NULL, NULL, 'room');
      INSERT INTO run_attempts VALUES ('timed_out');
      INSERT INTO runtime_processes VALUES ('terminated');
      INSERT INTO placements VALUES ('released');
    `);
    const check = assertWorkbenchRestartable;
    check(db);
    assert.equal(
      db.prepare("SELECT state FROM activations").get()?.state,
      "quarantined",
    );
    assert.throws(
      () => assertWorkbenchIdle(db),
      /Active work/,
      "strict restore guard is unchanged",
    );
    for (const [table, state] of [
      ["activations", "queued"],
      ["activations", "leased"],
      ["run_attempts", "starting"],
      ["run_attempts", "running"],
      ["run_attempts", "orphaned"],
      ["runtime_processes", "prepared"],
      ["runtime_processes", "active"],
      ["runtime_processes", "orphaned"],
      ["placements", "reserved"],
      ["agent_exclusive_operation_leases", "active"],
    ]) {
      db.prepare(`INSERT INTO ${table} (state) VALUES (?)`).run(state!);
      assert.throws(() => check(db), /Active work/);
      db.prepare(`DELETE FROM ${table} WHERE state = ?`).run(state!);
    }
    for (const column of ["lease_owner", "lease_until", "lease_until_ms"]) {
      db.exec(`UPDATE activations SET ${column} = 1`);
      assert.throws(() => check(db), /lease/i);
      db.exec(`UPDATE activations SET ${column} = NULL`);
    }
    db.exec(`
      DELETE FROM activations;
      INSERT INTO activations VALUES ('queued', NULL, NULL, NULL, 'room');
      INSERT INTO room_agent_sos_holds VALUES ('room', 'stop');
      INSERT INTO room_agent_sos_operations VALUES ('room', 'stop', 'stopped');
    `);
    const pending = db.prepare("SELECT * FROM activations").all();
    check(db);
    assert.deepEqual(db.prepare("SELECT * FROM activations").all(), pending);
    assert.throws(() => assertWorkbenchIdle(db), /Active work/);
    for (const state of ["stopping", "resumed"]) {
      db.prepare("UPDATE room_agent_sos_operations SET state=?").run(state);
      assert.throws(() => check(db), /Active work/);
    }
    db.exec("UPDATE room_agent_sos_operations SET state='stopped'");
    for (const column of ["lease_owner", "lease_until", "lease_until_ms"]) {
      db.exec(`UPDATE activations SET ${column} = 1`);
      assert.throws(() => check(db), /Active work/);
      db.exec(`UPDATE activations SET ${column} = NULL`);
    }
    db.exec("UPDATE room_agent_sos_holds SET room_id='another-room'");
    assert.throws(() => check(db), /Active work/);
  } finally {
    db.close();
  }
});
test("private executable recovery helpers retain owner execute permission", async () => {
  const root = await mkdtemp(join(tmpdir(), "rah-restart-mode-test-"));
  const state = join(root, "state");
  await mkdir(state);
  await writeFile(join(state, "helper"), "#!/bin/sh\nexit 0\n", {
    mode: 0o700,
  });
  await backupState(state, join(root, "backup"));
  assert.equal((await stat(join(root, "backup/helper"))).mode & 0o777, 0o700);
});
test("every failed pre-stop step blocks stop, including an explicit false receipt", async () => {
  for (const failed of stages.slice(0, -1)) {
    for (const failure of ["throw", "false"]) {
      const calls: string[] = [];
      const steps = Object.fromEntries(
        stages.map((name) => [
          name,
          async () => {
            calls.push(name);
            if (name === failed) {
              if (failure === "throw") throw new Error(name);
              return false;
            }
            return true;
          },
        ]),
      );
      await assert.rejects(guardedStop(steps));
      assert.deepEqual(calls, stages.slice(0, stages.indexOf(failed) + 1));
      assert.equal(calls.includes("stop"), false);
    }
  }
});

test("stop is awaited exactly once after all positive receipts; stop failure propagates", async () => {
  const calls: string[] = [];
  const steps = Object.fromEntries(
    stages.map((name) => [
      name,
      async () => {
        calls.push(name);
        return true;
      },
    ]),
  );
  await guardedStop(steps);
  assert.deepEqual(calls, stages);
  await assert.rejects(
    guardedStop({
      ...steps,
      stop: async () => {
        throw new Error("stop timeout");
      },
    }),
    /stop timeout/,
  );
});

test("online WAL backup contains committed data, nested memory, private files and no stale WAL", async () => {
  const root = await mkdtemp(join(tmpdir(), "rah-restart-backup-test-"));
  const state = join(root, "state"),
    target = join(root, "backup");
  await mkdir(state, { mode: 0o700 });
  const db = new DatabaseSync(join(state, "room.db"));
  try {
    db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE sample (v TEXT); INSERT INTO sample VALUES ('committed');",
    );
    await mkdir(join(state, "memory"));
    await writeFile(join(state, "memory/MEMORY.md"), "index", { mode: 0o600 });
    await writeFile(join(state, "human.token"), "private-fixture-token", {
      mode: 0o600,
    });
    const receipt = await backupState(state, target);
    assert.equal(receipt.databases.length, 1);
    const copy = new DatabaseSync(join(target, "room.db"));
    assert.equal(copy.prepare("SELECT v FROM sample").get()?.v, "committed");
    copy.close();
    assert.equal(
      await readFile(join(target, "memory/MEMORY.md"), "utf8"),
      "index",
    );
    await assert.rejects(readFile(join(target, "room.db-wal")), /ENOENT/);
    await assert.rejects(backupState(state, target), /EEXIST/);
  } finally {
    db.close();
  }
});

test("backup refuses symlinks rather than silently following outside state", async () => {
  const root = await mkdtemp(join(tmpdir(), "rah-restart-symlink-test-"));
  const state = join(root, "state");
  await mkdir(state);
  await symlink(root, join(state, "escape"));
  await assert.rejects(backupState(state, join(root, "backup")), /symlink/);
});

test("corrupt database and post-backup file damage cannot produce a verified receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "rah-restart-damage-test-"));
  const state = join(root, "state");
  await mkdir(state);
  await writeFile(join(state, "memory.md"), "private index");
  const target = join(root, "backup");
  const receipt = await backupState(state, target);
  await writeFile(join(target, "memory.md"), "damaged");
  await assert.rejects(verifyStateBackup(target, receipt), /digest mismatch/);
  await writeFile(join(state, "corrupt.db"), "not SQLite");
  await assert.rejects(backupState(state, join(root, "backup2")));
  await assert.rejects(
    backupState(state, join(state, "nested")),
    /outside state/,
  );
});

test("a valid SQLite rewrite or changed database set invalidates the backup receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "rah-restart-db-digest-test-"));
  const state = join(root, "state"),
    target = join(root, "backup");
  await mkdir(state);
  const source = new DatabaseSync(join(state, "room.db"));
  source.exec(
    "CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO sample(value) VALUES ('original')",
  );
  source.close();

  const receipt = await backupState(state, target);
  const databaseHashes = receipt.databaseHashes;
  assert.match(databaseHashes["room.db"] ?? "", /^[a-f0-9]{64}$/);
  const copy = new DatabaseSync(join(target, "room.db"));
  copy.prepare("UPDATE sample SET value='different' WHERE id=1").run();
  copy.close();
  await assert.rejects(verifyStateBackup(target, receipt), /digest mismatch/);

  const cleanTarget = join(root, "clean-backup");
  const cleanReceipt = await backupState(state, cleanTarget);
  const extra = new DatabaseSync(join(cleanTarget, "extra.db"));
  extra.exec("CREATE TABLE unexpected (value TEXT)");
  extra.close();
  await assert.rejects(
    verifyStateBackup(cleanTarget, cleanReceipt),
    /database set mismatch/,
  );
});

test("unknown database schema and every active execution owner block release", () => {
  const db = new DatabaseSync(":memory:");
  try {
    assert.throws(() => assertWorkbenchIdle(db));
    const tables = [
      "activations",
      "run_attempts",
      "runtime_processes",
      "placements",
      "agent_exclusive_operation_leases",
    ];
    for (const table of tables) db.exec(`CREATE TABLE ${table} (state TEXT)`);
    assertWorkbenchIdle(db);
    for (const [table, state] of [
      ["activations", "queued"],
      ["activations", "quarantined"],
      ["run_attempts", "running"],
      ["runtime_processes", "orphaned"],
      ["placements", "reserved"],
      ["agent_exclusive_operation_leases", "active"],
    ]) {
      db.prepare(`INSERT INTO ${table} VALUES (?)`).run(state!);
      assert.throws(() => assertWorkbenchIdle(db), /Active work/);
      db.exec(`DELETE FROM ${table}`);
    }
  } finally {
    db.close();
  }
});
