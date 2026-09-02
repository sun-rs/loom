import assert from "node:assert/strict";
import test from "node:test";

import {
  ClientAgentExecutionResetRequestSchema,
  ClientAgentExecutionResetResponseSchema,
} from "../src/index.ts";

test("Agent execution reset exposes Raft restart/session modes without enabling full", () => {
  assert.deepEqual(
    ClientAgentExecutionResetRequestSchema.parse({
      agentDefinitionId: "agent-definition-1",
      basedOnRoomSeq: 42,
      idempotencyKey: "reset-1",
      mode: "session",
    }),
    {
      agentDefinitionId: "agent-definition-1",
      basedOnRoomSeq: 42,
      idempotencyKey: "reset-1",
      mode: "session",
    },
  );
  assert.throws(() =>
    ClientAgentExecutionResetRequestSchema.parse({
      agentDefinitionId: "agent-definition-1",
      basedOnRoomSeq: 42,
      idempotencyKey: "reset-1",
      mode: "full",
    }),
  );
});

test("Agent execution reset response carries terminal Host evidence", () => {
  const response = ClientAgentExecutionResetResponseSchema.parse({
    agentDefinitionId: "agent-definition-1",
    completedAt: "2026-09-01T02:00:00.000Z",
    computerHostId: "host-local",
    deduplicated: false,
    mode: "restart",
    operationId: "operation-1",
    ownerParticipantId: "agent-1",
    providerContinuityRecords: 0,
  });
  assert.equal(response.mode, "restart");
  assert.equal(response.providerContinuityRecords, 0);
});
