import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("channel delete binds existing versioned intent and native confirmation, never a second endpoint", () => {
  const source = readFileSync(
    "frontends/raft/loom/ChannelDeleteAction.tsx",
    "utf8",
  );
  assert.match(source, /OfficialConfirmation.generated/);
  assert.match(source, /submitRevisioned/);
  assert.match(source, /request\("room.delete"/);
  assert.match(source, /basedOnRoomSeq: basis/);
  assert.match(source, /syncUntilCurrent/);
  assert.doesNotMatch(source, /eligibility/);
  assert.match(source, /私密会话/);
  assert.doesNotMatch(source, /room.slug === "all"/);
  assert.doesNotMatch(source, /fetch\(/);
});
test("only the channels section exposes the inline create-channel control", () => {
  const source = readFileSync("frontends/raft/loom/ChannelSidebar.tsx", "utf8");
  assert.match(
    source,
    /group\.id === "channels" && \(\s*<Tooltip content="新建频道">/,
  );
});
test("empty workspace keeps the channel creation section even on mobile", () => {
  const source=readFileSync('frontends/raft/loom/ChannelSidebar.tsx','utf8');
  assert.match(source,/g\.id === "channels" \|\|\s*!shouldHideEmptySidebarSection/);
});
