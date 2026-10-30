import test from "node:test";
import assert from "node:assert/strict";
import { NativeReadBridge } from "../../frontends/raft/adapter123/read-bridge.ts";

function fixture() {
  const calls: any[] = [];
  const bridge = new NativeReadBridge({
    request: async (op: string, input: any) => {
      calls.push([op, input]);
      if (op === "room.member.list")
        return { memberships: [{ principalId: "human" }] };
      if (op !== "room.timeline") throw Error("unexpected " + op);
      return {
        items: [
          {
            kind: "message",
            message: {
              messageId: "m17",
              roomId: input.roomId,
              roomSeq: 17,
              actorId: "human",
              body: "canonical",
              createdAt: "2026-10-30T00:00:00Z",
            },
          },
        ],
        hasMoreBefore: true,
        hasMoreAfter: false,
        cursorBefore: 17,
        cursorAfter: 17,
      };
    },
  } as any);
  bridge.identity = async () => ({
    workspace: { workspaceId: "w" },
    user: { id: "human" },
    server: { id: "w" },
  });
  bridge.channel = (() => ({
    room: {
      syncUntilCurrent: async () => {},
      state: {
        snapshot: {
          members: [{ principalId: "human", handle: "Sun", kind: "human" }],
        },
      },
    },
  })) as any;
  return { bridge, calls };
}
test("native history paging maps before/after only within the requested Room and stays bounded", async () => {
  const { bridge, calls } = fixture();
  const older = await bridge.read(
    "/messages/channel/room-A?before=80&limit=5000",
  );
  assert.deepEqual(calls.filter(([op]) => op === "room.timeline")[0], [
    "room.timeline",
    { roomId: "room-A", beforeSeq: 80, limit: 200 },
  ]);
  assert.equal(older.messages[0].id, "m17");
  assert.equal(older.hasMore, true);
  await bridge.read("/messages/channel/room-B", { after: 7, limit: 25 });
  assert.deepEqual(calls.filter(([op]) => op === "room.timeline")[1], [
    "room.timeline",
    { roomId: "room-B", afterSeq: 7, limit: 25 },
  ]);
  assert.deepEqual(
    calls
      .filter(([op]) => op === "room.member.list")
      .map(([, input]) => input.roomId),
    ["room-A", "room-B"],
  );
  await assert.rejects(
    () => bridge.read("/messages/channel/room-A?before=9&after=4"),
    /either|同时|方向/,
  );
});
test("native sync cannot treat independent Room sequences as a global stream", async () => {
  const { bridge, calls } = fixture();
  await assert.rejects(
    () => bridge.read("/messages/sync?since_seq=12"),
    /channel|频道/,
  );
  assert.equal(calls.length, 0);
  const messages = await bridge.read(
    "/messages/sync?channel_id=room-B&since_seq=12&limit=100",
  );
  assert.deepEqual(calls.filter(([op]) => op === "room.timeline")[0], [
    "room.timeline",
    { roomId: "room-B", afterSeq: 12, limit: 100 },
  ]);
  assert.equal(messages[0].channelId, "room-B");
});
