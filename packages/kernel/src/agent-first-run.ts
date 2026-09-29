import type { DatabaseSync } from "node:sqlite";
import type { RoomEvent } from "@rah-os/protocol";
import type { RoomEventWriter } from "./room-event-writer.ts";
import { DeliveryProofError, ForbiddenError } from "./errors.ts";
import { integer, text, type Row } from "./sqlite-row.ts";

/** Workspace setting is projected from its authoritative control-Room events. */
export function agentGreetingEnabled(
  database: DatabaseSync,
  controlRoomId: string | undefined,
): boolean {
  if (!controlRoomId) return true;
  const row = database
    .prepare(
      `SELECT json_extract(payload_json,'$.agentAllChannelGreetingEnabled') enabled
    FROM room_events WHERE room_id=? AND type='workspace.updated'
    AND json_type(payload_json,'$.agentAllChannelGreetingEnabled') IN ('true','false')
    ORDER BY room_seq DESC LIMIT 1`,
    )
    .get(controlRoomId);
  return row?.enabled !== 0;
}

export function firstRunMessageKey(participantId: string): string {
  return `agent-first-greeting:${participantId}`;
}

/** Called only from successful new provisioning, inside the same transaction.
 * Never backfill existing Agents or derive work from a provider session. */
export function requestAgentFirstRun(
  database: DatabaseSync,
  events: RoomEventWriter,
  controlRoomId: string,
  participantId: string,
  now: Date,
): void {
  const all = database
    .prepare(
      `SELECT r.room_id FROM rooms r JOIN rooms c ON c.workspace_id=r.workspace_id
    WHERE c.room_id=? AND r.kind='channel' AND r.slug='all' AND r.archived_at IS NULL`,
    )
    .get(controlRoomId);
  // Headless workspaces may not expose the product #all channel yet.
  // Do not redirect a public greeting into the private control Room.
  if (!all) return;
  const roomId = text(all, "room_id");
  // New Agents always initialize and greet; legacy settings remain readable only.
  const greetingEnabled = true;
  const messageKey = firstRunMessageKey(participantId);
  const event = events.append({
    actorId: "principal_system",
    aggregateId: participantId,
    aggregateType: "agent",
    roomId,
    type: "agent.first_run_requested",
    idempotencyKey: `agent-first-run:${participantId}`,
    payload: {
      participantId,
      greetingEnabled,
      messageKey,
      body: greetingEnabled
        ? `First-run request (system-triggered): Read your identity and MEMORY.md index. You have just joined #all, the Workspace-wide channel. Read the room, then post one short, natural self-introduction in your own voice, one or two sentences, so the team knows who you are and what you can help with. Do not paste a fixed template. This is a one-time greeting; afterward return to normal work. Do not create or claim a Task for onboarding. Use "$RAH_WORKER_CLI" worker message-post --top-level --idempotency-key ${messageKey} with your greeting on stdin. Keep this key on retry; a committed greeting is returned without posting again.`
        : "First-run request (system-triggered): Read your identity and MEMORY.md index. Automatic #all greeting is disabled. Do not send a greeting or create a Task; acknowledge this delivery and return to normal work.",
    },
  });
  events.deriveAttention(
    event,
    [{ participantId, reason: "manual" }],
    now.toISOString(),
  );
}

/** A reserved once-only send key binds the actual Room message to this request.
 * Normal message idempotency remains content-sensitive. */
export function firstRunReplay(
  database: DatabaseSync,
  scope: { participantId: string; roomId: string; activationId: string },
  key: string | undefined,
  threadId: string | null | undefined,
  eventFromRow: (row: Row) => RoomEvent,
): RoomEvent | undefined {
  if (!key?.startsWith("agent-first-greeting:")) return undefined;
  if (key !== firstRunMessageKey(scope.participantId) || threadId != null)
    throw new ForbiddenError(
      "First greeting must belong to this Agent and the top-level Room",
    );
  const request = database
    .prepare(
      `SELECT 1 FROM room_events e JOIN inbox_items i ON i.event_id=e.event_id
    JOIN activations a ON a.activation_id=? AND a.participant_id=i.participant_id
    WHERE e.room_id=? AND e.type='agent.first_run_requested' AND i.participant_id=?
    AND e.room_seq BETWEEN a.from_seq AND a.to_seq AND json_extract(e.payload_json,'$.greetingEnabled')=1`,
    )
    .get(scope.activationId, scope.roomId, scope.participantId);
  if (!request)
    throw new ForbiddenError("No first-greeting request in this Activation");
  const prior = database
    .prepare(
      "SELECT * FROM room_events WHERE room_id=? AND idempotency_key=? AND actor_id=? AND type='message.posted'",
    )
    .get(scope.roomId, key, scope.participantId);
  return prior ? eventFromRow(prior) : undefined;
}

/** Successful exit/ack alone never proves the requested greeting was sent. */
export function assertAgentFirstRunSatisfied(
  database: DatabaseSync,
  activation: Row,
): void {
  const pending = database
    .prepare(
      `SELECT 1 FROM room_events e JOIN inbox_items i ON i.event_id=e.event_id
    WHERE e.room_id=? AND i.participant_id=? AND e.room_seq BETWEEN ? AND ?
    AND e.type='agent.first_run_requested' AND json_extract(e.payload_json,'$.greetingEnabled')=1
    AND NOT EXISTS (SELECT 1 FROM room_events m WHERE m.room_id=e.room_id AND m.type='message.posted'
      AND m.actor_id=i.participant_id AND m.idempotency_key=json_extract(e.payload_json,'$.messageKey')) LIMIT 1`,
    )
    .get(
      text(activation, "room_id"),
      text(activation, "participant_id"),
      integer(activation, "from_seq"),
      integer(activation, "to_seq"),
    );
  if (pending)
    throw new DeliveryProofError(
      "First-run greeting has not been published; send the requested greeting before completing this Activation",
    );
}
