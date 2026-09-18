import assert from "node:assert/strict";

// The SQLite online backup, verification and idle proof live in the daemon
// package so an installed product never depends on repository scripts.
export {
  assertWorkbenchIdle,
  assertWorkbenchRestartable,
  backupState,
  fileInventory,
  preflightKernelUpgrade,
  protectKernelSchemaMigration,
  restoreStateSnapshot,
  snapshotStateBeforeMigration,
  stateWriteEvidence,
  verifyStateBackup,
} from "../packages/daemon/src/state-backup.ts";

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
