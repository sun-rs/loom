import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("private box uses durable parent channel for both native back and close", () => {
  const s = readFileSync("frontends/raft/loom/ChannelApp.tsx", "utf8");
  assert.match(s, /selected\.instancePrivateBox\?\.channelId/);
  assert.match(s, /aria-label="关闭频道内私聊"/);
  assert.match(s, /isPrivate \|\| channel\.side/);
});
