import type { DatabaseSync } from "node:sqlite";

import { NotFoundError } from "./errors.ts";
import { text, type Row } from "./sqlite-row.ts";
import {
  resolveWorkerReadTarget,
  type WorkerVisibleRoomScope,
} from "./worker-read-targets.ts";

/**
 * Raft addresses a Task the way a Human reads it: a channel target plus the
 * per-channel Task number
 * (`agentApiTaskClaimBodySchema = { channel, task_numbers }`,
 * `agentApiTaskUnclaimBodySchema = { channel, task_number }`).
 *
 * The resolution below is only an address lookup. It reuses
 * `resolveWorkerReadTarget`, so the caller can name no Room it is not an
 * enabled Agent member of, and it hands back the canonical `taskId` that every
 * existing authority check — delivery for a mutation, Room visibility for a
 * read — then applies unchanged. A number that resolves outside the running
 * Activation's Room fails in exactly the same place, and with the same error,
 * as a `--task-id` for that Task would.
 */
export type WorkerTaskAddress = { channel: string; taskNumber: number };

export function resolveWorkerTaskNumber(
  database: DatabaseSync,
  scope: WorkerVisibleRoomScope,
  address: WorkerTaskAddress,
): { roomId: string; taskId: string } {
  const target = resolveWorkerReadTarget(database, scope, address.channel);
  const row: Row | undefined = database
    .prepare("SELECT task_id FROM tasks WHERE room_id = ? AND task_number = ?")
    .get(target.roomId, address.taskNumber) as Row | undefined;
  if (row === undefined) {
    throw new NotFoundError(
      `task #${String(address.taskNumber)} was not found in ${address.channel}`,
    );
  }
  return { roomId: target.roomId, taskId: text(row, "task_id") };
}
