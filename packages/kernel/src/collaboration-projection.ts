import type { Room } from "@rah-os/protocol";

import { LEGACY_WORKSPACE_ID } from "./schema.ts";
import { nullableText, text, type Row } from "./sqlite-row.ts";

export function newLegacyRoom(
  roomId: string,
  input: { name: string; slug: string },
  createdAt: string,
): Room {
  const room: Room = {
    createdAt,
    kind: "channel",
    name: input.name.trim(),
    roomId,
    slug: input.slug.trim(),
    workspaceId: LEGACY_WORKSPACE_ID,
  };
  if (room.slug.length === 0 || room.name.length === 0) {
    throw new Error("room slug and name are required");
  }
  return room;
}

export function roomProjectionFromRow(row: Row): Room {
  const archivedAt = nullableText(row, "archived_at");
  return {
    ...(archivedAt === null ? {} : { archivedAt }),
    createdAt: text(row, "created_at"),
    kind: text(row, "kind") as Room["kind"],
    name: text(row, "name"),
    roomId: text(row, "room_id"),
    slug: text(row, "slug"),
    workspaceId: text(row, "workspace_id"),
  };
}
