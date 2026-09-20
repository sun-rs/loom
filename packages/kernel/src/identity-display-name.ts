import type { DatabaseSync } from "node:sqlite";
/** Presentation only, after the caller authorizes the containing result. */
export function identityDisplayName(
  db: DatabaseSync,
  principalId: string,
): string | undefined {
  const row = db
    .prepare(
      `SELECT COALESCE(NULLIF(json_extract(rev.definition_json,'$.displayName'),''),NULLIF(p.display_name,''),p.handle) AS name
 FROM principals p LEFT JOIN agent_definitions a ON a.participant_id=p.principal_id
 LEFT JOIN agent_definition_revisions rev ON rev.agent_definition_revision_id=a.current_revision_id WHERE p.principal_id=?`,
    )
    .get(principalId);
  return typeof row?.name === "string" ? row.name : undefined;
}
export function directRoomDisplayName(
  db: DatabaseSync,
  roomId: string,
  viewerId: string,
): string | undefined {
  const row = db
    .prepare(
      `SELECT CASE WHEN left_principal_id=? THEN right_principal_id ELSE left_principal_id END AS peer FROM direct_room_pairs WHERE room_id=? AND (left_principal_id=? OR right_principal_id=?)`,
    )
    .get(viewerId, roomId, viewerId, viewerId);
  return typeof row?.peer === "string"
    ? identityDisplayName(db, row.peer)
    : undefined;
}
