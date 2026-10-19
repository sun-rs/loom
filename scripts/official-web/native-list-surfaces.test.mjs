import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync("frontends/raft/" + p, "utf8");
test("shared official list surface uses flat press overlay, without legacy border/shadow hover", () => {
  const s = read("packages/web/src/components/ui/SurfaceListItem.tsx");
  assert.match(s, /hover:press-overlay active:press-overlay/);
  assert.doesNotMatch(s, /hover:border|shadow-raft|bg-info-muted/);
});
test("official avatar row uses body typography, native spacing and focus geometry", () => {
  const s = read("packages/web/src/components/ui/AvatarListRow.tsx");
  assert.match(s, /text-body font-semibold text-foreground/);
  assert.match(s, /group px-4 py-3/);
  assert.match(s, /focus-visible:shadow-raft-focus/);
  const c = read("loom/ComputersPage.tsx");
  assert.match(c, /<AvatarListRow/);
  assert.match(c, /<SectionHeader/);
});
test("avatar frame sizes and badge corners come from the current official recipe", () => {
  const s = read("packages/web/src/components/ui/AvatarSlot.tsx");
  assert.doesNotMatch(s, /!size-|!border|theme=elegant|rounded-full/);
  assert.match(s, /"profile-tile": "lg"/);
  assert.match(s, /"list-row": "md"/);
  assert.match(s, /rounded-\[2px\]/);
});
