import test from "node:test";
import assert from "node:assert/strict";
import { roleInstanceFixture } from "./role-instance-fixture.ts";
test("Role creation chooses and persists an avatar once after idempotency replay; explicit avatars stay intact", () => {
  const f = roleInstanceFixture();
  try {
    const { avatarKey, ...configuration } = f.role.configuration;
    const input = {
      controlRoomId: f.role.controlRoomId,
      basedOnRoomSeq: f.head(f.role.controlRoomId),
      idempotencyKey: "random-avatar",
      configuration: { ...configuration, displayName: "New role" },
    };
    const created = f.kernel.roles.create(f.actor, input);
    assert.match(
      created.role.configuration.avatarKey ?? "",
      /^pixel:[a-z0-9-]+$/,
    );
    assert.deepEqual(f.kernel.roles.create(f.actor, input).role, created.role);
    assert.equal(
      f.kernel.roles.create(f.actor, {
        ...input,
        basedOnRoomSeq: f.head(f.role.controlRoomId),
        idempotencyKey: "explicit-avatar",
        configuration: {
          ...configuration,
          displayName: "Explicit role",
          avatarKey: "pixel:loom-eva-unit01",
        },
      }).role.configuration.avatarKey,
      "pixel:loom-eva-unit01",
    );
  } finally {
    f.close();
  }
});
test("Role remarks/prompt/avatar revisions preserve frozen instances and reach only new instances", () => {
  const f = roleInstanceFixture();
  try {
    const before = f.kernel.getWorkspaceAgentManagementView(
      f.actor,
      f.instance.agentId,
    ).agent.currentRevision;
    const revised = f.kernel.roles.revise(f.actor, {
      roleId: f.role.roleId,
      expectedRoleRevisionId: f.role.roleRevisionId,
      basedOnRoomSeq: f.head(f.role.controlRoomId),
      idempotencyKey: "metadata-revision",
      configuration: {
        ...f.role.configuration,
        description: "Display note only",
        role: f.role.configuration.displayName,
        instructions: "Executable instructions only",
        avatarKey: "pixel:loom-eva-unit01",
      },
    }).role;
    assert.deepEqual(
      f.kernel.getWorkspaceAgentManagementView(f.actor, f.instance.agentId)
        .agent.currentRevision,
      before,
    );
    const next = f.kernel.roles.instantiate(f.actor, {
      roleId: revised.roleId,
      channelId: f.home.roomId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "new-identity-instance",
    });
    assert.equal(next.agent.currentRevision.description, "Display note only");
    assert.equal(
      next.agent.currentRevision.instructions,
      "Executable instructions only",
    );
    assert.equal(next.agent.currentRevision.avatarKey, "pixel:loom-eva-unit01");
  } finally {
    f.close();
  }
});
