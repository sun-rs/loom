import { bindRoleDefinitionFixture } from "../../kernel/test/role-definition-fixture.ts";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  computeRuntimeCertificationDigest,
  LeaseConflictError,
  RoomKernel,
  StaleContextError,
  type AuthenticatedHostContext,
} from "@rah-os/kernel";
import type { RuntimeCertification, RuntimeOffer } from "@rah-os/protocol";

import {
  FakeRuntimeAdapter,
  MultiLaneAgentHost,
  type ActivationEnvelope,
} from "../src/index.ts";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

test("MultiLaneAgentHost preserves concurrent, serial, restart, and quarantine business invariants", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-multi-lane-"));
  try {
    let nowMs = Date.now();
    const certificationContent = {
      capabilities: ["worker_commands"],
      certificationId: "multi-lane-worker-certification",
      maximumIsolation: "process",
      protocolFamily: "rah-worker-process/v1",
      runtimeProfileDigest: digest("d"),
    } satisfies Omit<RuntimeCertification, "certificationDigest">;
    const certification: RuntimeCertification = {
      ...certificationContent,
      certificationDigest:
        computeRuntimeCertificationDigest(certificationContent),
    };
    const kernel = new RoomKernel({
      databasePath: join(directory, "room.db"),
      now: () => new Date(nowMs),
      placementCapacityPolicy: { defaultMaxConcurrent: 2 },
      runtimeCertifications: [certification],
    });
    kernel.initialize();
    const human = kernel.provisionPrincipal({
      handle: "multi-lane-human",
      kind: "human",
    });
    const agentA = kernel.provisionPrincipal({
      handle: "multi-lane-agent-a",
      kind: "agent",
    });
    const agentB = kernel.provisionPrincipal({
      handle: "multi-lane-agent-b",
      kind: "agent",
    });
    const humanActor = kernel.authenticateAccessToken(human.accessToken);
    const workspace = kernel.createWorkspace(humanActor, {
      idempotencyKey: "multi-lane-workspace-created",
      name: "Multi-lane core Workspace",
      slug: "multi-lane-core-workspace",
    });
    const controlRoom = workspace.controlRoom;
    const room = kernel.createWorkspaceRoom(humanActor, {
      basedOnControlRoomSeq: workspace.event.roomSeq,
      idempotencyKey: "multi-lane-room-created",
      kind: "channel",
      name: "Multi-lane core Room",
      slug: "multi-lane-core-room",
      workspaceId: workspace.workspace.workspaceId,
    }).room;
    for (const participant of [agentA.principal, agentB.principal]) {
      for (const roomId of [controlRoom.roomId, room.roomId]) {
        kernel.addMember(humanActor, {
          principalId: participant.principalId,
          roomId,
        });
      }
    }
    const policy = kernel.createExecutionPolicy(humanActor, {
      basedOnRoomSeq: latestRoomSeq(kernel, humanActor, controlRoom.roomId),
      controlRoomId: controlRoom.roomId,
      idempotencyKey: "multi-lane-policy",
      modelIntent: {
        fallback: "disabled",
        reasoning: "default",
        serviceTier: "default",
      },
      preferred: [],
      required: {
        allowedProtocolFamilies: ["rah-worker-process/v1"],
        capabilities: [
          { capability: "worker_commands", minimumEvidence: "probed" },
        ],
        minimumIsolation: "process",
        workspaceMode: "worktree",
      },
      retryPolicyRef: {
        artifactId: "multi-lane-retry-policy",
        contentDigest: digest("a"),
        versionId: "multi-lane-retry-policy-v1",
      },
      sessionPolicy: "fresh",
    }).policy;
    const agentDefinitionIds: string[] = [];
    for (const [index, participant] of [agentA, agentB].entries()) {
      const created = kernel.createAgentDefinition(humanActor, {
        basedOnRoomSeq: latestRoomSeq(kernel, humanActor, controlRoom.roomId),
        controlRoomId: controlRoom.roomId,
        executionPolicyRevisionId: policy.executionPolicyRevisionId,
        idempotencyKey: `multi-lane-agent-definition-${String(index)}`,
        instructionRefs: [],
        memoryPolicyRef: {
          artifactId: `multi-lane-memory-${String(index)}`,
          contentDigest: digest(index === 0 ? "b" : "c"),
          versionId: `multi-lane-memory-${String(index)}-v1`,
        },
        participantId: participant.principal.principalId,
        role: `parallel worker ${String(index)}`,
        skillRefs: [],
      });
      bindRoleDefinitionFixture(
        kernel,
        humanActor,
        join(directory, "room.db"),
        created.definition.agentId,
        room.roomId,
        "multi-lane-runtime-offer",
      );
      agentDefinitionIds.push(created.definition.agentId);
    }
    const host = authenticateHost(kernel, "multi-lane-host", [
      agentA.principal.principalId,
      agentB.principal.principalId,
    ]);
    kernel.publishRuntimeOffer(host, runtimeOffer(host, certification));

    const taskA = kernel.createTask(humanActor, {
      assigneeId: agentA.principal.principalId,
      idempotencyKey: "multi-lane-task-a",
      roomId: room.roomId,
      title: "Agent A waits while Agent B completes",
    }).task;
    const taskB = kernel.createTask(humanActor, {
      assigneeId: agentB.principal.principalId,
      idempotencyKey: "multi-lane-task-b",
      roomId: room.roomId,
      title: "Agent B completes independently",
    }).task;
    assert.ok(
      kernel.scheduleNextPlacement({ leaseMs: 30_000 }),
      "the first Task must be schedulable before Host workers start",
    );

    let releaseAgentA!: () => void;
    const agentAReap = new Promise<void>((resolve) => {
      releaseAgentA = resolve;
    });
    const runtimeA = new FakeRuntimeAdapter({
      onReap: async () => {
        await agentAReap;
        return { code: 0 };
      },
      onStart: (envelope) => {
        assert.equal(
          envelope.agent?.agentDefinitionRevision.role,
          "parallel worker 0",
        );
        if (runtimeA.starts.length === 1) {
          submitAssignedTask(kernel, host, envelope, taskA.taskId);
        } else {
          acknowledgeActivation(kernel, host, envelope);
        }
      },
    });
    const runtimeB = new FakeRuntimeAdapter({
      onStart: (envelope) =>
        submitAssignedTask(kernel, host, envelope, taskB.taskId),
    });
    const multiLaneHost = new MultiLaneAgentHost({
      capacity: 2,
      host,
      kernel,
      leaseMs: 30_000,
      leaseRenewIntervalMs: 5,
      pollIntervalMs: 5,
      retryAfterMs: 0,
      runtime: runtimeA,
      placementRuntimeResolver: (placement) =>
        placement.participantId === agentA.principal.principalId
          ? runtimeA
          : runtimeB,
    });
    const controller = new AbortController();
    const running = multiLaneHost.run({ signal: controller.signal });
    let runError: unknown;
    void running.catch((error: unknown) => {
      runError = error;
    });
    try {
      try {
        await waitUntil(
          () =>
            runError !== undefined ||
            runtimeA.starts.length + runtimeB.starts.length === 2 ||
            kernel
              .listActivations({ roomId: room.roomId })
              .some(
                (activation) =>
                  activation.attemptCount > 0 && activation.state === "queued",
              ),
        );
      } catch {
        assert.fail(
          JSON.stringify({
            activations: kernel.listActivations({ roomId: room.roomId }),
            attempts: kernel.listRunAttempts({ roomId: room.roomId }),
            hosts: kernel.listHosts(),
            placements: kernel.listPlacements({ roomId: room.roomId }),
            runError:
              runError instanceof Error ? runError.stack : String(runError),
          }),
        );
      }
      assert.equal(
        runError,
        undefined,
        runError instanceof Error ? runError.stack : String(runError),
      );
      assert.equal(
        runtimeA.starts.length + runtimeB.starts.length,
        2,
        JSON.stringify({
          activations: kernel.listActivations({ roomId: room.roomId }),
          attempts: kernel.listRunAttempts({ roomId: room.roomId }),
          placements: kernel.listPlacements({ roomId: room.roomId }),
        }),
      );
      await waitUntil(() =>
        kernel
          .listRunAttempts({ roomId: room.roomId })
          .some(
            (attempt) =>
              attempt.participantId === agentB.principal.principalId &&
              attempt.state !== "running" &&
              attempt.state !== "starting",
          ),
      );
      assert.equal(
        kernel
          .listTasks(humanActor, { roomId: room.roomId })
          .find((task) => task.taskId === taskB.taskId)?.state,
        "submitted",
        JSON.stringify({
          activations: kernel.listActivations({ roomId: room.roomId }),
          attempts: kernel.listRunAttempts({ roomId: room.roomId }),
          tasks: kernel.listTasks(humanActor, { roomId: room.roomId }),
        }),
      );
      assert.equal(
        kernel
          .listActivations({ roomId: room.roomId })
          .find(
            (activation) =>
              activation.participantId === agentB.principal.principalId,
          )?.state,
        "completed",
        "Agent B Activation may complete while Agent A remains leased",
      );
      kernel.completeTask(humanActor, {
        basedOnRoomSeq: latestRoomSeq(kernel, humanActor, room.roomId),
        idempotencyKey: "accept:multi-lane-task-b",
        taskId: taskB.taskId,
      });
      assert.equal(
        kernel
          .listTasks(humanActor, { roomId: room.roomId })
          .find((task) => task.taskId === taskA.taskId)?.state,
        "submitted",
        "Agent A may remain active without blocking Agent B completion",
      );
      kernel.postMessage(humanActor, {
        body: "Follow-up work must wait for Agent A's active lane",
        idempotencyKey: "multi-lane-agent-a-follow-up",
        recipients: [
          {
            participantId: agentA.principal.principalId,
            reason: "mention",
          },
        ],
        roomId: room.roomId,
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(
        runtimeA.starts.length,
        1,
        "one Agent identity must never run two concurrent lanes",
      );
      assert.equal(
        kernel
          .listActivations({ roomId: room.roomId })
          .filter((activation) => activation.state === "leased").length,
        1,
      );

      const disabled = kernel.manageWorkspaceAgent(humanActor, {
        action: "set_state",
        agentId: agentDefinitionIds[0]!,
        basedOnRoomSeq: latestRoomSeq(kernel, humanActor, controlRoom.roomId),
        idempotencyKey: "multi-lane-agent-a-disable-active",
        state: "disabled",
      });
      assert.equal(disabled.agent.definition.state, "disabled");
      await waitUntil(() => runtimeA.cancellations.length === 1);
      assert.equal(
        kernel
          .listRunAttempts({ roomId: room.roomId })
          .some(
            (attempt) =>
              attempt.participantId === agentA.principal.principalId &&
              attempt.state === "cancelled",
          ),
        true,
      );
      assert.equal(
        kernel
          .listActivations({ roomId: room.roomId })
          .some(
            (activation) =>
              activation.participantId === agentA.principal.principalId &&
              activation.state === "queued",
          ),
        true,
      );
      kernel.manageWorkspaceAgent(humanActor, {
        action: "set_state",
        agentId: agentDefinitionIds[0]!,
        basedOnRoomSeq: disabled.event.roomSeq,
        idempotencyKey: "multi-lane-agent-a-enable-after-drain",
        state: "enabled",
      });

      releaseAgentA();
      try {
        await waitUntil(() =>
          kernel
            .listActivations({ roomId: room.roomId })
            .every((activation) =>
              ["cancelled", "completed"].includes(activation.state),
            ),
        );
      } catch {
        assert.fail(
          JSON.stringify({
            activations: kernel.listActivations({ roomId: room.roomId }),
            attempts: kernel.listRunAttempts({ roomId: room.roomId }),
            runtimeStarts: runtimeA.starts.length,
          }),
        );
      }
      assert.equal(
        kernel
          .listTasks(humanActor, { roomId: room.roomId })
          .find((task) => task.taskId === taskA.taskId)?.state,
        "submitted",
      );
      kernel.completeTask(humanActor, {
        basedOnRoomSeq: latestRoomSeq(kernel, humanActor, room.roomId),
        idempotencyKey: "accept:multi-lane-task-a",
        taskId: taskA.taskId,
      });
    } finally {
      releaseAgentA();
      controller.abort();
      await running;
    }

    assert.equal(kernel.listRunAttempts({ roomId: room.roomId }).length, 3);
    assert.deepEqual(
      kernel
        .listRunAttempts({ roomId: room.roomId })
        .map((attempt) => attempt.state)
        .sort(),
      ["cancelled", "exited", "exited"],
    );
    assert.equal(kernel.listPlacements({ roomId: room.roomId }).length, 3);
    assert.equal(
      kernel
        .listTasks(humanActor, { roomId: room.roomId })
        .every((task) => task.state === "completed"),
      true,
    );

    const openTask = kernel.createTask(humanActor, {
      idempotencyKey: "multi-lane-open-task",
      roomId: room.roomId,
      title: "Exactly one Agent wins this open Task",
    }).task;
    const openWinners: string[] = [];
    const openRuntimeA = new FakeRuntimeAdapter({
      onStart: (envelope) => {
        if (attemptOpenTask(kernel, host, envelope, openTask.taskId)) {
          openWinners.push(envelope.participantId);
        }
      },
    });
    const openRuntimeB = new FakeRuntimeAdapter({
      onStart: (envelope) => {
        if (attemptOpenTask(kernel, host, envelope, openTask.taskId)) {
          openWinners.push(envelope.participantId);
        }
      },
    });
    kernel.heartbeatHost(host);
    const openTaskHost = new MultiLaneAgentHost({
      capacity: 2,
      host,
      kernel,
      leaseMs: 30_000,
      pollIntervalMs: 5,
      runtime: openRuntimeA,
      placementRuntimeResolver: (placement) =>
        placement.participantId === agentA.principal.principalId
          ? openRuntimeA
          : openRuntimeB,
    });
    const openController = new AbortController();
    const openRunning = openTaskHost.run({ signal: openController.signal });
    try {
      await waitUntil(
        () =>
          kernel
            .listTasks(humanActor, { roomId: room.roomId })
            .find((task) => task.taskId === openTask.taskId)?.state ===
            "submitted" &&
          kernel
            .listActivations({ roomId: room.roomId })
            .every((activation) =>
              ["cancelled", "completed"].includes(activation.state),
            ),
      );
    } finally {
      openController.abort();
      await openRunning;
    }
    assert.equal(openRuntimeA.starts.length + openRuntimeB.starts.length, 2);
    assert.equal(openWinners.length, 1);
    const openTaskProjection = kernel
      .listTasks(humanActor, { roomId: room.roomId })
      .find((task) => task.taskId === openTask.taskId);
    assert.equal(openTaskProjection?.assigneeId, openWinners[0]);
    const openClaimEvents = kernel
      .sync(humanActor, {
        afterSeq: 0,
        consumerId: "multi-lane-open-task-audit",
        roomId: room.roomId,
      })
      .events.filter(
        (event) =>
          event.type === "task.claimed" &&
          event.aggregateId === openTask.taskId,
      );
    assert.equal(openClaimEvents.length, 1);
    kernel.completeTask(humanActor, {
      basedOnRoomSeq: latestRoomSeq(kernel, humanActor, room.roomId),
      idempotencyKey: "accept:multi-lane-open-task",
      taskId: openTask.taskId,
    });

    const restartTask = kernel.createTask(humanActor, {
      assigneeId: agentA.principal.principalId,
      idempotencyKey: "multi-lane-restart-task",
      roomId: room.roomId,
      title: "Recover a crashed lane before retrying it",
    }).task;
    kernel.heartbeatHost(host);
    const crashedPlacement = kernel.scheduleNextPlacement({
      leaseMs: 30_000,
    });
    assert.ok(crashedPlacement);
    const crashedClaim = kernel.claimNextPlacement(host, { leaseMs: 30_000 });
    assert.ok(crashedClaim);
    const recoveryDescriptor = {
      driver: "fake-runtime",
      metadata: {},
      recoveryKey: "crashed-multi-lane-run",
    } as const;
    kernel.prepareRunAttemptRuntime(host, {
      recoveryDescriptor,
      runAttemptId: crashedClaim.runAttempt.runAttemptId,
      runtimeRunId: "crashed-multi-lane-run",
    });
    kernel.markRunAttemptRunning(host, {
      recoveryDescriptor,
      runAttemptId: crashedClaim.runAttempt.runAttemptId,
      runtimeRunId: "crashed-multi-lane-run",
    });
    nowMs += 30_001;

    let recoveredRuntimeRunId: string | undefined;
    const recoveryRuntime = new FakeRuntimeAdapter({
      onRecover: (input) => {
        recoveredRuntimeRunId = input.runtimeRunId;
        return { code: null, signal: "SIGKILL" };
      },
    });
    const restartRuntime = new FakeRuntimeAdapter({
      onStart: (envelope) =>
        submitAssignedTask(kernel, host, envelope, restartTask.taskId),
    });
    const restartedHost = new MultiLaneAgentHost({
      capacity: 2,
      host,
      kernel,
      leaseMs: 30_000,
      pollIntervalMs: 5,
      runtime: restartRuntime,
      placementRuntimeResolver: () => restartRuntime,
      runtimeRecoveryDrivers: ["fake-runtime"],
      runtimeRecoveryResolver: (descriptor) => {
        assert.equal(descriptor.driver, "fake-runtime");
        return recoveryRuntime;
      },
    });
    const restartController = new AbortController();
    const restarted = restartedHost.run({ signal: restartController.signal });
    try {
      await waitUntil(
        () =>
          kernel
            .listTasks(humanActor, { roomId: room.roomId })
            .find((task) => task.taskId === restartTask.taskId)?.state ===
          "submitted",
      );
    } finally {
      restartController.abort();
      await restarted;
    }
    assert.equal(recoveredRuntimeRunId, "crashed-multi-lane-run");
    assert.equal(
      kernel
        .listRuntimeProcesses({ roomId: room.roomId })
        .every((runtimeProcess) => runtimeProcess.state === "terminated"),
      true,
    );
    assert.equal(
      kernel
        .listActivations({ roomId: room.roomId })
        .every((activation) =>
          ["cancelled", "completed"].includes(activation.state),
        ),
      true,
    );
    kernel.completeTask(humanActor, {
      basedOnRoomSeq: latestRoomSeq(kernel, humanActor, room.roomId),
      idempotencyKey: "accept:multi-lane-restart-task",
      taskId: restartTask.taskId,
    });
    assert.equal(
      kernel
        .listRunAttempts({ roomId: room.roomId })
        .some(
          (attempt) =>
            attempt.state === "starting" || attempt.state === "running",
        ),
      false,
    );
    assert.equal(kernel.listRunAttempts({ roomId: room.roomId }).length, 7);
    assert.equal(kernel.listPlacements({ roomId: room.roomId }).length, 7);

    const quarantinedTask = kernel.createTask(humanActor, {
      assigneeId: agentA.principal.principalId,
      idempotencyKey: "multi-lane-quarantine-task",
      roomId: room.roomId,
      title: "Quarantine only Agent A's unsafe runtime",
    }).task;
    const isolatedTask = kernel.createTask(humanActor, {
      assigneeId: agentB.principal.principalId,
      idempotencyKey: "multi-lane-quarantine-isolation-task",
      roomId: room.roomId,
      title: "Agent B must proceed despite Agent A quarantine",
    }).task;
    const unsafeRuntime = new FakeRuntimeAdapter({
      onCancel: () => {
        throw new Error("runtime termination cannot be proven");
      },
      onReap: async () => await new Promise(() => {}),
      onStart: (envelope) =>
        submitAssignedTask(kernel, host, envelope, quarantinedTask.taskId),
    });
    const isolatedRuntime = new FakeRuntimeAdapter({
      onStart: (envelope) =>
        submitAssignedTask(kernel, host, envelope, isolatedTask.taskId),
    });
    const isolationHost = new MultiLaneAgentHost({
      capacity: 2,
      host,
      kernel,
      leaseMs: 30_000,
      pollIntervalMs: 5,
      runtime: unsafeRuntime,
      placementRuntimeResolver: (placement) =>
        placement.participantId === agentA.principal.principalId
          ? unsafeRuntime
          : isolatedRuntime,
      timeoutWait: async () => {},
    });
    const isolationController = new AbortController();
    const isolationRunning = isolationHost.run({
      signal: isolationController.signal,
    });
    try {
      await waitUntil(() => {
        const activations = kernel.listActivations({ roomId: room.roomId });
        return (
          activations.some(
            (activation) =>
              activation.participantId === agentA.principal.principalId &&
              activation.state === "quarantined",
          ) &&
          activations.some(
            (activation) =>
              activation.participantId === agentB.principal.principalId &&
              activation.state === "completed",
          ) &&
          // Agent B's earlier Activations are already completed; wait for the
          // isolated Task itself, which only Agent B's new run submits. A drain
          // no longer lets a lane still queued in the start gate start.
          kernel
            .listTasks(humanActor, { roomId: room.roomId })
            .find((task) => task.taskId === isolatedTask.taskId)?.state ===
            "submitted"
        );
      });
    } finally {
      isolationController.abort();
      await isolationRunning;
    }
    assert.equal(
      kernel
        .listTasks(humanActor, { roomId: room.roomId })
        .find((task) => task.taskId === isolatedTask.taskId)?.state,
      "submitted",
      "Agent B business flow must survive Agent A quarantine",
    );
    assert.equal(
      kernel
        .listRuntimeProcesses({ roomId: room.roomId })
        .some(
          (runtimeProcess) =>
            runtimeProcess.participantId === agentA.principal.principalId &&
            runtimeProcess.state === "orphaned",
        ),
      true,
    );
    kernel.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

function authenticateHost(
  kernel: RoomKernel,
  hostId: string,
  participantIds: string[],
): AuthenticatedHostContext {
  const credential = kernel.provisionHostCredential({ hostId, participantIds });
  const host = kernel.authenticateHostAccessToken(credential.accessToken);
  kernel.heartbeatHost(host);
  return host;
}

function latestRoomSeq(
  kernel: RoomKernel,
  actor: Parameters<RoomKernel["sync"]>[0],
  roomId: string,
): number {
  return kernel.sync(actor, {
    afterSeq: 0,
    consumerId: "multi-lane-setup",
    roomId,
  }).latestRoomSeq;
}

function runtimeOffer(
  host: AuthenticatedHostContext,
  certification: RuntimeCertification,
): RuntimeOffer {
  return {
    capacityPoolIds: ["multi-lane-pool"],
    certificationRefs: [
      {
        certificationDigest: certification.certificationDigest,
        certificationId: certification.certificationId,
      },
    ],
    capabilityEvidence: [
      { capability: "worker_commands", evidence: "certified" },
    ],
    hostId: host.hostId,
    hostInstanceId: host.instanceId,
    isolation: { evidence: "certified", level: "process" },
    leaseUntil: new Date(Date.now() + 60_000).toISOString(),
    maxConcurrent: 2,
    modelBindingDescriptors: [],
    observedAt: new Date().toISOString(),
    protocolFamily: "rah-worker-process/v1",
    revisionDigest: digest("d"),
    runtimeOfferId: "multi-lane-runtime-offer",
    runtimeProfileId: "multi-lane-profile",
    runtimeProfileRevisionId: "multi-lane-profile-v1",
    state: "available",
    workspaceMountDescriptors: [
      {
        modes: ["worktree"],
        workspaceDefinitionId: "multi-lane-workspace",
        workspaceMountDigest: digest("e"),
        workspaceMountRevisionId: "multi-lane-mount-a-v1",
      },
      {
        modes: ["worktree"],
        workspaceDefinitionId: "multi-lane-workspace",
        workspaceMountDigest: digest("f"),
        workspaceMountRevisionId: "multi-lane-mount-b-v1",
      },
    ],
  };
}

function submitAssignedTask(
  kernel: RoomKernel,
  host: AuthenticatedHostContext,
  envelope: ActivationEnvelope,
  taskId: string,
): void {
  const execution = kernel.authorizeWorkerExecution(host, {
    activationId: envelope.activationId,
    consumerId: envelope.consumerId,
    hostId: envelope.hostId,
    participantId: envelope.participantId,
    roomId: envelope.roomId,
    runAttemptId: envelope.runAttemptId,
    toSeq: envelope.toSeq,
  });
  const delivered = kernel.syncWorker(execution, {});
  kernel.acknowledgeWorkerCursor(execution, {
    throughSeq: delivered.cursorAfter,
  });
  const claimed = kernel.claimTask(execution, {
    basedOnRoomSeq: delivered.cursorAfter,
    idempotencyKey: `claim:${taskId}`,
    leaseMs: 30_000,
    taskId,
  });
  const started = kernel.startTask(execution, {
    basedOnRoomSeq: claimed.event.roomSeq,
    idempotencyKey: `start:${taskId}`,
    leaseMs: 30_000,
    taskId,
  });
  kernel.submitTask(execution, {
    basedOnRoomSeq: started.event.roomSeq,
    idempotencyKey: `submit:${taskId}`,
    summary: `completed by ${envelope.participantId}`,
    taskId,
  });
}

function attemptOpenTask(
  kernel: RoomKernel,
  host: AuthenticatedHostContext,
  envelope: ActivationEnvelope,
  taskId: string,
): boolean {
  const execution = kernel.authorizeWorkerExecution(host, {
    activationId: envelope.activationId,
    consumerId: envelope.consumerId,
    hostId: envelope.hostId,
    participantId: envelope.participantId,
    roomId: envelope.roomId,
    runAttemptId: envelope.runAttemptId,
    toSeq: envelope.toSeq,
  });
  const delivered = kernel.syncWorker(execution, {});
  kernel.acknowledgeWorkerCursor(execution, {
    throughSeq: delivered.cursorAfter,
  });
  let claimed;
  try {
    claimed = kernel.claimTask(execution, {
      basedOnRoomSeq: delivered.cursorAfter,
      idempotencyKey: `claim:${taskId}:${envelope.participantId}`,
      leaseMs: 30_000,
      taskId,
    });
  } catch (error) {
    if (
      error instanceof LeaseConflictError ||
      error instanceof StaleContextError
    ) {
      return false;
    }
    throw error;
  }
  const started = kernel.startTask(execution, {
    basedOnRoomSeq: claimed.event.roomSeq,
    idempotencyKey: `start:${taskId}:${envelope.participantId}`,
    leaseMs: 30_000,
    taskId,
  });
  kernel.submitTask(execution, {
    basedOnRoomSeq: started.event.roomSeq,
    idempotencyKey: `submit:${taskId}:${envelope.participantId}`,
    summary: `won and completed by ${envelope.participantId}`,
    taskId,
  });
  return true;
}

function acknowledgeActivation(
  kernel: RoomKernel,
  host: AuthenticatedHostContext,
  envelope: ActivationEnvelope,
): void {
  const execution = kernel.authorizeWorkerExecution(host, {
    activationId: envelope.activationId,
    consumerId: envelope.consumerId,
    hostId: envelope.hostId,
    participantId: envelope.participantId,
    roomId: envelope.roomId,
    runAttemptId: envelope.runAttemptId,
    toSeq: envelope.toSeq,
  });
  const delivered = kernel.syncWorker(execution, {});
  kernel.acknowledgeWorkerCursor(execution, {
    throughSeq: delivered.cursorAfter,
  });
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) assert.fail("condition was not reached");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
