import assert from "node:assert/strict";
import test from "node:test";

import {
  ClientTaskReassignRequestSchema,
  ClientTaskReassignmentResponseSchema,
} from "../src/index.ts";

test("Task reassignment request exposes only Human intent and causal identity", () => {
  const request = ClientTaskReassignRequestSchema.parse({
    assigneeId: "agent-new",
    basedOnRoomSeq: 17,
    idempotencyKey: "reassign-task-1",
    reason: "Move the remaining work to the available Agent",
    taskId: "task-1",
  });
  assert.equal(request.assigneeId, "agent-new");
  assert.throws(() =>
    ClientTaskReassignRequestSchema.parse({
      ...request,
      previousAssigneeId: "agent-old",
    }),
  );
  assert.throws(() =>
    ClientTaskReassignRequestSchema.parse({ ...request, reason: "  " }),
  );
});

test("Task reassignment response carries the durable saga and final Task", () => {
  const response = ClientTaskReassignmentResponseSchema.parse({
    activationIds: ["activation-new"],
    deduplicated: false,
    event: {
      actorId: "human-1",
      aggregateId: "task-1",
      aggregateType: "task",
      createdAt: "2026-09-01T05:00:00.000Z",
      eventId: "event-1",
      idempotencyKey: "reassign-task-1:assigned",
      payload: {},
      roomId: "room-1",
      roomSeq: 19,
      schemaVersion: 1,
      type: "task.reassigned",
    },
    operation: {
      completedAt: "2026-09-01T05:00:00.000Z",
      createdAt: "2026-09-01T04:59:58.000Z",
      nextAssigneeId: "agent-new",
      operationId: "task_reassignment_1",
      previousAssigneeId: "agent-old",
      reason: "Move the remaining work to the available Agent",
      requestedBy: "human-1",
      roomId: "room-1",
      state: "assigned",
      taskId: "task-1",
      updatedAt: "2026-09-01T05:00:00.000Z",
    },
    task: {
      assigneeId: "agent-new",
      collaboratorIds: [],
      createdAt: "2026-09-01T04:00:00.000Z",
      creatorId: "human-1",
      dependencyTaskIds: [],
      roomId: "room-1",
      reviewerIds: [],
      sourceMessageId: "message-1",
      state: "todo",
      taskId: "task-1",
      taskNumber: 1,
      threadId: "thread-1",
      title: "Finish the implementation",
      updatedAt: "2026-09-01T05:00:00.000Z",
    },
  });
  assert.equal(response.operation.state, "assigned");
  assert.equal(response.task.assigneeId, "agent-new");
});
