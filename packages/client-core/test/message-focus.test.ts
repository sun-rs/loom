import test from "node:test";
import assert from "node:assert/strict";
import { FakeRahClient } from "@rah-os/client-sdk";
import { MessageSession, RoomTimelineSession } from "../src/index.ts";
for (const threaded of [false, true])
  test(`bounded focus preserves target and rejects wrong scope (${threaded})`, async () => {
    const calls: any[] = [];
    let wrong = false;
    const message = {
      messageId: "old",
      roomId: "r",
      roomSeq: 20,
      actorId: "h",
      body: "old",
      createdAt: "2026-10-15T00:00:00Z",
      ...(threaded ? { threadId: "t" } : {}),
    };
    const client = new FakeRahClient(async (op, input: any) => {
      calls.push([op, input]);
      if (op === "message.context")
        return {
          message: { ...message, roomId: wrong ? "elsewhere" : "r" },
          messages: [],
        };
      const n = input.afterSeq ? 21 : 20;
      const item = {
        ...message,
        roomSeq: n,
        messageId: n === 20 ? "old" : "next",
      };
      const page = {
        cursorBefore: n,
        cursorAfter: n,
        hasMoreBefore: true,
        hasMoreAfter: true,
      };
      if (op === "room.timeline")
        return { ...page, items: [{ kind: "message", message: item }] };
      if (op === "message.list") return { ...page, messages: [item] };
      throw Error(op);
    });
    const session = threaded
      ? new MessageSession({ client, roomId: "r", threadId: "t" })
      : new RoomTimelineSession(client, "r");
    await session.focus("old");
    assert.equal(session.state.cursorAfter, 21);
    assert.equal(session.state.complete, false);
    assert.equal(calls.length, 3);
    assert.equal(calls[1][1].beforeSeq, 21);
    assert.equal(calls[1][1].limit, 50);
    const before = session.state;
    wrong = true;
    await assert.rejects(session.focus("old"), /scope/);
    assert.deepEqual(session.state, before);
  });
