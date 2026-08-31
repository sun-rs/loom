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
test("menu and drag policy preserve execution/review facts and creator ownership", () => {
  assert.equal(
    globalTaskTransition(task, "closed", "human").operation,
    "task.cancel",
  );
  assert.ok(globalTaskTransition(task, "done", "human").reason);
  assert.ok(globalTaskTransition(task, "in-progress", "human").reason);
  assert.ok(globalTaskTransition(task, "review", "human").reason);
  assert.ok(globalTaskTransition(task, "closed", "another").reason);
  assert.equal(
    globalTaskTransition({ ...task, state: "cancelled" }, "todo", "human")
      .operation,
    "task.reopen",
  );
});
test("global writes synchronize the target Room, retain idempotency on retry, and reject stale cards", async () => {
  const calls: Array<[string, unknown]> = [];
  let sync = 0,
    stale = true;
  const client = {
    request: async (operation: string, input: unknown) => {
      calls.push([operation, input]);
      if (operation === "health") return { capabilities: { taskWrite: true } };
      if (operation === "task.list") return { tasks: [task] };
      if (operation === "task.cancel" && stale) {
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
    principalId: "human",
    reason: "audit",
    idempotencyKey: "fixed",
    session,
  });
  const writes = calls
    .filter(([op]) => op === "task.cancel")
    .map(([, input]) => input);
  assert.deepEqual(writes, [
    {
      taskId: "task",
      basedOnRoomSeq: 701,
      idempotencyKey: "fixed",
      reason: "audit",
    },
    {
      taskId: "task",
      basedOnRoomSeq: 702,
      idempotencyKey: "fixed",
      reason: "audit",
    },
  ]);
  assert.ok(
    calls
      .filter(([op]) => op === "task.list")
      .every(
        ([, input]) => (input as { roomId: string }).roomId === "other-room",
      ),
  );
  await assert.rejects(
    applyGlobalTaskTransition({
      client,
      task: { ...task, state: "claimed" },
      target: "closed",
      principalId: "human",
      reason: "audit",
      idempotencyKey: "stale",
      session,
    }),
    /变化|刷新/,
  );
});
test("blank cancellation, unavailable capability and incomplete review never write", async () => {
  const calls: string[] = [];
  const submitted = {
    ...task,
    state: "submitted" as const,
    reviewerIds: ["reviewer"],
  };
  const client = {
    request: async (op: string) => {
      calls.push(op);
      if (op === "health") return { capabilities: { taskWrite: true } };
      if (op === "task.list") return { tasks: [submitted] };
      if (op === "task.review.list") return { submissions: [], reviews: [] };
      throw new Error("unexpected mutation");
    },
  } as unknown as RahClient;
  const session = {
    syncUntilCurrent: async () => ({
      caughtUp: true,
      state: { latestRoomSeq: 2 },
    }),
  };
  await assert.rejects(
    applyGlobalTaskTransition({
      client,
      task: submitted,
      target: "done",
      principalId: "human",
      idempotencyKey: "done",
      session,
    }),
    /审阅/,
  );
  await assert.rejects(
    applyGlobalTaskTransition({
      client,
      task,
      target: "closed",
      principalId: "human",
      reason: " ",
      idempotencyKey: "empty",
      session,
    }),
    /原因/,
  );
  assert.ok(
    calls.every((op) => op !== "task.cancel" && op !== "task.complete"),
  );
});
