import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateChatHistory } from "./generate-chat-history.mjs";
const read = (p) => readFileSync(p, "utf8");
test("history and snapshot thread are reproducible official-source bindings without a second transport", () => {
  for (const [name, source] of Object.entries(generateChatHistory()))
    assert.equal(read("frontends/raft/loom/" + name), source);
  const thread = read("frontends/raft/loom/OfficialThreadPanel.generated.tsx");
  assert.doesNotMatch(
    thread,
    /AuthenticatedThreadPanel|useThreadStore|getSocket|useAuthStore/,
  );
  assert.match(thread, /readOnlyData: ReadOnlyThreadData/);
  assert.match(thread, /loomMentionMap/);
  assert.match(thread, /loomHasNewer \?\? false/);
  assert.match(thread, /\{loomFooter\}/);
  const vite = read("frontends/raft/loom/vite.config.ts");
  assert.doesNotMatch(vite, /adaptTimelineWindow|adaptThreadFooter/);
  assert.doesNotMatch(
    read("frontends/raft/loom/ThreadWorkspace.tsx"),
    /as ComponentType/,
  );
});
test("official keyboard pagination and bounded-window anchors coexist", () => {
  const timeline =
    generateChatHistory()["OfficialMessageTimeline.generated.tsx"];
  assert.match(timeline, /addEventListener\("keydown"/);
  assert.match(timeline, /restoreAnchor\(scroller, survivingAnchor, true\)/);
  assert.match(timeline, /requestOlderFromSentinel/);
});
