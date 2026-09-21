import assert from "node:assert/strict";
import test from "node:test";
import { conversationLayout } from "../src/conversation-layout.ts";

test("available width alone controls folding, regardless of height or PWA keyboard", () => {
  assert.equal(conversationLayout(1200, 900, 304), "split");
  assert.equal(conversationLayout(984, 900, 304), "split");
  assert.equal(conversationLayout(983, 900, 304), "replace");
  assert.equal(conversationLayout(1000, 1200, 304), "split");
  assert.equal(conversationLayout(1280, 1500, 304), "split");
  assert.equal(conversationLayout(1100, 900, 424), "replace");
  assert.equal(conversationLayout(768, 900, 304), "replace");
  assert.equal(conversationLayout(767, 900, 0), "fullscreen");
});

test("profile preserves 320px body with its own 300px minimum; thread retains 360px", () => {
  assert.equal(conversationLayout(1004, 900, 384, "profile"), "split");
  assert.equal(conversationLayout(1003, 900, 384, "profile"), "replace");
  assert.equal(conversationLayout(1004, 900, 384, "thread"), "replace");
});
