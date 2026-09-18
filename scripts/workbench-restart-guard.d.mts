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
export type {
  BackupReceipt,
  FileInventory,
  SchemaMigrationOutcome,
  StateSnapshotReceipt,
  StateWriteEvidence,
} from "../packages/daemon/src/state-backup.ts";

export function guardedStop(
  steps: Record<string, () => Promise<boolean>>,
): Promise<void>;
