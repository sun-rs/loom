import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  ActivationCredentialScope,
  WorkerMessageHeldResponse,
  RoomEvent,
} from "@rah-os/protocol";
import { finalized } from "./activation-read-coverage.ts";
import { instanceSessionState } from "./instance-session.ts";
import type { Row } from "./sqlite-row.ts";

type Proof = {
  runAttemptId: string;
  generation: number;
  readReceiptId: string;
  messageSeqs: number[];
  windowDigest: string;
  delivered: boolean;
};

export function migrate(database: DatabaseSync): void {
  if (
    !database
      .prepare("PRAGMA table_info(held_message_drafts)")
      .all()
      .some((r) => r.name === "read_proof_json")
  )
    database.exec(
      "ALTER TABLE held_message_drafts ADD COLUMN read_proof_json TEXT CHECK(read_proof_json IS NULL OR json_valid(read_proof_json))",
    );
}

function proof(row: Row): Proof | undefined {
  if (typeof row.read_proof_json !== "string") return;
  const value = JSON.parse(row.read_proof_json) as Proof;
  if (
    !value ||
    typeof value.runAttemptId !== "string" ||
    typeof value.readReceiptId !== "string" ||
    typeof value.windowDigest !== "string" ||
    !Number.isSafeInteger(value.generation) ||
    typeof value.delivered !== "boolean" ||
    !Array.isArray(value.messageSeqs) ||
    !value.messageSeqs.every((s) => Number.isSafeInteger(s) && s > 0)
  )
    return;
  return value;
}
function sameRun(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
  row: Row,
  value: Proof,
): boolean {
  return (
    row.participant_id === scope.participantId &&
    row.activation_id === scope.activationId &&
    row.room_id === scope.roomId &&
    value.runAttemptId === scope.runAttemptId &&
    value.generation ===
      instanceSessionState(database, scope.participantId).generation &&
    !finalized(database, scope)
  );
}

/** A draft owns an immutable output window; it is not the history receipt's mutable delivery_id. */
export function record(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
  result: WorkerMessageHeldResponse,
  newlyCreated: boolean,
): string | undefined {
  if (
    finalized(database, scope) ||
    !database
      .prepare("SELECT 1 FROM role_instances WHERE instance_id=?")
      .get(scope.participantId)
  )
    return;
  const row = database
    .prepare("SELECT * FROM held_message_drafts WHERE held_draft_id=?")
    .get(result.heldDraftId);
  if (
    !row ||
    row.state !== "held" ||
    row.activation_id !== scope.activationId ||
    row.participant_id !== scope.participantId ||
    row.room_id !== scope.roomId ||
    row.reply_based_on_room_seq === null
  )
    return;
  const messageSeqs = result.newerMessages
    .filter((e) => e.roomSeq > scope.toSeq)
    .map((e) => e.roomSeq);
  if (!messageSeqs.length) return;
  const windowDigest = createHash("sha256")
    .update(JSON.stringify(result.newerMessages))
    .digest("hex");
  const existing = proof(row);
  if (row.read_proof_json !== null)
    return existing &&
      sameRun(database, scope, row, existing) &&
      existing.windowDigest === windowDigest
      ? existing.readReceiptId
      : undefined;
  if (!newlyCreated) return;
  const value: Proof = {
    runAttemptId: scope.runAttemptId,
    generation: instanceSessionState(database, scope.participantId).generation,
    readReceiptId: randomUUID(),
    messageSeqs,
    windowDigest,
    delivered: false,
  };
  database
    .prepare(
      "UPDATE held_message_drafts SET read_proof_json=? WHERE held_draft_id=? AND read_proof_json IS NULL",
    )
    .run(JSON.stringify(value), result.heldDraftId);
  return value.readReceiptId;
}

/** Only the CLI's completed output callback supplies this token. No cursor changes. */
export function received(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
  id: string,
): boolean {
  const row = database
    .prepare(
      "SELECT * FROM held_message_drafts WHERE activation_id=? AND participant_id=? AND room_id=? AND state='held' AND json_extract(read_proof_json,'$.readReceiptId')=?",
    )
    .get(scope.activationId, scope.participantId, scope.roomId, id);
  if (!row) return false;
  const value = proof(row);
  if (!value || !sameRun(database, scope, row, value)) return false;
  database
    .prepare(
      "UPDATE held_message_drafts SET read_proof_json=? WHERE held_draft_id=?",
    )
    .run(JSON.stringify({ ...value, delivered: true }), row.held_draft_id!);
  return true;
}

/** Called only for the first committed revision, before its original ACK/final is settled. */
export function confirmRevision(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
  draftId: string,
  event: RoomEvent,
): void {
  const row = database
    .prepare("SELECT * FROM held_message_drafts WHERE held_draft_id=?")
    .get(draftId);
  if (
    event.payload.heldDraftId !== draftId ||
    event.payload.revisedDraft !== true ||
    event.type !== "message.posted" ||
    event.actorId !== scope.participantId
  )
    return;
  if (
    !row ||
    row.state !== "replaced" ||
    row.resolution_kind !== "revised" ||
    row.room_id !== event.roomId ||
    (row.thread_id ?? null) !== (event.payload.threadId ?? null)
  )
    return;
  const value = proof(row);
  if (!value?.delivered || !sameRun(database, scope, row, value)) return;
  const insert = database.prepare(`INSERT INTO worker_run_read_receipts
    (run_attempt_id,participant_id,room_id,room_seq,thread_key,generation,delivery_id,delivered,confirmed)
    SELECT ?,?,e.room_id,e.room_seq,COALESCE(m.thread_id,''),?,?,1,1 FROM room_events e
    JOIN messages m ON m.room_id=e.room_id AND m.message_id=e.aggregate_id
    WHERE e.room_id=? AND e.room_seq=? AND e.type='message.posted' AND m.thread_id IS ?
    ON CONFLICT(run_attempt_id,room_id,room_seq) DO UPDATE SET delivered=1,confirmed=1
    WHERE worker_run_read_receipts.generation=excluded.generation AND worker_run_read_receipts.participant_id=excluded.participant_id AND worker_run_read_receipts.thread_key=excluded.thread_key`);
  for (const seq of value.messageSeqs)
    if (seq > scope.toSeq)
      insert.run(
        scope.runAttemptId,
        scope.participantId,
        value.generation,
        value.readReceiptId,
        scope.roomId,
        seq,
        row.thread_id ?? null,
      );
}
