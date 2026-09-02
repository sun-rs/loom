import assert from "node:assert/strict";
import test from "node:test";

import {
  RuntimeTerminationProofError,
  type AuthenticatedActorContext,
  type HumanApplicationPort,
} from "@rah-os/kernel";
import type { ClientTaskReassignmentResponse } from "@rah-os/protocol";

import { createDaemonTaskReassignmentAdministration } from "../src/daemon-application-support.ts";

const actor = {} as AuthenticatedActorContext;

test("daemon task reassignment waits for Host terminal proof before returning the new owner", async () => {
  const calls: string[] = [];
  let continuationAttempts = 0;
  const requested = response("cancellation_requested", false);
  const assigned = response("assigned", false);
  const requestTaskReassignment: HumanApplicationPort["requestTaskReassignment"] =
    (_actor, input) => {
      calls.push(`request:${input.assigneeId}`);
      return requested;
    };
  const continueTaskReassignment: HumanApplicationPort["continueTaskReassignment"] =
    (_actor, input) => {
      continuationAttempts += 1;
      calls.push(`continue:${input.operationId}:${continuationAttempts}`);
      if (continuationAttempts < 3) {
        throw new RuntimeTerminationProofError("runtime still active");
      }
      return assigned;
    };
  const human = {
    continueTaskReassignment,
    requestTaskReassignment,
  } as unknown as HumanApplicationPort;
  const administration = createDaemonTaskReassignmentAdministration({
    human,
    pollIntervalMs: 1,
    timeoutMs: 100,
  });

  const result = await administration.reassign(actor, {
    assigneeId: "agent-next",
    basedOnRoomSeq: 7,
    idempotencyKey: "reassign-1",
    reason: "The current Agent is unavailable",
    taskId: "task-1",
  });

  assert.equal(result.operation.state, "assigned");
  assert.equal(result.task.assigneeId, "agent-next");
  assert.deepEqual(calls, [
    "request:agent-next",
    "continue:reassignment-1:1",
    "continue:reassignment-1:2",
    "continue:reassignment-1:3",
  ]);
});

test("daemon task reassignment times out closed while terminal proof is absent", async () => {
  const requested = response("cancellation_requested", false);
  let continuationAttempts = 0;
  const requestTaskReassignment: HumanApplicationPort["requestTaskReassignment"] =
    () => requested;
  const continueTaskReassignment: HumanApplicationPort["continueTaskReassignment"] =
    () => {
      continuationAttempts += 1;
      throw new RuntimeTerminationProofError("runtime still active");
    };
  const human = {
    continueTaskReassignment,
    requestTaskReassignment,
  } as unknown as HumanApplicationPort;
  const administration = createDaemonTaskReassignmentAdministration({
    human,
    pollIntervalMs: 1,
    timeoutMs: 4,
  });

  await assert.rejects(
    async () =>
      await administration.reassign(actor, {
        assigneeId: "agent-next",
        basedOnRoomSeq: 7,
        idempotencyKey: "reassign-2",
        reason: "The current Agent is unavailable",
        taskId: "task-1",
      }),
    /waiting for Host terminal proof/u,
  );
  assert.ok(continuationAttempts > 0);
});

function response(
  state: "assigned" | "cancellation_requested",
  deduplicated: boolean,
): ClientTaskReassignmentResponse {
  const timestamp = "2026-09-01T03:00:00.000Z";
  return {
    activationIds: state === "assigned" ? ["activation-next"] : [],
    deduplicated,
    event: {
      actorId: "human-owner",
      aggregateId: "task-1",
      aggregateType: "task",
      createdAt: timestamp,
      eventId: state === "assigned" ? "event-assigned" : "event-requested",
      idempotencyKey:
        state === "assigned" ? "reassign-1:assigned" : "reassign-1",
      payload: {},
      roomId: "room-1",
      roomSeq: state === "assigned" ? 9 : 8,
      schemaVersion: 1,
      type:
        state === "assigned"
          ? "task.reassigned"
          : "task.reassignment_requested",
    },
    operation: {
      ...(state === "assigned" ? { completedAt: timestamp } : {}),
      createdAt: timestamp,
      nextAssigneeId: "agent-next",
      operationId: "reassignment-1",
      previousAssigneeId: "agent-current",
      reason: "The current Agent is unavailable",
      requestedBy: "human-owner",
      roomId: "room-1",
      state,
      taskId: "task-1",
      updatedAt: timestamp,
    },
    task: {
      ...(state === "assigned" ? { assigneeId: "agent-next" } : {}),
      collaboratorIds: [],
      createdAt: timestamp,
      creatorId: "human-owner",
      dependencyTaskIds: [],
      reviewerIds: [],
      roomId: "room-1",
      sourceMessageId: "message-1",
      state: "todo",
      taskId: "task-1",
      taskNumber: 1,
      threadId: "thread-1",
      title: "Finish the work",
      updatedAt: timestamp,
    },
  };
}
