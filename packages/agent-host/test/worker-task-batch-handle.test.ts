import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkerTaskBatchCommand } from "../src/worker-task-batch-cli.ts";

test("single-title creation with an @handle uses the handle-aware batch facade", () => {
  const request = parseWorkerTaskBatchCommand(
    "task-create",
    { title: "One task", assignee: "@worker" },
    {},
  );
  assert.equal(request?.path, "/v1/worker/tasks/create-batch");
  assert.deepEqual(request?.body, {
    titles: ["One task"],
    assignee: "@worker",
  });
});

test("single-title creation with a legacy participant ID retains compatibility", () => {
  assert.equal(
    parseWorkerTaskBatchCommand(
      "task-create",
      { title: "One task", assignee: "participant-1" },
      {},
    ),
    undefined,
  );
});
