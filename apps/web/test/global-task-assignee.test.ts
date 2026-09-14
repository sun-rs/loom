import assert from "node:assert/strict";
import test from "node:test";
import type { RahClient } from "@rah-os/client-sdk";
import type { Task } from "@rah-os/protocol";
import {
  createTaskAssigneeCommand,
  taskAssigneeMode,
} from "../src/global-task-assignee.ts";
const task: Task = {
  taskId: "t",
  roomId: "r",
  creatorId: "h",
  title: "Task",
  sourceMessageId: "m",
  threadId: "th",
  taskNumber: 1,
  state: "todo",
  createdAt: "2026-09-08T00:00:00.000Z",
  updatedAt: "2026-09-08T00:00:00.000Z",
  collaboratorIds: [],
  reviewerIds: [],
  dependencyTaskIds: [],
};
test("assignee controls project authority independently of business status", () => {
  assert.equal(taskAssigneeMode(task, "h"), "idle");
  assert.equal(taskAssigneeMode(task, "other"), "idle");
  assert.equal(
    taskAssigneeMode(
      { ...task, state: "in_progress", assigneeId: "a", claimedBy: "a" },
      "h",
    ),
    "idle",
  );
  assert.equal(taskAssigneeMode({ ...task, state: "submitted" }, "h"), "idle");
});
test("assignee commands reject a changed task before mutation and preserve original causal identity after an uncertain receipt", async () => {
  let current = { ...task };
  let failReceipt = true;
  let sequence = 3;
  const writes: Array<[string, unknown]> = [];
  const client = {
    request: async (operation: string, input: unknown) => {
      if (operation === "health") return { capabilities: { taskWrite: true } };
      if (operation === "task.get") return { task: current };
      writes.push([operation, input]);
      if (failReceipt) {
        failReceipt = false;
        current = {
          ...task,
          assigneeId: "a",
          updatedAt: "2026-09-08T00:00:01.000Z",
        };
        throw new Error("response lost");
      }
      return { task: current };
    },
  } as unknown as RahClient;
  const session = {
    syncUntilCurrent: async () => ({
      caughtUp: true,
      state: { latestRoomSeq: ++sequence },
    }),
  };
  const command = createTaskAssigneeCommand({
    client,
    task,
    principalId: "h",
    intent: { kind: "assign", assigneeId: "a" },
    idempotencyKey: "fixed",
    session,
  });
  await assert.rejects(command(), /response lost/);
  await command();
  assert.deepEqual(writes[0], writes[1]);
  assert.equal((writes[0]![1] as { basedOnRoomSeq: number }).basedOnRoomSeq, 4);
  const stale = createTaskAssigneeCommand({
    client,
    task,
    principalId: "h",
    intent: { kind: "assign", assigneeId: "b" },
    idempotencyKey: "different",
    session,
  });
  await assert.rejects(stale(), /任务已发生变化/);
  assert.equal(writes.length, 2);
});
test("active assignment uses the same backend edit and causal identity", async () => {
  const active = {
    ...task,
    state: "in_progress" as const,
    assigneeId: "a",
    claimedBy: "a",
  };
  const calls: Array<[string, unknown]> = [];
  const client = {
    request: async (operation: string, input: unknown) => {
      if (operation === "health") return { capabilities: { taskWrite: true } };
      if (operation === "task.get") return { task: active };
      calls.push([operation, input]);
      return {};
    },
  } as unknown as RahClient;
  await createTaskAssigneeCommand({
    client,
    task: active,
    principalId: "h",
    intent: { kind: "assign", assigneeId: "b" },
    idempotencyKey: "reassign",
    session: {
      syncUntilCurrent: async () => ({
        caughtUp: true,
        state: { latestRoomSeq: 8 },
      }),
    },
  })();
  assert.deepEqual(calls, [
    [
      "task.assign",
      {
        taskId: "t",
        assigneeId: "b",
        idempotencyKey: "reassign",
        basedOnRoomSeq: 8,
      },
    ],
  ]);
});
