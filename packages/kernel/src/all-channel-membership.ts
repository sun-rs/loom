import type { DatabaseSync } from "node:sqlite";
import type { RoomEventWriter } from "./room-event-writer.ts";
import { integer, nullableText, text } from "./sqlite-row.ts";

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

/** Read-only identity snapshot of a Room that is, or blocks, the canonical #all. */
export type AllChannelCandidateSnapshot = {
  archivedAt: string | undefined;
  createdAt: string;
  description: string | undefined;
  eventCount: number;
  humanMemberPrincipalIds: string[];
  kind: string;
  lastEventAt: string | undefined;
  latestRoomSeq: number;
  memberCount: number;
  name: string;
  roomId: string;
  slug: string;
  systemHidden: boolean;
  visibility: string;
  workspaceId: string;
};

/** Upgrade precheck. Membership-scoped listings cannot see a legacy private or
 * renamed #all, so bootstrap must read Workspace-wide identity before it writes.
 * This function never mutates: it only reports what an operator has to decide. */
export function readAllChannelCandidates(
  database: DatabaseSync,
  workspaceId: string,
): AllChannelCandidateSnapshot[] {
  const rows = database
    .prepare(
      `SELECT r.room_id, r.workspace_id, r.kind, r.slug, r.name, r.description,
              r.visibility, r.next_seq, r.created_at, r.archived_at, r.system_hidden,
              (SELECT COUNT(*) FROM memberships m WHERE m.room_id = r.room_id)
                AS member_count,
              (SELECT COUNT(*) FROM room_events e WHERE e.room_id = r.room_id)
                AS event_count,
              (SELECT MAX(e.created_at) FROM room_events e WHERE e.room_id = r.room_id)
                AS last_event_at
       FROM rooms r
       WHERE r.workspace_id = ? AND (r.slug = 'all' OR r.name = 'all')
       ORDER BY r.slug <> 'all', r.created_at, r.room_id`,
    )
    .all(workspaceId);
  const humans = database.prepare(
    `SELECT m.principal_id FROM memberships m
     JOIN principals p ON p.principal_id = m.principal_id AND p.kind = 'human'
     WHERE m.room_id = ? ORDER BY m.principal_id`,
  );
  return rows.map((row) => {
    const roomId = text(row, "room_id");
    return {
      archivedAt: nullableText(row, "archived_at") ?? undefined,
      createdAt: text(row, "created_at"),
      description: nullableText(row, "description") ?? undefined,
      eventCount: integer(row, "event_count"),
      humanMemberPrincipalIds: humans
        .all(roomId)
        .map((member) => text(member, "principal_id")),
      kind: text(row, "kind"),
      lastEventAt: nullableText(row, "last_event_at") ?? undefined,
      latestRoomSeq: integer(row, "next_seq") - 1,
      memberCount: integer(row, "member_count"),
      name: text(row, "name"),
      roomId,
      slug: text(row, "slug"),
      systemHidden: integer(row, "system_hidden") === 1,
      visibility: text(row, "visibility"),
      workspaceId: text(row, "workspace_id"),
    };
  });
}
