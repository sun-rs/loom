import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentMemoryMaterializationReceiptSchema,
  AgentMemoryWorkspaceSnapshotSchema,
  ClientAgentMemoryReadRequestSchema,
  ClientAgentMemoryResetRequestSchema,
} from "../src/agent-memory.ts";

const digest = (value: string): `sha256:${string}` =>
  `sha256:${value.repeat(64).slice(0, 64)}`;

test("Agent Memory materialization receipt proves Computer materialization without claiming model read", () => {
  const receipt = AgentMemoryMaterializationReceiptSchema.parse({
    activationId: "activation-1",
    agentDefinitionRevisionId: "revision-1",
    computerHostId: "computer-1",
    files: [
      {
        bytes: 12,
        contentDigest: digest("1"),
        modifiedAt: "2026-08-30T12:00:00.000Z",
        relativePath: "MEMORY.md",
      },
      {
        bytes: 24,
        contentDigest: digest("2"),
        modifiedAt: "2026-08-30T12:00:01.000Z",
        relativePath: "notes/decisions.md",
      },
    ],
    materializedAt: "2026-08-30T12:00:02.000Z",
    memoryPolicyRef: {
      artifactId: "memory-policy",
      contentDigest: digest("3"),
      versionId: "memory-policy-v1",
    },
    ownerParticipantId: "agent-1",
    proofScope: "computer_materialized_not_model_read",
    receiptId: digest("4"),
    roomId: "room-1",
    runAttemptId: "attempt-1",
    schemaVersion: 1,
    snapshotDigest: digest("5"),
  });

  assert.equal(receipt.files[0]?.relativePath, "MEMORY.md");
  assert.equal(receipt.proofScope, "computer_materialized_not_model_read");
  assert.ok(receipt.schemaVersion === 1);
  const { snapshotDigest: _legacyDigest, ...common } = receipt;
  const indexOnly = {
    ...common,
    schemaVersion: 2,
    coverage: "index_only",
    files: [receipt.files[0]],
  };
  assert.equal(
    AgentMemoryMaterializationReceiptSchema.parse(indexOnly).schemaVersion,
    2,
  );
  for (const invalid of [
    { ...indexOnly, files: receipt.files },
    { ...indexOnly, coverage: "full_tree" },
    { ...indexOnly, snapshotDigest: digest("5") },
    { ...indexOnly, files: [] },
  ]) {
    assert.equal(
      AgentMemoryMaterializationReceiptSchema.safeParse(invalid).success,
      false,
    );
  }
  assert.throws(
    () =>
      AgentMemoryMaterializationReceiptSchema.parse({
        ...receipt,
        files: [receipt.files[0], receipt.files[0]],
      }),
    /duplicate|path/iu,
  );
  assert.throws(
    () =>
      AgentMemoryMaterializationReceiptSchema.parse({
        ...receipt,
        files: [{ ...receipt.files[0], relativePath: "../MEMORY.md" }],
      }),
    /path|relative/iu,
  );
});

test("Agent Memory browser contracts are bounded and reset is explicit", () => {
  const missing = AgentMemoryWorkspaceSnapshotSchema.parse({
    files: [],
    ownerParticipantId: "agent-1",
    schemaVersion: 1,
    state: "absent",
    thresholdBytes: 65_536,
  });
  assert.equal(missing.state, "absent");
  const ready = {
    files: [
      {
        bytes: 12,
        contentDigest: digest("1"),
        modifiedAt: "2026-08-30T12:00:00.000Z",
        relativePath: "MEMORY.md",
      },
      {
        bytes: 24,
        contentDigest: digest("2"),
        modifiedAt: "2026-08-30T12:00:01.000Z",
        relativePath: "notes/alpha.md",
      },
      {
        bytes: 36,
        contentDigest: digest("3"),
        modifiedAt: "2026-08-30T12:00:02.000Z",
        relativePath: "notes/beta.md",
      },
    ],
    indexOverThreshold: false,
    noteCount: 2,
    ownerParticipantId: "agent-1",
    schemaVersion: 1 as const,
    state: "ready" as const,
    thresholdBytes: 65_536,
  };
  assert.equal(AgentMemoryWorkspaceSnapshotSchema.parse(ready).files.length, 3);
  assert.throws(
    () =>
      AgentMemoryWorkspaceSnapshotSchema.parse({
        ...ready,
        files: [ready.files[0], ready.files[1], ready.files[1]],
      }),
    /duplicate|path/iu,
  );
  assert.throws(
    () =>
      AgentMemoryWorkspaceSnapshotSchema.parse({
        ...ready,
        files: [ready.files[0], ready.files[2], ready.files[1]],
      }),
    /sorted|path/iu,
  );
  assert.throws(
    () =>
      ClientAgentMemoryReadRequestSchema.parse({
        agentDefinitionId: "definition-1",
        relativePath: "../MEMORY.md",
      }),
    /path|relative/iu,
  );
  assert.throws(
    () =>
      ClientAgentMemoryResetRequestSchema.parse({
        agentDefinitionId: "definition-1",
        confirmation: "yes",
        idempotencyKey: "reset-1",
      }),
    /confirmation/iu,
  );
  assert.equal(
    ClientAgentMemoryResetRequestSchema.parse({
      agentDefinitionId: "definition-1",
      confirmation: "RESET_AGENT_MEMORY",
      idempotencyKey: "reset-1",
    }).confirmation,
    "RESET_AGENT_MEMORY",
  );
});
