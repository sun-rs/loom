import assert from "node:assert/strict";
import test from "node:test";

import {
  ClientAgentExecutionResetRequestSchema,
  ClientAgentExecutionResetResponseSchema,
} from "../src/index.ts";

test("Agent execution reset exposes the complete Raft restart/session/full mode contract", () => {
  assert.deepEqual(
    ClientAgentExecutionResetRequestSchema.parse({
      agentId: "agent-definition-1",
      basedOnRoomSeq: 42,
      idempotencyKey: "reset-1",
      mode: "session",
    }),
    {
      agentId: "agent-definition-1",
      basedOnRoomSeq: 42,
      idempotencyKey: "reset-1",
      mode: "session",
    },
  );
  assert.equal(
    ClientAgentExecutionResetRequestSchema.parse({
      agentId: "agent-definition-1",
      basedOnRoomSeq: 42,
      idempotencyKey: "reset-full-1",
      mode: "full",
    }).mode,
    "full",
  );
  assert.throws(() =>
    ClientAgentExecutionResetRequestSchema.parse({
      agentId: "agent-definition-1",
      basedOnRoomSeq: 42,
      idempotencyKey: "reset-unknown-1",
      mode: "workspace",
    }),
  );
});

test("Agent execution reset response carries terminal Host evidence", () => {
  const response = ClientAgentExecutionResetResponseSchema.parse({
    agentId: "agent-definition-1",
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
