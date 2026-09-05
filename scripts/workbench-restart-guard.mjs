import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, copyFile, lstat, mkdir, open, readdir } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

// Operational sequence only: the incumbent's existing signal handler owns drain.
export async function guardedStop(steps) {
  for (const name of [
    "validate",
    "inspect",
    "backup",
    "verify",
    "recheck",
    "stop",
  ])
    assert.equal(await steps[name](), true, `Restart blocked at ${name}`);
}

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
async function sync(path) {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function fileInventory(root) {
  const files = {};
  const omittedSockets = [];
  async function walk(directory, prefix = "") {
    for (const entry of (await readdir(directory)).sort()) {
      const name = prefix + entry,
        path = join(directory, entry);
      const stat = await lstat(path);
      assert.ok(!stat.isSymbolicLink(), `State symlink refused: ${name}`);
      if (stat.isDirectory()) await walk(path, `${name}/`);
      else if (stat.isSocket()) omittedSockets.push(name);
      else {
        assert.ok(stat.isFile(), `Unsupported state entry: ${name}`);
        if (!/\.db(?:-wal|-shm|-journal)?$/.test(name))
          files[name] = await hashFile(path);
      }
    }
  }
  await walk(root);
  return { files, omittedSockets };
}

async function databaseInventory(root) {
  const databases = [];
  async function walk(directory, prefix = "") {
    for (const entry of (await readdir(directory)).sort()) {
      const name = prefix + entry,
        path = join(directory, entry);
      const stat = await lstat(path);
      assert.ok(!stat.isSymbolicLink(), `State symlink refused: ${name}`);
      if (stat.isDirectory()) await walk(path, `${name}/`);
      else if (stat.isSocket() || /\.db-(?:wal|shm|journal)$/.test(name)) {
        // Same exclusions as backupState/fileInventory.
      } else if (name.endsWith(".db")) {
        assert.ok(stat.isFile(), `Unsupported state entry: ${name}`);
        databases.push(name);
      }
    }
  }
  await walk(root);
  return databases.sort();
}

export async function backupState(state, target) {
  const nested = relative(resolve(state), resolve(target));
  assert.ok(
    nested.startsWith("..") && nested !== "..",
    "Backup must be outside state",
  );
  assert.ok((await lstat(state)).isDirectory());
  assert.ok(
    !(await lstat(state)).isSymbolicLink(),
    "State root symlink refused",
  );
  await mkdir(target, { mode: 0o700 }); // Exclusive: never reuse/overwrite a backup.
  const before = await fileInventory(state);
  const receipt = { databaseHashes: {}, databases: [], ...before };
  async function walk(directory, prefix = "") {
    for (const entry of (await readdir(directory)).sort()) {
      const name = prefix + entry,
        source = join(directory, entry),
        dest = join(target, name);
      const stat = await lstat(source);
      assert.ok(!stat.isSymbolicLink(), `State symlink refused: ${name}`);
      if (stat.isDirectory()) {
        await mkdir(dest, { mode: 0o700 });
        await walk(source, `${name}/`);
        await sync(dest);
      } else if (stat.isSocket() || /\.db-(?:wal|shm|journal)$/.test(name)) {
        // Process endpoints and online SQLite sidecars are never restored.
      } else if (name.endsWith(".db")) {
        const db = new DatabaseSync(source, { readOnly: true });
        try {
          await backup(db, dest);
        } finally {
          db.close();
        }
        await chmod(dest, 0o600);
        verifyDatabase(dest);
        receipt.databases.push(name);
        await sync(dest);
        receipt.databaseHashes[name] = await hashFile(dest);
      } else {
        assert.ok(stat.isFile(), `Unsupported state entry: ${name}`);
        await copyFile(source, dest, 1 /* COPYFILE_EXCL */);
        await chmod(dest, 0o600 | (stat.mode & 0o100));
        await sync(dest);
      }
    }
  }
  await walk(state);
  assert.deepEqual(
    await fileInventory(state),
    before,
    "State files changed during backup",
  );
  await verifyStateBackup(target, receipt);
  await sync(target);
  return receipt;
}

function verifyDatabase(path) {
  // A WAL-mode backup may need its own sidecars on first open. Verify writable
  // in the private backup directory, never immutable/read-only against live WAL.
  const db = new DatabaseSync(path);
  try {
    assert.deepEqual(
      db
        .prepare("PRAGMA quick_check")
        .all()
        .map((r) => Object.values(r)[0]),
      ["ok"],
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.exec("PRAGMA journal_mode=DELETE;");
  } finally {
    db.close();
  }
}

export async function verifyStateBackup(target, receipt) {
  const databases = await databaseInventory(target);
  assert.deepEqual(
    databases,
    [...receipt.databases].sort(),
    "Backup database set mismatch",
  );
  assert.deepEqual(
    Object.keys(receipt.databaseHashes ?? {}).sort(),
    databases,
    "Backup database digest set mismatch",
  );
  for (const name of databases) {
    const path = join(target, name);
    verifyDatabase(path);
    assert.equal(
      await hashFile(path),
      receipt.databaseHashes[name],
      `Backup database digest mismatch: ${name}`,
    );
  }
  assert.deepEqual(
    (await fileInventory(target)).files,
    receipt.files,
    "Backup file digest mismatch",
  );
  return true;
}

export function assertWorkbenchIdle(db) {
  for (const [table, predicate] of [
    ["activations", "state IN ('queued','leased','quarantined')"],
    ["run_attempts", "state IN ('starting','running','orphaned')"],
    ["runtime_processes", "state != 'terminated'"],
    ["placements", "state != 'released'"],
    ["agent_exclusive_operation_leases", "state = 'active'"],
  ]) {
    const count = db
      .prepare(`SELECT count(*) AS n FROM ${table} WHERE ${predicate}`)
      .get().n;
    assert.equal(count, 0, `Active work in ${table}; do not restart`);
  }
}
