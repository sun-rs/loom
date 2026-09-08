import assert from "node:assert/strict";
import test from "node:test";
import { routeAgentWorkspace } from "../src/client-agent-workspace-routes.ts";

test("Skills reads authorize before and after Host I/O and reject policy-switch late responses", async () => {
  let allowed = true;
  let revision = "policy-1";
  let calls = 0;
  const human = {
    getWorkspaceAgentManagementView: () => {
      if (!allowed) throw new Error("permission denied");
      return {
        agent: { definition: { participantId: "alice" } },
        policy: { executionPolicyRevisionId: revision },
      };
    },
  };
  const scope = { state: "ready", skills: [], truncated: false, issues: [] };
  let finish = () => {};
  const port = {
    skills: async (
      owner: string,
      policy: { executionPolicyRevisionId: string },
    ) => {
      calls++;
      assert.equal(owner, "alice");
      finish();
      return {
        executionPolicyRevisionId: policy.executionPolicyRevisionId,
        global: scope,
        workspace: scope,
      };
    },
  };
  const read = (body = { agentDefinitionId: "agent-a" }) =>
    routeAgentWorkspace(
      human as never,
      {} as never,
      "/agents/skills/list",
      body,
      port as never,
      (schema, value) => schema.parse(value),
    );
  await read();
  assert.equal(calls, 1);
  await assert.rejects(
    read({ agentDefinitionId: "agent-a", path: "/" } as never),
  );
  assert.equal(calls, 1);
  allowed = false;
  await assert.rejects(read(), /permission denied/);
  assert.equal(calls, 1);
  allowed = true;
  finish = () => {
    allowed = false;
  };
  await assert.rejects(read(), /permission denied/);
  allowed = true;
  finish = () => {
    revision = "policy-2";
  };
  await assert.rejects(read(), /configuration changed/);
});
