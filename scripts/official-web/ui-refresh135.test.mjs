import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (name) => readFileSync("frontends/raft/" + name, "utf8");
test("reviewed official package upgrade has one exact runtime", () => {
  assert.equal(
    JSON.parse(read("package.json")).dependencies["raft-ui"],
    "npm:@botiverse/raft-ui@0.52.2",
  );
});
test("workspace theme owns device mode; Appearance retains font and visibility preferences", () => {
  const theme = read("loom/WorkspaceThemeSettings.tsx");
  assert.match(theme, /OfficialThemeMode/);
  const appearance = read("loom/OfficialAppearance.generated.tsx");
  assert.doesNotMatch(
    appearance.split("export function AppearanceSection")[1],
    /<AppearanceThemeSettingsControl/,
  );
  assert.match(appearance, /messageBodyFontSize/);
});
test("activity uses the official menu and a clearable selected-filter chip", () => {
  const filters = read("loom/OfficialActivityFilters.generated.tsx");
  assert.match(filters, /inbox-filter-button/);
  assert.match(filters, /inbox-filter-clear/);
  assert.match(filters, /DropdownMenuRadioGroup/);
  assert.doesNotMatch(filters, /SegmentedControl/);
});
test("workspace mute is a separate settings destination, not mixed into browser permission", () => {
  const settings = read("loom/SettingsPage.tsx");
  assert.match(settings, /id: "server-notifications"/);
  assert.match(settings, /<WorkspaceNotificationSettings/);
  assert.doesNotMatch(read("loom/NotificationSettings.tsx"), /<WorkspaceMute/);
});
test("Role list groups by authenticated Computer inventory and preserves retired group", () => {
  assert.match(read("loom/RoleWorkspace.tsx"), /groupRolesByComputer/);
  assert.match(read("loom/RoleWorkspace.tsx"), /OfficialComputerGroup/);
  assert.match(read("loom/RoleWorkspace.tsx"), /已删除/);
});
test("empty Computer has no empty list border; blank pages and conversations use official empty states", () => {
  const computer = read("loom/ComputersPage.tsx");
  assert.match(computer, /<OfficialComputerInstancesEmpty/);
  assert.match(computer, /rows\.length > 0 &&/);
  const chat = read("loom/ChannelApp.tsx");
  assert.match(chat, /<PageEmpty/);
  assert.doesNotMatch(
    chat,
    /暂无频道，请从频道列表菜单创建|还没有私聊消息|频道还没有消息/,
  );
  assert.match(read("loom/MemoryPage.tsx"), /<PageEmpty/);
});
test("compact chat root has a real empty state after bootstrap; desktop sidebar keeps native compact descriptions", () => {
  assert.ok(
    read("loom/ChannelSidebar.tsx").includes('testId="empty-channel-list"'),
  );
  assert.ok(
    read("loom/RoleWorkspace.tsx").includes("OfficialSidebarDescription"),
  );
});
test("Role catalog render does not wait for CLI discovery to resolve Computer headings", () => {
  assert.ok(
    !read("loom/AgentPage.tsx").includes(
      "const [next, computer] = await Promise.all",
    ),
  );
});
test("a misspelled browser slice cannot silently launch the broad default acceptance run", () => {
  const runner = readFileSync(
    "scripts/official-web/channel-browser.mjs",
    "utf8",
  );
  assert.ok(runner.includes("Unknown browser slice"));
});
test("a workspace with only retired Roles opens the empty active-role page until a retired Role is selected", () => {
  assert.ok(!read("loom/AgentPage.tsx").includes("?? entries[0]"));
});
