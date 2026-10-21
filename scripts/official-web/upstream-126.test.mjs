import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync("frontends/raft/" + p, "utf8");
test("v1.21.26 desktop typography is scoped to fine-pointer desktop and imported centrally", () => {
  const css = read("node_modules/raft-ui/dist/styles.css");
  assert.match(css, /width >= 48rem/);
  assert.match(css, /pointer: fine/);
  for (const [token, value] of [
    ["body", "14px"],
    ["subhead", "14px"],
    ["footnote", "12px"],
  ])
    assert.ok(css.includes(`--text-${token}: ${value}`));
  assert.match(read("packages/web/src/index.css"), /raft-ui\/styles.css/);
});
test("message tiers follow upstream body tokens and retain explicit user preference", () => {
  const s = read("packages/web/src/store/appearanceStore.ts");
  assert.match(s, /fontSize: "var\(--text-body\)"/);
  assert.match(s, /lineHeight: "var\(--text-body--line-height\)"/);
  assert.doesNotMatch(s, /sizeLabel: "16px"/);
  assert.match(s, /localStorage.getItem\(MESSAGE_BODY_FONT_SIZE_STORAGE_KEY\)/);
});
test("topbar measures both adjacent slots instead of fixing the trigger width", () => {
  const s = read("loom/TopBar.tsx");
  assert.match(s, /useTopbarSearchWidth/);
  assert.match(s, /style=\{.*searchWidth/s);
  assert.doesNotMatch(s, /truncate text-subhead font-bold/);
});
test("computer instance rows use one native group and sibling separators", () => {
  const s = read("loom/ComputersPage.tsx");
  assert.match(s, /<OfficialListRowGroup>/);
  assert.match(s, /<OfficialAvatarListRow/);
  const port = read("loom/OfficialListRows.tsx");
  assert.match(port, /ListRowGroup as OfficialListRowGroup/);
  assert.match(port, /<ListRow onClick=/);
});
test("Role profile exposes field actions, native avatar presets and immutable revision binding", () => {
  const s = read("loom/RoleProfile.tsx");
  assert.match(s, /编辑\$\{label\}/);
  assert.match(s, /RoleFieldEditor/);
  assert.doesNotMatch(s, /编辑配置/);
  assert.match(read("loom/RoleWorkspace.tsx"), /<TabsLabel>资料<\/TabsLabel>/);
  assert.match(read("loom/RoleFieldEditor.tsx"), /AVATAR_KEYS/);
});

test("message headers retain official spacing, badges and semantic full timestamps", () => {
  const s = read("packages/web/src/components/message/MessageItem.tsx");
  const header = s.slice(
    s.indexOf("<MessageItemHeader>"),
    s.indexOf("</MessageItemHeader>"),
  );
  assert.doesNotMatch(header, /gap-2|text-\[10px\]|theme=elegant/);
  assert.match(header, /h-5.*rounded-chip/);
  assert.match(header, /<Tooltip content=\{gutterFullTimestamp\}>/);
  assert.match(header, /<MessageItemTime\s+dateTime=/);
  assert.match(s, /<MessageItemContinuationTime dateTime=/);
});
test("only Activity adopts the native 840px preview threshold", () => {
  const row = read("loom/ActivityMessageRow.tsx");
  assert.match(row, /ACTIVITY_PREVIEW_QUERY/);
  const page = read("loom/DiscoveryPage.tsx");
  assert.match(page, /mode === "activity"\s*\? ACTIVITY_PREVIEW_QUERY/);
});
