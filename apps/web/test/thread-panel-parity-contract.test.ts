import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) =>
  readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("Task messages keep Raft's compact linked marker and omit workflow state", () => {
  const source = read("components/conversation-panes.tsx");
  assert.doesNotMatch(source, /<span>Task #\{task\.taskNumber\}<\/span>/u);
  assert.doesNotMatch(source, /<span>\{task\.state\}<\/span>/u);
  assert.match(source, /className="rah-message-task-link"/u);
  assert.match(source, /打开任务 #\$\{task\.taskNumber\}/u);
  assert.match(source, /@\{taskAgent\.handle\}/u);
});

test("thread panel exposes the Raft header, history and action contracts", () => {
  const source = read("components/conversation-panes.tsx");
  const css = read("product.css");
  const markdown = read("components/message-markdown.tsx");
  assert.match(source, /data-testid="thread-scroll-to-top"/u);
  assert.match(source, /data-testid="thread-followers-header-trigger"/u);
  assert.match(source, /正在关注的 Agent/u);
  assert.match(source, /data-testid="thread-overflow-trigger"/u);
  for (const label of ["在消息列中搜索", "在频道中查看", "关注消息列"])
    assert.match(source, new RegExp(label, "u"));
  assert.match(source, /回复的开头/u);
  assert.match(source, /hasEarlierReplies/u);
  assert.match(source, /onLoadEarlier/u);
  assert.match(source, /onSearchThread/u);
  assert.match(markdown, /thread-search-fragment-highlight/u);
  assert.match(source, /上一个搜索结果/u);
  assert.match(source, /关闭消息列搜索/u);
  assert.match(source, /撤销/u);
  assert.match(source, /removedFollowers\.map/u);
  assert.match(
    css,
    /\.rah-thread-parent\s*\{[^}]*border-bottom:\s*var\(--bd-heavy\)/su,
  );
  assert.match(css, /\.rah-thread-resizer\s*\{[^}]*width:\s*8px/su);
  assert.match(css, /\.thread-head\s*\{[^}]*height:\s*62px/su);
  assert.match(css, /\.thread-head h2\s*\{[^}]*font-size:\s*16px/su);
});

test("WorkspaceScreen owns one persistent thread-panel width and its resizer", () => {
  const app = read("App.tsx");
  assert.match(app, /useThreadPanelWidth/u);
  assert.match(app, /--thread-w/u);
  assert.match(app, /<ThreadPanelResizer/u);
  assert.match(app, /loadEarlierThreadMessages/u);
  assert.match(app, /searchActiveThread/u);
});
