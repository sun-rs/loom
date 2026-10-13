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
import { canonicalDigest } from "./canonical-digest.ts";

type Context = {
  database: DatabaseSync;
  events: RoomEventWriter;
  now(): Date;
  requireActor(auth: AuthenticatedActorContext): string;
  transaction<T>(fn: () => T): T;
};
/** MVP discards only a drained Side. Never force-kill or mutate its source. */
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
        event.type !== "side.discarded" ||
        event.actorId !== actorId ||
        event.payload.requestDigest !== digest
      )
        throw new IdempotencyConflictError("Side command key already used");
      return {
        side: sideProjection(c.database, input.sideId),
        event,
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
    if (s.discarded_at != null)
      throw new ConflictError("Side already discarded");
    if (
      c.database
        .prepare(
          `SELECT 1 FROM run_attempts WHERE participant_id=? AND state IN ('starting','running','orphaned')
      UNION ALL SELECT 1 FROM runtime_processes WHERE participant_id=? AND state IN ('prepared','active','orphaned')
      UNION ALL SELECT 1 FROM activations WHERE participant_id=? AND state IN ('queued','leased','quarantined')
      UNION ALL SELECT 1 FROM placements WHERE participant_id=? AND state='reserved' LIMIT 1`,
        )
        .get(input.sideId, input.sideId, input.sideId, input.sideId)
    )
      throw new ConflictError(
        "Side has pending or running work; wait for it to finish before discarding",
      );
    assertNoUnresolvedRuntimeCleanup(c.database, input.sideId);
    const now = c.now().toISOString();
    c.database
      .prepare("UPDATE side_sessions SET discarded_at=? WHERE instance_id=?")
      .run(now, input.sideId);
    c.database
      .prepare(
        "UPDATE agent_definitions SET state='disabled',updated_at=? WHERE participant_id=?",
      )
      .run(now, input.sideId);
    const event = c.events.append({
      actorId,
      aggregateId: input.sideId,
      aggregateType: "side",
      roomId,
      idempotencyKey: input.idempotencyKey,
      type: "side.discarded",
      payload: { requestDigest: digest },
    });
    c.database
      .prepare("UPDATE rooms SET archived_at=? WHERE room_id=?")
      .run(now, roomId);
    return {
      side: sideProjection(c.database, input.sideId),
      event,
      deduplicated: false,
    };
  });
}
