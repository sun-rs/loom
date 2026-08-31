import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_EXCLUSIVE_OPERATION_MAX_LEASE_MS,
  AgentExclusiveOperationAcquireInputSchema,
  AgentExclusiveOperationLeaseSchema,
} from "../src/index.ts";

test("Agent exclusive operation commands are strict and lease duration is bounded", () => {
  assert.equal(
    AgentExclusiveOperationAcquireInputSchema.parse({
      kind: "memory_reset",
      leaseMs: AGENT_EXCLUSIVE_OPERATION_MAX_LEASE_MS,
      operationId: "operation-reset",
      participantId: "agent-alice",
    }).leaseMs,
    AGENT_EXCLUSIVE_OPERATION_MAX_LEASE_MS,
  );
  assert.throws(() =>
    AgentExclusiveOperationAcquireInputSchema.parse({
      kind: "memory_reset",
      leaseMs: AGENT_EXCLUSIVE_OPERATION_MAX_LEASE_MS + 1,
      operationId: "operation-reset",
      participantId: "agent-alice",
    }),
  );
  assert.throws(() =>
    AgentExclusiveOperationAcquireInputSchema.parse({
      kind: "memory_reset",
      leaseMs: 1_000,
      operationId: "operation-reset",
      participantId: "agent-alice",
      releaseOnExpiry: true,
    }),
  );
});

test("Agent exclusive operation lease keeps release state structurally explicit", () => {
  const base = {
    acquiredAt: "2026-08-30T00:00:00.000Z",
    kind: "memory_reset",
    leaseId: "exclusive-lease",
    leaseUntil: "2026-08-30T00:00:30.000Z",
    operationId: "operation-reset",
    ownerHostId: "host-a",
    ownerHostInstanceId: "host-instance-a",
    participantId: "agent-alice",
    renewedAt: "2026-08-30T00:00:00.000Z",
    schemaVersion: 1,
  } as const;
  assert.equal(
    AgentExclusiveOperationLeaseSchema.parse({ ...base, state: "active" })
      .state,
    "active",
  );
  assert.throws(() =>
    AgentExclusiveOperationLeaseSchema.parse({
      ...base,
      releasedAt: "2026-08-30T00:00:10.000Z",
      state: "active",
    }),
  );
  assert.throws(() =>
    AgentExclusiveOperationLeaseSchema.parse({ ...base, state: "released" }),
  );
});
