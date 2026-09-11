import assert from "node:assert/strict";
import test from "node:test";
import { conversationLayout } from "../src/conversation-layout.ts";

test("Raft uses available content width and orientation, not a 1280px drawer", () => {
  assert.equal(conversationLayout(1200, 900, 304), "split");
  assert.equal(conversationLayout(984, 900, 304), "split");
  assert.equal(conversationLayout(983, 900, 304), "replace");
  assert.equal(conversationLayout(1000, 1200, 304), "replace");
  assert.equal(conversationLayout(1280, 1500, 304), "split");
  assert.equal(conversationLayout(1100, 900, 424), "replace");
  assert.equal(conversationLayout(768, 900, 304), "replace");
  assert.equal(conversationLayout(767, 900, 0), "fullscreen");
});
