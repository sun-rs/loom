import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync("frontends/raft/" + p, "utf8");
test("thread overflow uses native PanelAction and composer has no added separator", () => {
  const menu = read("loom/ThreadFollowMenu.tsx");
  assert.match(menu, /<PanelAction/);
  assert.doesNotMatch(menu, /variant="outline"|size="icon-sm"/);
  const s = read("loom/ThreadWorkspace.tsx");
  const start = s.indexOf("data-loom-composer-shell");
  assert.doesNotMatch(
    s.slice(start, s.indexOf("<MessageInput", start)),
    /border-t/,
  );
});
test("preview header adopts native title and icon-lg ghost actions", () => {
  const s = read(
    "packages/web/src/components/message/attachmentPreviewSurfaces.tsx",
  );
  const h = s.slice(
    s.indexOf('<div className="flex h-14'),
    s.indexOf("{browserFindLayout && <div"),
  );
  assert.match(h, /text-headline text-foreground/);
  assert.match(h, /size="icon-lg"/);
  assert.match(h, /variant=\{commentsOpen \? "outline" : "ghost"\}/);
  assert.doesNotMatch(h, /size="icon-sm"|font-display|!min-h/);
});
test("shared close action delegates colors to native recipe", () => {
  const s = read("packages/web/src/components/ui/CloseButton.tsx");
  assert.match(s, /className=\{className\}/);
  assert.doesNotMatch(s, /hover:bg|text-foreground/);
});
test("both reaction picker and menu rows retain current focus and selected colors", () => {
  const s = read("packages/web/src/components/message/MessageItem.tsx");
  assert.equal(
    s.split(
      "flex size-7 items-center justify-center rounded-control bg-transparent outline-none hover:bg-primary-soft active:bg-primary-soft focus-visible:shadow-raft-focus",
    ).length - 1,
    2,
  );
});
test("attachment badge uses native inline placement without forced legacy size", () => {
  const s = read("packages/web/src/components/message/AttachmentTypeBadge.tsx");
  assert.match(s, /placement="inline"/);
  assert.match(s, /className=\{className\}/);
  assert.doesNotMatch(s, /!h-|!w-|!min-|!text-/);
});
test("attachment comments use native card, typography and lightweight chrome", () => {
  const s = read(
    "packages/web/src/components/message/AttachmentCommentsPanel.tsx",
  );
  assert.match(
    s,
    /<Card\s+render=\{<button type="button" onClick=\{jump\} \/>\}/,
  );
  assert.match(
    s,
    /min-h-10 shrink-0 items-center gap-2 border-b border-line-seam/,
  );
  assert.match(s, /size="icon-sm" variant="ghost"/);
  assert.match(s, /shrink-0 border-t border-line-seam p-3/);
  assert.match(s, /font-mono text-mono-meta text-foreground-hint/);
  assert.doesNotMatch(
    s,
    /text-\[\d+px\]|border-b-2|border-t-2|bg-brutal-stone|size=\{9\}/,
  );
});
test("attachment comment drawers use the native seam border", () => {
  const s = read(
    "packages/web/src/components/message/attachmentPreviewSurfaces.tsx",
  );
  const shell = s.slice(
    s.indexOf("export function AttachmentPreviewShell"),
    s.indexOf("export function CsvPreviewPane"),
  );
  assert.doesNotMatch(shell, /border-line-muted/);
});
