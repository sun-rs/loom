import assert from "node:assert/strict";
import test from "node:test";

import {
  TaskAmendRequestSchema,
  TaskDeleteRequestSchema,
  WorkerTaskAmendRequestSchema,
  WorkerTaskAssignRequestSchema,
  WorkerTaskBlockRequestSchema,
  WorkerTaskClaimMessageRequestSchema,
  WorkerTaskClaimRequestSchema,
  WorkerTaskConvertRequestSchema,
  WorkerTaskCreateRequestSchema,
  WorkerTaskDeleteRequestSchema,
  WorkerTaskProgressRequestSchema,
  WorkerTaskReleaseRequestSchema,
  WorkerTaskRequestInputRequestSchema,
  WorkerTaskReviewRequestSchema,
  WorkerTaskStartRequestSchema,
  WorkerTaskSubmitRequestSchema,
  WorkerTaskUnblockRequestSchema,
} from "../src/index.ts";

/**
 * Raft has neither `--based-on-room-seq` nor `--idempotency-key` on any Task
 * command, so the minimal form must parse; the explicit form stays valid
 * byte-for-byte, and both stay `.strict()`.
 */
const commands = [
  { name: "task-claim", schema: WorkerTaskClaimRequestSchema, minimal: {} },
  { name: "task-start", schema: WorkerTaskStartRequestSchema, minimal: {} },
  { name: "task-release", schema: WorkerTaskReleaseRequestSchema, minimal: {} },
  {
    name: "task-progress",
    schema: WorkerTaskProgressRequestSchema,
    minimal: { progress: "half way" },
  },
  {
    name: "task-block",
    schema: WorkerTaskBlockRequestSchema,
    minimal: { reason: "waiting" },
  },
  {
    name: "task-request-input",
    schema: WorkerTaskRequestInputRequestSchema,
    minimal: { question: "which one?" },
  },
  {
    name: "task-submit",
    schema: WorkerTaskSubmitRequestSchema,
    minimal: { summary: "done" },
  },
  {
    name: "task-review",
    schema: WorkerTaskReviewRequestSchema,
    minimal: { disposition: "approved", summary: "looks right" },
  },
  {
    name: "task-unblock",
    schema: WorkerTaskUnblockRequestSchema,
    minimal: {},
  },
  {
    name: "task-assign",
    schema: WorkerTaskAssignRequestSchema,
    minimal: { assigneeId: null },
  },
  {
    name: "task-amend",
    schema: WorkerTaskAmendRequestSchema,
    minimal: { title: "new title" },
  },
  {
    name: "task-delete",
    schema: WorkerTaskDeleteRequestSchema,
    minimal: { roomId: "room_1" },
  },
] as const;

test("every Task command parses without a cursor or an idempotency key", () => {
  for (const command of commands) {
    const parsed = command.schema.parse({
      taskId: "task_1",
      ...command.minimal,
    });
    assert.equal(
      (parsed as { basedOnRoomSeq?: number }).basedOnRoomSeq,
      undefined,
      command.name,
    );
    assert.equal(
      (parsed as { idempotencyKey?: string }).idempotencyKey,
      undefined,
      command.name,
    );
  }
});

test("the explicit form of every Task command still parses unchanged", () => {
  for (const command of commands) {
    const explicit = {
      taskId: "task_1",
      ...command.minimal,
      basedOnRoomSeq: 7,
      idempotencyKey: "explicit-key",
    };
    assert.deepEqual(command.schema.parse(explicit), explicit, command.name);
  }
});

test("Task commands stay strict about unknown fields", () => {
  for (const command of commands) {
    assert.throws(
      () =>
        command.schema.parse({
          taskId: "task_1",
          ...command.minimal,
          unexpected: true,
        }),
      command.name,
    );
  }
});

test("the message-addressed Task commands also accept the minimal form", () => {
  assert.deepEqual(
    WorkerTaskClaimMessageRequestSchema.parse({
      messageId: "message_1",
      rationale: "durable work",
    }),
    { messageId: "message_1", rationale: "durable work" },
  );
  assert.deepEqual(
    WorkerTaskConvertRequestSchema.parse({ messageId: "message_1" }),
    { messageId: "message_1" },
  );
  assert.deepEqual(WorkerTaskCreateRequestSchema.parse({ title: "New work" }), {
    title: "New work",
  });
});

test("the Human amend and delete contracts keep both fields required", () => {
  assert.throws(() =>
    TaskAmendRequestSchema.parse({ taskId: "task_1", title: "t" }),
  );
  assert.throws(() =>
    TaskDeleteRequestSchema.parse({ roomId: "room_1", taskId: "task_1" }),
  );
});
