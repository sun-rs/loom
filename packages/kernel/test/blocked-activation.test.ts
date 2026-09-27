import assert from "node:assert/strict";
import test from "node:test";

import { ClientApplicationService } from "../../application-service/src/index.ts";
import { HttpRahClient } from "../../client-sdk/src/index.ts";
import {
  ConflictError,
  TaskSubmissionProofError,
  createHumanApplicationPort,
} from "../src/index.ts";
import {
  claimInstanceRun,
  roleInstanceFixture,
  type RoleInstanceFixture,
} from "./role-instance-fixture.ts";

/**
 * D2 (2026-09-27 acceptance): a business-obligation refusal (an assigned Task
 * the instance never submitted) is not a Runtime failure. Its retry fence
 * never holds the instance's lane across Rooms, the activity projection shows
 * it as blocked with its reason, and the Human can abandon it explicitly.
 * Fake Host, no provider process; every assertion reads durable Kernel state.
 */

function assignTask(f: RoleInstanceFixture, key: string) {
  return f.kernel.createTask(f.actor, {
    assigneeId: f.instance.instanceId,
    idempotencyKey: key,
    roomId: f.home.roomId,
    title: "Assigned work",
  });
}

/** One attempt that ACKs through its head, exits 0 and is refused. */
function ackOnlyAttempt(f: RoleInstanceFixture) {
  const running = claimInstanceRun(f);
  f.kernel.acknowledgeWorkerCursor(running.execution, {
    throughSeq: running.activation.toSeq,
  });
  f.kernel.recordRuntimeTermination(f.host, {
    runAttemptId: running.run.runAttemptId,
    runtimeRunId: running.runtime.runtimeRunId,
    exit: { code: 0 },
  });
  f.kernel.finishRunAttempt(f.host, {
    runAttemptId: running.run.runAttemptId,
    state: "exited",
    exitCode: 0,
  });
  let refusal = "";
  assert.throws(() => {
    try {
      f.kernel.completeActivation(f.host, {
        activationId: running.activation.activationId,
        consumerId: "worker",
      });
    } catch (error) {
      refusal = (error as Error).message;
      throw error;
    }
  }, TaskSubmissionProofError);
  return { running, refusal };
}

/** Three identical refusals, retried as recoverable: the fence blocks. */
function blockOnBusinessRefusal(f: RoleInstanceFixture) {
  assignTask(f, "assigned");
  let activationId = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { running, refusal } = ackOnlyAttempt(f);
    activationId = running.activation.activationId;
    f.kernel.retryActivation(f.host, {
      activationId,
      error: refusal,
      retryAfterMs: 0,
    });
  }
  const row = f.db
    .prepare(
      "SELECT a.state, f.state AS fence FROM activations a JOIN activation_retry_fences f USING(activation_id) WHERE a.activation_id=?",
    )
    .get(activationId)!;
  assert.equal(row.state, "quarantined");
  assert.equal(row.fence, "blocked");
  return activationId;
}

/** A Runtime-class fence (for example an auth failure) on a finished run. */
function blockOnRuntimeFailure(f: RoleInstanceFixture) {
  f.kernel.postMessage(f.actor, {
    roomId: f.home.roomId,
    body: "please review",
    idempotencyKey: "runtime-wake",
    recipients: [{ participantId: f.instance.instanceId, reason: "mention" }],
  });
  const running = claimInstanceRun(f);
  f.kernel.recordRuntimeTermination(f.host, {
    runAttemptId: running.run.runAttemptId,
    runtimeRunId: running.runtime.runtimeRunId,
    exit: { code: 1 },
  });
  f.kernel.finishRunAttempt(f.host, {
    runAttemptId: running.run.runAttemptId,
    state: "failed",
    exitCode: 1,
  });
  f.kernel.retryActivation(f.host, {
    activationId: running.activation.activationId,
    error: "AuthError: provider login required",
    retryAfterMs: 0,
    retryDisposition: "action_required",
  });
  return running;
}

function wake(f: RoleInstanceFixture, roomId: string, key: string) {
  f.kernel.postMessage(f.actor, {
    roomId,
    body: "new work",
    idempotencyKey: key,
    recipients: [{ participantId: f.instance.instanceId, reason: "mention" }],
  });
}

