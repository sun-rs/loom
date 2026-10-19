import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync("frontends/raft/" + p, "utf8");
test("FormField delegates label density and spacing to native Field recipes", () => {
  const s = read("packages/web/src/components/ui/FormField.tsx");
  assert.match(s, /size=\{fieldSize\}/);
  assert.doesNotMatch(
    s,
    /LABEL_BASE|LABEL_UPPERCASE|className="mt-1"|mb-1 flex/,
  );
});
test("StableField preserves control authority and adopts native label and message composition", () => {
  const s = read("packages/web/src/components/agent/StableField.tsx");
  assert.doesNotMatch(s, /LABEL_CLS|uppercase tracking-wide/);
  assert.match(s, /data-slot="field-label-accessory"/);
  assert.match(s, /className="text-caption"/);
  assert.match(s, /data-field-config-error/);
  assert.match(s, /aria-describedby=\{messageId\}/);
});
test("Role sidebar adopts shared section controls and row content without local font overrides", () => {
  const s = read("loom/RoleWorkspace.tsx");
  for (const n of [
    "SidebarSectionHeader",
    "SidebarSectionControl",
    "SidebarSectionCount",
    "SidebarItemContent",
    "SidebarItemTitle",
  ])
    assert.ok(s.includes("<" + n));
  assert.doesNotMatch(s, /tracking-widest|size="icon-xs"|truncate text-sm/);
});
test("message toolbar delegates position and active color to native recipe with current 18px icons", () => {
  const s = read("packages/web/src/components/message/MessageHoverToolbar.tsx");
  assert.match(s, /className="pointer-events-auto"/);
  assert.match(s, /<ThreadIcon width=\{18\} height=\{18\}/);
  assert.match(s, /<Bookmark size=\{18\}/);
  assert.doesNotMatch(
    s,
    /right-2|data-theme|!opacity-100|data-active:text-accent/,
  );
});
