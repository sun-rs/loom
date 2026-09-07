import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { RahClient } from "@rah-os/client-sdk";
import type { Task } from "@rah-os/protocol";
import { createLatestRequest } from "../src/latest-request.ts";

import {
  appendRoomTaskWindowPage,
  createRoomTaskWindow,
  loadEarlierRoomTaskOverview,
  loadRoomTaskOverview,
  mergeRoomTaskPages,
  refreshRoomTaskWindow,
  ROOM_TASK_EARLIER_PAGE_WINDOW,
} from "../src/room-task-pages.ts";

const read = (path: string) =>
  readFile(new URL(`../../../${path}`, import.meta.url), "utf8");

const task = (input: {
  state: Task["state"];
  taskId: string;
  taskNumber: number;
}): Task => ({
  collaboratorIds: [],
  createdAt: "2026-09-06T00:00:00.000Z",
  creatorId: "human",
  dependencyTaskIds: [],
  reviewerIds: [],
  roomId: "room",
  sourceMessageId: `message-${input.taskId}`,
  state: input.state,
  taskId: input.taskId,
  taskNumber: input.taskNumber,
  threadId: `thread-${input.taskId}`,
  title: input.taskId,
  updatedAt: "2026-09-06T00:00:00.000Z",
});

test("Room Task polling combines recent history with the bounded active-work query", async () => {
  const calls: unknown[] = [];
  const oldActive = task({
    state: "todo",
    taskId: "old-active",
    taskNumber: 1,
  });
  const recentTerminal = task({
    state: "cancelled",
    taskId: "recent-terminal",
    taskNumber: 206,
  });
  recentTerminal.cancelledAt = "2026-09-06T00:00:00.000Z";
  recentTerminal.cancellationReason = "closed";
  const client = {
    request: async (_operation: string, input: unknown) => {
      calls.push(input);
      return "states" in (input as Record<string, unknown>)
        ? { tasks: [oldActive] }
        : { nextBeforeTaskNumber: 7, tasks: [recentTerminal] };
    },
  } as unknown as RahClient;

  assert.deepEqual((await loadRoomTaskOverview(client, "room")).tasks, [
    oldActive,
    recentTerminal,
  ]);
  assert.deepEqual(calls, [
    { limit: 200, roomId: "room" },
    {
      limit: 500,
      roomId: "room",
      states: [
        "todo",
        "claimed",
        "in_progress",
        "waiting_input",
        "blocked",
        "submitted",
      ],
    },
  ]);
});

test("Room Task history exposes a bounded continuation instead of dropping the 501st active Task", async () => {
  const calls: unknown[] = [];
  const oldest = task({ state: "todo", taskId: "oldest", taskNumber: 1 });
  const newest = task({ state: "todo", taskId: "newest", taskNumber: 501 });
  const client = {
    request: async (_operation: string, input: unknown) => {
      calls.push(input);
      const request = input as {
        beforeTaskNumber?: number;
        states?: readonly string[];
      };
      if (request.states === undefined) return { tasks: [] };
      return request.beforeTaskNumber === 2
        ? { tasks: [oldest] }
        : { nextBeforeTaskNumber: 2, tasks: [newest] };
    },
  } as unknown as RahClient;

  const first = await loadRoomTaskOverview(client, "room");
  assert.deepEqual(first.tasks, [newest]);
  assert.deepEqual(first.nextPage, { activeBeforeTaskNumber: 2 });
  const earlier = await loadEarlierRoomTaskOverview(
    client,
    "room",
    first.nextPage,
  );
  assert.deepEqual(mergeRoomTaskPages(first, earlier), [oldest, newest]);
  assert.equal(earlier.nextPage, undefined);
  assert.deepEqual(calls.at(-1), {
    beforeTaskNumber: 2,
    limit: 500,
    roomId: "room",
    states: [
      "todo",
      "claimed",
      "in_progress",
      "waiting_input",
      "blocked",
      "submitted",
    ],
  });
});

