import type { DatabaseSync } from "node:sqlite";
import { ConflictError } from "./errors.ts";
import { text } from "./sqlite-row.ts";
/** One deletion graph: channel members, their private boxes and read-only side sessions. */
export function channelDeletionScope(db: DatabaseSync, roomId: string) {
  const instances = db
    .prepare(
      `SELECT instance_id,agent_id FROM role_instances WHERE channel_id=? OR instance_id IN (SELECT instance_id FROM side_sessions WHERE source_channel_id=?)`,
    )
    .all(roomId, roomId);
  const ids = instances.map((x) => text(x, "instance_id"));
  const rooms = new Set([roomId]);
  for (const id of ids) {
    for (const r of db
      .prepare(
        `SELECT p.room_id FROM direct_room_pairs p WHERE left_principal_id=? OR right_principal_id=? UNION SELECT room_id FROM side_sessions WHERE instance_id=?`,
      )
      .all(id, id, id))
      rooms.add(text(r, "room_id"));
    if (
      db
        .prepare(
          `SELECT 1 FROM memberships m JOIN rooms r ON r.room_id=m.room_id WHERE m.principal_id=? AND r.kind='channel' AND r.room_id<>?`,
        )
        .get(id, roomId)
    )
      throw new ConflictError(
        "Instance has membership outside the deletion channel",
      );
  }
  for (const r of rooms) {
    if (r === roomId) continue;
    for (const m of db
      .prepare(
        `SELECT m.principal_id FROM memberships m JOIN principals p ON p.principal_id=m.principal_id WHERE m.room_id=? AND p.kind<>'human'`,
      )
      .all(r))
      if (!ids.includes(text(m, "principal_id")))
        throw new ConflictError(
          "Private deletion scope includes an unrelated instance",
        );
  }
  return {
    instances: instances.map((x) => ({
      instanceId: text(x, "instance_id"),
      agentId: text(x, "agent_id"),
    })),
    roomIds: [...rooms],
  };
}
export type ChannelDeletionScope = ReturnType<typeof channelDeletionScope>;
