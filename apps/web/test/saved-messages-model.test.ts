import assert from "node:assert/strict";
import test from "node:test";

import {
  formatSavedRelativeTime,
  mergeSavedMessages,
  savedContextMenuPosition,
  savedTargetLabel,
} from "../src/saved-messages-model.ts";

test("saved cards use Raft target labels and relative-time spacing", () => {
  assert.equal(savedTargetLabel("direct", "General", "Alice"), "@Alice");
  assert.equal(savedTargetLabel("channel", "General", "Alice"), "#General");
  assert.equal(
    formatSavedRelativeTime(
      "2026-09-02T03:55:00.000Z",
      "zh-CN",
      new Date("2026-09-02T04:00:00.000Z"),
    ),
    "5 分钟前",
  );
});

test("saved pagination remains append-only and context menus stay on screen", () => {
  const one = {
    message: { messageId: "message-one" },
  } as Parameters<typeof mergeSavedMessages>[0][number];
  const two = {
    message: { messageId: "message-two" },
  } as Parameters<typeof mergeSavedMessages>[0][number];
  assert.deepEqual(mergeSavedMessages([one], [one, two, two]), [one, two]);
  assert.deepEqual(savedContextMenuPosition(1270, 710, 1280, 720), {
    x: 1080,
    y: 620,
  });
  assert.deepEqual(savedContextMenuPosition(10, 10, 180, 90), {
    x: 0,
    y: 0,
  });
});
