import test from "node:test";
import assert from "node:assert/strict";
import { projectRoleAvatars } from "../../frontends/raft/loom/role-avatar-projection.ts";
test("current Role avatar is a visual projection; frozen execution snapshots and replaced Role names are untouched", () => {
  const roles = {
    roles: [
      { roleId: "old-role", configuration: { avatarKey: "pixel:owl" } },
      { roleId: "new-role", configuration: { avatarKey: "pixel:rocket" } },
    ],
    instances: [
      {
        instanceId: "one",
        roleId: "old-role",
        snapshot: {
          configuration: {
            avatarKey: "pixel:robot",
            instructions: "OLD PROMPT",
          },
        },
      },
      { instanceId: "two", roleId: "new-role" },
      { instanceId: "retired", roleId: "deleted-role" },
    ],
  } as any;
  const agents = [
    {
      definition: { participantId: "retired" },
      currentRevision: { avatarKey: "pixel:antenna" },
    },
  ] as any;
  const before = JSON.stringify(roles);
  assert.deepEqual(projectRoleAvatars(roles, agents), {
    one: "pixel:owl",
    two: "pixel:rocket",
    retired: "pixel:antenna",
  });
  assert.equal(JSON.stringify(roles), before);
});

test("deleted Role IDs retain their own visual identity after the same name is reused", () => {
  const roles = {
    roles: [
      {
        roleId: "new",
        configuration: { displayName: "Tom", avatarKey: "pixel:owl" },
      },
    ],
    deletedRoles: [
      {
        roleId: "old",
        configuration: { displayName: "Tom", avatarKey: "pixel:spider" },
      },
    ],
    instances: [
      { instanceId: "old-instance", roleId: "old" },
      { instanceId: "new-instance", roleId: "new" },
    ],
  } as any;
  assert.deepEqual(projectRoleAvatars(roles, []), {
    "old-instance": "pixel:spider",
    "new-instance": "pixel:owl",
  });
});
