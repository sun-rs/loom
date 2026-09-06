import type {
  RoomListItem,
  RoomListReadRequest,
  RoomListReadResponse,
} from "@rah/runtime-protocol";

import { listRooms } from "./room-api";

export type RoomCatalogPageReader = (
  request: RoomListReadRequest,
  signal?: AbortSignal,
) => Promise<RoomListReadResponse>;

/**
 * Read the complete Room navigation catalog through its opaque cursor. A Room
 * deep link must not become unreachable merely because it sorts after page 1.
 */
export async function readCompleteRoomCatalog(
  readPage: RoomCatalogPageReader = listRooms,
  signal?: AbortSignal,
): Promise<RoomListItem[]> {
  const items: RoomListItem[] = [];
  const roomIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  while (true) {
    const page = await readPage({ ...(cursor ? { cursor } : {}), limit: 200 }, signal);
    for (const item of page.items) {
      if (roomIds.has(item.room.roomId)) {
        throw new Error(`Room catalog repeated Room ${item.room.roomId}`);
      }
      roomIds.add(item.room.roomId);
      items.push(item);
    }
    if (!page.hasMore) return items;
    const nextCursor = page.roomListCursor;
    if (!nextCursor || nextCursor === cursor || seenCursors.has(nextCursor)) {
      throw new Error("Room catalog cursor did not advance");
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
}
