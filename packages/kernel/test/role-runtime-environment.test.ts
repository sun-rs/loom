import assert from "node:assert/strict";
import test from "node:test";
import { roleInstanceFixture } from "./role-instance-fixture.ts";
test("Role environment reaches a frozen instance revision and rejects managed keys", () => {
  const f = roleInstanceFixture();
  try {
    const revise = (environment: Record<string, string>, key: string) =>
      f.kernel.roles.revise(f.actor, {
        roleId: f.role.roleId,
        expectedRoleRevisionId: f.role.roleRevisionId,
        basedOnRoomSeq: f.head(f.role.controlRoomId),
        idempotencyKey: key,
        configuration: { ...f.role.configuration, environment },
      });
    assert.throws(
      () => revise({ RAH_WORKER_API_URL: "https://bad.invalid" }, "bad"),
      /protected/,
    );
    revise({ EXAMPLE_ROLE_VALUE: "original" }, "environment");
    const added = f.kernel.roles.instantiate(f.actor, {
      roleId: f.role.roleId,
      channelId: f.home.roomId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "env-instance",
    });
    assert.deepEqual(added.agent.currentRevision.environment, {
      EXAMPLE_ROLE_VALUE: "original",
    });
    const current = f.kernel.roles.list(f.actor, {
      controlRoomId: f.role.controlRoomId,
    }).roles[0]!;
    f.kernel.roles.revise(f.actor, {
      roleId: current.roleId,
      expectedRoleRevisionId: current.roleRevisionId,
      basedOnRoomSeq: f.head(current.controlRoomId),
      idempotencyKey: "new-env",
      configuration: {
        ...current.configuration,
        environment: { EXAMPLE_ROLE_VALUE: "changed" },
      },
    });
    const original = f.db
      .prepare(
        "SELECT definition_json FROM agent_definition_revisions WHERE agent_definition_revision_id=?",
      )
      .get(added.agent.currentRevision.agentDefinitionRevisionId);
    assert.deepEqual(
      JSON.parse(String(original!.definition_json)).environment,
      { EXAMPLE_ROLE_VALUE: "original" },
    );
  } finally {
    f.close();
  }
});
