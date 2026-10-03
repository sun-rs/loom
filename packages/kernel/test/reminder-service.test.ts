import { bindRoleDefinitionFixture } from "./role-definition-fixture.ts";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { AuthenticatedHostContext } from "../src/index.ts";
import { RoomKernel } from "../src/index.ts";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function createClock(initial = "2026-09-02T00:00:00.000Z") {
  let now = new Date(initial).getTime();
  return {
    advance(milliseconds: number) {
      now += milliseconds;
    },
    now: () => new Date(now),
  };
}

function latestRoomSeq(
  kernel: RoomKernel,
  actor: Parameters<RoomKernel["sync"]>[0],
  roomId: string,
): number {
  return kernel.sync(actor, {
    afterSeq: 0,
    consumerId: "reminder-fixture",
    roomId,
  }).latestRoomSeq;
}

function createFixture(
  options: {
    fireDeliveryHook?: (input: {
      occurrenceId: string;
      reminderId: string;
      reminderVersion: number;
    }) => void;
    threadedAnchor?: boolean;
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-reminder-"));
  const clock = createClock();
  const kernel = new RoomKernel({
    databasePath: join(directory, "room.db"),
    now: clock.now,
    reminderDefaultTimezone: "UTC",
    ...(options.fireDeliveryHook === undefined
      ? {}
      : { reminderFireDeliveryHook: options.fireDeliveryHook }),
  });
  kernel.initialize();
  const human = kernel.provisionPrincipal({
    handle: "reminder-owner",
    kind: "human",
  });
  const agent = kernel.provisionPrincipal({
    handle: "reminder-agent",
    kind: "agent",
  });
  const humanActor = kernel.authenticateAccessToken(human.accessToken);
  const workspace = kernel.createWorkspace(humanActor, {
    idempotencyKey: "reminder-workspace",
    name: "Reminder Workspace",
    slug: "reminder-workspace",
  });
  const room = kernel.createWorkspaceRoom(humanActor, {
    basedOnControlRoomSeq: workspace.event.roomSeq,
    idempotencyKey: "reminder-room",
    kind: "channel",
    name: "Reminder Room",
    slug: "reminder-room",
    workspaceId: workspace.workspace.workspaceId,
  }).room;
  const receiptRoom = kernel.createWorkspaceRoom(humanActor, {
    basedOnControlRoomSeq: latestRoomSeq(
      kernel,
      humanActor,
      workspace.controlRoom.roomId,
    ),
    idempotencyKey: "reminder-receipt-room",
    kind: "channel",
    name: "Reminder Receipts",
    slug: "reminder-receipts",
    workspaceId: workspace.workspace.workspaceId,
  }).room;
  for (const roomId of [
    workspace.controlRoom.roomId,
    room.roomId,
    receiptRoom.roomId,
  ]) {
    kernel.addMember(humanActor, {
      principalId: agent.principal.principalId,
      roomId,
    });
  }
  const policy = kernel.createExecutionPolicy(humanActor, {
    basedOnRoomSeq: latestRoomSeq(
      kernel,
      humanActor,
      workspace.controlRoom.roomId,
    ),
    controlRoomId: workspace.controlRoom.roomId,
    idempotencyKey: "reminder-policy",
    modelIntent: {
      fallback: "disabled",
      reasoning: "default",
      serviceTier: "default",
    },
    preferred: [],
    required: {
      allowedProtocolFamilies: ["rah-worker-process/v1"],
      capabilities: [],
      minimumIsolation: "process",
      workspaceMode: "in_place",
    },
    retryPolicyRef: {
      artifactId: "retry-policy",
      contentDigest: digest("a"),
      versionId: "retry-policy-v1",
    },
    sessionPolicy: "fresh",
  });
  const definition = kernel.createAgentDefinition(humanActor, {
    basedOnRoomSeq: latestRoomSeq(
      kernel,
      humanActor,
      workspace.controlRoom.roomId,
    ),
    controlRoomId: workspace.controlRoom.roomId,
    executionPolicyRevisionId: policy.policy.executionPolicyRevisionId,
    idempotencyKey: "reminder-agent-definition",
    instructionRefs: [],
    memoryPolicyRef: {
      artifactId: "memory-policy",
      contentDigest: digest("b"),
      versionId: "memory-policy-v1",
    },
    participantId: agent.principal.principalId,
    role: "Reminder owner",
    skillRefs: [],
  });
  bindRoleDefinitionFixture(
    kernel,
    humanActor,
    join(directory, "room.db"),
    definition.definition.agentId,
    room.roomId,
    "fixture-offer",
  );
  const posted = kernel.postRoomMessage(humanActor, {
    body: "Please remind yourself to publish the result.",
    idempotencyKey: "reminder-anchor-message",
    recipients: [],
    roomId: room.roomId,
  });
  const thread = options.threadedAnchor
    ? kernel.createThread(humanActor, {
        basedOnRoomSeq: posted.event.roomSeq,
        idempotencyKey: "reminder-anchor-thread",
        recipientIds: [agent.principal.principalId],
        roomId: room.roomId,
        rootMessageId: posted.event.aggregateId,
      }).thread
    : undefined;
  const host = authenticateHost(kernel, agent.principal.principalId);
  const activation = kernel.leaseNextActivation(host, {
    leaseMs: 2 * 60 * 60_000,
  });
  assert.ok(activation);
  const runAttempt = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  const runtime = {
    recoveryDescriptor: {
      driver: "fake-runtime",
      metadata: {},
      recoveryKey: "reminder-runtime",
    },
    runAttemptId: runAttempt.runAttemptId,
    runtimeRunId: "reminder-runtime",
  };
  kernel.prepareRunAttemptRuntime(host, runtime);
  kernel.markRunAttemptRunning(host, runtime);
  const worker = kernel.authorizeWorkerExecution(host, {
    activationId: activation.activationId,
    consumerId: "reminder-worker",
    hostId: host.hostId,
    participantId: agent.principal.principalId,
    roomId: room.roomId,
    runAttemptId: runAttempt.runAttemptId,
    toSeq: activation.toSeq,
  });
  const delivery = kernel.syncWorker(worker, {});
  return {
    agent,
    clock,
    definition,
    delivery,
    directory,
    host,
    humanActor,
    kernel,
    messageId: posted.event.aggregateId,
    receiptRoom,
    room,
    thread,
    worker,
  };
}

function authenticateHost(
  kernel: RoomKernel,
  participantId: string,
): AuthenticatedHostContext {
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "reminder-host",
      participantIds: [participantId],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  return host;
}

test("Raft-compatible Reminder schedule is anchored, owner scoped, and idempotent", () => {
  const fixture = createFixture();
  try {
    const roomSeqBeforeSchedule = latestRoomSeq(
      fixture.kernel,
      fixture.humanActor,
      fixture.room.roomId,
    );
    const request = {
      basedOnRoomSeq: fixture.delivery.cursorAfter,
      delaySeconds: 60,
      idempotencyKey: "schedule-publication-reminder",
      messageId: fixture.messageId.slice(0, 14),
      title: "Publish the result",
    };
    const created = fixture.kernel.reminders.schedule(fixture.worker, request);
    assert.equal(created.deduplicated, false);
    assert.equal(created.reminder.status, "scheduled");
    assert.equal(created.reminder.msgId, fixture.messageId);
    assert.equal(
      created.reminder.ownerAgentId,
      fixture.definition.definition.agentId,
    );
    assert.equal(
      latestRoomSeq(fixture.kernel, fixture.humanActor, fixture.room.roomId),
      roomSeqBeforeSchedule,
    );
    const replied = fixture.kernel.postWorkerMessage(fixture.worker, {
      basedOnRoomSeq: fixture.delivery.cursorAfter,
      body: "The reminder is scheduled.",
      idempotencyKey: "reply-after-reminder-schedule",
    });
    assert.ok("event" in replied);
    assert.equal(
      fixture.kernel.reminders.schedule(fixture.worker, request).deduplicated,
      true,
    );
    assert.throws(
      () =>
        fixture.kernel.reminders.schedule(fixture.worker, {
          ...request,
          title: "Different intent",
        }),
      /idempotency/i,
    );
    assert.deepEqual(
      fixture.kernel.reminders
        .listWorker(fixture.worker, {})
        .map(({ reminderId }) => reminderId),
      [created.reminder.reminderId],
    );
    assert.deepEqual(
      fixture.kernel.reminders
        .listHuman(fixture.humanActor, {
          agentId: fixture.definition.definition.agentId,
        })
        .reminders.map(({ reminderId }) => reminderId),
      [created.reminder.reminderId],
    );
    const shortId = created.reminder.reminderId.slice(0, 14);
    const snoozed = fixture.kernel.reminders.snooze(fixture.worker, {
      delaySeconds: 120,
      idempotencyKey: "snooze-by-short-id",
      reminderId: shortId,
    });
    assert.equal(snoozed.reminder.reminderId, created.reminder.reminderId);
    assert.equal(snoozed.reminder.status, "scheduled");
  } finally {
    fixture.kernel.close();
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("a due Reminder persists a receipt before exactly one owner-only Activation", () => {
  const fixture = createFixture();
  try {
    const created = fixture.kernel.reminders.schedule(fixture.worker, {
      basedOnRoomSeq: fixture.delivery.cursorAfter,
      delaySeconds: 30,
      idempotencyKey: "schedule-due-reminder",
      messageId: fixture.messageId,
      title: "Send the report",
    });
    fixture.clock.advance(30_000);
    assert.deepEqual(fixture.kernel.reminders.reconcileDue(), {
      delivered: 1,
      exhausted: 0,
      pending: 0,
      staged: 1,
    });
    assert.equal(
      fixture.kernel.reminders.listWorker(fixture.worker, { status: "fired" })
        .length,
      1,
    );
    const followUps = fixture.kernel
      .listActivations({
        participantId: fixture.agent.principal.principalId,
        roomId: fixture.room.roomId,
      })
      .filter(({ reason }) => reason === "reminder");
    assert.equal(followUps.length, 1);
    assert.equal(followUps[0]?.state, "queued");
    assert.equal(
      fixture.kernel
        .listInbox(
          fixture.kernel.authenticateAccessToken(fixture.agent.accessToken),
          { roomId: fixture.room.roomId },
        )
        .filter(({ reason }) => reason === "reminder").length,
      1,
    );
    assert.deepEqual(fixture.kernel.reminders.reconcileDue(), {
      delivered: 0,
      exhausted: 0,
      pending: 0,
      staged: 0,
    });
    const log = fixture.kernel.reminders.log(fixture.worker, {
      reminderId: created.reminder.reminderId,
    });
    assert.deepEqual(
      log.events.map(({ eventType }) => eventType),
      ["scheduled", "fired"],
    );
  } finally {
    fixture.kernel.close();
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("a Role instance cannot publish a reminder into another channel or wake its members", () => {
  const f = createFixture();
  try {
    assert.throws(
      () =>
        f.kernel.reminders.schedule(f.worker, {
          basedOnRoomSeq: f.delivery.cursorAfter,
          channel: "#reminder-receipts",
          delaySeconds: 30,
          idempotencyKey: "cross-room",
          messageId: f.messageId,
          title: "Cross-room work",
        }),
      /active execution target/,
    );
    f.clock.advance(30_000);
    assert.equal(f.kernel.reminders.reconcileDue().delivered, 0);
    assert.equal(
      f.kernel.listActivations({ roomId: f.receiptRoom.roomId }).length,
      0,
    );
  } finally {
    f.kernel.close();
    rmSync(f.directory, { force: true, recursive: true });
  }
});

test("a Thread-anchored Reminder preserves canonical thread receipt and permalink identities", () => {
  const fixture = createFixture({ threadedAnchor: true });
  try {
    assert.ok(fixture.thread);
    const created = fixture.kernel.reminders.schedule(fixture.worker, {
      basedOnRoomSeq: fixture.delivery.cursorAfter,
      delaySeconds: 10,
      idempotencyKey: "schedule-thread-reminder",
      messageId: fixture.messageId,
      title: "Return to this Thread",
    });
    assert.equal(created.reminder.threadId, fixture.thread.threadId);
    assert.equal(created.reminder.rootMessageId, fixture.messageId);
    fixture.clock.advance(10_000);
    assert.equal(fixture.kernel.reminders.reconcileDue().delivered, 1);
    const fired = fixture.kernel
      .sync(fixture.humanActor, {
        consumerId: "thread-reminder-audit",
        roomId: fixture.room.roomId,
      })
      .events.find((event) => event.type === "reminder.fired");
    assert.ok(fired);
    assert.equal(fired.payload.threadId, fixture.thread.threadId);
    assert.equal(fired.payload.rootMessageId, fixture.messageId);
  } finally {
    fixture.kernel.close();
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("Reminder fire delivery retries from its durable receipt without early wake", () => {
  let failuresRemaining = 2;
  const fixture = createFixture({
    fireDeliveryHook: () => {
      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        throw new Error("simulated fire transport failure");
      }
    },
  });
  try {
    fixture.kernel.reminders.schedule(fixture.worker, {
      basedOnRoomSeq: fixture.delivery.cursorAfter,
      delaySeconds: 10,
      idempotencyKey: "schedule-retry-reminder",
      messageId: fixture.messageId,
      title: "Retry safely",
    });
    fixture.clock.advance(10_000);
    assert.equal(fixture.kernel.reminders.reconcileDue().pending, 1);
    assert.equal(
      fixture.kernel
        .listActivations({ roomId: fixture.room.roomId })
        .filter(({ reason }) => reason === "reminder").length,
      0,
    );
    fixture.clock.advance(1_000);
    assert.equal(fixture.kernel.reminders.reconcileDue().pending, 1);
    fixture.clock.advance(2_000);
    assert.equal(fixture.kernel.reminders.reconcileDue().delivered, 1);
    assert.equal(
      fixture.kernel
        .listActivations({ roomId: fixture.room.roomId })
        .filter(({ reason }) => reason === "reminder").length,
      1,
    );
  } finally {
    fixture.kernel.close();
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("Raft recurrence grammar re-arms daily and interval Reminders", () => {
  const fixture = createFixture();
  try {
    const recurring = fixture.kernel.reminders.schedule(fixture.worker, {
      basedOnRoomSeq: fixture.delivery.cursorAfter,
      idempotencyKey: "schedule-recurring-reminder",
      messageId: fixture.messageId,
      repeat: "every:15m",
      timezone: "UTC",
      title: "Check the queue",
    });
    assert.equal(recurring.reminder.recurrence?.kind, "interval");
    fixture.clock.advance(15 * 60_000);
    assert.equal(fixture.kernel.reminders.reconcileDue().delivered, 1);
    const rearmed = fixture.kernel.reminders.listWorker(fixture.worker, {
      status: "scheduled",
    })[0];
    assert.equal(rearmed?.version, 2);
    assert.equal(
      rearmed?.fireAt,
      new Date(fixture.clock.now().getTime() + 15 * 60_000).toISOString(),
    );
  } finally {
    fixture.kernel.close();
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});
