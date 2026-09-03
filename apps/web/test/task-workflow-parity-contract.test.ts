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
