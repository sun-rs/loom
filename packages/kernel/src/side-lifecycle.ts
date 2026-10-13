import type { DatabaseSync } from "node:sqlite";
import * as P from "@rah-os/protocol";
import type { AuthenticatedActorContext } from "./auth.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import {
  ConflictError,
  ForbiddenError,
  IdempotencyConflictError,
  StaleContextError,
} from "./errors.ts";
import { sideProjection, sideSession } from "./side-session.ts";
import { assertNoUnresolvedRuntimeCleanup } from "./runtime-process-cleanup.ts";
import { findAgentDeletionBlocker } from "./agent-deletion-diagnostics.ts";
import { canonicalDigest } from "./canonical-digest.ts";

type Context = {
  database: DatabaseSync;
  events: RoomEventWriter;
  now(): Date;
  requireActor(auth: AuthenticatedActorContext): string;
  transaction<T>(fn: () => T): T;
};
/** Durable intent belongs to the Side Room; existing Host disable/cancel owns stopping. */
export function discardSide(
  c: Context,
  auth: AuthenticatedActorContext,
  raw: P.SideDiscardRequest,
): P.SideDiscardResponse {
  const input = P.SideDiscardRequestSchema.parse(raw);
  return c.transaction(() => {
    const actorId = c.requireActor(auth),
      s = sideSession(c.database, input.sideId);
    if (!s || s.owner_id !== actorId)
      throw new ForbiddenError("Side is unavailable to this Human");
    const roomId = String(s.room_id),
      digest = canonicalDigest(input);
    const prior = c.database
      .prepare(
        "SELECT * FROM room_events WHERE room_id=? AND idempotency_key=?",
      )
      .get(roomId, input.idempotencyKey);
    if (prior) {
      const event = c.events.eventFromRow(prior);
      if (
        !["side.discard_requested", "side.discarded"].includes(event.type) ||
        event.actorId !== actorId ||
        event.payload.requestDigest !== digest
      )
        throw new IdempotencyConflictError("Side command key already used");
      const completed =
        event.type === "side.discard_requested"
          ? finishDiscard(c, event)
          : event;
      return {
        side: sideProjection(c.database, input.sideId),
        event: completed ?? event,
        deduplicated: true,
      };
    }
    const head =
      Number(
        c.database
          .prepare("SELECT next_seq FROM rooms WHERE room_id=?")
          .get(roomId)!.next_seq,
      ) - 1;
    if (head !== input.basedOnRoomSeq)
      throw new StaleContextError(input.basedOnRoomSeq, head);
    if (s.discarded_at != null || Number(s.discard_requested) === 1)
      throw new ConflictError("Side is already being discarded or discarded");
    c.database
      .prepare(
        "UPDATE agent_definitions SET state='disabled',updated_at=? WHERE participant_id=?",
      )
      .run(c.now().toISOString(), input.sideId);
    const request = c.events.append({
      actorId,
      aggregateId: input.sideId,
      aggregateType: "side",
      roomId,
      idempotencyKey: input.idempotencyKey,
      type: "side.discard_requested",
      payload: { requestDigest: digest },
    });
    const completed = finishDiscard(c, request);
    return {
      side: sideProjection(c.database, input.sideId),
      event: completed ?? request,
      deduplicated: false,
    };
  });
}

function finishDiscard(
  c: Context,
  request: P.RoomEvent,
): P.RoomEvent | undefined {
  const id = request.aggregateId,
    s = sideSession(c.database, id)!;
  const old = c.database
    .prepare("SELECT * FROM room_events WHERE room_id=? AND idempotency_key=?")
    .get(request.roomId, `${request.eventId}:complete`);
  if (old) return c.events.eventFromRow(old);
  if (s.discarded_at != null) return;
  if (findAgentDeletionBlocker(c.database, id)) return;
  try {
    assertNoUnresolvedRuntimeCleanup(c.database, id);
  } catch (error) {
    if (error instanceof ConflictError) return;
    throw error;
  }
  const now = c.now().toISOString();
  for (const a of c.database
    .prepare(
      "SELECT activation_id FROM activations WHERE participant_id=? AND state IN ('queued','quarantined')",
    )
    .all(id)) {
    const activationId = String(a.activation_id);
    c.database
      .prepare(
        "UPDATE activations SET state='cancelled',lease_owner=NULL,lease_until=NULL,lease_until_ms=NULL,last_error='Side discarded',updated_at=? WHERE activation_id=?",
      )
      .run(now, activationId);
    c.events.append(
      {
        actorId: request.actorId,
        aggregateId: activationId,
        aggregateType: "activation",
        roomId: request.roomId,
        idempotencyKey: `${request.eventId}:cancel:${activationId}`,
        type: "activation.cancelled",
        payload: { activationId, reason: "side_discarded", sideId: id },
      },
      request,
    );
  }
  c.database
    .prepare("UPDATE side_sessions SET discarded_at=? WHERE instance_id=?")
    .run(now, id);
  const event = c.events.append(
    {
      actorId: request.actorId,
      aggregateId: id,
      aggregateType: "side",
      roomId: request.roomId,
      idempotencyKey: `${request.eventId}:complete`,
      type: "side.discarded",
      payload: { requestDigest: request.payload.requestDigest },
    },
    request,
  );
  c.database
    .prepare("UPDATE rooms SET archived_at=? WHERE room_id=?")
    .run(now, request.roomId);
  return event;
}
/** Reconstructed from the ledger on every cadence and restart; no second queue. */
export function reconcileSideDiscards(c: Context): number {
  let completed = 0;
  const rows = c.database
    .prepare(
      "SELECT e.* FROM room_events e JOIN side_sessions s ON s.instance_id=e.aggregate_id AND s.room_id=e.room_id WHERE e.type='side.discard_requested' AND s.discarded_at IS NULL ORDER BY e.created_at LIMIT 50",
    )
    .all();
  for (const row of rows)
    if (c.transaction(() => finishDiscard(c, c.events.eventFromRow(row))))
      completed++;
  return completed;
}
