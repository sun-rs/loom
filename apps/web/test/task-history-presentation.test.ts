import assert from "node:assert/strict";
import test from "node:test";
import {
  taskAmendmentDetails,
  taskHistoryOperations,
} from "../src/task-history-presentation.ts";
test("Task history is chronological operations; claim records both ownership and status, progress stays in discussion", () => {
  const base = {
    eventId: "event",
    roomSeq: 1,
    actorId: "agent",
    createdAt: "2026-09-14T00:00:00.000Z",
  };
  const rows = taskHistoryOperations([
    {
      ...base,
      eventId: "progress",
      roomSeq: 3,
      type: "task.progressed",
      progress: "Long agent prose",
    },
    {
      ...base,
      eventId: "claim",
      roomSeq: 2,
      type: "task.claimed",
      workflowStatus: "in_progress",
      previousWorkflowStatus: "todo",
    },
    {
      ...base,
      type: "task.created",
      workflowStatus: "todo",
      title: "Task title",
    },
  ]);
  assert.deepEqual(
    rows.map((r) => r.title),
    ["创建任务", "变更负责人", "变更状态"],
  );
});
test("Raft close/reopen are distinct operations and amendments retain field transitions", () => {
  const base = {
    eventId: "e",
    roomSeq: 1,
    actorId: "human",
    createdAt: "2026-09-14T00:00:00Z",
  };
  assert.deepEqual(
    taskHistoryOperations([
      {
        ...base,
        type: "task.cancelled",
        workflowStatus: "closed",
        previousWorkflowStatus: "todo",
      },
      {
        ...base,
        eventId: "r",
        roomSeq: 2,
        type: "task.reopened",
        workflowStatus: "todo",
        previousWorkflowStatus: "closed",
      },
    ]).map((row) => row.title),
    ["关闭任务", "重新打开任务"],
  );
});

test("amendments show original and new public fields, including a cleared description", () => {
  assert.equal(
    taskAmendmentDetails({
      title: { from: "Before", to: "After" },
      description: { from: "Old", to: null },
    }),
    "标题：Before → After · 描述：Old → —",
  );
});
