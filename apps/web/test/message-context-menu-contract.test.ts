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
    /onContextMenu=\{navigationTarget \? openContextMenu : undefined\}/u,
  );
  assert.doesNotMatch(
    conversation,
    /onContextMenu=\{\s*convertTaskAction === undefined/u,
  );
  assert.match(menu, /QUICK_REACTIONS\.map/u);
  assert.match(menu, /复制链接/u);
  assert.match(menu, /复制 Markdown/u);
  assert.match(menu, /在消息列中回复/u);
  assert.match(menu, /从收藏中移除|收藏消息/u);
  assert.match(menu, /转为任务/u);
  assert.match(interaction, /export const MESSAGE_LONG_PRESS_MS = 500/u);
  assert.match(conversation, /onTouchStart=\{startContextMenuLongPress\}/u);
  assert.match(conversation, /onTouchMove=\{moveContextMenuLongPress\}/u);
  assert.match(conversation, /onTouchEnd=\{finishContextMenuLongPress\}/u);
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
