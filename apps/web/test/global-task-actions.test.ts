import assert from "node:assert/strict";
import test from "node:test";
import type { RahClient } from "@rah-os/client-sdk";
import type { Task } from "@rah-os/protocol";
import {
  globalTaskTransition,
  applyGlobalTaskTransition,
} from "../src/global-task-actions.ts";

const task: Task = {
  taskId: "task",
  roomId: "other-room",
  creatorId: "human",
  title: "Cross Room",
  sourceMessageId: "root",
  state: "todo",
  taskNumber: 1,
  threadId: "thread",
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
  collaboratorIds: [],
  reviewerIds: [],
  dependencyTaskIds: [],
};

test("Raft manager can select every distinct business status", () => {
  assert.ok(globalTaskTransition(task, "closed", false).reason);
  assert.equal(
    globalTaskTransition(task, "closed", true).operation,
    "task.workflow.update",
  );
  assert.equal(
    globalTaskTransition(task, "in-progress", true).operation,
    "task.workflow.update",
  );
  assert.equal(
    globalTaskTransition(task, "review", true).operation,
    "task.workflow.update",
  );
  assert.equal(
    globalTaskTransition(task, "done", true).operation,
    "task.workflow.update",
  );
  assert.equal(
    globalTaskTransition(
      { ...task, state: "submitted", workflowStatus: "in_progress" },
      "done",
      true,
    ).operation,
    "task.workflow.update",
  );
  assert.equal(
    globalTaskTransition(
      {
        ...task,
        state: "cancelled",
        workflowStatus: "done",
        cancellationReason: "Closed",
        cancelledAt: "2026-08-30T00:01:00.000Z",
      },
      "todo",
      true,
    ).operation,
    "task.workflow.update",
  );
});

test("global writes synchronize the target Room, retain idempotency on retry, and reject stale cards", async () => {
  const calls: Array<[string, unknown]> = [];
  let sync = 0;
  let stale = true;
  const client = {
    request: async (operation: string, input: unknown) => {
      calls.push([operation, input]);
      if (operation === "health") return { capabilities: { taskWrite: true } };
      if (operation === "task.get") return { task };
      if (operation === "task.workflow.update" && stale) {
        stale = false;
        throw { code: "stale_context", status: 409 };
      }
      return {};
    },
  } as unknown as RahClient;
  const session = {
    syncUntilCurrent: async () => ({
      caughtUp: true,
      state: { latestRoomSeq: ++sync + 700 },
    }),
  };
  await applyGlobalTaskTransition({
    client,
    task,
    target: "closed",
    canManageAnyTask: true,
    idempotencyKey: "fixed",
    session,
  });
  const writes = calls
    .filter(([op]) => op === "task.workflow.update")
    .map(([, input]) => input);
  assert.deepEqual(writes, [
    {
      taskId: "task",
      basedOnRoomSeq: 701,
      idempotencyKey: "fixed",
      workflowStatus: "closed",
    },
    {
      taskId: "task",
      basedOnRoomSeq: 702,
      idempotencyKey: "fixed",
      workflowStatus: "closed",
    },
  ]);
  assert.deepEqual(
    calls.filter(([op]) => op === "task.get").map(([, input]) => input),
    [
      { roomId: "other-room", taskId: "task" },
      { roomId: "other-room", taskId: "task" },
    ],
  );
  await assert.rejects(
    applyGlobalTaskTransition({
      client,
      task: { ...task, state: "claimed" },
      target: "closed",
      canManageAnyTask: true,
      idempotencyKey: "stale",
      session,
    }),
    /变化|刷新/,
  );
});

test("the five-state UI sends one typed intent for Kernel lifecycle interpretation", async () => {
  const calls: string[] = [];
  const submitted = {
    ...task,
    state: "submitted" as const,
    workflowStatus: "in_review" as const,
    reviewerIds: ["reviewer"],
  };
  const client = {
    request: async (op: string) => {
      calls.push(op);
      if (op === "health") return { capabilities: { taskWrite: true } };
      if (op === "task.get") return { task: submitted };
      if (op === "task.workflow.update") return {};
      throw new Error(`unexpected mutation ${op}`);
    },
  } as unknown as RahClient;
  const session = {
    syncUntilCurrent: async () => ({
      caughtUp: true,
      state: { latestRoomSeq: 2 },
    }),
  };
  await applyGlobalTaskTransition({
    client,
    task: submitted,
    target: "done",
    canManageAnyTask: true,
    idempotencyKey: "done",
    session,
  });
  assert.ok(calls.includes("task.workflow.update"));
  assert.ok(!calls.includes("task.cancel"));
  assert.ok(!calls.includes("task.complete"));
  assert.ok(!calls.includes("task.review.list"));
});
