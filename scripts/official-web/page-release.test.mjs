import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync("frontends/raft/" + p, "utf8");
test("desktop notification is hosted by the top bar, not duplicated in the rail", () => {
  assert.match(
    read("loom/TopBar.tsx"),
    /<SystemNotifications flavor="top-bar"/,
  );
  assert.doesNotMatch(read("loom/Navigation.tsx"), /<SystemNotifications/);
  const trigger = read(
    "packages/web/src/components/layout/NotificationTrigger.tsx",
  );
  assert.match(trigger, /notification-trigger-top-bar/);
  assert.match(trigger, /size-9/);
  assert.match(
    read("packages/web/src/components/layout/NotificationCenter.tsx"),
    /"top-bar"/,
  );
});
test("conversation and role tab strips retain official default selected recipe and wrapper", () => {
  for (const file of ["ChannelTabs.tsx", "RoleWorkspace.tsx"]) {
    const source = read("loom/" + file);
    assert.doesNotMatch(source, /variant="underline"/);
    assert.match(source, /<ConversationPanelTabs/);
  }
});
test("single workspace identity uses native subhead typography without a disabled switcher", () => {
  const source = read("loom/TopBar.tsx");
  assert.match(source, /text-subhead font-bold/);
  assert.doesNotMatch(source, /AvatarSlot|\bdisabled\b/);
});
