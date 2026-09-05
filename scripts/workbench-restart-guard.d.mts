import type { DatabaseSync } from "node:sqlite";

export type FileInventory = {
  files: Record<string, string>;
  omittedSockets: string[];
};
export type BackupReceipt = FileInventory & {
  databases: string[];
  databaseHashes: Record<string, string>;
};
export function guardedStop(
  steps: Record<string, () => Promise<boolean>>,
): Promise<void>;
export function backupState(
  state: string,
  target: string,
): Promise<BackupReceipt>;
export function fileInventory(root: string): Promise<FileInventory>;
export function verifyStateBackup(
  target: string,
  receipt: BackupReceipt,
): Promise<true>;
export function assertWorkbenchIdle(db: DatabaseSync): void;
