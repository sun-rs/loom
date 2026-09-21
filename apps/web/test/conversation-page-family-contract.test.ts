import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { Task } from "@rah-os/protocol";
import {
  messageTaskMenuAction,
  messageTaskMenuTarget,
} from "../src/message-task-menu-action.ts";

const read = (path: string) =>
  readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const readLibrary = (path: string) =>
  readFileSync(
    new URL(`../../../packages/ui-web/src/${path}`, import.meta.url),
    "utf8",
  );

function task(state: Task["state"]): Task {
  const workflowStatus =
    state === "submitted"
      ? ("in_review" as const)
      : state === "completed"
        ? ("done" as const)
        : state === "cancelled"
          ? ("closed" as const)
          : ("todo" as const);
  return {
    taskId: `task-${state}`,
    roomId: "room-a",
    creatorId: "human-a",
    collaboratorIds: [],
    title: `Task ${state}`,
    dependencyTaskIds: [],
    sourceMessageId: `message-${state}`,
    state,
    workflowStatus,
    taskNumber: 1,
    threadId: `thread-${state}`,
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
    reviewerIds: [],
  };
}

test("message Task actions share the Human editable workflow", () => {
  for (const state of [
    "todo",
    "claimed",
    "in_progress",
    "waiting_input",
    "blocked",
    "submitted",
    "completed",
    "cancelled",
  ] as const) {
    assert.equal(
      messageTaskMenuTarget(task(state)),
      state === "completed" ? "todo" : "done",
    );
  }
  assert.deepEqual(messageTaskMenuAction(task("submitted"), true), {
    kind: "complete",
    label: "标记为完成",
  });
  assert.deepEqual(messageTaskMenuAction(task("cancelled"), true), {
    kind: "complete",
    label: "标记为完成",
  });
  assert.deepEqual(messageTaskMenuAction(task("todo"), true), {
    kind: "complete",
    label: "标记为完成",
  });
  assert.deepEqual(messageTaskMenuAction(task("completed"), true), {
    kind: "reopen",
    label: "重新打开任务",
  });
  assert.deepEqual(messageTaskMenuAction(task("submitted"), false), {
    kind: "unavailable",
    label: "标记为完成",
    reason: "你没有管理此任务的权限",
  });
});

test("message context menu exposes only source-backed Thread and Task actions", () => {
  const menu = read("components/message-context-menu.tsx");
  const conversation = read("components/conversation-panes.tsx");

  assert.match(menu, /threadFollow/u);
  assert.match(menu, /取消关注消息列|关注消息列/u);
  assert.match(menu, /taskAction/u);
  assert.match(menu, /重新打开任务|标记为完成/u);
  assert.doesNotMatch(menu, /编辑消息|删除消息/u);
  assert.match(conversation, /thread\.followers/u);
  assert.match(conversation, /activity\.follow/u);
  assert.match(conversation, /messageTaskMenuAction/u);
});

test("Search owns shared loading, failure recovery, and IME request barriers", () => {
  const discovery = read("components/global-discovery.tsx");
  const loading = readLibrary("neo-brutalist/loading-state.tsx");

  assert.match(
    discovery,
    /onCompositionStart=\{\(\) => setComposing\(true\)\}/u,
  );
  assert.match(discovery, /!composing && searchActive/u);
  assert.match(discovery, /<LoadingState/u);
  assert.match(discovery, /搜索失败/u);
  assert.match(discovery, /onClick=\{result\.refresh\}/u);
  assert.match(loading, /role="status"/u);
  assert.match(loading, /rah-loading-spinner/u);
});
