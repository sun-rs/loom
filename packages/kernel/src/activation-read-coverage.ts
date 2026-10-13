import { resolveRecoveredActivationCancellation } from "./activation-cancellation.ts";
import { activationProjectionFromRow } from "./delivery-projection.ts";
import { resolveActivationRetryFence } from "./activation-retry-fence.ts";
import {
  DeliveryProofError,
  TaskSubmissionProofError,
  RuntimeTerminationProofError,
} from "./errors.ts";
import type { Row } from "./sqlite-row.ts";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ActivationCredentialScope, RoomEvent } from "@rah-os/protocol";
import type { RoomEventWriter } from "./room-event-writer.ts";
import type { ActivationObligationService } from "./activation-obligation-service.ts";
import { instanceSessionState } from "./instance-session.ts";
import { assertAgentFirstRunSatisfied } from "./agent-first-run.ts";
import { activeInstancePrivateBoxPredicate } from "./instance-worker-scope.ts";
import { integer, text } from "./sqlite-row.ts";

/** Final closes consumption even while tools/processes are still winding down. */
export function finalized(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
): boolean {
  return (
    database
      .prepare("SELECT 1 FROM run_attempt_final_replies WHERE run_attempt_id=?")
      .get(scope.runAttemptId) !== undefined
  );
}

/** Provenance only, never a queue, Room cursor or Inbox acknowledgement. */
export function migrate(database: DatabaseSync): void {
  database.exec(`CREATE TABLE IF NOT EXISTS worker_run_read_receipts (
 run_attempt_id TEXT NOT NULL, participant_id TEXT NOT NULL,
 room_id TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
 room_seq INTEGER NOT NULL, thread_key TEXT NOT NULL, generation INTEGER NOT NULL,
 delivery_id TEXT, delivered INTEGER NOT NULL DEFAULT 0 CHECK(delivered IN (0,1)),
 check_id TEXT, confirmed INTEGER NOT NULL DEFAULT 0 CHECK(confirmed IN (0,1)),
 PRIMARY KEY(run_attempt_id,room_id,room_seq)
 ) STRICT;
 CREATE INDEX IF NOT EXISTS idx_run_read_receipts_room ON worker_run_read_receipts(room_id,participant_id,room_seq);`);
}

export function record(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
  roomId: string,
  seqs: readonly number[],
): string | undefined {
  if (
    roomId !== scope.roomId ||
    finalized(database, scope) ||
    !database
      .prepare("SELECT 1 FROM role_instances WHERE instance_id=?")
      .get(scope.participantId)
  )
    return;
  const generation = instanceSessionState(
    database,
    scope.participantId,
  ).generation;
  const id = randomUUID();
  let written = 0;
  const insert = database.prepare(`INSERT INTO worker_run_read_receipts
 (run_attempt_id,participant_id,room_id,room_seq,thread_key,generation,delivery_id)
 SELECT ?,?,e.room_id,e.room_seq,COALESCE(m.thread_id,''),?,? FROM room_events e
 JOIN messages m ON m.room_id=e.room_id AND m.message_id=e.aggregate_id
 WHERE e.room_id=? AND e.room_seq=? AND e.type='message.posted'
 ON CONFLICT(run_attempt_id,room_id,room_seq) DO UPDATE SET delivery_id=excluded.delivery_id WHERE worker_run_read_receipts.delivered=0`);
  for (const seq of new Set(seqs))
    if (seq > scope.toSeq)
      written += Number(
        insert.run(
          scope.runAttemptId,
          scope.participantId,
          generation,
          id,
          roomId,
          seq,
        ).changes,
      );
  return written > 0 ? id : undefined;
}

/** Output receipt only, not a consumption confirmation or a Room cursor ACK. */
export function received(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
  id: string,
): boolean {
  if (finalized(database, scope)) return false;
  return (
    database
      .prepare(
        "UPDATE worker_run_read_receipts SET delivered=1 WHERE run_attempt_id=? AND room_id=? AND delivery_id=?",
      )
      .run(scope.runAttemptId, scope.roomId, id).changes > 0
  );
}

/** The check response echoes this opaque token in its ACK; no message IDs are accepted from the Worker. */
export function freeze(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
): string | undefined {
  if (finalized(database, scope)) return;
  const id = randomUUID();
  const updated = database
    .prepare(
      "UPDATE worker_run_read_receipts SET check_id=? WHERE run_attempt_id=? AND room_id=? AND confirmed=0 AND delivered=1",
    )
    .run(id, scope.runAttemptId, scope.roomId);
  return updated.changes > 0 ? id : undefined;
}
export function confirmCheck(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
  id: string | undefined,
): void {
  if (id === undefined || finalized(database, scope)) return;
  database
    .prepare(
      "UPDATE worker_run_read_receipts SET confirmed=1 WHERE run_attempt_id=? AND room_id=? AND check_id=?",
    )
    .run(scope.runAttemptId, scope.roomId, id);
}
export function confirmPost(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
  event: RoomEvent,
  basedOn: number | undefined,
): void {
  if (
    basedOn === undefined ||
    event.roomId !== scope.roomId ||
    finalized(database, scope)
  )
    return;
  const thread =
    typeof event.payload.threadId === "string" ? event.payload.threadId : "";
  database
    .prepare(
      `UPDATE worker_run_read_receipts SET confirmed=1
 WHERE run_attempt_id=? AND room_id=? AND thread_key=? AND room_seq<=? AND delivered=1`,
    )
    .run(scope.runAttemptId, event.roomId, thread, basedOn);
}

