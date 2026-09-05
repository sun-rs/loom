import assert from "node:assert/strict";
import test from "node:test";
import {
  HumanProfileRequestSchema,
  HumanProfileResponseSchema,
} from "../src/index.ts";

test("Human profile contract rejects injected actor, non-Human identities and invented ownership", () => {
  const request = { workspaceId: "workspace", principalId: "owner" };
  assert.equal(HumanProfileRequestSchema.safeParse(request).success, true);
  assert.equal(
    HumanProfileRequestSchema.safeParse({ ...request, actorId: "admin" })
      .success,
    false,
  );
  const response = {
    workspaceId: "workspace",
    principal: { principalId: "owner", handle: "owner", kind: "human" },
    membership: { role: "owner", joinedAt: "2026-09-04T00:00:00Z" },
    canReadCreatedAgents: true,
    createdAgentDefinitionIds: [],
    truncated: false,
  };
  assert.equal(HumanProfileResponseSchema.safeParse(response).success, true);
  assert.equal(
    HumanProfileResponseSchema.safeParse({ ...response, computers: ["host"] })
      .success,
    false,
  );
  assert.equal(
    HumanProfileResponseSchema.safeParse({
      ...response,
      principal: { ...response.principal, kind: "agent" },
    }).success,
    false,
  );
});
