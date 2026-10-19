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
  assert.match(c, /className="space-y-2"/);
});
test("avatar frame sizes and badge corners come from the current official recipe", () => {
  const s = read("packages/web/src/components/ui/AvatarSlot.tsx");
  assert.doesNotMatch(s, /!size-|!border|theme=elegant|rounded-full/);
  assert.match(s, /"profile-tile": "lg"/);
  assert.match(s, /"list-row": "md"/);
  assert.match(s, /rounded-\[2px\]/);
});
test("account profile uses current native card, typography and keyboard-accessible avatar edit", () => {
  const card = read(
    "packages/web/src/components/settings/SettingsProfileCard.tsx",
  );
  assert.match(card, /<Card/);
  assert.match(card, /<Separator className="mb-4"/);
  assert.match(card, /text-headline text-foreground/);
  assert.doesNotMatch(card, /shadow-raft-sm|border-t|text-lg/);
  const panel = read("packages/web/src/components/settings/SettingsPanel.tsx");
  const profile = panel.slice(
    panel.indexOf('testId="account-profile-card"'),
    panel.indexOf("{/* Profile form */}"),
  );
  assert.match(profile, /peer\/avatar-edit sr-only/);
  assert.match(profile, /has-\[:focus-visible\]:shadow-raft-focus/);
  assert.match(profile, /<AvatarEditVeil busy={avatarSaving}/);
  assert.doesNotMatch(profile, /size-16|className="hidden"|bg-black\/40/);
});
test("system channel settings retain native form Card and disabled typography", () => {
  const s = read("packages/web/src/components/settings/SettingsPanel.tsx");
  const section = s.slice(
    s.indexOf("function SystemChannelsSection()"),
    s.indexOf("function ServerTranslationSection()"),
  );
  assert.match(section, /<Card render={<form onSubmit={handleSave} \/>}/);
  assert.match(section, /text-subhead font-semibold/);
  assert.match(section, /text-footnote text-foreground-muted/);
  assert.doesNotMatch(section, /shadow-raft-sm|opacity-60/);
});
