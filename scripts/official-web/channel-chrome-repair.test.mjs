import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) =>
  readFileSync(
    new URL("../../frontends/raft/loom/" + p, import.meta.url),
    "utf8",
  );
test("chat header exposes shared search and settings-owned members; composer has no outer separator", () => {
  const app = read("ChannelApp.tsx");
  assert.match(app, /loom:open-search/);
  assert.doesNotMatch(
    app,
    /items-center border-t border-line-muted bg-layer-panel px-3/,
  );
  assert.match(read("ChannelControl.tsx"), /DrawerContent/);
  assert.doesNotMatch(read("ChannelMembers.tsx"), /DialogTrigger/);
});
test("computer details retain native edit/runtime affordances and automatic desktop selection", () => {
  const page = read("ComputersPage.tsx");
  assert.match(page, /ComputerProfile/);
  assert.match(page, /machine-detected-runtimes/);
  assert.match(page, /min-width: 768px/);
  assert.match(page, /iconTone="neutral"/);
});

test("settings opens without forced input focus or a redundant corner close; drawer members are flat", () => {
  assert.doesNotMatch(read("ChannelSettingsContent.tsx"), /autoFocus/);
  assert.doesNotMatch(read("ChannelControl.tsx"), /DrawerClose/);
  assert.match(read("ChannelMembers.tsx"), /<MembersStrip/);
  assert.match(read("ChannelMembers.tsx"), /<ChannelMemberRow/);
  assert.match(read("ChannelMembers.tsx"), /OfficialMemberFlow.generated/);
  assert.doesNotMatch(read("ChannelMembers.tsx"), /<Card|<ListRowGroup/);
});
test("role tabs retain the current official conversation wrapper without a conflicting width override", () => {
  const page = read("RoleWorkspace.tsx");
  assert.match(page, /OfficialRoleTabs/);
  assert.match(
    read("OfficialIdentityFrames.generated.tsx"),
    /ConversationPanelTabs/,
  );
  assert.doesNotMatch(page, /<TabsList[^>]*className=/s);
});

test("chat header actions retain official tooltip/PanelAction composition and 22px icons", () => {
  const app = read("ChannelApp.tsx");
  assert.match(
    app,
    /<OverflowMenuTrigger\s+labelId="message.chatPanel.searchChannel"/,
  );
  assert.match(app, /icon=\{<Search size=\{22\} \/>\}/);
  assert.doesNotMatch(app, /uiActionProps.panelIcon/);
  assert.match(
    read("ChannelControl.tsx"),
    /icon=\{<Settings size=\{22\} \/>\}/,
  );
});