test("Room Task window survives repeated polling, advances, refreshes older state, and stays bounded", async () => {
  const newest = task({ state: "todo", taskId: "newest", taskNumber: 1_001 });
  const older = task({ state: "todo", taskId: "older", taskNumber: 501 });
  const oldest = task({ state: "todo", taskId: "oldest", taskNumber: 1 });
  let olderState: Task["state"] = "todo";
  const client = {
    request: async (_operation: string, input: unknown) => {
      const request = input as {
        beforeTaskNumber?: number;
        states?: readonly string[];
      };
      if (request.states === undefined) return { tasks: [] };
      if (request.beforeTaskNumber === 502)
        return {
          nextBeforeTaskNumber: 2,
          tasks: [
            {
              ...older,
              state: olderState,
              updatedAt: `2026-09-06T00:00:0${olderState === "todo" ? "0" : "1"}.000Z`,
            },
          ],
        };
      if (request.beforeTaskNumber === 2) return { tasks: [oldest] };
      return { nextBeforeTaskNumber: 502, tasks: [newest] };
    },
  } as unknown as RahClient;

  let window = createRoomTaskWindow(await loadRoomTaskOverview(client, "room"));
  assert.deepEqual(window.nextPage, { activeBeforeTaskNumber: 502 });
  const firstCursor = window.nextPage!;
  window = appendRoomTaskWindowPage(
    window,
    firstCursor,
    await loadEarlierRoomTaskOverview(client, "room", firstCursor),
  );
  assert.deepEqual(
    window.tasks.map(({ taskId }) => taskId),
    ["older", "newest"],
  );
  assert.deepEqual(window.nextPage, { activeBeforeTaskNumber: 2 });

  window = await refreshRoomTaskWindow(client, "room", window);
  window = await refreshRoomTaskWindow(client, "room", window);
  assert.deepEqual(
    window.tasks.map(({ taskId }) => taskId),
    ["older", "newest"],
    "ordinary polling must not drop a visited continuation page",
  );
  assert.deepEqual(window.nextPage, { activeBeforeTaskNumber: 2 });

  olderState = "blocked";
  window = await refreshRoomTaskWindow(client, "room", window);
  assert.equal(
    window.tasks.find(({ taskId }) => taskId === "older")?.state,
    "blocked",
    "a visited older page is re-read instead of retaining stale Task state",
  );
  const secondCursor = window.nextPage!;
  window = appendRoomTaskWindowPage(
    window,
    secondCursor,
    await loadEarlierRoomTaskOverview(client, "room", secondCursor),
  );
  assert.deepEqual(
    window.tasks.map(({ taskId }) => taskId),
    ["oldest", "older", "newest"],
  );

  let bounded = createRoomTaskWindow({
    nextPage: { activeBeforeTaskNumber: -1 },
    tasks: [],
  });
  for (let index = 0; index < ROOM_TASK_EARLIER_PAGE_WINDOW + 2; index += 1) {
    const cursor = bounded.nextPage!;
    bounded = appendRoomTaskWindowPage(bounded, cursor, {
      nextPage: { activeBeforeTaskNumber: -(index + 2) },
      tasks: [],
    });
  }
  assert.equal(bounded.earlierPages.length, ROOM_TASK_EARLIER_PAGE_WINDOW);
});

test("a late Room projection cannot publish after a newer Room read starts", () => {
  const reads = createLatestRequest();
  const firstRoom = reads.begin();
  const secondRoom = reads.begin();
  assert.equal(firstRoom.current(), false);
  assert.equal(firstRoom.signal.aborted, true);
  assert.equal(secondRoom.current(), true);
});

test("the isolated production fixture owns a canonical non-empty Task page sample", async () => {
  const [fixture, launcher] = await Promise.all([
    read("scripts/run-multi-agent-web-fixture.mjs"),
    read("scripts/ui-shell-browser-scenarios.mjs"),
  ]);

  assert.match(launcher, /RAH_FIXTURE_TASK_MATRIX:\s*"1"/u);
  assert.match(fixture, /seedTaskPageFixture/u);
  assert.match(fixture, /updateTaskWorkflowStatus/u);
  assert.doesNotMatch(
    fixture,
    /UPDATE tasks SET (?:state|workflow_status)/u,
    "the browser fixture must seed Task truth through Kernel commands, never SQL projection edits",
  );
});

