import type { Room } from "@rah-os/protocol";
export function channelMetadataPayload(
  room: Room,
  basis: number,
  name: string,
  description: string,
) {
  return {
    roomId: room.roomId,
    basedOnRoomSeq: basis,
    name: name.trim(),
    description: description.trim(),
    visibility: room.visibility ?? "private",
  };
}
