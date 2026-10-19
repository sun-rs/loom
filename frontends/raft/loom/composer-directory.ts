import type { Room } from "@rah-os/protocol";
import type { Channel } from "../packages/web/src/store/channelStore.ts";
/** Read-only projection of the existing authorized directory, never an upstream store. */
export function projectComposerChannels(rooms: readonly Room[]): Channel[] {
  const seen = new Set<string>();
  return rooms
    .filter((room) => {
      if (
        room.kind !== "channel" ||
        room.instancePrivateBox ||
        room.side ||
        seen.has(room.roomId)
      )
        return false;
      seen.add(room.roomId);
      return true;
    })
    .map((room) => ({
      id: room.roomId,
      name: room.name,
      description: room.description ?? null,
      type: "channel",
      createdAt: room.createdAt,
      archivedAt: room.archivedAt ?? null,
    }));
}
