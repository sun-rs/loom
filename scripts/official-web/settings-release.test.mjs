import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync("frontends/raft/" + p, "utf8");
test("settings sidebar adopts native group and item composition instead of hand-sized labels", () => {
  const s = read(
    "packages/web/src/components/settings/SettingsSidebarList.tsx",
  );
  for (const name of [
    "SidebarGroupLabel",
    "SidebarItemContent",
    "SidebarItemTitle",
  ])
    assert.ok(s.includes("<" + name));
  assert.doesNotMatch(s, /tracking-widest|text-\[10px\]|space-y-3/);
});
test("settings detail retains native header and responsive body composition", () => {
  const s = read("loom/SettingsPage.tsx");
  assert.ok(
    s.includes("px-4 py-4 text-foreground mobile-nav-clearance md:px-5"),
  );
  assert.doesNotMatch(s, /icon=\{<Icon|iconBg=/);
  assert.ok(s.includes('edge="inset"'));
});
test("appearance uses official native type hierarchy and unified divided preference group", () => {
  const s = read("loom/OfficialAppearance.generated.tsx");
  assert.match(s, /<ListRowGroup className="mt-4">/);
  assert.match(s, /<ListRow variant="plain" interactive=\{false\}>/);
  assert.match(s, /text-subhead font-semibold text-foreground/);
  assert.doesNotMatch(s, /shadow-raft-sm|tracking-widest|text-\[11px\]/);
});
