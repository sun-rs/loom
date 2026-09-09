import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { type AuthenticatedHostContext, RoomKernel } from "@rah-os/kernel";

import { WorkerApplicationService } from "../src/index.ts";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

test("Worker Reminder HTTP contract preserves causal anchoring and owner scope", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-worker-reminder-"));
  let nowMs = Date.parse("2026-09-02T00:00:00.000Z");
  const now = () => new Date(nowMs);
  const kernel = new RoomKernel({
    databasePath: join(directory, "room.db"),
    now,
    reminderDefaultTimezone: "UTC",
  });
  const service = new WorkerApplicationService({ kernel, now });
  try {
    kernel.initialize();
    const human = kernel.provisionPrincipal({
      handle: "worker-reminder-human",
      kind: "human",
    });
    const agent = kernel.provisionPrincipal({
      handle: "worker-reminder-agent",
      kind: "agent",
    });
    const actor = kernel.authenticateAccessToken(human.accessToken);
    const workspace = kernel.createWorkspace(actor, {
      idempotencyKey: "worker-reminder-workspace",
      name: "Worker Reminder Workspace",
      slug: "worker-reminder-workspace",
    });
    const room = kernel.createWorkspaceRoom(actor, {
      basedOnControlRoomSeq: latestRoomSeq(
        kernel,
        actor,
        workspace.controlRoom.roomId,
      ),
      idempotencyKey: "worker-reminder-room",
      kind: "channel",
      name: "Worker Reminder Room",
      slug: "worker-reminder-room",
      workspaceId: workspace.workspace.workspaceId,
    }).room;
    for (const roomId of [workspace.controlRoom.roomId, room.roomId]) {
      kernel.addMember(actor, {
        principalId: agent.principal.principalId,
        roomId,
      });
    }
    const policy = kernel.createExecutionPolicy(actor, {
      basedOnRoomSeq: latestRoomSeq(
        kernel,
        actor,
        workspace.controlRoom.roomId,
      ),
      controlRoomId: workspace.controlRoom.roomId,
      idempotencyKey: "worker-reminder-policy",
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
        artifactId: "worker-reminder-retry",
        contentDigest: digest("a"),
        versionId: "worker-reminder-retry-v1",
      },
      sessionPolicy: "fresh",
    });
    kernel.createAgentDefinition(actor, {
      basedOnRoomSeq: latestRoomSeq(
        kernel,
        actor,
        workspace.controlRoom.roomId,
      ),
      controlRoomId: workspace.controlRoom.roomId,
      executionPolicyRevisionId: policy.policy.executionPolicyRevisionId,
      idempotencyKey: "worker-reminder-definition",
      instructionRefs: [],
      memoryPolicyRef: {
        artifactId: "worker-reminder-memory",
        contentDigest: digest("b"),
        versionId: "worker-reminder-memory-v1",
      },
      participantId: agent.principal.principalId,
      role: "Reminder owner",
      skillRefs: [],
    });
    const posted = kernel.postRoomMessage(actor, {
      body: "Remind yourself to review the release.",
      idempotencyKey: "worker-reminder-anchor",
      recipients: [
        { participantId: agent.principal.principalId, reason: "mention" },
      ],
      roomId: room.roomId,
    });
    const host = authenticateHost(kernel, agent.principal.principalId);
    const activation = kernel.leaseNextActivation(host, {
      leaseMs: 5 * 60_000,
    });
    assert.ok(activation);
    const runAttempt = kernel.createRunAttempt(host, {
      activationId: activation.activationId,
    });
    const runtime = {
      recoveryDescriptor: {
        driver: "fake-runtime",
        metadata: {},
        recoveryKey: "worker-reminder-runtime",
      },
      runAttemptId: runAttempt.runAttemptId,
      runtimeRunId: "worker-reminder-runtime",
    };
    kernel.prepareRunAttemptRuntime(host, runtime);
    kernel.markRunAttemptRunning(host, runtime);
    await service.start();
    const credential = service.issueActivationCredential(host, {
      activationId: activation.activationId,
      consumerId: "worker-reminder-consumer",
      hostId: host.hostId,
      participantId: agent.principal.principalId,
      roomId: room.roomId,
      runAttemptId: runAttempt.runAttemptId,
      toSeq: activation.toSeq,
    });
    const request = async (path: string, body: Record<string, unknown>) => {
      const response = await fetch(`${service.origin}${path}`, {
        body: JSON.stringify(body),
        headers: {
          authorization: `Bearer ${credential.accessToken}`,
          "content-type": "application/json",
        },
        method: "POST",
      });
      const payload: unknown = await response.json();
      return { payload, status: response.status };
    };
    const sync = await request("/v1/worker/sync", {});
    assert.equal(sync.status, 200);
    assert.ok(isRecord(sync.payload));
    const basedOnRoomSeq = sync.payload.cursorAfter;
    assert.equal(typeof basedOnRoomSeq, "number");

    const stale = await request("/v1/worker/reminders/schedule", {
      basedOnRoomSeq: Number(basedOnRoomSeq) + 1,
      delaySeconds: 60,
      idempotencyKey: "worker-reminder-stale",
      messageId: posted.event.aggregateId,
      title: "Must not be scheduled",
    });
    assert.equal(stale.status, 409);

    const scheduled = await request("/v1/worker/reminders/schedule", {
      basedOnRoomSeq,
      delaySeconds: 60,
      idempotencyKey: "worker-reminder-schedule",
      messageId: posted.event.aggregateId,
      title: "Review the release",
    });
    assert.equal(scheduled.status, 200);
    assert.ok(isRecord(scheduled.payload));
    assert.ok(isRecord(scheduled.payload.reminder));
    const reminderId = scheduled.payload.reminder.reminderId;
    assert.ok(typeof reminderId === "string");

    const list = await request("/v1/worker/reminders/list", {});
    assert.equal(list.status, 200);
    assert.ok(isRecord(list.payload));
    assert.ok(Array.isArray(list.payload.reminders));
    assert.equal(list.payload.reminders.length, 1);

    const snoozed = await request("/v1/worker/reminders/snooze", {
      delaySeconds: 120,
      idempotencyKey: "worker-reminder-snooze",
      reminderId: reminderId.slice(0, 14),
    });
    assert.equal(snoozed.status, 200);

    nowMs += 120_001;
    const reconciliation = kernel.reminders.reconcileDue();
    assert.equal(reconciliation.delivered, 1);
    const log = await request("/v1/worker/reminders/log", {
      reminderId,
    });
    assert.equal(log.status, 200);
    assert.ok(isRecord(log.payload));
    assert.ok(Array.isArray(log.payload.events));
    assert.deepEqual(
      log.payload.events.map((event) =>
        isRecord(event) ? event.eventType : undefined,
      ),
      ["scheduled", "snoozed", "fired"],
    );

    // Raft's `reminder schedule` carries no causal cursor at all; the server
    // resolves the anchor against the Activation head it already owns, so the
    // minimal form schedules the same reminder and an identical retry is one.
    const minimal = await request("/v1/worker/reminders/schedule", {
      delaySeconds: 86_400,
      idempotencyKey: "worker-reminder-minimal",
      messageId: posted.event.aggregateId,
      title: "Minimal form",
    });
    assert.equal(minimal.status, 200, JSON.stringify(minimal.payload));
    assert.ok(isRecord(minimal.payload));
    assert.ok(isRecord(minimal.payload.reminder));
    const minimalRetry = await request("/v1/worker/reminders/schedule", {
      delaySeconds: 86_400,
      idempotencyKey: "worker-reminder-minimal",
      messageId: posted.event.aggregateId,
      title: "Minimal form",
    });
    assert.equal(minimalRetry.status, 200);
    assert.ok(isRecord(minimalRetry.payload));
    assert.equal(minimalRetry.payload.deduplicated, true);
    // A presented cursor this credential never saw is still refused.
    const forged = await request("/v1/worker/reminders/schedule", {
      basedOnRoomSeq: Number(basedOnRoomSeq) + 1,
      delaySeconds: 86_400,
      idempotencyKey: "worker-reminder-forged",
      messageId: posted.event.aggregateId,
      title: "Forged cursor",
    });
    assert.equal(forged.status, 409);
  } finally {
    await service.close();
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

function authenticateHost(
  kernel: RoomKernel,
  participantId: string,
): AuthenticatedHostContext {
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "worker-reminder-host",
      participantIds: [participantId],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  return host;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function latestRoomSeq(
  kernel: RoomKernel,
  actor: Parameters<RoomKernel["sync"]>[0],
  roomId: string,
): number {
  return kernel.sync(actor, {
    afterSeq: 0,
    consumerId: "worker-reminder-fixture",
    roomId,
  }).latestRoomSeq;
}
