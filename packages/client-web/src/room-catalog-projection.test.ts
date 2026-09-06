import assert from "node:assert/strict";
import test from "node:test";

import type { RoomListItem, RoomListReadResponse } from "@rah/runtime-protocol";
import { readCompleteRoomCatalog } from "./room-catalog-projection";

const CREATED_AT = "2026-09-06T08:00:00.000Z";

function item(index: number): RoomListItem {
  return {
    room: {
      roomId: `room-${index}`,
      workspaceKey: "workspace-main",
      kind: "channel",
      slug: `room-${index}`,
      name: `Room ${index}`,
      visibility: "private",
      createdAt: CREATED_AT,
    },
    membership: {
      roomId: `room-${index}`,
      principalId: "human-owner",
      role: "owner",
      joinedAt: CREATED_AT,
    },
    latestRoomSeq: index,
    participantCount: 1,
    pendingAttentionCount: 0,
  };
}

test("complete Room catalog follows opaque pages so a deep link beyond 200 is selectable", async () => {
  const pages = [
    { mode: "room_list", items: Array.from({ length: 200 }, (_, index) => item(index + 1)), hasMore: true, roomListCursor: "page-2" },
    { mode: "room_list", items: Array.from({ length: 7 }, (_, index) => item(index + 201)), hasMore: false },
  ] satisfies RoomListReadResponse[];
  const requests: Array<{ cursor?: string; limit?: number }> = [];
  const catalog = await readCompleteRoomCatalog(async (request) => {
    requests.push(request);
    return pages[requests.length - 1]!;
  });
  assert.equal(catalog.length, 207);
  assert.equal(catalog.at(-1)?.room.roomId, "room-207");
  assert.deepEqual(requests, [{ limit: 200 }, { cursor: "page-2", limit: 200 }]);
});

test("complete Room catalog rejects a non-progressing cursor", async () => {
  await assert.rejects(
    readCompleteRoomCatalog(async () => ({
      mode: "room_list",
      items: [],
      hasMore: true,
      roomListCursor: "same",
    })),
    /did not advance/,
  );
});
