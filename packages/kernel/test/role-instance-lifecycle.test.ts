import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ClientApplicationService } from "../../application-service/src/index.ts";
import { HttpRahClient } from "../../client-sdk/src/index.ts";
import { RoomKernel, createHumanApplicationPort } from "../src/index.ts";
import {
  launchContext,
  roleInstanceFixture,
  startInstanceRun,
  startInstanceRunFromQueue,
} from "./role-instance-fixture.ts";

test("channel creation cannot add an existing Role instance to a second channel", () => {
  const f = roleInstanceFixture();
  try {
    assert.throws(
      () =>
        f.kernel.createWorkspaceRoom(f.actor, {
          workspaceId: f.workspace.workspace.workspaceId,
          basedOnControlRoomSeq: f.head(f.controlRoomId),
          kind: "channel",
          idempotencyKey: "second",
          name: "second",
          slug: "second",
          initialAgentParticipantIds: [f.instance.instanceId],
        }),
      /Role instance cannot join another channel/,
    );
    assert.deepEqual(
      f.db
        .prepare(
          "SELECT r.room_id FROM memberships m JOIN rooms r ON r.room_id=m.room_id WHERE m.principal_id=? AND r.kind='channel'",
        )
        .all(f.instance.instanceId)
        .map((row) => row.room_id),
      [f.home.roomId],
    );
  } finally {
    f.close();
  }
});

test("a removed instance cannot rejoin with its old ID; re-adding the Role creates a new instance", () => {
  const f = roleInstanceFixture();
  try {
    // An existing member's replay stays an idempotent no-op.
    f.kernel.addMember(f.actor, {
      roomId: f.home.roomId,
      principalId: f.instance.instanceId,
    });
    f.kernel.removeRoomMember(f.actor, {
      roomId: f.home.roomId,
      principalId: f.instance.instanceId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "remove",
    });
    const refused = /removed Role instance cannot rejoin/;
    assert.throws(
      () =>
        f.kernel.addMember(f.actor, {
          roomId: f.home.roomId,
          principalId: f.instance.instanceId,
        }),
      refused,
    );
    assert.throws(
      () =>
        f.kernel.addRoomMember(f.actor, {
          roomId: f.home.roomId,
          principalId: f.instance.instanceId,
          role: "member",
          basedOnRoomSeq: f.head(f.home.roomId),
          idempotencyKey: "readd",
        }),
      refused,
    );
    assert.equal(
      f.db
        .prepare("SELECT 1 FROM memberships WHERE room_id=? AND principal_id=?")
        .get(f.home.roomId, f.instance.instanceId),
      undefined,
    );
    assert.equal(
      f.kernel.roles
        .list(f.actor, { controlRoomId: f.controlRoomId })
        .instances.some((i) => i.instanceId === f.instance.instanceId),
      false,
    );
    // The old private box stays inactive.
    assert.throws(
      () =>
        f.kernel.postMessage(f.actor, {
          roomId: f.privateBox.roomId,
          body: "must not wake the removed instance",
          idempotencyKey: "private-after-readd",
          recipients: [],
        }),
      /private box.*inactive/i,
    );
    // The same Role instantiated again is a new instance with a new ID.
    const again = f.kernel.roles.instantiate(f.actor, {
      roleId: f.kernel.roles
        .list(f.actor, { controlRoomId: f.controlRoomId })
        .roles.map((role) => role.roleId)[0]!,
      channelId: f.home.roomId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "instance-again",
    }).instance;
    assert.notEqual(again.instanceId, f.instance.instanceId);
    assert.deepEqual(
      f.kernel.roles
        .list(f.actor, { controlRoomId: f.controlRoomId })
        .instances.map((i) => i.instanceId),
      [again.instanceId],
    );
  } finally {
    f.close();
  }
});

