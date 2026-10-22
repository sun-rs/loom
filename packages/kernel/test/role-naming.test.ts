import assert from "node:assert/strict";
import test from "node:test";
import {
  roleInstanceFixture,
  startInstanceRun,
} from "./role-instance-fixture.ts";

function create(
  f: ReturnType<typeof roleInstanceFixture>,
  name: string,
  key: string,
) {
  return f.kernel.roles.create(f.actor, {
    controlRoomId: f.role.controlRoomId,
    basedOnRoomSeq: f.head(f.role.controlRoomId),
    idempotencyKey: key,
    configuration: { ...f.role.configuration, displayName: name },
  });
}

test("live Role names are unique even with another handle or Unicode/case spelling", () => {
  const f = roleInstanceFixture();
  try {
    assert.throws(
      () => create(f, "reviewer", "duplicate"),
      /name.*already|名称.*已/i,
    );
    assert.throws(
      () => create(f, "Ｒｅｖｉｅｗｅｒ", "unicode"),
      /name.*already|名称.*已/i,
    );
    assert.equal(
      f.kernel.roles.list(f.actor, { controlRoomId: f.role.controlRoomId })
        .roles.length,
      1,
    );
  } finally {
    f.close();
  }
});

test("instances use readable names, retain different immutable identities and route by those names", () => {
  const f = roleInstanceFixture();
  try {
    const second = f.kernel.roles.instantiate(f.actor, {
      roleId: f.role.roleId,
      channelId: f.home.roomId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "second",
    });
    assert.equal(
      f.db
        .prepare("SELECT handle FROM principals WHERE principal_id=?")
        .get(f.instance.instanceId)!.handle,
      "Reviewer-1",
    );
    assert.equal(second.agent.handle, "Reviewer-2");
    assert.equal(second.agent.currentRevision.displayName, "Reviewer-2");
    assert.notEqual(second.instance.instanceId, f.instance.instanceId);
    const post = f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      basedOnRoomSeq: f.head(f.home.roomId),
      body: "@Reviewer-2 please review",
      recipients: [],
      idempotencyKey: "mention",
    });
    const row = f.db
      .prepare("SELECT mentions_json FROM messages WHERE message_id=?")
      .get(String(post.event.payload.messageId))!;
    assert.equal(
      JSON.parse(String(row.mentions_json))[0].principalId,
      second.instance.instanceId,
    );
  } finally {
    f.close();
  }
});

test("renaming a Role preserves its identity and frozen instance configuration", () => {
  const f = roleInstanceFixture();
  try {
    create(f, "Other", "other");
    const input = {
      roleId: f.role.roleId,
      expectedRoleRevisionId: f.role.roleRevisionId,
      basedOnRoomSeq: f.head(f.role.controlRoomId),
      idempotencyKey: "rename",
      configuration: {
        ...f.role.configuration,
        displayName: "Jerry",
        instructions: "new prompt",
      },
    };
    assert.throws(
      () =>
        f.kernel.roles.revise(f.actor, {
          ...input,
          configuration: { ...input.configuration, displayName: "Other" },
        }),
      /name.*already|名称.*已/i,
    );
    const revised = f.kernel.roles.revise(f.actor, input);
    assert.equal(revised.role.roleId, f.role.roleId);
    assert.notEqual(revised.role.roleRevisionId, f.role.roleRevisionId);
    assert.equal(f.kernel.roles.revise(f.actor, input).deduplicated, true);
    assert.equal(
      f.db
        .prepare(
          "SELECT role_revision_id FROM role_instances WHERE instance_id=?",
        )
        .get(f.instance.instanceId)!.role_revision_id,
      f.role.roleRevisionId,
    );
  } finally {
    f.close();
  }
});

