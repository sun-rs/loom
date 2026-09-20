import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalAgentIdField,
  ClientAgentProfileRequestSchema,
} from "../src/index.ts";
test("legacy identity fields convert without changing identity or unrelated data", () => {
  const old = {
    agentDefinitionId: "old-immutable-id",
    body: "agentDefinitionId remains authored text",
  };
  assert.deepEqual(canonicalAgentIdField(old), {
    agentId: "old-immutable-id",
    body: old.body,
  });
  assert.equal(old.agentDefinitionId, "old-immutable-id");
  assert.throws(
    () => canonicalAgentIdField({ agentId: "new", agentDefinitionId: "old" }),
    /Conflicting/,
  );
  const command = ClientAgentProfileRequestSchema.parse(
    canonicalAgentIdField({
      agentDefinitionId: "old-immutable-id",
      action: "update_profile",
      field: "displayName",
      value: "Kimi",
      expectedRevisionId: "r1",
      basedOnRoomSeq: 1,
      idempotencyKey: "edit",
    }),
  );
  assert.equal(command.agentId, "old-immutable-id");
});
