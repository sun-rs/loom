import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
test("sender extension uses existing branch owner and private callback outside menu lifetime", () => {
  const host = readFileSync("frontends/raft/loom/SenderActions.tsx", "utf8");
  assert.ok(host.includes("useInstanceBranches("));
  assert.ok(host.includes("onOpenPrivate(id)"));
  assert.ok(host.includes("hasUnresolvedIntents()"));
  assert.ok(host.includes("instance.channelId !== room.roomId"));
  assert.ok(!host.includes('"role.fork"'));
  const item = readFileSync(
    "frontends/raft/loom/OfficialMessageItem.generated.tsx",
    "utf8",
  );
  assert.ok(item.includes("<SenderActionItems"));
});
test("message more button reuses the existing context-menu owner", () => {
  const toolbar = readFileSync(
    "frontends/raft/loom/OfficialMessageHoverToolbar.generated.tsx",
    "utf8",
  );
  assert.ok(toolbar.includes('data-message-affordance="more"'));
  const item = readFileSync(
    "frontends/raft/loom/OfficialMessageItem.generated.tsx",
    "utf8",
  );
  assert.ok(item.includes("onMoreMenu={handleContextMenu}"));
});
test("navigation fallback cannot send users to the retired console", () => {
  const source = readFileSync("frontends/raft/loom/Navigation.tsx", "utf8");
  assert.ok(!source.includes("/_rah/console/"));
});
