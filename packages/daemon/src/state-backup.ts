import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { backup, DatabaseSync } from "node:sqlite";

import { RoomKernel, type KernelSchemaState } from "@rah-os/kernel";
import { databaseContentDigest } from "./state-restore-proof.ts";

export type FileInventory = {
  files: Record<string, string>;
  omittedSockets: string[];
  omittedRuntimeCredentials?: string[];
};

export type BackupReceipt = FileInventory & {
  databaseHashes: Record<string, string>;
  databases: string[];
};

/**
 * Durable evidence of how far the Room ledger had progressed when a snapshot
 * was taken. A restore is only ever allowed against an identical reading.
 */
export type StateWriteEvidence = {
  eventCount: number;
  roomSeq: { roomId: string; roomSeq: number }[];
};

export type StateSnapshotReceipt = {
  backup: BackupReceipt;
  createdAt: string;
  fromSchemaVersion: number;
  /** Known legacy drift at snapshot time; recorded, never acted on. */
  legacyDrift: string[];
  kind: "pre-migration";
  pendingChanges: string[];
  schemaVersion: 1;
  snapshotDirectory: string;
  stateDirectory: string;
  toSchemaVersion: number;
  writeEvidence: StateWriteEvidence;
};

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function sync(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

// Host-owned per-turn capabilities are process state, never restorable data.
// Keep provider-sessions and all other files in the verified backup.
function runtimeCredentialDirectory(name: string): boolean {
  return /^warm-runtimes\/instrt_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/turns$/u.test(
    name,
  );
}

export async function fileInventory(
  root: string,
  allowRuntimeCredentials = true,
): Promise<FileInventory> {
  const files: Record<string, string> = {};
  const omittedSockets: string[] = [];
  const omittedRuntimeCredentials: string[] = [];
  async function walk(directory: string, prefix = ""): Promise<void> {
    for (const entry of (await readdir(directory)).sort()) {
      const name = prefix + entry,
        path = join(directory, entry);
      const stat = await lstat(path);
      assert.ok(!stat.isSymbolicLink(), `State symlink refused: ${name}`);
      if (runtimeCredentialDirectory(name)) {
        assert.ok(
          stat.isDirectory() && allowRuntimeCredentials,
          "Runtime credentials must not be restored from backup",
        );
        omittedRuntimeCredentials.push(name);
        continue;
      }
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
  return {
    files,
    omittedSockets,
    ...(omittedRuntimeCredentials.length ? { omittedRuntimeCredentials } : {}),
  };
}

async function databaseInventory(root: string): Promise<string[]> {
  const databases: string[] = [];
  async function walk(directory: string, prefix = ""): Promise<void> {
    for (const entry of (await readdir(directory)).sort()) {
      const name = prefix + entry,
        path = join(directory, entry);
      const stat = await lstat(path);
      assert.ok(!stat.isSymbolicLink(), `State symlink refused: ${name}`);
      if (runtimeCredentialDirectory(name) && stat.isDirectory()) continue;
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

export async function backupState(
  state: string,
  target: string,
): Promise<BackupReceipt> {
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
  const receipt: BackupReceipt = {
    databaseHashes: {},
    databases: [],
    ...before,
  };
  async function walk(directory: string, prefix = ""): Promise<void> {
    for (const entry of (await readdir(directory)).sort()) {
      const name = prefix + entry,
        source = join(directory, entry),
        dest = join(target, name);
      const stat = await lstat(source);
      assert.ok(!stat.isSymbolicLink(), `State symlink refused: ${name}`);
      if (runtimeCredentialDirectory(name) && stat.isDirectory()) continue;
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

function verifyDatabase(path: string): void {
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

export async function verifyStateBackup(
  target: string,
  receipt: BackupReceipt,
): Promise<true> {
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
    (await fileInventory(target, false)).files,
    receipt.files,
    "Backup file digest mismatch",
  );
  return true;
}

export function assertWorkbenchIdle(db: DatabaseSync): void {
  assertWorkbenchQuiescent(db, false);
}

/** A restart retains inert work; it does not retry, resume or discard it. */
export function assertWorkbenchRestartable(db: DatabaseSync): void {
  assertWorkbenchQuiescent(db, true);
  const leasedQuarantine = db
    .prepare(
      "SELECT count(*) AS n FROM activations WHERE state = 'quarantined' AND (lease_owner IS NOT NULL OR lease_until IS NOT NULL OR lease_until_ms IS NOT NULL)",
    )
    .get()?.n;
  assert.equal(
    leasedQuarantine,
    0,
    "Quarantined work still has a lease; do not restart",
  );
}

function assertWorkbenchQuiescent(
  db: DatabaseSync,
  retainInertWork: boolean,
): void {
  for (const [table, predicate] of [
    [
      "activations",
      retainInertWork
        ? `state = 'leased' OR (state = 'queued' AND NOT (
            lease_owner IS NULL AND lease_until IS NULL AND lease_until_ms IS NULL
            AND EXISTS (
              SELECT 1 FROM room_agent_sos_holds AS hold
              JOIN room_agent_sos_operations AS operation
                ON operation.operation_id = hold.operation_id
                AND operation.room_id = hold.room_id
              WHERE hold.room_id = activations.room_id AND operation.state = 'stopped'
            )
          ))`
        : "state IN ('queued','leased','quarantined')",
    ],
    ["run_attempts", "state IN ('starting','running','orphaned')"],
    ["runtime_processes", "state != 'terminated'"],
    ["placements", "state != 'released'"],
    ["agent_exclusive_operation_leases", "state = 'active'"],
  ]) {
    const count = db
      .prepare(`SELECT count(*) AS n FROM ${table} WHERE ${predicate}`)
      .get()?.n;
    assert.equal(count, 0, `Active work in ${table}; do not restart`);
  }
}

/** Reads the Room ledger's progress without writing to it. */
export function stateWriteEvidence(stateDirectory: string): StateWriteEvidence {
  const db = new DatabaseSync(join(stateDirectory, "room.db"), {
    readOnly: true,
  });
  try {
    return {
      eventCount: Number(
        db.prepare("SELECT count(*) AS n FROM room_events").get()?.n ?? 0,
      ),
      roomSeq: db
        .prepare(
          "SELECT room_id, max(room_seq) AS seq FROM room_events GROUP BY room_id ORDER BY room_id",
        )
        .all()
        .map((row) => ({
          roomId: String(row.room_id),
          roomSeq: Number(row.seq),
        })),
    };
  } finally {
    db.close();
  }
}

export function snapshotReceiptPath(snapshotDirectory: string): string {
  return `${snapshotDirectory}.receipt.json`;
}

/**
 * Exclusive, verified snapshot taken before a Kernel schema migration.
 * Every failure throws: the caller must abort the migration, not continue.
 */
export async function snapshotStateBeforeMigration(input: {
  schemaState: KernelSchemaState;
  snapshotRoot: string;
  stateDirectory: string;
}): Promise<{
  receipt: StateSnapshotReceipt;
  receiptPath: string;
  snapshotDirectory: string;
}> {
  const evidence = stateWriteEvidence(input.stateDirectory);
  await mkdir(input.snapshotRoot, { mode: 0o700, recursive: true });
  const snapshotDirectory = join(
    input.snapshotRoot,
    `pre-migration-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}`,
  );
  const backupReceipt = await backupState(
    input.stateDirectory,
    snapshotDirectory,
  );
  const receipt: StateSnapshotReceipt = {
    backup: backupReceipt,
    createdAt: new Date().toISOString(),
    fromSchemaVersion: input.schemaState.databaseSchemaVersion,
    kind: "pre-migration",
    legacyDrift: input.schemaState.drift.map(
      (change) => `${change.kind}:${change.name}`,
    ),
    pendingChanges: input.schemaState.pending.map(
      (change) => `${change.kind}:${change.name}`,
    ),
    schemaVersion: 1,
    snapshotDirectory,
    stateDirectory: input.stateDirectory,
    toSchemaVersion: input.schemaState.kernelSchemaVersion,
    writeEvidence: evidence,
  };
  const receiptPath = snapshotReceiptPath(snapshotDirectory);
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  return { receipt, receiptPath, snapshotDirectory };
}

export type SchemaMigrationOutcome = {
  migrated: boolean;
  schemaState: KernelSchemaState;
  snapshotDirectory?: string;
};

/** Candidate schema must open a historical database copy before stopping service. */
export async function preflightKernelUpgrade(
  databasePath: string,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "rah-upgrade-preflight-"));
  try {
    const copiedPath = join(directory, "room.db");
    const source = new DatabaseSync(databasePath, { readOnly: true });
    try {
      await backup(source, copiedPath);
    } finally {
      source.close();
    }
    const kernel = new RoomKernel({ databasePath: copiedPath });
    try {
      kernel.initialize();
      assert.deepEqual(
        kernel.pendingSchemaChanges(),
        [],
        "Candidate migration did not converge",
      );
    } finally {
      kernel.close();
    }
    verifyDatabase(copiedPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * Detect first, snapshot second, migrate last. An ordinary start with nothing
 * pending copies no state at all; a failed snapshot aborts before the Kernel
 * has touched the database.
 */
export async function protectKernelSchemaMigration(input: {
  snapshotRoot?: string;
  stateDirectory: string;
}): Promise<SchemaMigrationOutcome> {
  const databasePath = join(input.stateDirectory, "room.db");
  const schemaState = RoomKernel.inspectSchemaState(databasePath);
  if (!schemaState.supported) {
    throw new Error(
      `Refusing to open ${databasePath}: it was written by Kernel schema ${schemaState.databaseSchemaVersion} and this build supports ${schemaState.kernelSchemaVersion}. Artifact rollback does not roll back data; install the matching or newer build.`,
    );
  }
  const unexpected = schemaState.drift.filter(
    (change) => change.kind === "unexpected_drift",
  );
  if (
    schemaState.databaseSchemaVersion === schemaState.kernelSchemaVersion &&
    unexpected.length
  ) {
    throw new Error(
      `unrecognized schema drift: ${unexpected.map((change) => change.name).join(", ")}; refusing to change the database without an explicit repair migration`,
    );
  }
  const legacy = schemaState.drift.filter(
    (change) => change.kind === "legacy_drift",
  );
  if (legacy.length > 0) {
    // One line, once per start: accepted legacy drift is a diagnostic only.
    process.stderr.write(
      `Kernel schema legacy drift (accepted, no migration acts on it): ${legacy
        .map((change) => change.name)
        .join(", ")}\n`,
    );
  }
  if (schemaState.pending.length === 0) {
    return { migrated: false, schemaState };
  }
  const snapshotRoot =
    input.snapshotRoot ?? join(dirname(input.stateDirectory), "backups");
  let snapshotDirectory: string;
  try {
    ({ snapshotDirectory } = await snapshotStateBeforeMigration({
      schemaState,
      snapshotRoot,
      stateDirectory: input.stateDirectory,
    }));
  } catch (error) {
    throw new Error(
      `Kernel schema migration ${schemaState.databaseSchemaVersion} -> ${schemaState.kernelSchemaVersion} aborted: the pre-migration snapshot under ${snapshotRoot} could not be completed and verified. The database was not migrated.`,
      { cause: error },
    );
  }
  const kernel = new RoomKernel({ databasePath });
  try {
    kernel.initialize();
  } finally {
    kernel.close();
  }
  return { migrated: true, schemaState, snapshotDirectory };
}

/**
 * Explicit operator restore. It never overwrites a database in use and never
 * discards newer business writes: both refuse, keep the scene and report why.
 */
export async function restoreStateSnapshot(input: {
  confirm: "restore-from-snapshot";
  runningPid?: number;
  snapshotDirectory: string;
  stateDirectory: string;
}): Promise<{ restoredFrom: string; supersededDirectory: string }> {
  assert.equal(
    input.confirm,
    "restore-from-snapshot",
    "Restore requires an explicit operator confirmation",
  );
  const receiptPath = snapshotReceiptPath(input.snapshotDirectory);
  const receipt = JSON.parse(
    await readFile(receiptPath, "utf8"),
  ) as StateSnapshotReceipt;
  assert.equal(receipt.schemaVersion, 1, "Unsupported snapshot receipt");
  assert.equal(
    resolve(receipt.stateDirectory),
    resolve(input.stateDirectory),
    "Snapshot belongs to another state directory",
  );
  await verifyStateBackup(input.snapshotDirectory, receipt.backup);
  if (input.runningPid !== undefined) {
    let alive = true;
    try {
      process.kill(input.runningPid, 0);
    } catch {
      alive = false;
    }
    assert.ok(
      !alive,
      `Workbench process ${input.runningPid} is still running; stop it before restoring`,
    );
  }
  const live = new DatabaseSync(join(input.stateDirectory, "room.db"), {
    readOnly: true,
  });
  try {
    assertWorkbenchIdle(live);
    assert.equal(
      live
        .prepare(
          "SELECT count(*) AS n FROM agent_hosts WHERE state != 'offline'",
        )
        .get()?.n,
      0,
      "Workbench Hosts must be offline before restoring",
    );
  } finally {
    live.close();
  }
  assert.deepEqual(
    stateWriteEvidence(input.stateDirectory),
    receipt.writeEvidence,
    "The state received new business writes after this snapshot; restoring would discard them. The scene is unchanged.",
  );
  const verifyUnchanged = async () => {
    assert.deepEqual(
      (await fileInventory(input.stateDirectory)).files,
      receipt.backup.files,
      "File state changed after the snapshot; restoring would discard it",
    );
    assert.deepEqual(
      await databaseInventory(input.stateDirectory),
      [...receipt.backup.databases].sort(),
      "Database state changed after the snapshot",
    );
    for (const name of receipt.backup.databases)
      assert.equal(
        databaseContentDigest(join(input.stateDirectory, name)),
        databaseContentDigest(join(input.snapshotDirectory, name)),
        "Database state changed after the snapshot; migrated or newer data requires an explicit recovery plan",
      );
  };
  await verifyUnchanged();
  // Prepare and verify the replacement before moving the current tree aside.
  const stagingDirectory = `${input.stateDirectory}.restore-${randomUUID()}`;
  await mkdir(stagingDirectory, { mode: 0o700 });
  await copyTree(input.snapshotDirectory, stagingDirectory);
  await verifyStateBackup(stagingDirectory, receipt.backup);
  await verifyUnchanged();
  // Never overwrite the database in use: the current tree is set aside intact.
  const supersededDirectory = `${input.stateDirectory}.superseded-${new Date()
    .toISOString()
    .replaceAll(":", "-")}`;
  await rename(input.stateDirectory, supersededDirectory);
  try {
    await rename(stagingDirectory, input.stateDirectory);
  } catch (error) {
    await rename(supersededDirectory, input.stateDirectory);
    throw error;
  }
  return { restoredFrom: input.snapshotDirectory, supersededDirectory };
}

async function copyTree(source: string, target: string): Promise<void> {
  for (const entry of (await readdir(source)).sort()) {
    const from = join(source, entry),
      to = join(target, entry);
    const stat = await lstat(from);
    assert.ok(!stat.isSymbolicLink(), `Snapshot symlink refused: ${entry}`);
    if (stat.isDirectory()) {
      await mkdir(to, { mode: 0o700 });
      await copyTree(from, to);
    } else {
      await copyFile(from, to, 1 /* COPYFILE_EXCL */);
      await chmod(to, 0o600 | (stat.mode & 0o100));
    }
  }
}
