import { WorkerTaskBatchResponseSchema } from "@rah-os/protocol";
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  ActivationCredentialScope,
  WorkerTaskBatchResponse,
} from "@rah-os/protocol";
import { ConflictError, IdempotencyConflictError } from "./errors.ts";
import { text } from "./sqlite-row.ts";
// Local bounded-storage policy, not asserted to be Raft's server implementation.
export const TASK_BATCH_RECEIPT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const TASK_BATCH_RECEIPT_LIMIT = 1024;
export const TASK_BATCH_RESPONSE_BYTES = 256 * 1024;
export function batchDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function readBatchReceipt(
  db: DatabaseSync,
  scope: ActivationCredentialScope,
  operation: string,
  key: string,
  digest: string,
): WorkerTaskBatchResponse | undefined {
  const row = db
    .prepare(
      "SELECT * FROM task_batch_command_receipts WHERE actor_id=? AND room_id=? AND operation=? AND idempotency_key=?",
    )
    .get(scope.participantId, scope.roomId, operation, key);
  if (!row) return;
  if (text(row, "request_digest") !== digest)
    throw new IdempotencyConflictError(
      "Task batch key already belongs to a different request",
    );
  const raw = text(row, "response_json");
  if (Buffer.byteLength(raw) > TASK_BATCH_RESPONSE_BYTES)
    throw new ConflictError(
      "Stored Task batch response exceeds the receipt size bound",
    );
  const response = WorkerTaskBatchResponseSchema.parse(JSON.parse(raw));
  const sanitize = (r: WorkerTaskBatchResponse["results"][number]) => {
    if (
      !r.success ||
      !r.taskId ||
      db
        .prepare("SELECT 1 FROM tasks WHERE task_id=? AND room_id=?")
        .get(r.taskId, scope.roomId)
    )
      return r;
    return {
      success: true,
      taskId: r.taskId,
      ...(r.taskNumber === undefined ? {} : { taskNumber: r.taskNumber }),
      deleted: true,
    };
  };
  return {
    ...response,
    results: response.results.map(sanitize),
    tasks: response.tasks.map(sanitize),
    deduplicated: true,
  };
}
export function reserveBatchReceipt(db: DatabaseSync, now: number): void {
  db.prepare(
    `DELETE FROM task_batch_command_receipts WHERE rowid IN (SELECT r.rowid FROM task_batch_command_receipts r WHERE r.expires_at_ms <= ? AND NOT EXISTS (SELECT 1 FROM activations a WHERE a.activation_id=r.activation_id AND a.state NOT IN ('completed','cancelled')) AND NOT EXISTS (SELECT 1 FROM run_attempts run WHERE run.activation_id=r.activation_id AND run.state IN ('starting','running','orphaned')) ORDER BY r.expires_at_ms LIMIT 100)`,
  ).run(now);
  const count = db
    .prepare("SELECT COUNT(*) AS n FROM task_batch_command_receipts")
    .get()!;
  if (Number(count.n) >= TASK_BATCH_RECEIPT_LIMIT)
    throw new ConflictError(
      "Task batch receipt capacity reached; unexpired receipts are preserved",
    );
}
export function recordBatchReceipt(
  db: DatabaseSync,
  scope: ActivationCredentialScope,
  operation: string,
  key: string,
  digest: string,
  response: WorkerTaskBatchResponse,
  now: number,
): void {
  const json = JSON.stringify(WorkerTaskBatchResponseSchema.parse(response));
  if (Buffer.byteLength(json) > TASK_BATCH_RESPONSE_BYTES)
    throw new ConflictError(
      "Task batch response exceeds the bounded receipt size",
    );
  db.prepare(
    "INSERT INTO task_batch_command_receipts VALUES(?,?,?,?,?,?,?,?,?)",
  ).run(
    scope.participantId,
    scope.roomId,
    operation,
    key,
    digest,
    json,
    scope.activationId,
    now,
    now + TASK_BATCH_RECEIPT_TTL_MS,
  );
}