test("deleting a Role releases its name without changing instances or historical identity", () => {
  const f = roleInstanceFixture();
  try {
    const input = {
      roleId: f.role.roleId,
      expectedRoleRevisionId: f.role.roleRevisionId,
      basedOnRoomSeq: f.head(f.controlRoomId),
      idempotencyKey: "delete",
    };
    const removed = f.kernel.roles.delete(f.actor, input);
    assert.equal(removed.roleId, f.role.roleId);
    assert.equal(f.kernel.roles.delete(f.actor, input).deduplicated, true);
    const replacement = create(f, "Reviewer", "replacement").role;
    assert.notEqual(replacement.roleId, f.role.roleId);
    const list = f.kernel.roles.list(f.actor, {
      controlRoomId: f.controlRoomId,
    });
    assert.deepEqual(
      list.roles.map((r) => r.roleId),
      [replacement.roleId],
    );
    assert.equal(list.instances[0]!.roleId, f.role.roleId);
    assert.throws(
      () =>
        f.kernel.roles.instantiate(f.actor, {
          roleId: f.role.roleId,
          channelId: f.home.roomId,
          basedOnRoomSeq: f.head(f.home.roomId),
          idempotencyKey: "deleted-instance",
        }),
      /deleted/i,
    );
    const next = f.kernel.roles.instantiate(f.actor, {
      roleId: replacement.roleId,
      channelId: f.home.roomId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "replacement-instance",
    });
    assert.equal(next.agent.handle, "Reviewer-2");
    assert.notEqual(next.instance.instanceId, f.instance.instanceId);
  } finally {
    f.close();
  }
});

test("readable Unicode instance names remain usable for native model configuration", () => {
  const f = roleInstanceFixture();
  try {
    const role = create(f, "审查 Tom", "unicode-name").role;
    const made = f.kernel.roles.instantiate(f.actor, {
      roleId: role.roleId,
      channelId: f.home.roomId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "unicode-instance",
    });
    assert.equal(made.agent.handle, "审查 Tom-1");
    const result = f.kernel.manageWorkspaceAgent(f.actor, {
      ...role.configuration,
      action: "configure",
      agentId: made.agent.definition.agentId,
      handle: made.agent.handle,
      displayName: made.agent.handle,
      basedOnRoomSeq: f.head(f.controlRoomId),
      idempotencyKey: "unicode-config",
    });
    assert.equal(result.agent.handle, made.agent.handle);
  } finally {
    f.close();
  }
});

test("Role modification time survives list and exact revision replay while creation time stays fixed", () => {
  const f = roleInstanceFixture();
  try {
    const input = {
      roleId: f.role.roleId,
      expectedRoleRevisionId: f.role.roleRevisionId,
      basedOnRoomSeq: f.head(f.role.controlRoomId),
      idempotencyKey: "timestamp-revision",
      configuration: { ...f.role.configuration, instructions: "updated" },
    };
    const result = f.kernel.roles.revise(f.actor, input);
    assert.equal(typeof result.role.updatedAt, "string");
    assert.equal(result.role.createdAt, f.role.createdAt);
    assert.equal(
      f.kernel.roles
        .list(f.actor, { controlRoomId: f.role.controlRoomId })
        .roles.find((r) => r.roleId === f.role.roleId)?.updatedAt,
      result.role.updatedAt,
    );
    assert.equal(
      f.kernel.roles.revise(f.actor, input).role.updatedAt,
      result.role.updatedAt,
    );
  } finally {
    f.close();
  }
});

// Audit evidence: deleting configuration must not stop an already running instance.
test("deleting Role while running leaves execution, session and frozen revisions intact", () => {
  const f = roleInstanceFixture();
  try {
    const work = startInstanceRun(f);
    const tables = [
      "role_instances",
      "role_revisions",
      "agent_definitions",
      "agent_definition_revisions",
      "role_instance_sessions",
      "run_attempts",
      "runtime_processes",
      "inbox_items",
      "messages",
    ];
    const snapshot = () =>
      tables.map((table) =>
        f.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      );
    const before = snapshot();
    f.kernel.roles.delete(f.actor, {
      roleId: f.role.roleId,
      expectedRoleRevisionId: f.role.roleRevisionId,
      basedOnRoomSeq: f.head(f.controlRoomId),
      idempotencyKey: "delete-live-role",
    });
    assert.deepEqual(snapshot(), before);
    work.finish(0);
  } finally {
    f.close();
  }
});
