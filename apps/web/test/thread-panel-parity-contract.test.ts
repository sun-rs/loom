import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { readUiSource as read } from "./ui-source.ts";

test("Task messages keep Raft's compact linked marker and omit workflow state", () => {
  const source = read("components/conversation-panes.tsx");
  const css = read("product.css");
  assert.doesNotMatch(source, /<span>Task #\{task\.taskNumber\}<\/span>/u);
  assert.doesNotMatch(source, /<span>\{task\.state\}<\/span>/u);
  assert.match(source, /className="rah-message-task-link"/u);
  assert.match(
    source,
    /data-task-status=\{taskStatusPresentation\(task\)\.id\}/u,
  );
  assert.match(source, /打开任务 #\$\{task\.taskNumber\}/u);
  assert.match(source, /@\{taskAgent\.displayName \|\| taskAgent\.handle\}/u);
  assert.match(
    css,
    /\.rah-message-task-link\s*\{[^}]*height:\s*20px[^}]*font:\s*700 10px\/10px var\(--sans\)[^}]*gap:\s*4px[^}]*padding:\s*0 6px/su,
  );
  assert.match(css, /--rah-task-review-ink:\s*var\(--brutal-pink-950\)/u);
  assert.match(
    css,
    /\.rah-message-task-link\s*\{[^}]*border:\s*1px solid var\(--ink\)[^}]*color:\s*var\(--rah-task-review-ink\)/su,
  );
  assert.match(
    css,
    /\.rah-message-task-link svg\s*\{[^}]*height:\s*10px[^}]*width:\s*10px/su,
  );
  assert.match(
    css,
    /\.rah-message-task-link:hover:not\(:disabled\)\s*\{[^}]*filter:\s*brightness\(0\.9\)/su,
  );
});

test("inline Task replies reuse the canonical Agent avatar identity", () => {
  const app = read("App.tsx");
  const source = read("components/conversation-panes.tsx");
  assert.match(source, /actorId: string/u);
  assert.match(app, /actorId: message\.actorId/u);
  assert.match(source, /participantId \}\) => participantId === actorId/u);
  assert.match(
    source,
    /<AgentAvatar[\s\S]*?agent=\{replyAgent\}[\s\S]*?showStatus=\{false\}[\s\S]*?size="compact"/u,
  );
  assert.doesNotMatch(
    source,
    /className="avatar xs rah-avatar"[\s\S]*?reply\.author\.slice/u,
  );
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
  assert.match(
    read("panel-foundations.css"),
    /\.rah-panel-resizer\s*\{[^}]*width:\s*8px/su,
  );
  assert.match(source, /<PanelHeader kind="thread"/u);
  assert.match(
    read("panel-layout.css"),
    /\.rah-panel-header\s*\{[^}]*height:\s*var\(--head-h\)/su,
  );
  assert.match(css, /\.rah-thread-title b\s*\{[^}]*font-size:\s*16px/su);
});

test("WorkspaceScreen owns one persistent thread-panel width and its resizer", () => {
  const app = read("App.tsx");
  assert.match(app, /useThreadPanelWidth/u);
  assert.match(app, /--thread-w/u);
  assert.match(app, /<ThreadPanelResizer/u);
  assert.match(app, /loadEarlierThreadMessages/u);
  assert.match(app, /searchActiveThread/u);
});
