import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  taskAttentionLabel,
  taskStatusPresentation,
} from "../src/task-presentation.ts";

test("all task surfaces share the five Raft status labels and tones", () => {
  assert.deepEqual(taskStatusPresentation("todo"), {
    id: "todo",
    label: "待办",
    tone: "orange",
  });
  assert.deepEqual(taskStatusPresentation("waiting_input"), {
    id: "in-progress",
    label: "进行中",
    tone: "cyan",
  });
  assert.deepEqual(taskStatusPresentation("submitted"), {
    id: "review",
    label: "待确认",
    tone: "purple",
  });
  assert.deepEqual(taskStatusPresentation("completed"), {
    id: "done",
    label: "完成",
    tone: "green",
  });
  assert.deepEqual(taskStatusPresentation("cancelled"), {
    id: "closed",
    label: "已关闭",
    tone: "gray",
  });
  assert.equal(taskAttentionLabel({ state: "claimed" }), "已认领");
  assert.equal(taskAttentionLabel({ state: "waiting_input" }), "等待输入");
  assert.equal(
    taskAttentionLabel({ state: "blocked", blockedReason: "等待授权" }),
    "已阻塞：等待授权",
  );
  assert.equal(taskAttentionLabel({ state: "submitted" }), undefined);
});

test("Room task cards never leak legacy state strings or synthetic Agent initials", async () => {
  const source = await readFile(
    new URL("../src/components/conversation-panes.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /\{task\.state\}/u);
  assert.doesNotMatch(source, /agent\.handle\.slice\(0, 1\)/u);
  assert.match(
    source,
    /<AgentAvatar\s+agent=\{agent\}\s+showStatus=\{false\}\s+size="compact"\s*\/>/u,
  );
});

test("global Tasks keeps the Raft heading semantics and has no local-only refresh action", async () => {
  const source = await readFile(
    new URL("../src/components/global-discovery.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /<h2>\{title\}<\/h2>/u);
  const taskSurface = source.slice(
    source.indexOf("function GlobalTasks("),
    source.indexOf("function GlobalSearch("),
  );
  assert.doesNotMatch(taskSurface, /onRefresh=/u);
  assert.doesNotMatch(taskSurface, /刷新任务/u);
});

test("global Task cards keep Raft's separate drag and visual interaction layers", async () => {
  const board = await readFile(
    new URL("../src/components/global-task-board.tsx", import.meta.url),
    "utf8",
  );
  const filter = await readFile(
    new URL("../src/components/discovery-filter.tsx", import.meta.url),
    "utf8",
  );
  const styles = await readFile(
    new URL("../src/discovery-controls.css", import.meta.url),
    "utf8",
  );
  const discoveryStyles = await readFile(
    new URL("../src/global-discovery.css", import.meta.url),
    "utf8",
  );

  assert.match(board, /data-testid="task-board-draggable-card"/u);
  assert.match(board, /className=\{`rah-global-task-drag-shell/u);
  assert.match(
    board,
    /<div\s+draggable=\{false\}\s+className="kcard rah-global-task-card"/u,
  );
  assert.doesNotMatch(
    board,
    /className=\{`kcard rah-global-task-card[^`]*`\}[\s\S]{0,160}CSS\.Translate/u,
  );
  assert.match(filter, /variant === "status" \? "pencil" : "chevron-down"/u);
  assert.match(
    styles,
    /\.rah-global-task-card\s*\{[\s\S]*?transition:\s*all 100ms;/u,
  );
  assert.match(
    styles,
    /\.rah-global-task-card:hover\s*\{[\s\S]*?transform:\s*translateY\(-1px\);/u,
  );
  assert.match(
    styles,
    /\.rah-global-task-card:active\s*\{[\s\S]*?transform:\s*translate\(1px, 1px\);/u,
  );
  assert.match(
    styles,
    /\.rah-task-status-picker \.task-filter-trigger > svg:last-child\s*\{\s*width: 10px;\s*height: 10px;/u,
  );
  assert.doesNotMatch(
    discoveryStyles,
    /\.rah-global-task-card(?::hover)?\s*\{/u,
  );
});
