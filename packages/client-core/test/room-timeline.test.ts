import assert from "node:assert/strict";
import test from "node:test";
import { FakeRahClient } from "@rah-os/client-sdk";
import { RoomTimelineSession } from "../src/index.ts";

const notice = (n: number, roomId = "r") => ({
  kind: "notice" as const,
  notice: {
    eventId: `e${n}`,
    roomId,
    roomSeq: n,
    createdAt: "2026-10-15T00:00:00Z",
    type: "room.unarchived" as const,
    text: "频道已恢复",
  },
});
test("timeline owner recovers bounded notice-only history, preserves IDs and rejects cross-room or cursor lies", async () => {
  let bad = false;
  const calls: any[] = [];
  const client = new FakeRahClient(async (op, input: any) => {
    assert.equal(op, "room.timeline");
    calls.push(input);
    const n = input.beforeSeq ? 1 : input.afterSeq ? 3 : 2;
    return {
      items: [notice(n, bad ? "other" : "r")],
      cursorBefore: n,
      cursorAfter: n,
      hasMoreBefore: n > 1,
      hasMoreAfter: false,
    };
  });
  const session = new RoomTimelineSession(client, "r");
  await session.syncUntilCurrent({ limit: 1, maxPages: 1 });
  await session.loadEarlier({ limit: 1 });
  await session.syncUntilCurrent({ limit: 1, maxPages: 1 });
  assert.deepEqual(
    session.state.items.map((i) => i.kind === "notice" && i.notice.eventId),
    ["e1", "e2", "e3"],
  );
  assert.deepEqual(
    calls.map((i) => [i.beforeSeq, i.afterSeq]),
    [
      [undefined, undefined],
      [2, undefined],
      [undefined, 2],
    ],
  );
  bad = true;
  await assert.rejects(
    new RoomTimelineSession(client, "r").syncUntilCurrent(),
    /Room/,
  );
  const lying = new RoomTimelineSession(
    new FakeRahClient(async () => ({
      items: [notice(1)],
      cursorBefore: 0,
      cursorAfter: 2,
      hasMoreBefore: false,
      hasMoreAfter: false,
    })),
    "r",
  );
  await assert.rejects(lying.syncUntilCurrent(), /cursor/);
});
