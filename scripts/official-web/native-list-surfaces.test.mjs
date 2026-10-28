import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync("frontends/raft/" + p, "utf8");
test("shared official list surface uses flat press overlay, without legacy border/shadow hover", () => {
  const s = read(
    "upstream/raft-web-source/packages/web/src/components/ui/SurfaceListItem.tsx",
  );
  assert.match(s, /hover:press-overlay active:press-overlay/);
  assert.doesNotMatch(s, /hover:border|shadow-raft|bg-info-muted/);
});
test("official avatar row uses body typography, native spacing and focus geometry", () => {
  const s = read("packages/web/src/components/ui/AvatarListRow.tsx");
  assert.match(s, /text-body font-semibold text-foreground/);
  assert.match(s, /group px-4 py-3/);
  assert.match(s, /focus-visible:shadow-raft-focus/);
  const c = read("loom/ComputersPage.tsx");
  assert.match(c, /<ComputerInstanceRow/);
  assert.match(read("loom/ComputerInstanceRow.tsx"), /<OfficialAvatarListRow/);
  assert.match(c, /<SectionHeader/);
  assert.match(c, /<OfficialListRowGroup>/);
  const row = read("loom/OfficialListRows.tsx");
  assert.match(row, /@loom\/raft-web-source\/AvatarListRow/);
  const native = read(
    "upstream/raft-web-source/packages/web/src/components/ui/AvatarListRow.tsx",
  );
  assert.match(native, /<ListRowMeta>/);
  assert.match(native, /interactive=\{interactive\}/);
});
test("avatar frame sizes and badge corners come from the current official recipe", () => {
  const s = read("loom/OfficialAvatarSlot.generated.tsx");
  assert.doesNotMatch(s, /!size-|!border|theme=elegant|rounded-full/);
  assert.match(s, /"profile-tile": "lg"/);
  assert.match(s, /"list-row": "md"/);
  assert.match(s, /rounded-\[2px\]/);
});
test("account profile uses current native card, typography and keyboard-accessible avatar edit", () => {
  const card = read(
    "upstream/raft-web-source/packages/web/src/components/settings/SettingsProfileCard.tsx",
  );
  assert.match(card, /<Card/);
  assert.match(card, /<Separator className="mb-4"/);
  assert.match(card, /text-headline text-foreground/);
  assert.doesNotMatch(card, /shadow-raft-sm|border-t|text-lg/);
  const panel = read(
    "upstream/raft-web-source/packages/web/src/components/settings/SettingsPanel.tsx",
  );
  const profile = panel.slice(
    panel.indexOf('testId="account-profile-card"'),
    panel.indexOf("{/* Profile form */}"),
  );
  assert.match(profile, /peer\/avatar-edit sr-only/);
  assert.match(profile, /has-\[:focus-visible\]:shadow-focus/);
  assert.match(profile, /<AvatarEditVeil busy={avatarSaving}/);
  assert.doesNotMatch(profile, /size-16|className="hidden"|bg-black\/40/);
});
