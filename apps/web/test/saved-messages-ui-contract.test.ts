import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pane = readFileSync(
  new URL("../src/components/saved-messages.tsx", import.meta.url),
  "utf8",
);
const card = readFileSync(
  new URL("../src/components/saved-message-card.tsx", import.meta.url),
  "utf8",
);
const css = readFileSync(
  new URL("../src/message-social.css", import.meta.url),
  "utf8",
);

test("Saved pane follows the observed Raft page contract", () => {
  assert.match(pane, /limit:\s*20/u);
  assert.match(pane, /query:\s*""/u);
  assert.match(pane, /sortDirection:\s*"desc"/u);
  assert.match(pane, /暂无收藏的消息/u);
  assert.match(pane, /通过消息菜单收藏内容。/u);
  assert.doesNotMatch(pane, /rah-saved-refresh/u);
  assert.match(pane, /aria-busy="true"/u);
});

test("Saved card carries Raft metadata, full-card navigation, menu, and removal", () => {
  assert.match(card, /ProfileImageAvatar/u);
  assert.match(card, /onContextMenu/u);
  assert.match(card, /ariaLabel="收藏消息操作"/u);
  assert.doesNotMatch(card, /复制链接/u);
  assert.match(card, /复制 Markdown/u);
  assert.match(card, /从收藏中移除/u);
  assert.match(card, /savedTargetLabel/u);
  assert.match(card, /FloatingContextMenu/u);
  assert.match(card, /anchor=\{menu\}/u);
  assert.match(card, /triggerRef=\{cardRef\}/u);
  assert.match(
    card,
    /className="rah-saved-remove"[^]*?<button|<button[^]*?className="rah-saved-remove"/u,
  );
});

test("Saved visuals keep the shared measured header, card, and remove-button geometry", () => {
  assert.match(pane, /<PanelHeader kind="surface"/u);
  assert.match(pane, /<PanelHeaderIcon name="bookmark"/u);
  assert.match(
    css,
    /\.rah-saved-card\s*\{[^}]*border:\s*2px solid rgb\(0 0 0 \/ 30%\);[^}]*padding:\s*12px;/u,
  );
  assert.match(
    css,
    /\.rah-saved-remove\s*\{[^}]*height:\s*28px;[^}]*width:\s*28px;/u,
  );
  assert.match(
    css,
    /\.rah-saved-remove svg\s*\{[^}]*height:\s*14px;[^}]*width:\s*14px;/u,
  );
  assert.match(
    css,
    /\.rah-saved-context-menu button\s*\{[^}]*font:\s*500 14px\/20px var\(--sans\);[^}]*padding:\s*8px 12px;/u,
  );
  assert.match(
    css,
    /\.rah-saved-context-menu button:hover,[^}]*\{[^}]*background:\s*rgb\(255 212 64 \/ 30%\);/u,
  );
  assert.match(
    css,
    /\.rah-saved-context-menu hr\s*\{[^}]*border-top:\s*2px solid var\(--black\);[^}]*margin:\s*0;/u,
  );
});
