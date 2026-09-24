import type { DatabaseSync } from "node:sqlite";

import type { ActivationCredentialScope } from "@rah-os/protocol";

import type { Row } from "./sqlite-row.ts";
import { requireWorkerTaskVisibility } from "./worker-task-scope.ts";

/**
 * Durable evidence for an explicit old-Task-Thread reply: `task-get` of that
 * Task in this Activation. Written by the read itself; idempotent.
 */
export const ACTIVATION_TASK_READS_SCHEMA = `
CREATE TABLE IF NOT EXISTS activation_task_reads (
  activation_id TEXT NOT NULL REFERENCES activations(activation_id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (activation_id, task_id)
) STRICT;
`;

export function recordActivationTaskRead(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
  taskId: string,
  now: string,
): void {
  database
    .prepare(
      "INSERT OR IGNORE INTO activation_task_reads(activation_id, task_id, created_at) VALUES(?, ?, ?)",
    )
    .run(scope.activationId, taskId, now);
}

/** `task-get`: the visible Task row, recording reply-target evidence for its
 * Thread in this Activation in the same transaction. */
export function readWorkerTask(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
  taskId: string,
  now: string,
): Row {
  const task = requireWorkerTaskVisibility(database, scope, taskId);
  recordActivationTaskRead(database, scope, taskId, now);
  return task;
}
