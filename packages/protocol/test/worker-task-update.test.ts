import assert from "node:assert/strict";
import test from "node:test";
import { WorkerTaskUpdateRequestSchema } from "../src/worker-task-update.ts";

test("Task status setter accepts only five workflow states and optional explicit summary", () => {
  for (const status of ["todo", "in_progress", "in_review", "done", "closed"]) {
    assert.deepEqual(
      WorkerTaskUpdateRequestSchema.parse({ taskId: "task-1", status }),
      { taskId: "task-1", status },
    );
  }
  assert.deepEqual(
    WorkerTaskUpdateRequestSchema.parse({
      taskId: "task-1",
      status: "in_review",
      summary: " Result ",
    }),
    { taskId: "task-1", status: "in_review", summary: "Result" },
  );
  assert.equal(
    WorkerTaskUpdateRequestSchema.safeParse({
      taskId: "task-1",
      status: "blocked",
    }).success,
    false,
  );
  assert.equal(
    WorkerTaskUpdateRequestSchema.safeParse({
      taskId: "task-1",
      status: "in_review",
      summary: " ",
    }).success,
    false,
  );
  assert.equal(
    WorkerTaskUpdateRequestSchema.safeParse({
      taskId: "task-1",
      status: "done",
      actorId: "human",
    }).success,
    false,
  );
});
