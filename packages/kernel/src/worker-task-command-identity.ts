import type { DatabaseSync } from "node:sqlite";
import type * as P from "@rah-os/protocol";

import { ForbiddenError } from "./errors.ts";
import { deriveWorkerTaskIdempotencyKey } from "./worker-message-identity.ts";
import { jsonObject, nullableInteger } from "./sqlite-row.ts";
import { highestWorkerRoomReadPosition } from "./worker-target-read-position.ts";

export type WorkerTaskCommandIdentity = {
  operation: string;
  subjectId?: string | undefined;
  content?: readonly (string | null)[] | undefined;
  basedOnRoomSeq?: number | undefined;
  idempotencyKey?: string | undefined;
};

export type ResolvedWorkerTaskCausality = {
  basedOnRoomSeq: number;
  idempotencyKey: string;
};

/**
 * Raft resolves a command's read position inside the tool from its own local
 * state instead of asking the model for one. RAH's equivalent local state is
 * the ledger itself: the Activation head this credential was issued for, moved
 * forward by this Run's own committed Task events.
 *
 * `assertWorkerTaskCursorAnchor` accepts exactly those anchors — the Activation
 * head, a Task event this participant appended in this RunAttempt, or the
 * furthest position the Kernel has demonstrably shown this participant in this
 * Room. It is the same number the standing prompt used to make the Agent carry
 * and re-derive after every non-deduplicated response.
 *
 * The read position is part of it because a freshness hold tells the Agent to
 * read the newer context and rerun the command if it is still correct. Without
 * it that instruction is false: the retry would carry the same frozen head and
 * be held again, with no path out inside the Run. The fence widens only to what
 * this participant has actually been shown, which is the fence's own criterion.
 */
export function workerTaskCommandReadPosition(
  database: DatabaseSync,
  scope: P.ActivationCredentialScope,
): number {
  const own = database
    .prepare(
      `SELECT MAX(room_seq) AS seq FROM room_events
       WHERE room_id = ?
         AND aggregate_type = 'task'
         AND actor_id = ?
         AND json_extract(payload_json, '$.runAttemptId') = ?`,
    )
    .get(scope.roomId, scope.participantId, scope.runAttemptId);
  return Math.max(
    scope.toSeq,
    own === undefined ? 0 : (nullableInteger(own, "seq") ?? 0),
    highestWorkerRoomReadPosition(database, {
      participantId: scope.participantId,
      roomId: scope.roomId,
    }),
  );
}

/**
 * The Room sequence of the latest event that opened a new round of owner work
 * on this Task. Kept server-side so the Agent never has to fold it into a key.
 */
export function workerTaskReworkRoundSeq(
  database: DatabaseSync,
  roomId: string,
  taskId: string | undefined,
): number {
  if (taskId === undefined) return 0;
  const row = database
    .prepare(
      `SELECT MAX(room_seq) AS seq FROM room_events
       WHERE room_id = ?
         AND (
           (aggregate_type = 'task' AND aggregate_id = ? AND type = 'task.reopened')
           OR (
             type = 'review.submitted'
             AND json_extract(payload_json, '$.taskId') = ?
             AND json_extract(payload_json, '$.disposition') = 'changes_requested'
           )
         )`,
    )
    .get(roomId, taskId, taskId);
  return row === undefined ? 0 : (nullableInteger(row, "seq") ?? 0);
}

/**
 * The cursor a command already committed under. A derived retry has to be
 * byte-identical to its first attempt: the read position moves forward as this
 * Run commits its own Task events, and Task creation compares the recorded
 * `basedOnRoomSeq` when it replays a key, so a retry that carried a newer
 * number would read as a different mutation under the same key.
 */
function committedCursorForKey(
  database: DatabaseSync,
  roomId: string,
  idempotencyKey: string,
): number | undefined {
  const previous = database
    .prepare(
      "SELECT payload_json FROM room_events WHERE room_id=? AND idempotency_key=?",
    )
    .get(roomId, idempotencyKey);
  if (previous === undefined) return undefined;
  const recorded = jsonObject(previous, "payload_json").basedOnRoomSeq;
  return typeof recorded === "number" && Number.isInteger(recorded)
    ? recorded
    : undefined;
}

/** Fill in whatever the minimal form omitted; never rewrite what was presented. */
export function resolveWorkerTaskCommandCausality(
  database: DatabaseSync,
  scope: P.ActivationCredentialScope,
  input: WorkerTaskCommandIdentity,
): ResolvedWorkerTaskCausality {
  const idempotencyKey =
    input.idempotencyKey ??
    deriveWorkerTaskIdempotencyKey({
      participantId: scope.participantId,
      activationId: scope.activationId,
      roomId: scope.roomId,
      operation: input.operation,
      subjectId: input.subjectId ?? null,
      roundSeq: workerTaskReworkRoundSeq(
        database,
        scope.roomId,
        input.subjectId,
      ),
      content: input.content ?? [],
    });
  return {
    basedOnRoomSeq:
      input.basedOnRoomSeq ??
      committedCursorForKey(database, scope.roomId, idempotencyKey) ??
      workerTaskCommandReadPosition(database, scope),
    idempotencyKey,
  };
}

/**
 * The Kernel still owns a complete command. Route handlers resolve the minimal
 * form before they call in, so this only fires on a direct Kernel caller.
 */
export function requireResolvedWorkerTaskCausality<
  T extends {
    basedOnRoomSeq?: number | undefined;
    idempotencyKey?: string | undefined;
  },
>(input: T): T & ResolvedWorkerTaskCausality {
  if (input.basedOnRoomSeq === undefined || input.idempotencyKey === undefined)
    throw new ForbiddenError(
      "Task command reached the Kernel without a resolved causal cursor and idempotency key",
    );
  return input as T & ResolvedWorkerTaskCausality;
}