test("a removed instance's private box rejects thread creation and thread replies", () => {
  const f = roleInstanceFixture();
  try {
    const root = f.kernel.postMessage(f.actor, {
      roomId: f.privateBox.roomId,
      body: "private root",
      idempotencyKey: "root",
      recipients: [],
    });
    const thread = f.kernel.createThread(f.actor, {
      basedOnRoomSeq: f.head(f.privateBox.roomId),
      idempotencyKey: "thread",
      recipientIds: [],
      roomId: f.privateBox.roomId,
      rootMessageId: root.event.aggregateId,
    });
    const second = f.kernel.postMessage(f.actor, {
      roomId: f.privateBox.roomId,
      body: "second root",
      idempotencyKey: "root-2",
      recipients: [],
    });
    f.detachFromChannel();
    const activationsBefore = f.db
      .prepare("SELECT count(*) n FROM activations WHERE participant_id=?")
      .get(f.instance.instanceId)!.n;
    assert.throws(
      () =>
        f.kernel.replyThread(f.actor, {
          basedOnRoomSeq: f.head(f.privateBox.roomId),
          body: "must not wake removed instance",
          idempotencyKey: "reply-after-removal",
          recipientIds: [f.instance.instanceId],
          roomId: f.privateBox.roomId,
          threadId: thread.thread.threadId,
        }),
      /private box.*inactive/i,
    );
    assert.throws(
      () =>
        f.kernel.createThread(f.actor, {
          basedOnRoomSeq: f.head(f.privateBox.roomId),
          idempotencyKey: "thread-after-removal",
          recipientIds: [f.instance.instanceId],
          roomId: f.privateBox.roomId,
          rootMessageId: second.event.aggregateId,
        }),
      /private box.*inactive/i,
    );
    assert.equal(
      f.db
        .prepare("SELECT count(*) n FROM activations WHERE participant_id=?")
        .get(f.instance.instanceId)!.n,
      activationsBefore,
    );
  } finally {
    f.close();
  }
});

test("forwarding into a removed instance's private box is refused", () => {
  const f = roleInstanceFixture();
  try {
    const source = f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      body: "public note",
      idempotencyKey: "source",
      recipients: [],
    });
    f.detachFromChannel();
    const response = f.kernel.forwardMessages(f.actor, {
      destinationRoomIds: [f.privateBox.roomId],
      requestId: "forward-after-removal",
      sourceMessageIds: [source.event.aggregateId],
      sourceRoomId: f.home.roomId,
    });
    assert.equal(response.results[0]!.status, "failed");
    assert.equal(
      f.db
        .prepare("SELECT count(*) n FROM messages WHERE room_id=?")
        .get(f.privateBox.roomId)!.n,
      0,
    );
  } finally {
    f.close();
  }
});

function insertInstanceReminder(
  f: ReturnType<typeof roleInstanceFixture>,
  anchorMessageId: string,
) {
  const fireAt = new Date(Date.now() - 1_000);
  f.db
    .prepare(
      `INSERT INTO reminders(reminder_id, owner_agent_id, owner_participant_id,
         room_id, target_room_id, title, fire_at, fire_at_ms, status,
         message_id, version, created_at, updated_at)
       VALUES('reminder-private', ?, ?, ?, ?, 'follow up', ?, ?, 'scheduled', ?, 1, ?, ?)`,
    )
    .run(
      f.instance.agentId,
      f.instance.instanceId,
      f.home.roomId,
      f.privateBox.roomId,
      fireAt.toISOString(),
      fireAt.getTime(),
      anchorMessageId,
      fireAt.toISOString(),
      fireAt.toISOString(),
    );
}

test("an instance-owned scheduled reminder counts as active work at removal", () => {
  const f = roleInstanceFixture();
  try {
    const anchor = f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      body: "anchor",
      idempotencyKey: "anchor",
      recipients: [],
    });
    insertInstanceReminder(f, anchor.event.aggregateId);
    const remove = (key: string) =>
      f.kernel.removeRoomMember(f.actor, {
        roomId: f.home.roomId,
        principalId: f.instance.instanceId,
        basedOnRoomSeq: f.head(f.home.roomId),
        idempotencyKey: key,
      });
    assert.throws(
      () => remove("remove-with-reminder"),
      /active collaboration work/,
    );
    f.db
      .prepare("UPDATE reminders SET status='canceled' WHERE reminder_id=?")
      .run("reminder-private");
    remove("remove-after-cancel");
  } finally {
    f.close();
  }
});

test("a removed instance's reminder never fires into its private box", () => {
  const f = roleInstanceFixture();
  try {
    const anchor = f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      body: "anchor",
      idempotencyKey: "anchor",
      recipients: [],
    });
    insertInstanceReminder(f, anchor.event.aggregateId);
    f.detachFromChannel();
    f.kernel.reminders.reconcileDue();
    assert.equal(
      f.db
        .prepare(
          "SELECT count(*) n FROM room_events WHERE room_id=? AND type='reminder.fired'",
        )
        .get(f.privateBox.roomId)!.n,
      0,
    );
    assert.equal(
      f.db
        .prepare("SELECT count(*) n FROM activations WHERE participant_id=?")
        .get(f.instance.instanceId)!.n,
      0,
    );
    assert.equal(
      f.db
        .prepare("SELECT state FROM reminder_fire_receipts WHERE reminder_id=?")
        .get("reminder-private")!.state,
      "obsolete",
    );
  } finally {
    f.close();
  }
});

