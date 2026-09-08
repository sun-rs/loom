import assert from "node:assert/strict";
import test from "node:test";

import {
  WorkerTaskTrajectoryRequestSchema,
  WorkerTaskTrajectoryResponseSchema,
} from "../src/index.ts";

test("Worker Task trajectory request defaults a bounded page and rejects injection", () => {
  assert.deepEqual(
    WorkerTaskTrajectoryRequestSchema.parse({ taskId: "task-1" }),
    { limit: 50, taskId: "task-1" },
  );
  assert.deepEqual(
    WorkerTaskTrajectoryRequestSchema.parse({
      beforeSequence: 12,
      limit: 2,
      taskId: "task-1",
    }),
    { beforeSequence: 12, limit: 2, taskId: "task-1" },
  );
  assert.equal(
    WorkerTaskTrajectoryRequestSchema.safeParse({
      participantId: "attacker",
      taskId: "task-1",
    }).success,
    false,
    "a reviewer cannot select whose trajectory is read",
  );
  assert.equal(
    WorkerTaskTrajectoryRequestSchema.safeParse({ limit: 201, taskId: "t" })
      .success,
    false,
  );
  assert.equal(
    WorkerTaskTrajectoryRequestSchema.safeParse({ limit: 0, taskId: "t" })
      .success,
    false,
  );
  assert.equal(
    WorkerTaskTrajectoryRequestSchema.safeParse({
      beforeSequence: 0,
      taskId: "t",
    }).success,
    false,
  );
});

test("Worker Task trajectory response round-trips owner tool-call evidence", () => {
  const record = {
    activityId: "runtime_activity-1",
    entry: {
      kind: "tool_start" as const,
      toolName: "Bash",
      toolInput: "npm test",
    },
    observedAt: "2026-09-05T01:00:00.000Z",
    participantId: "agent-owner",
    producerSequence: 1,
    recordedAt: "2026-09-05T01:00:01.000Z",
    roomId: "room-1",
    runAttemptId: "run-1",
    runtimeRunId: "runtime-1",
    serverSequence: 7,
  };
  const parsed = WorkerTaskTrajectoryResponseSchema.parse({
    entries: [record],
    nextBeforeSequence: 7,
    ownerParticipantId: "agent-owner",
    scope: "task_linked_run_diagnostics",
    taskId: "task-1",
  });
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0]?.serverSequence, 7);
  assert.equal(parsed.nextBeforeSequence, 7);
  assert.equal(
    WorkerTaskTrajectoryResponseSchema.parse({
      entries: [],
      ownerParticipantId: "agent-owner",
      scope: "task_linked_run_diagnostics",
      taskId: "task-1",
    }).nextBeforeSequence,
    undefined,
  );
  assert.equal(
    WorkerTaskTrajectoryResponseSchema.safeParse({
      entries: [],
      ownerParticipantId: "agent-owner",
      scope: "task_linked_run_diagnostics",
      taskId: "task-1",
      unknown: true,
    }).success,
    false,
  );
});