test("D2-1: a business-obligation fence does not hold the lane: new channel and private-box work are placed", () => {
  const f = roleInstanceFixture();
  try {
    const blocked = blockOnBusinessRefusal(f);
    wake(f, f.home.roomId, "after-block-home");
    const home = claimInstanceRun(f);
    assert.notEqual(home.activation.activationId, blocked);
    assert.equal(home.activation.roomId, f.home.roomId);
    home.finish(0);
    wake(f, f.privateBox.roomId, "after-block-direct");
    const direct = claimInstanceRun(f);
    assert.equal(direct.activation.roomId, f.privateBox.roomId);
    direct.finish(0);
    assert.equal(
      f.db
        .prepare("SELECT state FROM activations WHERE activation_id=?")
        .get(blocked)!.state,
      "quarantined",
      "the blocked Activation stays for the Human to handle",
    );
  } finally {
    f.close();
  }
});

test("D2-1: a Runtime-class fence still holds the lane", () => {
  const f = roleInstanceFixture();
  try {
    blockOnRuntimeFailure(f);
    wake(f, f.privateBox.roomId, "runtime-direct");
    assert.equal(f.kernel.scheduleNextPlacement({ leaseMs: 600_000 }), null);
    assert.equal(
      f.kernel.leaseNextActivation(f.host, { leaseMs: 1_000 }),
      null,
    );
  } finally {
    f.close();
  }
});

test("D2-3: the activity projection reports the blocked Activation, its reason and whether it holds the lane", () => {
  const f = roleInstanceFixture();
  try {
    const blocked = blockOnBusinessRefusal(f);
    const [business] = f.kernel
      .listRoomAgentActivity(f.actor, { roomId: f.home.roomId })
      .filter((entry) => entry.participantId === f.instance.instanceId);
    assert.equal(business?.blocked?.activationId, blocked);
    assert.equal(business?.blocked?.holdsLane, false);
    assert.match(business?.blocked?.reason ?? "", /unfinished Task/u);
    assert.doesNotMatch(
      business?.blocked?.reason ?? "",
      /RAH_BUSINESS_OBLIGATION_UNMET/u,
    );
  } finally {
    f.close();
  }
  const g = roleInstanceFixture();
  try {
    const running = blockOnRuntimeFailure(g);
    const [runtime] = g.kernel
      .listRoomAgentActivity(g.actor, { roomId: g.home.roomId })
      .filter((entry) => entry.participantId === g.instance.instanceId);
    assert.equal(
      runtime?.blocked?.activationId,
      running.activation.activationId,
    );
    assert.equal(runtime?.blocked?.holdsLane, true);
    assert.match(runtime?.blocked?.reason ?? "", /AuthError/u);
  } finally {
    g.close();
  }
});

test("D2-2: the Human abandons a blocked Activation: cancelled, fence resolved, lane released, RunAttempt and Task untouched, replay deduplicated", () => {
  const f = roleInstanceFixture();
  try {
    const running = blockOnRuntimeFailure(f);
    const activationId = running.activation.activationId;
    const task = assignTask(f, "unrelated-task");
    const runBefore = f.db
      .prepare("SELECT * FROM run_attempts WHERE activation_id=?")
      .all(activationId);
    const request = {
      instanceId: f.instance.instanceId,
      activationId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "abandon-1",
    };
    const result = f.kernel.roles.abandonBlockedActivation(f.actor, request);
    assert.equal(result.deduplicated, false);
    assert.equal(result.activationId, activationId);
    assert.equal(result.event.type, "instance.activation_abandoned");
    assert.equal(
      f.db
        .prepare("SELECT state FROM activations WHERE activation_id=?")
        .get(activationId)!.state,
      "cancelled",
    );
    const fence = f.db
      .prepare(
        "SELECT state, last_error FROM activation_retry_fences WHERE activation_id=?",
      )
      .get(activationId)!;
    assert.equal(fence.state, "resolved");
    assert.match(String(fence.last_error), /AuthError/u, "history kept");
    assert.deepEqual(
      f.db
        .prepare("SELECT * FROM run_attempts WHERE activation_id=?")
        .all(activationId),
      runBefore,
    );
    const cancelled = f.db
      .prepare(
        "SELECT payload_json FROM room_events WHERE type='activation.cancelled' AND aggregate_id=?",
      )
      .all(activationId);
    assert.equal(cancelled.length, 1);
    assert.equal(
      JSON.parse(String(cancelled[0]!.payload_json)).reason,
      "human_abandoned_blocked_activation",
    );
    const replay = f.kernel.roles.abandonBlockedActivation(f.actor, request);
    assert.equal(replay.deduplicated, true);
    assert.equal(replay.event.eventId, result.event.eventId);
    // The lane is free: the queued Task Activation is placed.
    const next = claimInstanceRun(f);
    assert.notEqual(next.activation.activationId, activationId);
    assert.equal(
      f.kernel
        .listTasks(f.actor, { roomId: f.home.roomId })
        .find((candidate) => candidate.taskId === task.task.taskId)?.state,
      "todo",
    );
    // A second abandon of a no-longer-blocked Activation is refused.
    assert.throws(
      () =>
        f.kernel.roles.abandonBlockedActivation(f.actor, {
          ...request,
          basedOnRoomSeq: f.head(f.home.roomId),
          idempotencyKey: "abandon-2",
        }),
      ConflictError,
    );
  } finally {
    f.close();
  }
});