/** Called in the caller's transaction, before any candidate reserves resources. */
export function settle(
  database: DatabaseSync,
  events: RoomEventWriter,
  obligations: ActivationObligationService,
  now: string,
): void {
  const candidates = database
    .prepare(
      `SELECT a.*, COALESCE(ss.generation,0) generation FROM activations a
 JOIN rooms target_room ON target_room.room_id=a.room_id AND target_room.archived_at IS NULL
 JOIN role_instances ri ON ri.instance_id=a.participant_id
 JOIN agent_definitions ad ON ad.agent_definition_id=ri.agent_id AND ad.state='enabled'
 JOIN memberships member ON member.room_id=ri.channel_id AND member.principal_id=ri.instance_id
 LEFT JOIN role_instance_sessions ss ON ss.instance_id=ri.instance_id
 WHERE a.state='queued' AND a.attempt_count=0 AND a.lease_owner IS NULL
 AND ${activeInstancePrivateBoxPredicate("a.room_id")}
 AND NOT EXISTS(SELECT 1 FROM placements p WHERE p.activation_id=a.activation_id)
 AND NOT EXISTS(SELECT 1 FROM run_attempts r WHERE r.activation_id=a.activation_id)
 AND NOT EXISTS(SELECT 1 FROM activation_retry_fences f WHERE f.activation_id=a.activation_id AND f.state <> 'resolved')
 AND NOT EXISTS(SELECT 1 FROM room_agent_sos_holds h WHERE h.room_id=a.room_id)
 AND EXISTS(SELECT 1 FROM worker_run_read_receipts x WHERE x.participant_id=a.participant_id AND x.room_id=a.room_id AND x.confirmed=1)`,
    )
    .all();
  for (const candidate of candidates) {
    const id = text(candidate, "activation_id"),
      roomId = text(candidate, "room_id"),
      participant = text(candidate, "participant_id");
    const inbox = database
      .prepare(
        `SELECT e.room_seq,e.type,i.reason FROM inbox_items i JOIN room_events e ON e.event_id=i.event_id
    WHERE i.room_id=? AND i.participant_id=? AND e.room_seq BETWEEN ? AND ?`,
      )
      .all(
        roomId,
        participant,
        integer(candidate, "from_seq"),
        integer(candidate, "to_seq"),
      );
    if (
      !inbox.length ||
      inbox.some(
        (row) =>
          row.type !== "message.posted" ||
          !["mention", "dm", "thread_subscription"].includes(
            String(row.reason),
          ),
      )
    )
      continue;
    const seqs = inbox.map((row) => integer(row, "room_seq"));
    const sources = database
      .prepare(
        `SELECT r.run_attempt_id,r.activation_id,s.payload_json FROM run_attempts r
   JOIN activations a ON a.activation_id=r.activation_id AND a.state='completed'
   JOIN room_events s ON s.aggregate_id=a.activation_id AND s.room_id=a.room_id AND s.type='activation.finished'
   WHERE r.participant_id=? AND r.room_id=? AND a.to_seq < ?
   AND (r.state='exited' OR EXISTS(SELECT 1 FROM run_attempt_final_replies f WHERE f.run_attempt_id=r.run_attempt_id))
   AND NOT EXISTS(SELECT 1 FROM run_attempts newer WHERE newer.activation_id=a.activation_id AND newer.attempt_number>r.attempt_number)
   AND NOT EXISTS(SELECT 1 FROM runtime_processes p WHERE p.activation_id=a.activation_id AND p.state<>'terminated')
   AND NOT EXISTS(SELECT 1 FROM held_message_drafts d WHERE d.activation_id=a.activation_id AND d.state='held')
   AND EXISTS(SELECT 1 FROM worker_run_read_receipts x WHERE x.run_attempt_id=r.run_attempt_id AND x.confirmed=1)`,
      )
      .all(participant, roomId, integer(candidate, "from_seq"));
    for (const source of sources) {
      const runId = text(source, "run_attempt_id");
      const receipts = database
        .prepare(
          `SELECT room_seq FROM worker_run_read_receipts WHERE run_attempt_id=? AND room_id=? AND participant_id=? AND generation=? AND confirmed=1`,
        )
        .all(runId, roomId, participant, integer(candidate, "generation"));
      const covered = new Set(receipts.map((row) => integer(row, "room_seq")));
      if (!seqs.every((seq) => covered.has(seq))) continue;
      try {
        obligations.assertSatisfied(id);
        assertAgentFirstRunSatisfied(database, candidate);
      } catch (error) {
        if (
          error instanceof TaskSubmissionProofError ||
          error instanceof DeliveryProofError
        )
          break;
        throw error;
      }
      database
        .prepare(
          "UPDATE activations SET state='cancelled', updated_at=? WHERE activation_id=? AND state='queued'",
        )
        .run(now, id);
      const provenance = JSON.parse(text(source, "payload_json")) as {
        consumerId?: string;
      };
      events.append({
        actorId: "principal_system",
        aggregateId: id,
        aggregateType: "activation",
        roomId,
        type: "activation.cancelled",
        idempotencyKey: `activation.covered:${id}`,
        payload: {
          activationId: id,
          reason: "covered_by_successful_run",
          sourceActivationId: text(source, "activation_id"),
          sourceRunAttemptId: runId,
          consumerId: provenance.consumerId,
          confirmedMessageSeqs: seqs,
          generation: integer(candidate, "generation"),
        },
      });
      break;
    }
  }
}