test("the browser Task page-family gate proves Raft behavior and canonical results", async () => {
  const scenario = await read(
    "scripts/ui-discovery-family-browser-scenarios.mjs",
  );

  assert.match(
    scenario,
    /const taskColumns = \[[\s\S]*?\["todo", "待办", true\][\s\S]*?\["in-progress", "进行中", true\][\s\S]*?\["review", "待确认", true\][\s\S]*?\["done", "完成", false\][\s\S]*?\["closed", "已关闭", false\]/u,
  );
  assert.match(scenario, /aria-expanded/u);
  assert.match(scenario, /任务 #\$\{taskNumber\} 状态/u);
  assert.match(scenario, /\/v3\/client\/tasks\/workflow/u);
  assert.match(scenario, /\/v3\/client\/tasks\/list/u);
  assert.match(scenario, /task\.cancelled/u);
  assert.match(scenario, /task\.reopened/u);
  assert.match(scenario, /Room active continuation/u);
  assert.match(scenario, /载入更早任务/u);
  assert.match(scenario, /beforeTaskNumber === 2/u);
  assert.match(scenario, /390/u);
  assert.match(scenario, /1440/u);
});

test("Room Task behavior rows are machine-owned after the page-family gate", async () => {
  const registry = JSON.parse(
    await read("docs/product/ui-behavior-registry.json"),
  ) as {
    behaviors: Array<{
      id: string;
      status: string;
      owners: string[];
      adoptions: string[];
      scenarios: string[];
    }>;
  };

  for (const id of ["B035", "B037", "B038"]) {
    const behavior = registry.behaviors.find((entry) => entry.id === id);
    assert.ok(behavior, `missing ${id}`);
    assert.equal(behavior.status, "migrated", `${id} is not migrated`);
    assert.ok(behavior.owners.length > 0, `${id} has no owner`);
    assert.ok(behavior.adoptions.length > 0, `${id} has no Raft adoption`);
    assert.ok(
      behavior.scenarios.includes("discovery-page-family"),
      `${id} is not exercised by the browser page-family gate`,
    );
  }
});

test("Task creation keeps Raft's multi-title default and offers one atomic collaboration step", async () => {
  const [dialog, participantFields, execution, scenario] = await Promise.all([
    read("apps/web/src/components/task-dialogs.tsx"),
    read("apps/web/src/components/task-participant-fields.tsx"),
    read("apps/web/src/task-create-execution.ts"),
    read("scripts/ui-discovery-family-browser-scenarios.mjs"),
  ]);

  assert.match(dialog, /titles:\s*readonly/u);
  assert.match(dialog, /任务 \$\{String\(index \+ 1\)\}/u);
  assert.match(dialog, /再加一条/u);
  assert.match(dialog, /创建 \$\{String\(nonempty\.length\)\} 个任务/u);
  assert.match(dialog, /移除任务 \$\{String\(index \+ 1\)\}/u);
  assert.match(dialog, /配置协作与依赖/u);
  assert.match(participantFields, /aria-label="任务负责人"/u);
  assert.match(participantFields, /协作者/u);
  assert.match(participantFields, /审阅者/u);
  assert.match(dialog, /前置任务/u);
  assert.match(dialog, /taskParticipantsForSelection/u);
  assert.doesNotMatch(
    dialog,
    /详细说明（可选）|审阅者（提交后唤醒，可选）/u,
    "the primary Raft create dialog must not silently become an unrelated advanced form",
  );
  assert.match(execution, /for \(const task of input\.titles\)/u);
  assert.match(
    execution,
    /idempotencyKey:\s*`web-board-task-\$\{task\.clientId\}`/u,
  );
  assert.match(
    execution,
    /collaboratorIds:\s*\[\.\.\.input\.collaboratorIds\]/u,
  );
  assert.match(
    execution,
    /dependencyTaskIds:\s*\[\.\.\.input\.dependencyTaskIds\]/u,
  );
  assert.match(execution, /reviewerIds:\s*\[\.\.\.input\.reviewerIds\]/u);
  assert.match(execution, /assigneeId:\s*input\.assigneeId/u);
  assert.match(dialog, /submissionLocked/u);
  assert.match(dialog, /acceptedClientIds/u);
  assert.match(dialog, /只会重试尚未确认的任务/u);
  assert.match(participantFields, /disabled\?: boolean/u);
  assert.match(execution, /onAccepted\(task\.clientId\)/u);
  assert.match(scenario, /创建 2 个任务/u);
  assert.match(scenario, /task\.created/u);
  assert.match(scenario, /配置协作与依赖/u);
  assert.match(scenario, /前置任务/u);
  assert.match(scenario, /dependencyTaskIds/u);
});

test("the Room Task page exposes its bounded continuation in the real Task pane", async () => {
  const [app, pane] = await Promise.all([
    read("apps/web/src/App.tsx"),
    read("apps/web/src/components/conversation-panes.tsx"),
  ]);
  assert.match(app, /loadEarlierRoomTaskOverview/u);
  assert.match(app, /refreshRoomTaskWindow/u);
  assert.match(app, /roomDataReads\.current\.begin/u);
  assert.match(app, /taskWindows\.current/u);
  assert.match(app, /taskNextPage/u);
  assert.match(pane, /载入更早任务/u);
  assert.match(pane, /onLoadEarlierTasks/u);
});