test("a first launch that fails before any session binding does not brick the instance", () => {
  const f = roleInstanceFixture();
  try {
    assert.equal(launchContext(f).instanceSessionRequired, false);
    // Auth expired / bad model / crash before the session-id frame: the Host
    // spawned a process but never recorded a native session binding.
    startInstanceRun(f).finish(1);
    assert.ok(
      f.db
        .prepare(
          "SELECT 1 FROM runtime_processes WHERE participant_id=? LIMIT 1",
        )
        .get(f.instance.instanceId),
      "precondition: launch history exists",
    );
    assert.equal(launchContext(f).instanceSessionRequired, false);
    assert.equal(launchContext(f).instanceSessionGeneration, 0);
  } finally {
    f.close();
  }
});

test("a recorded session binding keeps requiring that session even if Host files are lost", () => {
  const f = roleInstanceFixture();
  try {
    const work = startInstanceRun(f);
    f.kernel.instanceSessions.record(f.host, {
      runAttemptId: work.run.runAttemptId,
      runtimeRunId: work.runtime.runtimeRunId,
    });
    // Idempotent: every resumed run reports the same binding again.
    f.kernel.instanceSessions.record(f.host, {
      runAttemptId: work.run.runAttemptId,
      runtimeRunId: work.runtime.runtimeRunId,
    });
    work.finish(0);
    // The Kernel evidence is independent of the Host's session files, so a
    // lost binding file makes the Host fail closed instead of starting fresh.
    assert.equal(launchContext(f).instanceSessionRequired, true);
    assert.throws(
      () =>
        f.kernel.instanceSessions.record(f.host, {
          runAttemptId: work.run.runAttemptId,
          runtimeRunId: work.runtime.runtimeRunId,
        }),
      /cannot record/i,
      "a finished run cannot claim a new binding",
    );
  } finally {
    f.close();
  }
});

test("a Human session reset is the explicit, visible exit for a blocked instance", async () => {
  const f = roleInstanceFixture();
  const service = new ClientApplicationService({
    human: createHumanApplicationPort(f.kernel),
    health: () => {
      throw new Error("health not used by this test");
    },
  });
  try {
    await service.start();
    const client = new HttpRahClient({
      baseUrl: service.origin,
      accessToken: () => f.owner.accessToken,
    });
    const work = startInstanceRun(f);
    f.kernel.instanceSessions.record(f.host, {
      runAttemptId: work.run.runAttemptId,
      runtimeRunId: work.runtime.runtimeRunId,
    });
    const reset = (key: string) =>
      client.request("instance.session.reset", {
        instanceId: f.instance.instanceId,
        basedOnRoomSeq: f.head(f.home.roomId),
        idempotencyKey: key,
      });
    await assert.rejects(() => reset("reset-while-running"), /running work/i);
    assert.equal(launchContext(f).instanceSessionRequired, true);
    work.finish(0);
    const result = await reset("reset");
    assert.equal(result.deduplicated, false);
    assert.equal(result.channelId, f.home.roomId);
    assert.equal(result.sessionGeneration, 1);
    assert.equal(result.event.roomId, f.home.roomId);
    assert.equal(result.event.type, "instance.session_reset");
    assert.match(
      String(result.event.payload.notice),
      /context continuity interrupted by Human reset/,
    );
    assert.equal(launchContext(f).instanceSessionRequired, false);
    assert.equal(launchContext(f).instanceSessionGeneration, 1);
    const replay = await client.request("instance.session.reset", {
      instanceId: f.instance.instanceId,
      basedOnRoomSeq: 0,
      idempotencyKey: "reset",
    });
    assert.equal(replay.deduplicated, true);
    assert.equal(replay.event.eventId, result.event.eventId);
    // The new generation binds and is then required like the first one.
    const next = startInstanceRun(f);
    f.kernel.instanceSessions.record(f.host, {
      runAttemptId: next.run.runAttemptId,
      runtimeRunId: next.runtime.runtimeRunId,
    });
    next.finish(0);
    assert.equal(launchContext(f).instanceSessionRequired, true);
    assert.equal(launchContext(f).instanceSessionGeneration, 1);
    // History stays: the reset appended an event, it did not delete runs.
    assert.equal(
      f.db
        .prepare("SELECT count(*) n FROM run_attempts WHERE participant_id=?")
        .get(f.instance.instanceId)!.n,
      2,
    );
  } finally {
    await service.close();
    f.close();
  }
});

