import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
test("channel control retains official settings trigger and overflow dismissal parameters", () => {
  const source = readFileSync(
    "frontends/raft/packages/web/src/components/channel/ChannelOverflowMenu.tsx",
    "utf8",
  );
  const local = readFileSync("frontends/raft/loom/ChannelControl.tsx", "utf8");
  for (const fragment of [
    'labelId="message.chatPanel.overflow.open"',
    "icon={<Settings size={14} />}",
    'descriptionId="message.chatPanel.overflow.open"',
    'closeLabelId="message.chatPanel.overflow.close"',
    "hideDesktopClose",
  ]) {
    assert.ok(source.includes(fragment));
    assert.ok(local.includes(fragment), fragment);
  }
});
