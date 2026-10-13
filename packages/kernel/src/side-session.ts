import type { DatabaseSync } from "node:sqlite";
import type { ActivationCredentialScope } from "@rah-os/protocol";
import { ForbiddenError } from "./errors.ts";

/** Kernel-owned provenance/read grant; execution still uses the ordinary Room lane. */
export const SIDE_SESSION_SCHEMA = `
CREATE TABLE IF NOT EXISTS side_sessions (
 instance_id TEXT PRIMARY KEY REFERENCES role_instances(instance_id),
 room_id TEXT NOT NULL UNIQUE REFERENCES rooms(room_id),
 source_instance_id TEXT NOT NULL REFERENCES role_instances(instance_id),
 source_channel_id TEXT NOT NULL REFERENCES rooms(room_id),
 owner_id TEXT NOT NULL REFERENCES principals(principal_id),
 discarded_at TEXT
) STRICT;
`;
export function sideSession(db: DatabaseSync, instanceId: string) {
  return db
    .prepare(
      "SELECT s.*,i.agent_id FROM side_sessions s JOIN role_instances i ON i.instance_id=s.instance_id WHERE s.instance_id=?",
    )
    .get(instanceId);
}
export function sideProjection(db: DatabaseSync, instanceId: string) {
  const s = sideSession(db, instanceId)!;
  return {
    instanceId,
    agentId: String(s.agent_id),
    roomId: String(s.room_id),
    sourceInstanceId: String(s.source_instance_id),
    sourceChannelId: String(s.source_channel_id),
    state:
      s.discarded_at == null ? ("active" as const) : ("discarded" as const),
  };
}
/** Default-deny for Worker capabilities. Explicit conversation paths opt in. */
export function requireSideCapability(
  db: DatabaseSync,
  scope: ActivationCredentialScope,
  conversation = false,
) {
  const side = sideSession(db, scope.participantId);
  if (!side) return;
  if (side.discarded_at != null || side.room_id !== scope.roomId)
    throw new ForbiddenError(
      "Side conversation has been discarded or is outside this execution",
    );
  if (!conversation)
    throw new ForbiddenError(
      "Side allows only its own conversation and read-only source access",
    );
}
export function sideReadGrant(db: DatabaseSync, instanceId: string) {
  const side = sideSession(db, instanceId);
  if (!side) return;
  if (
    side.discarded_at != null ||
    !db
      .prepare(
        `SELECT 1 FROM rooms r
    JOIN memberships source ON source.room_id=r.room_id AND source.principal_id=?
    JOIN memberships human ON human.room_id=r.room_id AND human.principal_id=?
    WHERE r.room_id=? AND r.archived_at IS NULL`,
      )
      .get(side.source_instance_id!, side.owner_id!, side.source_channel_id!)
  )
    throw new ForbiddenError(
      "Side source read permission is no longer available",
    );
  return side;
}

/** Only history reads opt into this grant; writable target resolution never does. */
export function sideHistoryTarget(
  db: DatabaseSync,
  scope: ActivationCredentialScope,
  channel: string | undefined,
): { participantId: string; roomId: string; threadId?: string } | undefined {
  if (!channel) return;
  const s = sideSession(db, scope.participantId);
  if (!s) return;
  const source = db
    .prepare("SELECT slug FROM rooms WHERE room_id=?")
    .get(s.source_channel_id!);
  if (channel !== s.source_channel_id && channel !== `#${source?.slug}`) return;
  sideReadGrant(db, scope.participantId);
  return {
    participantId: scope.participantId,
    roomId: String(s.source_channel_id),
  };
}