const resetSession = (f: ReturnType<typeof roleInstanceFixture>, key: string) =>
  f.kernel.roles.resetInstanceSession(f.actor, {
    instanceId: f.instance.instanceId,
    basedOnRoomSeq: f.head(f.home.roomId),
    idempotencyKey: key,
  });

test("reset while an Activation is leased without a live Run: the launch reads the new generation", () => {
  const f = roleInstanceFixture();
  try {
    const bound = startInstanceRun(f);
    f.kernel.instanceSessions.record(f.host, {
      runAttemptId: bound.run.runAttemptId,
      runtimeRunId: bound.runtime.runtimeRunId,
    });
    bound.finish(0);
    assert.equal(launchContext(f).instanceSessionRequired, true);
    f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      body: "next question",
      idempotencyKey: "leased-before-reset",
      recipients: [{ participantId: f.instance.instanceId, reason: "mention" }],
    });
    const placement = f.kernel.scheduleNextPlacement({ leaseMs: 600_000 });
    assert.equal(placement?.participantId, f.instance.instanceId);
    assert.equal(
      f.db
        .prepare("SELECT state FROM activations WHERE activation_id=?")
        .get(placement!.activationId)!.state,
      "leased",
      "precondition: leased, but no RunAttempt exists yet",
    );
    // Allowed: the generation is read when the Run is created, not at lease.
    assert.equal(resetSession(f, "reset-while-leased").sessionGeneration, 1);
    const claim = f.kernel.claimNextPlacement(f.host, { leaseMs: 600_000 });
    assert.equal(claim?.activation.activationId, placement!.activationId);
    // The launch carries the new generation without a binding requirement,
    // so the Host starts a fresh native session instead of the old one.
    assert.equal(claim!.agentContext.instanceSessionGeneration, 1);
    assert.equal(claim!.agentContext.instanceSessionRequired, false);
    // Now a Run exists: a second reset is refused until it finishes.
    assert.throws(
      () => resetSession(f, "reset-while-starting"),
      /running work/i,
    );
  } finally {
    f.close();
  }
});

test("a late binding receipt from the previous generation cannot bind the new one", () => {
  const f = roleInstanceFixture();
  try {
    const old = startInstanceRun(f);
    // Reset is refused while the old-generation run is live, so its receipt
    // can only arrive after it finished.
    assert.throws(() => resetSession(f, "reset-too-early"), /running work/i);
    old.finish(0);
    assert.equal(resetSession(f, "reset").sessionGeneration, 1);
    assert.throws(
      () =>
        f.kernel.instanceSessions.record(f.host, {
          runAttemptId: old.run.runAttemptId,
          runtimeRunId: old.runtime.runtimeRunId,
        }),
      /cannot record/i,
    );
    assert.equal(launchContext(f).instanceSessionGeneration, 1);
    assert.equal(
      launchContext(f).instanceSessionRequired,
      false,
      "the new generation stays unbound until its own run reports a binding",
    );
    assert.equal(
      f.db
        .prepare(
          "SELECT bound_run_attempt_id FROM role_instance_sessions WHERE instance_id=?",
        )
        .get(f.instance.instanceId)!.bound_run_attempt_id,
      null,
    );
  } finally {
    f.close();
  }
});

test("full review batch 2: a binding reported mid-run survives the run's failure", () => {
  const f = roleInstanceFixture();
  try {
    // The cold drivers now report the binding as soon as the provider took
    // the input; the run can still fail, be cancelled or crash afterwards.
    const work = startInstanceRun(f);
    f.kernel.instanceSessions.record(f.host, {
      runAttemptId: work.run.runAttemptId,
      runtimeRunId: work.runtime.runtimeRunId,
    });
    work.finish(1);
    // The next launch must resume that session (fail closed if lost), never
    // start a new one silently.
    assert.equal(launchContext(f).instanceSessionRequired, true);
    assert.equal(launchContext(f).instanceSessionGeneration, 0);
  } finally {
    f.close();
  }
});

