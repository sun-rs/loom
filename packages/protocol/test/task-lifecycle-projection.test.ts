import assert from "node:assert/strict";
import test from "node:test";

import {
  projectTaskLifecycle,
  taskWorkflowTransitionOptions,
  taskWorkflowStatus,
  type TaskState,
} from "../src/index.ts";

test("Raft workflow options preserve the ordinary graph and manager override", () => {
  assert.deepEqual(taskWorkflowTransitionOptions("todo", false), [
    "todo",
    "in_progress",
    "closed",
  ]);
  assert.deepEqual(taskWorkflowTransitionOptions("in_review", false), [
    "in_review",
    "done",
    "in_progress",
    "closed",
  ]);
  assert.deepEqual(taskWorkflowTransitionOptions("done", false), [
    "done",
    "todo",
    "in_progress",
    "in_review",
    "closed",
  ]);
  assert.deepEqual(taskWorkflowTransitionOptions("closed", false), [
    "closed",
    "todo",
    "in_progress",
  ]);
  assert.deepEqual(taskWorkflowTransitionOptions("todo", true), [
    "todo",
    "in_progress",
    "in_review",
    "done",
    "closed",
  ]);
});

test("legacy canonical task states project onto the five Raft workflow states", () => {
  const expected: Record<
    TaskState,
    "closed" | "done" | "in_progress" | "in_review" | "todo"
  > = {
    todo: "todo",
    claimed: "in_progress",
    in_progress: "in_progress",
    waiting_input: "in_progress",
    blocked: "in_progress",
    submitted: "in_review",
    completed: "done",
    cancelled: "closed",
  };

  for (const [state, workflowStatus] of Object.entries(expected)) {
    assert.equal(taskWorkflowStatus(state as TaskState), workflowStatus);
  }
});

test("execution and attention remain orthogonal to the public workflow status", () => {
  assert.deepEqual(
    projectTaskLifecycle({ state: "submitted", workflowStatus: "in_progress" }),
    {
      workflowStatus: "in_progress",
      executionPhase: "idle",
    },
  );
  assert.deepEqual(projectTaskLifecycle({ state: "claimed" }), {
    workflowStatus: "in_progress",
    executionPhase: "claimed",
  });
  assert.deepEqual(projectTaskLifecycle({ state: "in_progress" }), {
    workflowStatus: "in_progress",
    executionPhase: "running",
  });
  assert.deepEqual(projectTaskLifecycle({ state: "waiting_input" }), {
    workflowStatus: "in_progress",
    executionPhase: "idle",
    attention: { kind: "waiting_input" },
  });
  assert.deepEqual(
    projectTaskLifecycle({ state: "blocked", blockedReason: "等待外部凭据" }),
    {
      workflowStatus: "in_progress",
      executionPhase: "idle",
      attention: { kind: "blocked", reason: "等待外部凭据" },
    },
  );
  assert.deepEqual(
    projectTaskLifecycle({ state: "cancelled" }, { cancellationPending: true }),
    {
      workflowStatus: "closed",
      executionPhase: "cancelling",
    },
  );
});

test("blocked projection fails closed without canonical reason evidence", () => {
  assert.throws(
    () => projectTaskLifecycle({ state: "blocked" }),
    /blocked Task projection requires blockedReason/u,
  );
});
