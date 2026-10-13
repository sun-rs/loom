import assert from "node:assert/strict";
import { test } from "node:test";
import {
  roleInstanceFixture,
  startInstanceRun,
  launchContext,
  claimInstanceRun,
} from "./role-instance-fixture.ts";

function ready() {
  const f = roleInstanceFixture();
  const run = startInstanceRun(f);
  f.kernel.instanceSessions.record(f.host, {
    runAttemptId: run.runtime.runAttemptId,
    runtimeRunId: run.runtime.runtimeRunId,
  });
  run.finish(0);
  return f;
}
function request(f: ReturnType<typeof ready>) {
  return {
    instanceId: f.instance.instanceId,
    basedOnRoomSeq: f.head(f.home.roomId),
    idempotencyKey: "fork-one",
  };
}
test("Fork publishes an independent bound member only after native copy and replays without copying", async () => {
  const f = ready();
  try {
    const input = request(f);
    let calls = 0;
    const copy = async (plan: {
      targetInstanceId: string;
      sourceInstanceId: string;
      sourceGeneration: number;
    }) => {
      calls++;
      assert.equal(plan.sourceInstanceId, f.instance.instanceId);
      assert.equal(plan.sourceGeneration, 0);
      assert.equal(
        f.db
          .prepare("SELECT 1 FROM principals WHERE principal_id=?")
          .get(plan.targetInstanceId),
        undefined,
      );
    };
    const result = await f.kernel.roles.forkInstance(
      f.actor,
      f.host,
      input,
      copy,
    );
    assert.notEqual(result.instance.instanceId, f.instance.instanceId);
    assert.equal(result.instance.roleId, f.role.roleId);
    assert.equal(result.instance.roleRevisionId, f.role.roleRevisionId);
    assert.equal(result.agent.handle, "Reviewer-2");
    assert.equal(result.agent.currentRevision.instructions, "Review only.");
    assert.equal(
      f.db
        .prepare("SELECT bound FROM role_instance_sessions WHERE instance_id=?")
        .get(result.instance.instanceId)?.bound,
      1,
    );
    assert.equal(launchContext(f).instanceSessionRequired, true);
    assert.equal(
      f.db
        .prepare("SELECT count(*) AS n FROM activations WHERE participant_id=?")
        .get(result.instance.instanceId)?.n,
      0,
    );
    const again = await f.kernel.roles.forkInstance(
      f.actor,
      f.host,
      input,
      copy,
    );
    assert.equal(again.instance.instanceId, result.instance.instanceId);
    assert.equal(again.deduplicated, true);
    assert.equal(calls, 1);
    assert.equal(result.event.type, "instance.created");
    f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      body: "hello fork",
      idempotencyKey: "wake-fork",
      recipients: [
        { participantId: result.instance.instanceId, reason: "mention" },
      ],
    });
    const child = claimInstanceRun({
      ...f,
      instance: result.instance,
      agentId: result.instance.agentId,
      revisionId: result.agent.currentRevision.agentDefinitionRevisionId,
    });
    assert.equal(child.agentContext?.participantId, result.instance.instanceId);
    assert.equal(child.agentContext?.instanceSessionRequired, true);
    assert.equal(child.agentContext?.instanceSessionGeneration, 0);
    child.finish(0);
  } finally {
    f.close();
  }
});
test("Fork preserves source frozen Role after Role edit", async () => {
  const f = ready();
  try {
    f.kernel.roles.revise(f.actor, {
      roleId: f.role.roleId,
      expectedRoleRevisionId: f.role.roleRevisionId,
      basedOnRoomSeq: f.head(f.controlRoomId),
      idempotencyKey: "change-role",
      configuration: {
        ...f.role.configuration,
        displayName: "Other",
        instructions: "Different.",
      },
    });
    const result = await f.kernel.roles.forkInstance(
      f.actor,
      f.host,
      request(f),
      async () => {},
    );
    assert.equal(result.instance.roleRevisionId, f.role.roleRevisionId);
    assert.equal(result.agent.currentRevision.instructions, "Review only.");
    assert.equal(result.agent.handle, "Reviewer-2");
  } finally {
    f.close();
  }
});
test("Fork refuses unbound, busy, removed or unauthorized sources before native copy", async () => {
  const f = roleInstanceFixture();
  let calls = 0;
  const copy = async () => {
    calls++;
  };
  try {
    await assert.rejects(
      () => f.kernel.roles.forkInstance(f.actor, f.host, request(f), copy),
      /session/i,
    );
    const run = startInstanceRun(f);
    f.kernel.instanceSessions.record(f.host, {
      runAttemptId: run.runtime.runAttemptId,
      runtimeRunId: run.runtime.runtimeRunId,
    });
    await assert.rejects(
      () => f.kernel.roles.forkInstance(f.actor, f.host, request(f), copy),
      /work|idle/i,
    );
    run.finish(0);
    const outsider = f.kernel.authenticateAccessToken(
      f.kernel.provisionPrincipal({ handle: "outsider", kind: "human" })
        .accessToken,
    );
    await assert.rejects(() =>
      f.kernel.roles.forkInstance(outsider, f.host, request(f), copy),
    );
    f.detachFromChannel();
    await assert.rejects(
      () => f.kernel.roles.forkInstance(f.actor, f.host, request(f), copy),
      /member|removed/i,
    );
    assert.equal(calls, 0);
  } finally {
    f.close();
  }
});
for (const change of ["reset", "run", "remove"] as const)
  test(`Fork rejects source ${change} during native copy without publishing a member`, async () => {
    const f = ready();
    try {
      await assert.rejects(() =>
        f.kernel.roles.forkInstance(f.actor, f.host, request(f), async () => {
          if (change === "reset")
            f.kernel.roles.resetInstanceSession(f.actor, {
              ...request(f),
              idempotencyKey: "reset",
            });
          else if (change === "run") {
            const run = startInstanceRun(f);
            run.finish(0);
          } else f.detachFromChannel();
        }),
      );
      assert.equal(
        f.db.prepare("SELECT count(*) AS n FROM role_instances").get()?.n,
        1,
      );
    } finally {
      f.close();
    }
  });
test("Failed native copy creates no principal or membership", async () => {
  const f = ready();
  try {
    const before = f.head(f.home.roomId);
    await assert.rejects(
      () =>
        f.kernel.roles.forkInstance(f.actor, f.host, request(f), async () => {
          throw new Error("copy unknown");
        }),
      /copy unknown/,
    );
    assert.equal(f.head(f.home.roomId), before);
    assert.equal(
      f.db.prepare("SELECT count(*) AS n FROM role_instances").get()?.n,
      1,
    );
  } finally {
    f.close();
  }
});

test("Fork refuses a revoked Host after native copy without publishing the child", async () => {
  const f = ready();
  try {
    await assert.rejects(
      () =>
        f.kernel.roles.forkInstance(f.actor, f.host, request(f), async () => {
          f.kernel.revokeHostCredential(f.host.credentialId);
        }),
      /host|authentication/i,
    );
    assert.equal(
      f.db.prepare("SELECT count(*) AS n FROM role_instances").get()?.n,
      1,
    );
  } finally {
    f.close();
  }
});

test("Fork validates its Host before any native copying", async () => {
  const f = ready();
  let copies = 0;
  try {
    f.kernel.revokeHostCredential(f.host.credentialId);
    await assert.rejects(() =>
      f.kernel.roles.forkInstance(f.actor, f.host, request(f), async () => {
        copies++;
      }),
    );
    assert.equal(copies, 0);
  } finally {
    f.close();
  }
});