/** Ends a run in failure and lets the Host's retry decision quarantine it. */
function quarantineInstanceRun(
  f: ReturnType<typeof roleInstanceFixture>,
  error: string,
  retryDisposition: "action_required" | "sticky_terminal",
) {
  const work = startInstanceRun(f);
  f.kernel.instanceSessions.record(f.host, {
    runAttemptId: work.run.runAttemptId,
    runtimeRunId: work.runtime.runtimeRunId,
  });
  f.kernel.recordRuntimeTermination(f.host, {
    runAttemptId: work.run.runAttemptId,
    runtimeRunId: work.runtime.runtimeRunId,
    exit: { code: 1 },
  });
  f.kernel.finishRunAttempt(f.host, {
    runAttemptId: work.run.runAttemptId,
    state: "failed",
    exitCode: 1,
  });
  f.kernel.retryActivation(f.host, {
    activationId: work.activation.activationId,
    error,
    retryAfterMs: 0,
    retryDisposition,
  });
  const state = (activationId = work.activation.activationId) =>
    String(
      f.db
        .prepare("SELECT state FROM activations WHERE activation_id=?")
        .get(activationId)!.state,
    );
  assert.equal(state(), "quarantined", "precondition: a real quarantine");
  return { ...work, state };
}

const SESSION_CONTINUITY_FAILURE =
  "RAH_SESSION_CONTINUITY_REQUIRED: previously launched instance has no session binding";

test("full review batch 2: a session reset requeues the session-continuity quarantine and the new generation runs", () => {
  const f = roleInstanceFixture();
  try {
    const blocked = quarantineInstanceRun(
      f,
      SESSION_CONTINUITY_FAILURE,
      "sticky_terminal",
    );
    f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      body: "are you there?",
      idempotencyKey: "after-quarantine",
      recipients: [{ participantId: f.instance.instanceId, reason: "mention" }],
    });
    assert.equal(
      f.kernel.leaseNextActivation(f.host, { leaseMs: 600_000 }),
      null,
      "precondition: the quarantine blocks the whole lane",
    );
    const reset = resetSession(f, "reset-after-quarantine");
    assert.equal(reset.sessionGeneration, 1);
    assert.deepEqual(reset.event.payload.recovery, {
      resumedActivationIds: [blocked.activation.activationId],
    });
    assert.equal(blocked.state(), "queued");
    const fence = f.db
      .prepare(
        "SELECT state, resolution_kind FROM activation_retry_fences WHERE activation_id=?",
      )
      .get(blocked.activation.activationId)!;
    assert.equal(fence.state, "resolved");
    assert.equal(fence.resolution_kind, "restart");
    const resumed = f.db
      .prepare(
        "SELECT payload_json FROM room_events WHERE type='activation.retry_resumed' AND aggregate_id=?",
      )
      .get(blocked.activation.activationId);
    assert.ok(resumed, "the recovery is a visible Room event");
    assert.equal(
      JSON.parse(String(resumed.payload_json)).cause,
      "instance.session_reset",
    );
    // The old obligation runs again, merged with the follow-up, under the new
    // generation: a fresh native session, bound and then required.
    const next = startInstanceRunFromQueue(f);
    assert.equal(next.activation.activationId, blocked.activation.activationId);
    assert.equal(launchContext(f).instanceSessionGeneration, 1);
    assert.equal(launchContext(f).instanceSessionRequired, false);
    f.kernel.instanceSessions.record(f.host, {
      runAttemptId: next.run.runAttemptId,
      runtimeRunId: next.runtime.runtimeRunId,
    });
    next.finish(0);
    assert.equal(blocked.state(), "completed");
    assert.equal(launchContext(f).instanceSessionRequired, true);
    assert.equal(launchContext(f).instanceSessionGeneration, 1);
  } finally {
    f.close();
  }
});

test("full review batch 2: a session reset never lifts an unrelated quarantine", () => {
  const f = roleInstanceFixture();
  try {
    const blocked = quarantineInstanceRun(
      f,
      "access token could not be refreshed",
      "action_required",
    );
    const reset = resetSession(f, "reset-with-auth-quarantine");
    assert.equal(reset.sessionGeneration, 1);
    assert.deepEqual(reset.event.payload.recovery, {
      resumedActivationIds: [],
    });
    assert.equal(blocked.state(), "quarantined");
    assert.equal(
      f.kernel.leaseNextActivation(f.host, { leaseMs: 600_000 }),
      null,
      "the unrelated quarantine still holds the lane",
    );
  } finally {
    f.close();
  }
});

