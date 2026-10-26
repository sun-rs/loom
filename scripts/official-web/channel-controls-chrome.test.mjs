import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
test("channel control retains official settings trigger and overflow dismissal parameters", () => {
  const source = readFileSync(
    "frontends/raft/upstream/raft-web-source/packages/web/src/components/channel/ChannelOverflowMenu.tsx",
    "utf8",
  );
  const local = readFileSync("frontends/raft/loom/ChannelControl.tsx", "utf8");
  for (const fragment of [
    'labelId="message.chatPanel.overflow.open"',
    "icon={<Settings size={22} />}",
  ]) {
    assert.ok(source.includes(fragment));
    assert.ok(local.includes(fragment), fragment);
  }
  // Local authenticated settings uses the already adopted Drawer. Unsaved writes
  // must keep their dismissal barrier; an old OverflowMenuContent is not its owner.
  assert.match(local, /<Drawer\s+open=\{sheet\}/);
  assert.match(local, /swipeDirection="right"/);
  assert.match(
    local,
    /disablePointerDismissal=\{\s*dirty \|\| state !== "idle" \|\| hasUnresolvedIntents\(\)\s*\}/,
  );
  assert.match(
    local,
    /event.reason === "outside-press" \|\| event.reason === "swipe"/,
  );
  assert.doesNotMatch(local, /<DrawerClose/);
});
