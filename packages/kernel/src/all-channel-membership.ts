import type { DatabaseSync } from "node:sqlite";
import type { RoomEventWriter } from "./room-event-writer.ts";
import { integer, text } from "./sqlite-row.ts";

/** Called inside the owner's transaction. Permanent membership is derived from
 * Workspace Agent identities; existing delivery cursors and history stay intact. */
export function reconcileAllChannelMemberships(
  database: DatabaseSync,
  events: RoomEventWriter,
  now: Date,
): void {
  const missing = database
    .prepare(
      `SELECT r.room_id, r.next_seq, a.participant_id
    FROM rooms r JOIN rooms c ON c.workspace_id=r.workspace_id AND c.kind='control'
    JOIN agent_definitions a ON a.control_room_id=c.room_id AND a.state<>'tombstoned'
    WHERE r.kind='channel' AND r.slug='all'
    AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.room_id=r.room_id AND m.principal_id=a.participant_id)
    ORDER BY r.room_id,a.participant_id`,
    )
    .all();
  for (const row of missing) {
    const roomId = text(row, "room_id"),
      participantId = text(row, "participant_id");
    database
      .prepare(
        "INSERT INTO memberships(room_id,principal_id,role,joined_at) VALUES(?,?,'member',?)",
      )
      .run(roomId, participantId, now.toISOString());
    events.append({
      actorId: "principal_system",
      aggregateId: participantId,
      aggregateType: "membership",
      roomId,
      idempotencyKey: `all:auto-member:${participantId}:${integer(row, "next_seq")}`,
      type: "membership.added",
      payload: { participantId, role: "member" },
    });
  }
}