test("full review batch 2: unresolved runtime cleanup still refuses the reset and keeps the quarantine", () => {
  const f = roleInstanceFixture();
  try {
    const blocked = quarantineInstanceRun(
      f,
      SESSION_CONTINUITY_FAILURE,
      "sticky_terminal",
    );
    const now = new Date().toISOString();
    f.db
      .prepare(
        "INSERT INTO runtime_cleanup_states(runtime_run_id, host_id, participant_id, run_attempt_id, state, last_cleanup_id, observed_at, updated_at) VALUES(?, ?, ?, ?, 'pending', NULL, ?, ?)",
      )
      .run(
        blocked.runtime.runtimeRunId,
        f.host.hostId,
        f.instance.instanceId,
        blocked.run.runAttemptId,
        now,
        now,
      );
    assert.throws(
      () => resetSession(f, "reset-with-leftovers"),
      /unresolved leftover processes/,
    );
    assert.equal(blocked.state(), "quarantined");
    assert.equal(launchContext(f).instanceSessionGeneration, 0);
  } finally {
    f.close();
  }
});

test("a Role instance run without recorded usage reads as unavailable, not zero", () => {
  const f = roleInstanceFixture();
  try {
    const work = startInstanceRun(f);
    const usage = f.kernel.runAttemptUsage.get(f.actor, {
      agentId: f.agentId,
      runAttemptId: work.run.runAttemptId,
    });
    assert.equal(usage.completeness, "unavailable");
    assert.equal(usage.totals.inputTokens, null);
  } finally {
    f.close();
  }
});

test("instance session reset is Human-only and rejects non-instances", async () => {
  const f = roleInstanceFixture();
  try {
    const agent = f.kernel.provisionPrincipal({
      handle: "legacy",
      kind: "agent",
    });
    assert.throws(
      () =>
        f.kernel.roles.resetInstanceSession(f.actor, {
          instanceId: agent.principal.principalId,
          basedOnRoomSeq: f.head(f.home.roomId),
          idempotencyKey: "reset-legacy",
        }),
      /Role instance not found/,
    );
    const agentActor = f.kernel.authenticateAccessToken(agent.accessToken);
    assert.throws(() =>
      f.kernel.roles.resetInstanceSession(agentActor, {
        instanceId: f.instance.instanceId,
        basedOnRoomSeq: f.head(f.home.roomId),
        idempotencyKey: "reset-by-agent",
      }),
    );
  } finally {
    f.close();
  }
});

test("Agent memory and execution resets refuse Role instances instead of bricking them", () => {
  const f = roleInstanceFixture();
  try {
    for (const kind of ["memory_reset", "execution_restart"] as const)
      assert.throws(
        () =>
          f.kernel.acquireAgentExclusiveOperationLease(f.host, {
            kind,
            leaseMs: 60_000,
            operationId: `operation-${kind}`,
            participantId: f.instance.instanceId,
          }),
        /instance\.session\.reset/,
      );
  } finally {
    f.close();
  }
});

test("schema 62 upgrade keeps a previously launched instance fail closed", () => {
  const f = roleInstanceFixture();
  const databasePath = f.kernel.databasePath;
  try {
    startInstanceRun(f).finish(0);
    f.kernel.close();
    f.db.exec("DROP TABLE role_instance_sessions; PRAGMA user_version = 61;");
    const upgraded = new RoomKernel({ databasePath });
    upgraded.initialize();
    upgraded.close();
    // Pre-upgrade Hosts never reported binding evidence, so launch history is
    // the conservative stand-in; instance.session.reset is the explicit exit.
    assert.equal(launchContext(f).instanceSessionRequired, true);
    assert.equal(launchContext(f).instanceSessionGeneration, 0);
    // Later starts do not re-run the backfill (a reset would stay reset).
    f.db.exec("DELETE FROM role_instance_sessions");
    const restarted = new RoomKernel({ databasePath });
    restarted.initialize();
    restarted.close();
    assert.equal(launchContext(f).instanceSessionRequired, false);
  } finally {
    f.db.close();
    rmSync(join(databasePath, ".."), { recursive: true, force: true });
  }
});