/** Existing completion gates, extracted intact; coverage runs only after them. */
export function complete(
  database: DatabaseSync,
  events: RoomEventWriter,
  obligations: ActivationObligationService,
  row: Row,
  consumerId: string,
  hostId: string,
  updatedAt: string,
) {
  const activationId = text(row, "activation_id");
  if (
    database
      .prepare(
        "SELECT runtime_process_id FROM runtime_processes WHERE activation_id=? AND state<>'terminated' LIMIT 1",
      )
      .get(activationId)
  )
    throw new RuntimeTerminationProofError(
      `activation ${activationId} has a runtime without terminal proof`,
    );
  obligations.assertSatisfied(activationId);
  assertAgentFirstRunSatisfied(database, row);
  resolveActivationRetryFence(database, {
    activationId,
    resolutionKind: "progress",
    resolvedAt: updatedAt,
  });
  database
    .prepare(
      "UPDATE activations SET state='completed', lease_owner=NULL, lease_until=NULL, lease_until_ms=NULL, updated_at=? WHERE activation_id=?",
    )
    .run(updatedAt, activationId);
  events.append({
    actorId: "principal_system",
    aggregateId: activationId,
    aggregateType: "activation",
    idempotencyKey: `activation.complete:${activationId}`,
    payload: { activationId, consumerId, hostId },
    roomId: text(row, "room_id"),
    type: "activation.finished",
  });
  settle(database, events, obligations, updatedAt);
  return activationProjectionFromRow(
    database
      .prepare("SELECT * FROM activations WHERE activation_id=?")
      .get(activationId)!,
  );
}

/** A committed final survives Host loss. Never infer ACK or successful process exit. */
export function recoverCommittedFinal(
  database: DatabaseSync,
  events: RoomEventWriter,
  obligations: ActivationObligationService,
  row: Row,
  recoveryHostId: string,
  now: string,
) {
  const activationId = text(row, "activation_id");
  const marker = database
    .prepare(
      `SELECT f.consumer_id FROM run_attempt_final_replies f
 JOIN run_attempts r ON r.run_attempt_id=f.run_attempt_id
 JOIN worker_run_message_writes w ON w.event_id=f.event_id AND w.run_attempt_id=r.run_attempt_id
 JOIN role_instances i ON i.instance_id=r.participant_id
 LEFT JOIN role_instance_sessions s ON s.instance_id=i.instance_id
 JOIN subscription_cursors c ON c.room_id=r.room_id AND c.participant_id=r.participant_id AND c.consumer_id=f.consumer_id
 WHERE f.activation_id=? AND f.room_id=? AND r.participant_id=?
 AND f.delivery_to_seq>=? AND c.last_seq>=?
 AND w.session_generation=COALESCE(s.generation,0)
 AND NOT EXISTS(SELECT 1 FROM run_attempts n WHERE n.activation_id=r.activation_id AND n.attempt_number>r.attempt_number)
 AND NOT EXISTS(SELECT 1 FROM run_attempts n WHERE n.activation_id=r.activation_id AND n.state IN ('starting','running'))
 AND NOT EXISTS(SELECT 1 FROM held_message_drafts d WHERE d.activation_id=r.activation_id AND d.state='held')`,
    )
    .get(
      activationId,
      text(row, "room_id"),
      text(row, "participant_id"),
      integer(row, "to_seq"),
      integer(row, "to_seq"),
    );
  if (!marker) return;
  try {
    obligations.assertSatisfied(activationId);
    assertAgentFirstRunSatisfied(database, row);
  } catch (error) {
    if (
      error instanceof TaskSubmissionProofError ||
      error instanceof DeliveryProofError
    )
      return;
    throw error;
  }
  const result = complete(
    database,
    events,
    obligations,
    row,
    text(marker, "consumer_id"),
    recoveryHostId,
    now,
  );
  resolveRecoveredActivationCancellation(database, row, now);
  return result;
}
