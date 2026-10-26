import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync("frontends/raft/loom/" + p, "utf8");
test("appearance theme shortcut stays inside private appearance content and routes through settings owner", () => {
  const s = read("OfficialAppearance.generated.tsx");
  assert.match(s, /!publicSurface[\s\S]*themeLink[\s\S]*<SectionHeader/);
  assert.match(
    read("SettingsPage.tsx"),
    /themeLink=\{\s*<WorkspaceThemeLink onOpen=\{\(\) => onTab\("theme"\)\}/,
  );
});
test("current activity toolbar uses official automatic icon overflow and named icons", () => {
  const s = read("OfficialActivityFilters.generated.tsx");
  assert.match(s, /iconsOnlyBelow="auto"/);
  assert.match(s, /@container flex h-\[54px\]/);
  for (const icon of ["Inbox", "CircleDot", "AtSign", "Pin"])
    assert.match(s, new RegExp("<" + icon + " "));
  const a = read("OfficialActivityHeader.generated.tsx");
  assert.match(a, /<CheckCheck/);
  assert.match(a, /@max-\[30rem\]:sr-only/);
  assert.match(a, /disabled=\{busy\}/);
});
