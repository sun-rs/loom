import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync("frontends/raft/" + p, "utf8");
test("search entity rows retain compact native identities, outline labels and sibling separators", () => {
  const s = read("packages/web/src/components/search/EntityResultRow.tsx");
  assert.match(s, /context="compact-row"/);
  assert.doesNotMatch(s, /context="surface-list"/);
  assert.match(s, /not-first:before:border-t/);
  assert.match(s, /<Badge appearance="outline">/);
  assert.match(read("loom/SearchEntityRows.tsx"), /rootRef=\{row\}/);
});
test("search message result retains native avatar gutter and direct sibling result composition", () => {
  const s = read("packages/web/src/components/search/MessageHitRow.tsx");
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
  assert.doesNotMatch(s, /id: "computers"/);
  assert.match(s, /hideDesktopHeader/);
});
test("message size preferences match official current 14 16 18", () => {
  const s = read("packages/web/src/store/appearanceStore.ts");
  for (const n of ["14px", "16px", "18px"])
    assert.ok(s.includes('sizeLabel: "' + n + '"'));
  assert.match(s, /md: "1rem"/);
});
test("timeline supplies member mentions rather than empty map", () => {
  const s = read("loom/ChannelTimeline.tsx");
  assert.doesNotMatch(s, /const mentionMap = new Map\(\)/);
  assert.match(s, /projectMessageMentions\(members\)/);
});
test("release notes retain current native text hierarchy without highlighted card fill", () => {
  const s = read("packages/web/src/components/settings/ReleaseNotesPanel.tsx");
  assert.match(s, /font-mono text-mono-meta text-foreground/);
  assert.doesNotMatch(s, /isCurrentRelease \? "bg-primary-soft/);
  assert.match(s, /text-subhead text-foreground/);
});
test("readonly Loom timeline retains explicit channel navigation", () => {
  assert.match(read("loom/ChannelTimeline.tsx"), /channels=\{channels\}/);
  assert.match(read("loom/ChannelTimeline.tsx"), /onReadOnlyNavigateChannel/);
});
test("thread search headers use the native compact metadata hierarchy", () => {
  const s = read("loom/SearchMessageGroups.tsx");
  assert.match(s, /mb-0.5 flex min-w-0 flex-wrap items-center gap-1.5/);
  assert.match(s, /font-mono text-mono-meta text-foreground-hint/);
});
test("all search destination surfaces use current list composition and headings", () => {
  for (const p of ["loom/SearchRecent.tsx", "loom/SearchFrequent.tsx"]) {
    const s = read(p);
    assert.match(s, /<SearchResultsSectionHeading>/);
    assert.doesNotMatch(s, /grid-cols|<SectionEyebrow/);
  }
  assert.doesNotMatch(
    read("packages/web/src/components/search/SearchHomeEntityRow.tsx"),
    /context="surface-list"/,
  );
  assert.doesNotMatch(read("loom/SearchEntityRows.tsx"), /mb-3 px-3|-m-1.5/);
});
