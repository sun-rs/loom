import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync("frontends/raft/" + p, "utf8");
test("search entity rows retain compact native identities, outline labels and sibling separators", () => {
  const s = read("loom/OfficialSearchEntityRow.generated.tsx");
  assert.match(s, /context="compact-row"/);
  assert.doesNotMatch(s, /context="surface-list"/);
  assert.match(s, /not-first:before:border-t/);
  assert.match(s, /<Badge appearance="outline">/);
  assert.match(read("loom/SearchEntityRows.tsx"), /rootRef=\{row\}/);
});
test("search message result retains native avatar gutter and direct sibling result composition", () => {
  const s = read("loom/OfficialMessageHitRow.generated.tsx");
  assert.match(s, /pl-\[55px\]/);
  assert.match(s, /absolute top-3 left-4 flex/);
  assert.doesNotMatch(s, /preview-mini|border-t-2/);
  assert.match(read("loom/SearchMessageRow.tsx"), /resultKey=\{row.id\}/);
});
test("empty overlay hides filters but search results retain them", () => {
  assert.match(
    read("loom/DiscoveryPage.tsx"),
    /!\(overlay && !query.trim\(\) && !hasSearchFilters\)/,
  );
});
test("settings rail has no desktop title or computer navigation entry", () => {
  const s = read("loom/SettingsPage.tsx");
  assert.match(s, /!desktop && group.label === "工作空间"/);
  assert.match(s, /hideDesktopHeader/);
});
test("message size preferences follow v1.21.26 responsive typography", () => {
  const s = read("packages/web/src/store/appearanceStore.ts");
  assert.match(s, /fontSize: "var\(--text-body\)"/);
  assert.match(s, /lineHeight: "var\(--text-body--line-height\)"/);
  assert.doesNotMatch(s, /sizeLabel: "16px"/);
});
test("timeline supplies member mentions rather than empty map", () => {
  const s = read("loom/ChannelTimeline.tsx");
  assert.doesNotMatch(s, /const mentionMap = new Map\(\)/);
  assert.match(s, /projectMessageMentions\(members\)/);
});
test("release notes retain current native text hierarchy without highlighted card fill", () => {
  const s = read("loom/OfficialReleaseNotes.generated.tsx");
  assert.match(s, /font-mono text-mono-meta text-foreground/);
  assert.doesNotMatch(s, /isCurrentRelease \? "bg-primary-soft/);
  assert.match(s, /text-subhead text-foreground/);
});
test("readonly Loom timeline retains explicit channel navigation", () => {
  assert.match(read("loom/ChannelTimeline.tsx"), /channels=\{channels\}/);
  assert.match(read("loom/ChannelTimeline.tsx"), /onReadOnlyNavigateChannel/);
});
test("thread search headers use the native compact metadata hierarchy", () => {
  const s = read("loom/OfficialSearchSections.generated.tsx");
  assert.match(s, /mb-0.5 flex min-w-0 flex-wrap items-center gap-1.5/);
  assert.match(s, /font-mono text-mono-meta text-foreground-hint/);
});
test("all search destination surfaces use current list composition and headings", () => {
  for (const p of ["loom/OfficialSearchSections.generated.tsx"]) {
    const s = read(p);
    assert.match(s, /<SearchResultsSectionHeading>/);
    assert.doesNotMatch(s, /grid-cols|<SectionEyebrow/);
  }
  assert.doesNotMatch(
    read("loom/OfficialSearchHomeRow.generated.tsx"),
    /context="surface-list"/,
  );
  assert.doesNotMatch(read("loom/SearchEntityRows.tsx"), /mb-3 px-3|-m-1.5/);
});
test("search history uses current native heading, soft chips and shared text actions", () => {
  const s = read("loom/OfficialSearchSections.generated.tsx");
  assert.match(s, /SearchResultsSectionHeading/);
  assert.match(s, /appearance="soft"/);
  assert.match(s, /<TextLink/);
  assert.match(s, /flex flex-wrap gap-1.5 px-4/);
  assert.doesNotMatch(s, /SectionEyebrow|text-\[11px\]|size=\{11\}/);
});
test("member preview adopts current typography and native separator", () => {
  const s = read("loom/MessageProfile.tsx");
  assert.match(s, /text-headline text-foreground/);
  assert.match(s, /<Separator/);
  assert.match(s, /px-4 pt-4 pb-3 last:pb-4/);
  assert.doesNotMatch(s, /border-t-2|text-xs|font-bold/);
});
test("shared sidebars and channel sections use native recipes instead of local sizes", () => {
  const s = read("loom/ChatSidebarFrame.tsx");
  assert.match(s, /<OfficialSidebarHeader/);
  const generated = read("loom/OfficialIdentityFrames.generated.tsx");
  assert.match(generated, /<SidebarHeaderTitle/);
  assert.match(generated, /<PanelSectionHeader/);
  assert.doesNotMatch(s, /theme=elegant|font-display|text-lg/);
  const c = read("loom/ChannelSidebar.tsx");
  for (const name of [
    "SidebarSectionHeader",
    "SidebarSectionDisclosure",
    "SidebarSectionCount",
    "SidebarSectionControl",
  ])
    assert.ok(c.includes("<" + name));
  assert.doesNotMatch(c, /tracking-widest|btn-flat-sm/);
  assert.match(read("loom/SidebarMenus.tsx"), /<SidebarSectionControl/);
});
test("search pagination error uses the native warning banner", () => {
  const s = read("loom/OfficialSearchSections.generated.tsx");
  assert.match(s, /intent="warning"/);
  assert.match(s, /withIcon/);
  assert.doesNotMatch(s, /shadow-raft-sm|font-bold/);
});
