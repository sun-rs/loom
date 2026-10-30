import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (name) => readFileSync("frontends/raft/loom/" + name, "utf8");

test("Web139 Role sidebar uses native lists without the retired Web138 inset override", () => {
  const source = read("RoleWorkspace.tsx");
  assert.doesNotMatch(
    source,
    /OfficialRoleSidebarGeometry|roleSidebar(?:RowStyle|HeaderStyle|FrameClass)/,
  );
  assert.match(source, /OfficialComputerGroup139/);
  assert.match(source, /<SidebarList[\s>]/);
  assert.match(source, /<SidebarSection[\s>]/);
});
test("Web139 Computer sidebar delegates frame and list geometry to official recipes", () => {
  const source = read("ComputersPage.tsx");
  const desktop = source.slice(
    source.indexOf("<SidebarRoot"),
    source.indexOf('data-testid="mobile-computers-panel"'),
  );
  assert.doesNotMatch(desktop, /\bpx-2\b|\bpt-2\b/);
  assert.match(desktop, /<SidebarList[\s>]/);
});
test("Web140 native channel drop zones own list spacing, not section margins", () => {
  assert.doesNotMatch(read("SidebarDrag.tsx"), /className="mb-3"/);
  assert.match(read("ChannelSidebar.tsx"), /<DragList[\s>]/);
  assert.match(
    read("OfficialSidebarDrag140.generated.js"),
    /relative isolate flex flex-col gap-0\.5 py-2/,
  );
  assert.match(read("SavedNav.tsx"), /<SidebarList[\s>]/);
  assert.match(read("SavedNav.tsx"), /<SidebarItemIcon>/);
  assert.match(read("ChatSidebarFrame.tsx"), /SIDEBAR_SCROLL_139_CLASS/);
  assert.doesNotMatch(
    read("ChatSidebarFrame.tsx"),
    /hideDesktopHeader \? "pt-2"/,
  );
});
test("Web139 task navigation and empty-state use the same semantic ListTodo icon", () => {
  assert.match(
    read("Navigation.tsx"),
    /id: "tasks", label: "任务", icon: ListTodo/,
  );
  assert.match(read("TasksPage.tsx"), /icon=\{<ListTodo size=\{36\}/);
});
test("the shared settings scroll frame also binds the acquired current list composition", () => {
  assert.match(
    readFileSync(
      "frontends/raft/packages/web/src/components/settings/SettingsSidebarList.tsx",
      "utf8",
    ),
    /OfficialSettingsSidebar139/,
  );
  assert.match(read("OfficialSidebar139.generated.js"), /function Q4e/);
});
test("Web139 selection/menu state paints the official inset cell instead of a full-width background", () => {
  for (const file of ["ChannelListRow.tsx", "DirectChatRow.tsx"])
    assert.match(read(file), /sidebarItemClass139\(selected, menuOpen\)/, file);
});
test("Web139 published leaves are reproducible and locked independently of original TSX", async () => {
  const { generateSidebar139, sidebar139Types } =
    await import("./generate-sidebar139.mjs");
  assert.equal(read("OfficialSidebar139.generated.js"), generateSidebar139());
  assert.equal(read("OfficialSidebar139.generated.d.ts"), sidebar139Types());
  assert.match(generateSidebar139(), /mx-2 mt-1\.5/);
  assert.match(generateSidebar139(), /before:bg-fill-cell-hover/);
  assert.doesNotMatch(generateSidebar139(), /py-\[8\.5px\]/);
});
