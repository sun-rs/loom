import { DatabaseSync } from "node:sqlite";
import { assertAgentFirstRunSatisfied } from "../src/agent-first-run.ts";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  OFFICIAL_AGENT_AVATAR_KEYS,
  type RuntimeOffer,
} from "@rah-os/protocol";
import { RoomKernel } from "../src/index.ts";

test("first-run request is durable, directed and requires an actual once-only greeting", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-avatar-provision-"));
  const options = {
    databasePath: join(directory, "room.db"),
    now: () => new Date("2026-08-31T00:00:00.000Z"),
  };
  let kernel = new RoomKernel(options);
  try {
    kernel.initialize();
    const owner = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
    const agent = kernel.provisionPrincipal({
      handle: "bootstrap",
      kind: "agent",
    });
    let actor = kernel.authenticateAccessToken(owner.accessToken);
    const workspace = kernel.createWorkspace(actor, {
      idempotencyKey: "workspace",
      name: "Avatars",
      slug: "avatars",
    });
    const host = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId: "test-host",
        participantIds: [agent.principal.principalId],
      }).accessToken,
    );
    kernel.heartbeatHost(host);
    const digest = `sha256:${"a".repeat(64)}`;
    const offer: RuntimeOffer = {
      capacityPoolIds: [],
      capabilityEvidence: [],
      certificationRefs: [],
      hostId: host.hostId,
      hostInstanceId: host.instanceId,
      isolation: { evidence: "declared", level: "none" },
      leaseUntil: "2026-08-31T00:05:00.000Z",
      maxConcurrent: 1,
      modelBindingDescriptors: [],
      observedAt: options.now().toISOString(),
      protocolFamily: "rah-worker-process/v1",
      revisionDigest: digest,
      runtimeOfferId: "fixture-offer",
      runtimeProfileId: "fixture-profile",
      runtimeProfileRevisionId: "fixture-profile-v1",
      state: "available",
      supportedToolAccessModes: ["full_access"],
      workspaceMountDescriptors: [
        {
          modes: ["in_place"],
          workspaceDefinitionId: workspace.workspace.workspaceId,
          workspaceMountDigest: digest,
          workspaceMountRevisionId: "mount-v1",
        },
      ],
    };
    kernel.publishRuntimeOffer(host, offer);
    const all = kernel.createWorkspaceRoom(actor, {
      workspaceId: workspace.workspace.workspaceId,
      basedOnControlRoomSeq: workspace.event.roomSeq,
      name: "all",
      slug: "all",
      kind: "channel",
      visibility: "public",
      idempotencyKey: "all",
    });
    const request = {
      basedOnRoomSeq: all.event.roomSeq,
      controlRoomId: workspace.controlRoom.roomId,
      displayName: "Alice",
      handle: "alice",
      idempotencyKey: "create-alice",
      instructions: "Test identity only; do not run a provider.",
      modelIntent: { fallback: "disabled" as const },
      role: "Assistant",
      runtimeOfferId: offer.runtimeOfferId,
      sessionPolicy: "prefer_resume" as const,
    };
    const first = kernel.provisionWorkspaceAgent(actor, request);
    assert.equal(
      kernel
        .listAgentPresence(actor, {
          controlRoomId: workspace.controlRoom.roomId,
        })
        .agents.find((a) => a.agentId === first.agent.definition.agentId)
        ?.reason,
      "initializing",
    );
    assert.ok(
      kernel
        .listRoomMemberships(actor, { roomId: all.room.roomId })
        .some(
          (member) =>
            member.principalId === first.agent.definition.participantId,
        ),
      "provisioned Agent joins all in the same transaction",
    );
    const firstRun = kernel
      .sync(actor, {
        roomId: all.room.roomId,
        consumerId: "first-run-test",
        afterSeq: 0,
      })
      .events.filter((event) => event.type === "agent.first_run_requested");
    assert.equal(firstRun.length, 1);
    assert.equal(
      firstRun[0]!.payload.participantId,
      first.agent.definition.participantId,
    );
    assert.equal(firstRun[0]!.payload.greetingEnabled, true);
    const db = new DatabaseSync(options.databasePath);
    const participantId = first.agent.definition.participantId;
    const activation = kernel.leaseNextActivation(host, { leaseMs: 60000 });
    assert.ok(activation);
    assert.equal(activation.participantId, participantId);
    const row = db
      .prepare("SELECT * FROM activations WHERE activation_id=?")
      .get(activation.activationId)!;
    assert.throws(
      () => assertAgentFirstRunSatisfied(db, row),
      /not been published/,
    );
    const run = kernel.createRunAttempt(host, {
      activationId: activation.activationId,
    });
    const runtime = {
      runAttemptId: run.runAttemptId,
      runtimeRunId: "first-run-fake",
      recoveryDescriptor: {
        driver: "fake-runtime",
        metadata: {},
        recoveryKey: "first-run-fake",
      },
    };
    kernel.prepareRunAttemptRuntime(host, runtime);
    kernel.markRunAttemptRunning(host, runtime);
    let execution = kernel.authorizeWorkerExecution(host, {
      activationId: activation.activationId,
      consumerId: "first-run-worker",
      hostId: host.hostId,
      participantId,
      roomId: all.room.roomId,
      runAttemptId: run.runAttemptId,
      toSeq: activation.toSeq,
    });
    const delivery = kernel.syncWorker(execution, {});
    kernel.acknowledgeWorkerCursor(execution, {
      throughSeq: delivery.cursorAfter,
    });
    assert.throws(
      () => assertAgentFirstRunSatisfied(db, row),
      /not been published/,
      "delivery acknowledgement is not greeting completion",
    );
    const finish = (attempt: { runAttemptId: string }, runtimeId: string) => {
      kernel.recordRuntimeTermination(host, {
        exit: { code: 0 },
        runAttemptId: attempt.runAttemptId,
        runtimeRunId: runtimeId,
      });
      kernel.finishRunAttempt(host, {
        runAttemptId: attempt.runAttemptId,
        state: "exited",
        exitCode: 0,
      });
    };
    const retry = (runtimeId: string) => {
      kernel.retryActivation(host, {
        activationId: activation.activationId,
        error: "fixture retry",
        retryAfterMs: 0,
      });
      const leased = kernel.leaseNextActivation(host, { leaseMs: 60000 });
      assert.equal(leased?.activationId, activation.activationId);
      const attempt = kernel.createRunAttempt(host, {
        activationId: activation.activationId,
      });
      const descriptor = {
        runAttemptId: attempt.runAttemptId,
        runtimeRunId: runtimeId,
        recoveryDescriptor: {
          driver: "fake-runtime",
          metadata: {},
          recoveryKey: runtimeId,
        },
      };
      kernel.prepareRunAttemptRuntime(host, descriptor);
      kernel.markRunAttemptRunning(host, descriptor);
      execution = kernel.authorizeWorkerExecution(host, {
        activationId: activation.activationId,
        consumerId: "first-run-worker",
        hostId: host.hostId,
        participantId,
        roomId: all.room.roomId,
        runAttemptId: attempt.runAttemptId,
        toSeq: leased!.toSeq,
      });
      const page = kernel.syncWorker(execution, {});
      kernel.acknowledgeWorkerCursor(execution, {
        throughSeq: page.cursorAfter,
      });
      return attempt;
    };
    finish(run, runtime.runtimeRunId);
    assert.throws(
      () =>
        kernel.completeActivation(host, {
          activationId: activation.activationId,
          consumerId: "first-run-worker",
        }),
      /not been published/,
      "successful exit and cursor acknowledgement cannot complete a missing greeting",
    );
    const secondRun = retry("retry-before-send");
    const key = String(firstRun[0]!.payload.messageKey);
    assert.throws(
      () =>
        kernel.postWorkerMessage(execution, {
          body: "wrong identity",
          idempotencyKey: "agent-first-greeting:someone-else",
        }),
      /this Agent/,
    );
    const sent = kernel.postWorkerMessage(execution, {
      body: "Hello from Alice",
      threadId: null,
      idempotencyKey: key,
    });
    assert.ok("event" in sent);
    assertAgentFirstRunSatisfied(db, row);
    finish(secondRun, "retry-before-send");
    const thirdRun = retry("retry-after-commit");
    const repeated = kernel.postWorkerMessage(execution, {
      body: "A regenerated retry must not post twice",
      threadId: null,
      idempotencyKey: key,
    });
    assert.ok("event" in repeated);
    assert.equal(repeated.deduplicated, true);
    assert.equal(repeated.event.eventId, sent.event.eventId);
    finish(thirdRun, "retry-after-commit");
    kernel.completeActivation(host, {
      activationId: activation.activationId,
      consumerId: "first-run-worker",
    });
    assert.equal(
      db
        .prepare("SELECT COUNT(*) n FROM tasks WHERE room_id=?")
        .get(all.room.roomId)!.n,
      0,
    );
    assert.equal(
      kernel.provisionWorkspaceAgent(actor, request).deduplicated,
      true,
    );
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) n FROM room_events WHERE type='agent.first_run_requested'",
        )
        .get()!.n,
      1,
    );
    const controlHead = kernel.sync(actor, {
      roomId: workspace.controlRoom.roomId,
      consumerId: "settings",
      afterSeq: 0,
    }).latestRoomSeq;
    const changed = kernel.updateWorkspace(actor, {
      workspaceId: workspace.workspace.workspaceId,
      name: workspace.workspace.name,
      avatarKey: null,
      agentAllChannelGreetingEnabled: false,
      basedOnControlRoomSeq: controlHead,
      idempotencyKey: "greeting-off",
    });
    assert.equal(changed.workspace.agentAllChannelGreetingEnabled, false);
    const quiet = kernel.provisionWorkspaceAgent(actor, {
      ...request,
      handle: "silent",
      basedOnRoomSeq: changed.event.roomSeq,
      idempotencyKey: "silent-create",
    });
    const quietEvent = db
      .prepare(
        "SELECT payload_json FROM room_events WHERE type='agent.first_run_requested' AND aggregate_id=?",
      )
      .get(quiet.agent.definition.participantId)!;
    assert.equal(
      JSON.parse(String(quietEvent.payload_json)).greetingEnabled,
      true,
    );
    const disabled = kernel.manageWorkspaceAgent(actor, {
      action: "set_state",
      state: "disabled",
      agentId: quiet.agent.definition.agentId,
      basedOnRoomSeq: quiet.event.roomSeq,
      idempotencyKey: "quiet-disable",
    });
    assert.equal(
      kernel.leaseNextActivation(host, { leaseMs: 60000 }),
      null,
      "disabled Agent cannot run queued onboarding",
    );
    kernel.manageWorkspaceAgent(actor, {
      action: "set_state",
      state: "tombstoned",
      agentId: quiet.agent.definition.agentId,
      basedOnRoomSeq: disabled.event.roomSeq,
      idempotencyKey: "quiet-delete",
    });
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) n FROM activations WHERE participant_id=? AND state='queued'",
        )
        .get(quiet.agent.definition.participantId)!.n,
      0,
    );
    const freshHead = kernel.sync(actor, {
      roomId: workspace.controlRoom.roomId,
      consumerId: "after-delete",
      afterSeq: 0,
    }).latestRoomSeq;
    const replacement = kernel.provisionWorkspaceAgent(actor, {
      ...request,
      handle: "silent",
      displayName: "Silent",
      basedOnRoomSeq: freshHead,
      idempotencyKey: "silent-recreated",
    });
    assert.notEqual(
      replacement.agent.definition.participantId,
      quiet.agent.definition.participantId,
    );
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) n FROM room_events WHERE type='agent.first_run_requested'",
        )
        .get()!.n,
      3,
    );
    db.close();
    kernel.close();
    kernel = new RoomKernel(options);
    kernel.initialize();
    actor = kernel.authenticateAccessToken(owner.accessToken);
    assert.equal(
      kernel.listWorkspaces(actor)[0]!.agentAllChannelGreetingEnabled,
      false,
    );
    assert.equal(
      kernel.provisionWorkspaceAgent(actor, request).deduplicated,
      true,
    );
  } finally {
    kernel.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
