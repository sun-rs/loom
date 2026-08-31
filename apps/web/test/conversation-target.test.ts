import assert from "node:assert/strict";
import test from "node:test";

import { conversationTarget } from "../src/conversation-target.ts";

test("direct Rooms use the Raft @ target while channels use #", () => {
  assert.equal(conversationTarget({ kind: "direct", name: "Alice" }), "@Alice");
  assert.equal(
    conversationTarget({ kind: "channel", name: "Agent Council" }),
    "#Agent Council",
  );
  assert.equal(conversationTarget(undefined), "#room");
});
