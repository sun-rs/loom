import type { Room } from "@rah-os/protocol";
export type DiagnosticTarget = { roomId: string; messageId?: string };
export type DiagnosticRoom = Pick<Room, "roomId" | "slug" | "name" | "kind"> & {
  peerHandle?: string;
};
export function diagnosticReferenceParts(
  text: string,
  rooms: readonly DiagnosticRoom[],
) {
  const result: { text: string; target?: DiagnosticTarget }[] = [];
  // Consume the entire handle/suffix before validating, never link a misleading prefix.
  const expression =
    /(?<![\w/])(?:#([\p{L}\p{N}_-]+)|dm:@([\p{L}\p{N}_.-]+))(?::([a-zA-Z0-9_-]*))?/gu;
  let offset = 0;
  for (const match of text.matchAll(expression)) {
    if (match.index > offset)
      result.push({ text: text.slice(offset, match.index) });
    const name = (match[1] ?? match[2])!.toLocaleLowerCase();
    const candidates = rooms.filter((room) =>
      match[1]
        ? room.kind === "channel" &&
          (room.slug.toLocaleLowerCase() === name ||
            room.name.toLocaleLowerCase() === name)
        : room.kind === "direct" &&
          (room.peerHandle ?? room.name)
            .replace(/^@/, "")
            .toLocaleLowerCase() === name,
    );
    const validSuffix =
      match[3] === undefined ||
      (match[3].length >= 8 && match[3].length <= 160);
    const room =
      validSuffix && candidates.length === 1 ? candidates[0] : undefined;
    result.push({
      text: match[0],
      ...(room
        ? {
            target: {
              roomId: room.roomId,
              ...(match[3] ? { messageId: match[3] } : {}),
            },
          }
        : {}),
    });
    offset = match.index + match[0].length;
  }
  if (offset < text.length) result.push({ text: text.slice(offset) });
  return result;
}
