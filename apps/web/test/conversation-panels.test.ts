import assert from "node:assert/strict";
import test from "node:test";
import { conversationPanels } from "../src/conversation-panels.ts";

test("two slots retain the clicked source, with newest target alone on narrow screens", () => {
  for (const split of [false, true]) {
    for (const source of ["room", "thread"] as const) {
      const view = conversationPanels({
        thread: true,
        profile: true,
        latest: "profile",
        source,
        split,
      });
      assert.equal(view.profile, true);
      assert.equal(view.room, split && source === "room");
      assert.equal(view.thread, split && source === "thread");
    }
    assert.deepEqual(
      conversationPanels({
        thread: true,
        profile: true,
        latest: "thread",
        source: "room",
        split,
      }),
      { room: split, thread: true, profile: false, source: "room" },
    );
  }
});
test("closing either target restores the retained page; missing thread falls back to Room", () => {
  assert.deepEqual(
    conversationPanels({
      thread: false,
      profile: true,
      latest: "thread",
      source: "thread",
      split: true,
    }),
    { room: true, thread: false, profile: true, source: "room" },
  );
  assert.deepEqual(
    conversationPanels({
      thread: true,
      profile: false,
      latest: "profile",
      source: "thread",
      split: true,
    }),
    { room: true, thread: true, profile: false, source: "thread" },
  );
  assert.deepEqual(
    conversationPanels({
      thread: false,
      profile: false,
      latest: "profile",
      source: "room",
      split: false,
    }),
    { room: true, thread: false, profile: false, source: "room" },
  );
});
