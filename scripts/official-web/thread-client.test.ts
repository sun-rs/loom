import test from "node:test";
import assert from "node:assert/strict";
import { LoomThreadClient } from "../../frontends/raft/loom/thread-client.ts";
const root = {
  messageId: "root",
  roomId: "room",
  roomSeq: 1,
  actorId: "human",
  body: "parent",
  createdAt: "2026-10-15T00:00:00Z",
};
function fixture() {
  const calls: any[] = [];
  let threads: any[] = [];
  let lostCreate = true,
    lostReply = true;
  const client = {
    request: async (op: string, input: any) => {
      calls.push([op, input]);
      if (op === "message.context") return { message: root, messages: [] };
      if (op === "thread.list") return { threads };
      if (op === "room.sync" && input.afterSeq)
        return {
          cursorBefore: 1,
          cursorAfter: 1,
          latestRoomSeq: 1,
          events: [],
          snapshot: null,
        };
      if (op === "room.sync")
        return {
          cursorBefore: 1,
          cursorAfter: 1,
          latestRoomSeq: 1,
          eventFloorSeq: 1,
          snapshotSeq: 1,
          events: [],
          snapshot: {
            room: {
              roomId: "room",
              workspaceId: "w",
              kind: "channel",
              name: "Room",
              slug: "room",
              createdAt: root.createdAt,
            },
            members: [],
          },
        };
      if (op === "room.acknowledge") return { acknowledgedThrough: 1 };
      if (op === "thread.create") {
        threads = [
          {
            threadId: "thread",
            rootMessageId: "root",
            roomId: "room",
            replyCount: 0,
          },
        ];
        if (lostCreate) {
          lostCreate = false;
          throw Error("lost create");
        }
        return { thread: threads[0] };
      }
      if (op === "thread.reply") {
        if (lostReply) {
          lostReply = false;
          throw Error("lost reply");
        }
        return {
          message: {
            ...root,
            messageId: "reply",
            threadId: "thread",
            roomSeq: 2,
            body: input.body,
          },
        };
      }
      if (op === "message.list")
        return {
          messages: [],
          cursorBefore: 0,
          cursorAfter: 0,
          hasMoreBefore: false,
          hasMoreAfter: false,
        };
      throw Error(op);
    },
  };
  return { calls, client };
}
test("opening is read-only, first reply verifies each exact intent without losing the original body", async () => {
  const f = fixture();
  const b = new LoomThreadClient(f.client as any, "room", "root");
  await b.refresh();
  assert.equal(
    f.calls.some(([op]) => op === "thread.create"),
    false,
  );
  let settled = false;
  const send = b.send("original reply").then(() => (settled = true));
  for (let n = 0; n < 30 && b.writes.state !== "unknown"; n++)
    await new Promise((r) => setTimeout(r, 1));
  assert.equal(b.writes.state, "unknown");
  assert.equal(settled, false);
  assert.equal(f.calls.filter(([op]) => op === "thread.reply").length, 0);
  await b.writes.retry();
  for (let n = 0; n < 30 && b.writes.state !== "unknown"; n++)
    await new Promise((r) => setTimeout(r, 1));
  assert.equal(b.writes.state, "unknown");
  assert.equal(settled, false);
  await b.writes.retry();
  await send;
  for (const op of ["thread.create", "thread.reply"]) {
    const req = f.calls.filter(([o]) => o === op);
    assert.equal(req.length, 2);
    assert.deepEqual(req[0], req[1]);
  }
  assert.equal(
    f.calls.find(([op]) => op === "thread.reply")[1].body,
    "original reply",
  );
});
test("foreign parent context is rejected before any thread mutation", async () => {
  const f = fixture();
  const original = f.client.request;
  f.client.request = async (op, input) =>
    op === "message.context"
      ? { message: { ...root, roomId: "foreign" }, messages: [] }
      : original(op, input);
  const b = new LoomThreadClient(f.client as any, "room", "root");
  await assert.rejects(b.refresh(), /对话/);
  assert.equal(
    f.calls.some(([op]) => op === "thread.create"),
    false,
  );
});
