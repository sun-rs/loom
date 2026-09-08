import type { DatabaseSync } from "node:sqlite";
import { readAgentPresence } from "./agent-presence.ts";
import { readAgentDefinition } from "./workspace-agent-management.ts";
import { text, type Row } from "./sqlite-row.ts";
import type { WorkerVisibleRoomScope } from "./worker-read-targets.ts";

/** Public, content-free projection of the existing lifecycle and presence owners. */
export function workerProfileLifecycle(
  db: DatabaseSync,
  scope: WorkerVisibleRoomScope,
  row: Row,
  definitionId: string | null | undefined,
  now: Date,
) {
  const membership = db
    .prepare(
      "SELECT role,joined_at FROM memberships WHERE room_id=? AND principal_id=?",
    )
    .get(scope.roomId, text(row, "principal_id"))!;
  const record = definitionId
    ? readAgentDefinition(db, definitionId)
    : undefined;
  const presence = record
    ? readAgentPresence(db, { ...record, handle: text(row, "handle") }, now)
    : undefined;
  const tombstone =
    record?.definition.state === "tombstoned"
      ? db
          .prepare(
            "SELECT created_at FROM room_events WHERE room_id=? AND aggregate_id=? AND type='agent.tombstoned' ORDER BY room_seq DESC LIMIT 1",
          )
          .get(record.definition.controlRoomId, definitionId!)
      : undefined;
  return {
    createdAt: record?.definition.createdAt ?? text(row, "created_at"),
    deletedAt: tombstone ? text(tombstone, "created_at") : null,
    membership: {
      scope: "room" as const,
      role: text(membership, "role"),
      joinedAt: text(membership, "joined_at"),
    },
    availability: presence
      ? {
          activity: presence.activity,
          reason: presence.reason,
          ...(presence.activityAt ? { activityAt: presence.activityAt } : {}),
          observedAt: now.toISOString(),
        }
      : null,
  };
}
