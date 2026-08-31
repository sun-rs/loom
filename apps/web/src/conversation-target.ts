import type { Room } from "@rah-os/protocol";

export function conversationTarget(
  room: Pick<Room, "kind" | "name"> | undefined,
): string {
  if (room === undefined) return "#room";
  return `${room.kind === "direct" ? "@" : "#"}${room.name}`;
}
