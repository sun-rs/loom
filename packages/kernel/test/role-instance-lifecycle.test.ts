import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { ClientApplicationService } from "../../application-service/src/index.ts";
import { HttpRahClient } from "../../client-sdk/src/index.ts";
import { RoomKernel, createHumanApplicationPort } from "../src/index.ts";
import { agentRuntimeContextFromPlacement } from "../src/run-agent-context.ts";

// S1-f: Role instance isolation and lifecycle invariants. Fake Host, no
// provider process; every assertion reads durable Kernel state.
function roleInstanceFixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-role-lifecycle-"));
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  const owner = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
  const actor = kernel.authenticateAccessToken(owner.accessToken);
  const workspace = kernel.createWorkspace(actor, {
    name: "Roles",
    slug: "roles",
    idempotencyKey: "workspace",
  });
  const db = new DatabaseSync(databasePath);
  const head = (id: string) =>
    Number(
      db
        .prepare("SELECT next_seq - 1 AS seq FROM rooms WHERE room_id=?")
        .get(id)!.seq,
    );
  const controlRoomId = workspace.controlRoom.roomId;
  const role = kernel.roles.create(actor, {
    controlRoomId,
    basedOnRoomSeq: head(controlRoomId),
    idempotencyKey: "role",
    configuration: {
      displayName: "Reviewer",
      handle: "reviewer",
      instructions: "Review only.",
      role: "Review",
      runtimeOfferId: "offer",
      modelIntent: { fallback: "disabled" as const },
    },
  }).role;
  const channel = (slug: string) =>
    kernel.createWorkspaceRoom(actor, {
      workspaceId: workspace.workspace.workspaceId,
      basedOnControlRoomSeq: head(controlRoomId),
      kind: "channel",
      idempotencyKey: slug,
      name: slug,
      slug,
    }).room;
  const home = channel("home");
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "host",
      participantIds: [
        kernel.provisionPrincipal({ handle: "bootstrap", kind: "agent" })
          .principal.principalId,
      ],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  const now = new Date(),
    digest = `sha256:${"a".repeat(64)}`;
  kernel.publishRuntimeOffer(host, {
    hostId: host.hostId,
    hostInstanceId: host.instanceId,
    runtimeOfferId: "offer",
    runtimeProfileId: "profile",
    runtimeProfileRevisionId: "profile-v1",
    revisionDigest: digest,
    protocolFamily: "rah-worker-process/v1",
    state: "available",
    observedAt: now.toISOString(),
    leaseUntil: new Date(now.getTime() + 600_000).toISOString(),
    isolation: { evidence: "declared", level: "none" },
    maxConcurrent: 2,
    capacityPoolIds: [],
    capabilityEvidence: [],
    certificationRefs: [],
    modelBindingDescriptors: [],
    supportedToolAccessModes: ["full_access"],
    workspaceMountDescriptors: [
      {
        workspaceDefinitionId: workspace.workspace.workspaceId,
        workspaceMountRevisionId: "mount",
        workspaceMountDigest: digest,
        modes: ["in_place"],
      },
    ],
  });
  const created = kernel.roles.instantiate(actor, {
    roleId: role.roleId,
    channelId: home.roomId,
    basedOnRoomSeq: head(home.roomId),
    idempotencyKey: "instance",
  });
  const instance = created.instance;
  const privateBox = kernel.openDirectRoom(actor, {
    workspaceId: workspace.workspace.workspaceId,
    peerPrincipalId: instance.instanceId,
    basedOnControlRoomSeq: head(controlRoomId),
    idempotencyKey: "instance-dm",
  });
  const revisionId = created.agent.currentRevision.agentDefinitionRevisionId;
  /** Simulates a completed removal without draining unrelated work. */
  const detachFromChannel = () =>
    db
      .prepare("DELETE FROM memberships WHERE room_id=? AND principal_id=?")
      .run(home.roomId, instance.instanceId);
  const close = () => {
    db.close();
    kernel.close();
    rmSync(directory, { recursive: true, force: true });
  };
  return {
    actor,
    channel,
    close,
    controlRoomId,
    db,
    detachFromChannel,
    head,
    home,
    host,
    instance,
    kernel,
    owner,
    privateBox,
    revisionId,
    workspace,
  };
}

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

function startInstanceRun(f: ReturnType<typeof roleInstanceFixture>) {
  f.kernel.postMessage(f.actor, {
    roomId: f.home.roomId,
    body: "please review",
    idempotencyKey: `wake-${String(Math.random())}`,
    recipients: [{ participantId: f.instance.instanceId, reason: "mention" }],
  });
  const activation = f.kernel.leaseNextActivation(f.host, {
    leaseMs: 600_000,
  });
  assert.ok(activation);
  assert.equal(activation.participantId, f.instance.instanceId);
  const run = f.kernel.createRunAttempt(f.host, {
    activationId: activation.activationId,
  });
  const runtime = {
    runAttemptId: run.runAttemptId,
    runtimeRunId: "fake-" + run.runAttemptId,
    recoveryDescriptor: {
      driver: "fake",
      recoveryKey: run.runAttemptId,
      metadata: {},
    },
  };
  f.kernel.prepareRunAttemptRuntime(f.host, runtime);
  f.kernel.markRunAttemptRunning(f.host, runtime);
  const scope = {
    activationId: activation.activationId,
    consumerId: "worker",
    hostId: f.host.hostId,
    participantId: activation.participantId,
    roomId: activation.roomId,
    runAttemptId: run.runAttemptId,
    toSeq: activation.toSeq,
  };
  const execution = f.kernel.authorizeWorkerExecution(f.host, scope);
  const finish = (exitCode: number) => {
    f.kernel.acknowledgeWorkerCursor(execution, {
      throughSeq: activation.toSeq,
    });
    f.kernel.recordRuntimeTermination(f.host, {
      runAttemptId: run.runAttemptId,
      runtimeRunId: runtime.runtimeRunId,
      exit: { code: exitCode },
    });
    f.kernel.finishRunAttempt(f.host, {
      runAttemptId: run.runAttemptId,
      state: exitCode === 0 ? "exited" : "failed",
      exitCode,
    });
    f.kernel.completeActivation(f.host, {
      activationId: activation.activationId,
      consumerId: "worker",
    });
  };
  return { activation, run, runtime, finish };
}

const launchContext = (f: ReturnType<typeof roleInstanceFixture>) =>
  agentRuntimeContextFromPlacement(f.db, {
    participant_id: f.instance.instanceId,
    agent_definition_revision_id: f.revisionId,
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