test("D2-2: abandon handles a pre-fix retry_blocked quarantine whose error carries no business marker", () => {
  const f = roleInstanceFixture();
  try {
    f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      body: "please review",
      idempotencyKey: "legacy-wake",
      recipients: [{ participantId: f.instance.instanceId, reason: "mention" }],
    });
    let activationId = "";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const running = claimInstanceRun(f);
      activationId = running.activation.activationId;
      f.kernel.recordRuntimeTermination(f.host, {
        runAttemptId: running.run.runAttemptId,
        runtimeRunId: running.runtime.runtimeRunId,
        exit: { code: 0 },
      });
      f.kernel.finishRunAttempt(f.host, {
        runAttemptId: running.run.runAttemptId,
        state: "exited",
        exitCode: 0,
      });
      // The text a pre-fix Kernel wrote, without the marker.
      f.kernel.retryActivation(f.host, {
        activationId,
        error: `activation ${activationId} contains unfinished Task task_legacy in state in_progress`,
        retryAfterMs: 0,
      });
    }
    wake(f, f.privateBox.roomId, "legacy-direct");
    assert.equal(
      f.kernel.scheduleNextPlacement({ leaseMs: 600_000 }),
      null,
      "a pre-fix fence still holds the lane until the Human acts",
    );
    f.kernel.roles.abandonBlockedActivation(f.actor, {
      instanceId: f.instance.instanceId,
      activationId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "abandon-legacy",
    });
    const direct = claimInstanceRun(f);
    assert.equal(direct.activation.roomId, f.privateBox.roomId);
    direct.finish(0);
  } finally {
    f.close();
  }
});

test("D2-2: the abandon is reachable only through the authenticated Human client facade", async () => {
  const f = roleInstanceFixture();
  const service = new ClientApplicationService({
    human: createHumanApplicationPort(f.kernel),
    health: () => {
      throw new Error("health not used by this test");
    },
  });
  try {
    await service.start();
    const running = blockOnRuntimeFailure(f);
    const request = {
      instanceId: f.instance.instanceId,
      activationId: running.activation.activationId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "abandon-http",
    };
    const anonymous = new HttpRahClient({
      baseUrl: service.origin,
      accessToken: () => "not-a-token",
    });
    await assert.rejects(() =>
      anonymous.request("instance.activation.abandon", request),
    );
    const client = new HttpRahClient({
      baseUrl: service.origin,
      accessToken: () => f.owner.accessToken,
    });
    const result = await client.request("instance.activation.abandon", request);
    assert.equal(result.deduplicated, false);
    assert.equal(result.channelId, f.home.roomId);
    const replay = await client.request("instance.activation.abandon", {
      ...request,
      basedOnRoomSeq: 0,
    });
    assert.equal(replay.deduplicated, true);
    assert.equal(replay.event.eventId, result.event.eventId);
  } finally {
    await service.close();
    f.close();
  }
});
