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
test("document panes retain current native Card, tabs and semantic typography", () => {
  const all = read(
    "packages/web/src/components/message/attachmentPreviewSurfaces.tsx",
  );
  const s = all.slice(
    all.indexOf("export function CsvPreviewPane"),
    all.indexOf("export function DocumentAttachmentPreviewModal"),
  );
  assert.match(s, /<Card className="overflow-x-auto">/);
  assert.match(s, /font-display text-body text-foreground/);
  assert.match(s, /bg-layer-code p-4 font-mono text-mono-code text-foreground/);
  assert.match(s, /odd:bg-fill-muted\/50/);
  assert.doesNotMatch(
    s,
    /text-\[11px\]|text-xs|text-base|shadow-raft-sm|border-black\/40|bg-black\/\[0.03\]/,
  );
});
test("action menu rows use official native button recipe without Button overrides", () => {
  const s = read("packages/web/src/components/ui/MenuItem.tsx");
  assert.match(s, /data-slot="menu-item"/);
  assert.match(s, /flex min-h-9 w-full items-center gap-2.5/);
  assert.match(s, /enabled:focus-visible:bg-primary-soft/);
  assert.doesNotMatch(s, /<Button|hover:!border|text-sm/);
  const file = read(
    "packages/web/src/components/message/ChannelFileOverflowMenu.tsx",
  );
  assert.match(file, /size="icon-sm"\s+variant="ghost"/);
});
test("HTML preview overlays follow official popover, HUD and focus recipes", () => {
  const all = read(
    "packages/web/src/components/message/attachmentPreviewSurfaces.tsx",
  );
  const s = all.slice(
    all.indexOf("function HtmlPreviewBody"),
    all.indexOf("function VideoPreviewBody"),
  );
  assert.match(s, /bg-layer-popover px-3 py-2 text-callout/);
  assert.match(
    s,
    /rounded-chip bg-layer-hud px-2 py-1 text-caption text-layer-hud-foreground/,
  );
  assert.match(
    s,
    /rounded-\[2px\] bg-transparent outline-none focus-visible:shadow-raft-focus/,
  );
  assert.match(s, /sandbox="allow-scripts"/);
  assert.doesNotMatch(
    s,
    /text-xs|text-\[11px\]|font-black|shadow-raft-sm|focus-visible:border-black/,
  );
});
test("attachment reference quotes use the same official caption and seam as comments", () => {
  const s = read(
    "packages/web/src/components/message/AttachmentCommentRefChip.tsx",
  );
  assert.match(s, /border-line-seam pl-2.5 text-caption font-normal/);
  assert.doesNotMatch(s, /text-xs italic/);
});
