import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (n) => readFileSync("frontends/raft/loom/" + n, "utf8");
test("all primary list pages use one official sidebar resize and existing collapse owner", () => {
  for (const n of [
    "ChannelApp",
    "RoleWorkspace",
    "ComputersPage",
    "SettingsPage",
  ]) {
    const s = read(n + ".tsx");
    assert.match(s, /<SidebarResize/);
    assert.match(s, /useSidebarColumn\(/);
    assert.doesNotMatch(s, /useResizablePanel\(/);
  }
  const s = read("SidebarLayout.tsx");
  assert.match(s, /kind: "collapse"/);
  assert.match(s, /toggleSidebar\(\)/);
  assert.match(s, /<CurrentColumnResize/);
});
