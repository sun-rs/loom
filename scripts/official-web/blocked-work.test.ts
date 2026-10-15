import assert from "node:assert/strict";
import test from "node:test";
import { ClientApplicationService } from "../../packages/application-service/src/index.ts";
import { HttpRahClient } from "../../packages/client-sdk/src/index.ts";
import { createHumanApplicationPort } from "../../packages/kernel/src/index.ts";
import {
  roleInstanceFixture,
  claimInstanceRun,
} from "../../packages/kernel/test/role-instance-fixture.ts";
import { ManagementClient } from "../../frontends/raft/loom/management-client.ts";
import { abandonInstanceWork } from "../../frontends/raft/loom/control-actions.ts";

test("UI abandonment adapter releases a real Kernel block once after a lost HTTP result, preserving session and finished run", async () => {
  const f = roleInstanceFixture();
  const service = new ClientApplicationService({
    human: createHumanApplicationPort(f.kernel),
    health: () => {
      throw Error("unused");
    },
  });
  try {
    f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      body: "FIXTURE request",
      idempotencyKey: "request",
      recipients: [{ participantId: f.instance.instanceId, reason: "mention" }],
    });
    const r = claimInstanceRun(f);
    f.kernel.recordRuntimeTermination(f.host, {
      runAttemptId: r.run.runAttemptId,
      runtimeRunId: r.runtime.runtimeRunId,
      exit: { code: 1 },
    });
    f.kernel.finishRunAttempt(f.host, {
      runAttemptId: r.run.runAttemptId,
      state: "failed",
      exitCode: 1,
    });
    f.kernel.retryActivation(f.host, {
      activationId: r.activation.activationId,
      error: "FIXTURE Human intervention",
      retryAfterMs: 0,
      retryDisposition: "action_required",
    });
    const rows = () => ({
      run: f.db
        .prepare("SELECT * FROM run_attempts WHERE run_attempt_id=?")
        .get(r.run.runAttemptId),
      session: f.db
        .prepare("SELECT * FROM role_instance_sessions WHERE instance_id=?")
        .get(f.instance.instanceId),
    });
    const before = rows();
    await service.start();
    let lost = false;
    const client = new HttpRahClient({
      baseUrl: service.origin,
      accessToken: () => f.owner.accessToken,
      fetch: async (url, init) => {
        const result = await fetch(url, init);
        if (String(url).endsWith("/instances/activation/abandon") && !lost) {
          lost = true;
          assert.equal(result.status, 200);
          throw Error("lost committed reply");
        }
        return result;
      },
    });
    const manager = new ManagementClient(
      client,
      f.workspace.workspace.workspaceId,
      f.controlRoomId,
    );
    const outcomes: any[] = [];
    await abandonInstanceWork(
      manager,
      f.instance,
      r.activation.activationId,
      (o) => outcomes.push(o),
    );
    assert.equal(manager.writes.state, "unknown");
    await manager.writes.retry();
    assert.equal(manager.writes.state, "idle");
    assert.equal(outcomes.at(-1).result.deduplicated, true);
    assert.deepEqual(rows(), before);
    assert.equal(
      f.db
        .prepare("SELECT state FROM activations WHERE activation_id=?")
        .get(r.activation.activationId)!.state,
      "cancelled",
    );
    assert.equal(
      f.db
        .prepare(
          "SELECT count(*) n FROM room_events WHERE type='instance.activation_abandoned'",
        )
        .get()!.n,
      1,
    );
  } finally {
    await service.close();
    f.close();
  }
});
