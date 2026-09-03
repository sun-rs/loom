import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) =>
  readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("every ordinary message opens one Raft-ordered context menu", () => {
  const conversation = read("components/conversation-panes.tsx");
  const menu = read("components/message-context-menu.tsx");
  const interaction = read("use-message-context-menu.ts");

  assert.match(
    conversation,
    /onContextMenu=\{\s*navigationTarget && !selection\?\.active \? openContextMenu : undefined\s*\}/u,
  );
  assert.doesNotMatch(
    conversation,
    /onContextMenu=\{\s*convertTaskAction === undefined/u,
  );
  assert.match(menu, /QUICK_REACTIONS\.map/u);
  assert.match(menu, /复制链接/u);
  assert.match(menu, /复制 Markdown/u);
  assert.match(menu, /选择消息/u);
  assert.match(menu, /在消息列中回复/u);
  assert.match(menu, /从收藏中移除|收藏消息/u);
  assert.match(menu, /转为任务/u);
  assert.match(interaction, /export const MESSAGE_LONG_PRESS_MS = 500/u);
  assert.match(
    conversation,
    /onTouchStart=\{selection\?\.active \? undefined : startContextMenuLongPress\}/u,
  );
  assert.match(
    conversation,
    /onTouchMove=\{selection\?\.active \? undefined : moveContextMenuLongPress\}/u,
  );
  assert.match(
    conversation,
    /onTouchEnd=\{selection\?\.active \? undefined : finishContextMenuLongPress\}/u,
  );
  assert.match(
    conversation,
    /if \(!selection\?\.active\) return;[\s\S]*closest\("a, button, input, label"\)[\s\S]*selection\.onToggle\(\)/u,
    "Raft selection mode toggles a message from the row while preserving nested controls",
  );
});

test("Room and Thread consume one in-memory Raft selection owner", () => {
  const conversation = read("components/conversation-panes.tsx");
  const toolbar = read("components/message-selection-toolbar.tsx");
  const hook = read("use-message-selection.ts");

  assert.match(conversation, /useMessageSelection/u);
  assert.match(conversation, /selection\.enterRoom/u);
  assert.match(conversation, /selection\.enterThread/u);
  assert.match(conversation, /selection\.toggleWithThread/u);
  assert.match(conversation, /<MessageSelectionToolbar/u);
  assert.match(toolbar, /已选择/u);
  assert.match(toolbar, /全选/u);
  assert.match(toolbar, /复制链接/u);
  assert.match(toolbar, /复制 Markdown/u);
  assert.match(toolbar, /取消/u);
  assert.match(hook, /useSyncExternalStore/u);
  assert.doesNotMatch(hook, /localStorage|indexedDB/iu);
});

test("Saved and Message menus share the portal, focus, and keyboard owner", () => {
  const floating = read("components/floating-context-menu.tsx");
  const messageMenu = read("components/message-context-menu.tsx");
  const saved = read("components/saved-message-card.tsx");

  assert.match(floating, /createPortal/u);
  assert.match(floating, /role="menu"/u);
  assert.match(floating, /event\.key === "Escape"/u);
  assert.match(floating, /event\.key === "ArrowDown"/u);
  assert.match(floating, /window\.addEventListener\("scroll"/u);
  assert.match(messageMenu, /FloatingContextMenu/u);
  assert.match(saved, /FloatingContextMenu/u);
});

test("Raft-projected forwarded attachments reuse the canonical file preview owner", () => {
  const forwarded = read("components/forwarded-message-bundle.tsx");

  assert.match(forwarded, /MessageAttachments/u);
  assert.match(forwarded, /item\.attachmentPolicy === "projected"/u);
  assert.match(forwarded, /attachments=\{item\.attachments\}/u);
});
