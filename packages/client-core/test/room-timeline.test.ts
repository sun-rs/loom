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

test("history window stays bounded in both directions and background refresh never refills a detached tail", async () => {
  const calls: any[] = [];
  const total = 50000;
  const client = new FakeRahClient(async (op, input: any) => {
    assert.equal(op, "room.timeline");
    calls.push(input);
    const start = input.beforeSeq
      ? Math.max(1, input.beforeSeq - input.limit)
      : input.afterSeq
        ? input.afterSeq + 1
        : total - input.limit + 1;
    const end = Math.min(
      total,
      input.beforeSeq ? input.beforeSeq - 1 : start + input.limit - 1,
    );
    const items = Array.from({ length: Math.max(0, end - start + 1) }, (_, i) =>
      notice(start + i),
    );
    return {
      items,
      cursorBefore: items.length
        ? start
        : (input.afterSeq ?? input.beforeSeq ?? 0),
      cursorAfter: items.length
        ? end
        : (input.afterSeq ?? input.beforeSeq ?? 0),
      hasMoreBefore: start > 1,
      hasMoreAfter: end < total,
    };
  });
  const session = new RoomTimelineSession(client, "r");
  await session.syncUntilCurrent({ limit: 50 });
  for (let i = 0; i < 20; i++) await session.loadEarlier({ limit: 50 });
  assert.ok(session.state.items.length <= 300);
  assert.equal(session.state.complete, false);
  const historical = session.state.items.map(
    (i) => i.kind === "notice" && i.notice.eventId,
  );
  const count = calls.length;
  await session.refresh({ latestRoomSeq: 50001 });
  assert.equal(calls.length, count);
  assert.deepEqual(
    session.state.items.map((i) => i.kind === "notice" && i.notice.eventId),
    historical,
  );
  const boundary = session.state.cursorAfter;
  await session.syncUntilCurrent({ limit: 50, maxPages: 1 });
  assert.equal(calls.at(-1).afterSeq, boundary);
  assert.ok(session.state.items.length <= 300);
  assert.equal(session.state.cursorAfter, boundary + 50);
  assert.equal(session.state.hasEarlier, true);
});

test("paused reading stays in place on new activity; live follow resumes without acknowledging anything", async () => {
  let total = 50,
    calls = 0;
  const client = new FakeRahClient(async (op, input: any) => {
    assert.equal(op, "room.timeline");
    calls++;
    const start = input.afterSeq ? input.afterSeq + 1 : Math.max(1, total - 49);
    const items = Array.from(
      { length: Math.max(0, total - start + 1) },
      (_, i) => notice(start + i),
    );
    return {
      items,
      cursorBefore: items.length ? start : (input.afterSeq ?? 0),
      cursorAfter: items.length ? total : (input.afterSeq ?? 0),
      hasMoreBefore: start > 1,
      hasMoreAfter: false,
    };
  });
  const s = new RoomTimelineSession(client, "r");
  await s.refresh({ latestRoomSeq: 50 });
  s.setFollowingLatest(false);
  total = 51;
  await s.refresh({ latestRoomSeq: 51 });
  assert.equal(calls, 1);
  assert.equal(s.state.cursorAfter, 50);
  assert.equal(s.state.complete, false);
  s.setFollowingLatest(true);
  await s.refresh({ latestRoomSeq: 51 });
  assert.equal(calls, 2);
  assert.equal(s.state.cursorAfter, 51);
  assert.equal(s.state.complete, true);
});

test("timeline has a retained byte budget as well as an item budget", async () => {
  const items = Array.from({ length: 50 }, (_, i) => ({
    ...notice(i + 1),
    notice: { ...notice(i + 1).notice, text: "x".repeat(100000) },
  }));
  const s = new RoomTimelineSession(
    new FakeRahClient(async () => ({
      items,
      cursorBefore: 1,
      cursorAfter: 50,
      hasMoreBefore: false,
      hasMoreAfter: false,
    })),
    "r",
  );
  await s.syncUntilCurrent();
  assert.ok(JSON.stringify(s.state.items).length <= 2 * 1024 * 1024);
  assert.equal(s.state.cursorAfter, 50);
  assert.equal(s.state.hasEarlier, true);
});

test("large prepended pages retain the previous reading boundary instead of skipping it", async () => {
  const c = new FakeRahClient(async (_op, input: any) => {
    const first = input.beforeSeq ? input.beforeSeq - 50 : 51,
      last = input.beforeSeq ? input.beforeSeq - 1 : 100;
    const items = Array.from({ length: 50 }, (_, i) => ({
      ...notice(first + i),
      notice: { ...notice(first + i).notice, text: "x".repeat(100000) },
    }));
    return {
      items,
      cursorBefore: first,
      cursorAfter: last,
      hasMoreBefore: first > 1,
      hasMoreAfter: last < 100,
    };
  });
  const s = new RoomTimelineSession(c, "r");
  await s.syncUntilCurrent();
  const anchor = s.state.cursorBefore;
  await s.loadEarlier();
  assert.ok(
    s.state.items.some(
      (i) => i.kind === "notice" && i.notice.roomSeq === anchor,
    ),
  );
});

test("an aborted response cannot replace retained timeline state", async () => {
  const abort = new AbortController();
  const c = new FakeRahClient(async () => {
    abort.abort();
    return {
      items: [notice(1)],
      cursorBefore: 1,
      cursorAfter: 1,
      hasMoreBefore: false,
      hasMoreAfter: false,
    };
  });
  const s = new RoomTimelineSession(c, "r");
  await assert.rejects(s.syncUntilCurrent({ signal: abort.signal }));
  assert.equal(s.state.items.length, 0);
});
