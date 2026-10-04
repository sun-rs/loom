import type { DatabaseSync } from "node:sqlite";
import {
  WorkerFinalOutputRequestSchema,
  type ActivationCredentialScope,
  type WorkerMessagePostRequest,
} from "@rah-os/protocol";
import { ConflictError } from "./errors.ts";
import type { postWorkerMessageTransaction } from "./worker-message-command.ts";

/** Called only inside the authenticated Worker's existing Kernel transaction.
 * Provenance is recorded by this entry, never inferred from a caller's key. */
export function submitWorkerFinalOutputTransaction(input: {
  database: DatabaseSync;
  scope: ActivationCredentialScope;
  raw: { body: string; basedOnRoomSeq: number };
  post: (
    command: WorkerMessagePostRequest,
  ) => ReturnType<typeof postWorkerMessageTransaction>;
}) {
  const command = WorkerFinalOutputRequestSchema.parse(input.raw);
  const idempotencyKey = `final-output:v1:${input.scope.runAttemptId}`;
  const marker = input.database
    .prepare(
      "SELECT f.submission_kind, e.idempotency_key FROM run_attempt_final_replies f JOIN room_events e ON e.event_id=f.event_id WHERE f.run_attempt_id=?",
    )
    .get(input.scope.runAttemptId);
  if (
    marker &&
    (marker.submission_kind !== "final-output" ||
      marker.idempotency_key !== idempotencyKey)
  )
    throw new ConflictError("This Run already committed another final reply");
  const result = input.post({ ...command, idempotencyKey, final: true });
  if ("event" in result)
    input.database
      .prepare(
        "UPDATE run_attempt_final_replies SET submission_kind='final-output' WHERE run_attempt_id=? AND event_id=?",
      )
      .run(input.scope.runAttemptId, result.event.eventId);
  return result;
}
