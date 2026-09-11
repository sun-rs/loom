import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ComputerOperationStore,
  ConflictError,
  computeRuntimeCertificationDigest,
  createComputerApplicationPort,
  ForbiddenError,
  RoomKernel,
  UnauthenticatedError,
} from "@rah-os/kernel";
import type { RuntimeCertification, RuntimeOffer } from "@rah-os/protocol";

import {
  ComputerApplicationService,
  WorkerApplicationService,
} from "../src/index.ts";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const runtimeCertificationContent = {
  capabilities: ["worker_commands"],
  certificationId: "certification-worker-process-v1",
  maximumIsolation: "process",
  protocolFamily: "rah-worker-process/v1",
  runtimeProfileDigest: digest("d"),
} satisfies Omit<RuntimeCertification, "certificationDigest">;
const runtimeCertification: RuntimeCertification = {
  ...runtimeCertificationContent,
  certificationDigest: computeRuntimeCertificationDigest(
    runtimeCertificationContent,
  ),
};

function createClock(initial = "2026-08-28T00:00:00.000Z") {
  let now = Date.parse(initial);
  return {
    advance: (milliseconds: number) => {
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
    consumerId: "computer-service-fixture",
    roomId,
  }).latestRoomSeq;
}

function runtimeOffer(input: {
  hostId: string;
  hostInstanceId: string;
  now: Date;
  runtimeOfferId: string;
}): RuntimeOffer {
  return {
    capacityPoolIds: [`pool-${input.runtimeOfferId}`],
    certificationRefs: [
      {
        certificationDigest: runtimeCertification.certificationDigest,
        certificationId: runtimeCertification.certificationId,
      },
    ],
    capabilityEvidence: [
      { capability: "worker_commands", evidence: "certified" },
    ],
    hostId: input.hostId,
    hostInstanceId: input.hostInstanceId,
    isolation: { evidence: "certified", level: "process" },
    leaseUntil: new Date(input.now.getTime() + 60_000).toISOString(),
    maxConcurrent: 1,
    modelBindingDescriptors: [],
    observedAt: input.now.toISOString(),
    protocolFamily: "rah-worker-process/v1",
    revisionDigest: digest("d"),
    runtimeOfferId: input.runtimeOfferId,
    runtimeProfileId: `profile-${input.runtimeOfferId}`,
    runtimeProfileRevisionId: `profile-${input.runtimeOfferId}-v1`,
    state: "available",
    workspaceMountDescriptors: [
      {
        modes: ["in_place"],
        workspaceDefinitionId: "workspace-main",
        workspaceMountDigest: digest("e"),
        workspaceMountRevisionId: `mount-${input.runtimeOfferId}-v1`,
      },
    ],
  };
}

function sessionRequest(
  connectionId: string,
  processId: number,
  computerInstanceId = `${connectionId}-boot`,
  options: {
    buildVersion?: string;
    managedOperations?: boolean;
  } = {},
) {
  return {
    capabilities: [
      "content_free_hints" as const,
      ...(options.managedOperations ? (["managed_operations"] as const) : []),
      "placement_pull" as const,
      "runtime_activity_publish" as const,
      "runtime_offer_publish" as const,
      "terminal_proof" as const,
      "worker_credential_issue" as const,
    ],
    computerBuildVersion: options.buildVersion ?? "computer-test-1.0.0",
    computerInstanceId,
    connectionId,
    controlApiVersions: [1 as const],
    processId,
    runtimeProtocolVersion: 1,
  };
}

test("managed Computer operations require capability, monotonic progress, and successor build attestation", () => {
  const directory = mkdtempSync(
    join(tmpdir(), "rah-os-computer-operation-service-"),
  );
  const databasePath = join(directory, "room.db");
  const clock = createClock();
  const kernel = new RoomKernel({ databasePath, now: clock.now });
  let operations: ComputerOperationStore | undefined;
  try {
    kernel.initialize();
    const agent = kernel.provisionPrincipal({
      handle: "managed-operation-agent",
      kind: "agent",
    });
    const credential = kernel.provisionHostCredential({
      hostId: "managed-operation-computer",
      participantIds: [agent.principal.principalId],
    });
    operations = new ComputerOperationStore({ databasePath, now: clock.now });
    const service = new ComputerApplicationService({
      computer: createComputerApplicationPort(kernel, { operations }),
      now: clock.now,
      takeoverAfterMs: 30_000,
    });

    const incapable = service.openSession(
      credential.accessToken,
      sessionRequest("operation-incapable", 401),
    );
    assert.throws(
      () => service.claimOperation(incapable.sessionAccessToken, {}),
      ForbiddenError,
    );

    clock.advance(31_000);
    const incumbent = service.openSession(
      credential.accessToken,
      sessionRequest("operation-incumbent", 402, "operation-incumbent-boot", {
        managedOperations: true,
      }),
    );
    const requested = operations.request({
      action: "upgrade",
      hostId: incumbent.hostId,
      idempotencyKey: "upgrade-managed-computer-v2",
      targetBuildVersion: "computer-test-2.0.0",
    });
    assert.deepEqual(service.claimOperation(incumbent.sessionAccessToken, {}), {
      operation: {
        action: "upgrade",
        operationId: requested.operationId,
        requestedAt: requested.requestedAt,
        targetBuildVersion: "computer-test-2.0.0",
      },
    });
    for (const phase of [
      "draining",
      "downloading",
      "verifying",
      "staging",
      "replacing",
      "restarting",
    ] as const) {
      assert.deepEqual(
        service.acknowledgeOperation(incumbent.sessionAccessToken, {
          kind: "operation.progress",
          operationId: requested.operationId,
          phase,
        }),
        { accepted: true, terminal: false },
      );
    }
    assert.throws(
      () =>
        service.acknowledgeOperation(incumbent.sessionAccessToken, {
          kind: "operation.ready",
          observedBuildVersion: "computer-test-2.0.0",
          operationId: requested.operationId,
        }),
      ConflictError,
    );

    clock.advance(31_000);
    const successor = service.openSession(
      credential.accessToken,
      sessionRequest("operation-successor", 403, "operation-successor-boot", {
        buildVersion: "computer-test-1.9.0",
        managedOperations: true,
      }),
    );
    assert.deepEqual(
      service.claimOperation(successor.sessionAccessToken, {}).operation
        ?.operationId,
      requested.operationId,
    );
    assert.throws(
      () =>
        service.acknowledgeOperation(successor.sessionAccessToken, {
          kind: "operation.ready",
          observedBuildVersion: "computer-test-1.9.0",
          operationId: requested.operationId,
        }),
      ConflictError,
    );
    service.heartbeat(successor.sessionAccessToken, {
      buildVersion: "computer-test-2.0.0",
      state: "online",
    });
    assert.deepEqual(
      service.acknowledgeOperation(successor.sessionAccessToken, {
        kind: "operation.ready",
        observedBuildVersion: "computer-test-2.0.0",
        operationId: requested.operationId,
      }),
      { accepted: true, terminal: true },
    );
    assert.equal(operations.get(requested.operationId).state, "succeeded");
    service.dispose();
  } finally {
    operations?.close();
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("two remote Computer sessions publish distinct Offers and claim their own Agents", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-computer-service-"));
  const clock = createClock();
  const kernel = new RoomKernel({
    databasePath: join(directory, "room.db"),
    now: clock.now,
    runtimeCertifications: [runtimeCertification],
  });
  const worker = new WorkerApplicationService({ kernel, now: clock.now });
  try {
    kernel.initialize();
    await worker.start();
    const human = kernel.provisionPrincipal({
      handle: "computer-service-human",
      kind: "human",
    });
    const agents = ["alice", "cindy"].map((handle) =>
      kernel.provisionPrincipal({ handle, kind: "agent" }),
    );
    const humanActor = kernel.authenticateAccessToken(human.accessToken);
    const workspace = kernel.createWorkspace(humanActor, {
      idempotencyKey: "computer-service-workspace",
      name: "Computer Service Workspace",
      slug: "computer-service-workspace",
    });
    const room = kernel.createWorkspaceRoom(humanActor, {
      basedOnControlRoomSeq: workspace.event.roomSeq,
      idempotencyKey: "computer-service-room",
      kind: "channel",
      name: "Remote Computer Room",
      slug: "remote-computer-room",
      workspaceId: workspace.workspace.workspaceId,
    }).room;
    for (const agent of agents) {
      for (const roomId of [workspace.controlRoom.roomId, room.roomId]) {
        kernel.addMember(humanActor, {
          principalId: agent.principal.principalId,
          roomId,
        });
      }
    }
    const policy = kernel.createExecutionPolicy(humanActor, {
      basedOnRoomSeq: latestRoomSeq(
        kernel,
        humanActor,
        workspace.controlRoom.roomId,
      ),
      controlRoomId: workspace.controlRoom.roomId,
      idempotencyKey: "computer-service-policy",
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
        workspaceMode: "in_place",
      },
      retryPolicyRef: {
        artifactId: "computer-service-retry-policy",
        contentDigest: digest("a"),
        versionId: "computer-service-retry-policy-v1",
      },
      sessionPolicy: "fresh",
    }).policy;
    agents.forEach((agent, index) => {
      kernel.createAgentDefinition(humanActor, {
        basedOnRoomSeq: latestRoomSeq(
          kernel,
          humanActor,
          workspace.controlRoom.roomId,
        ),
        controlRoomId: workspace.controlRoom.roomId,
        executionPolicyRevisionId: policy.executionPolicyRevisionId,
        idempotencyKey: `computer-service-agent-${String(index)}`,
        instructionRefs: [],
        memoryPolicyRef: {
          artifactId: `computer-service-memory-${String(index)}`,
          contentDigest: digest(index === 0 ? "b" : "c"),
          versionId: `computer-service-memory-${String(index)}-v1`,
        },
        participantId: agent.principal.principalId,
        role: "remote implementation agent",
        skillRefs: [],
      });
    });
    const hostCredentials = agents.map((agent, index) =>
      kernel.provisionHostCredential({
        hostId: `computer-${String(index + 1)}`,
        participantIds: [agent.principal.principalId],
      }),
    );
    const computerPort = createComputerApplicationPort(kernel);
    assert.equal("provisionHostCredential" in computerPort, false);
    const service = new ComputerApplicationService({
      computer: computerPort,
      now: clock.now,
      sessionTtlMs: 60_000,
      takeoverAfterMs: 30_000,
      workerCredentials: worker,
    });

    const firstSession = service.openSession(
      hostCredentials[0]!.accessToken,
      sessionRequest("computer-1-connection", 101),
    );
    assert.deepEqual(
      service.openSession(
        hostCredentials[0]!.accessToken,
        sessionRequest("computer-1-connection", 101),
      ),
      firstSession,
    );
    assert.throws(
      () =>
        service.openSession(
          hostCredentials[0]!.accessToken,
          sessionRequest("computer-1-competing", 102),
        ),
      ConflictError,
    );
    const secondSession = service.openSession(
      hostCredentials[1]!.accessToken,
      sessionRequest("computer-2-connection", 202),
    );
    assert.notEqual(firstSession.hostId, secondSession.hostId);
    assert.notEqual(firstSession.hostInstanceId, secondSession.hostInstanceId);

    clock.advance(31_000);
    const replacementSession = service.openSession(
      hostCredentials[0]!.accessToken,
      sessionRequest("computer-1-replacement", 303),
    );
    assert.notEqual(
      replacementSession.hostInstanceId,
      firstSession.hostInstanceId,
    );
    assert.throws(
      () =>
        service.heartbeat(firstSession.sessionAccessToken, {
          state: "online",
        }),
      UnauthenticatedError,
    );
    const renewedSecond = service.heartbeat(secondSession.sessionAccessToken, {
      state: "online",
    });
    assert.deepEqual(
      renewedSecond.executionWorkspaceBindings?.map(
        (binding) => binding.participantId,
      ),
      [agents[1]!.principal.principalId],
    );
    assert.ok(
      Date.parse(renewedSecond.sessionExpiresAt) >
        Date.parse(renewedSecond.serverTime),
    );

    for (const session of [replacementSession, secondSession]) {
      service.publishRuntimeOffer(session.sessionAccessToken, {
        offer: runtimeOffer({
          hostId: session.hostId,
          hostInstanceId: session.hostInstanceId,
          now: clock.now(),
          runtimeOfferId: `offer-${session.hostId}`,
        }),
      });
    }
    kernel.postMessage(humanActor, {
      body: "Both remote Computers should execute their own Agent",
      idempotencyKey: "computer-service-message",
      recipients: agents.map((agent) => ({
        participantId: agent.principal.principalId,
        reason: "mention" as const,
      })),
      roomId: room.roomId,
    });
    assert.ok(kernel.scheduleNextPlacement({ leaseMs: 30_000 }));
    assert.ok(kernel.scheduleNextPlacement({ leaseMs: 30_000 }));

    const claims = [replacementSession, secondSession].map(
      (session) =>
        service.claimPlacement(session.sessionAccessToken, { leaseMs: 30_000 })
          .claim,
    );
    assert.equal(
      claims.every((claim) => claim !== null),
      true,
    );
    assert.deepEqual(
      new Set(claims.map((claim) => claim?.placement.hostId)),
      new Set([replacementSession.hostId, secondSession.hostId]),
    );
    assert.deepEqual(
      new Set(claims.map((claim) => claim?.placement.participantId)),
      new Set(agents.map((agent) => agent.principal.principalId)),
    );
    assert.equal(kernel.listRunAttempts({ roomId: room.roomId }).length, 2);

    const firstClaim = claims.find(
      (claim) => claim?.placement.hostId === replacementSession.hostId,
    );
    assert.ok(firstClaim);
    const runtimeIdentity = {
      recoveryDescriptor: {
        driver: "resident-runner/v1",
        metadata: { socketName: "runtime-1.sock" },
        recoveryKey: "remote-runtime-1",
      },
      runAttemptId: firstClaim.runAttempt.runAttemptId,
      runtimeRunId: "remote-runtime-1",
    };
    assert.equal(
      service.commandExecution(replacementSession.sessionAccessToken, {
        kind: "runtime.prepare",
        ...runtimeIdentity,
      }).kind,
      "runtime.prepare",
    );
    assert.equal(
      service.commandExecution(replacementSession.sessionAccessToken, {
        kind: "run.start",
        ...runtimeIdentity,
      }).kind,
      "run.start",
    );
    // A transport retry after an ambiguous response must be naturally
    // idempotent and cannot create a second execution.
    assert.equal(
      service.commandExecution(replacementSession.sessionAccessToken, {
        kind: "run.start",
        ...runtimeIdentity,
      }).kind,
      "run.start",
    );
    assert.throws(() =>
      service.commandExecution(secondSession.sessionAccessToken, {
        activationId: firstClaim.activation.activationId,
        kind: "activation.renew",
        leaseMs: 30_000,
      }),
    );
    assert.equal(
      service.commandExecution(replacementSession.sessionAccessToken, {
        activationId: firstClaim.activation.activationId,
        kind: "activation.renew",
        leaseMs: 30_000,
      }).kind,
      "activation.renew",
    );
    assert.equal(
      service.commandExecution(replacementSession.sessionAccessToken, {
        exit: { code: 0 },
        kind: "runtime.terminate",
        runAttemptId: firstClaim.runAttempt.runAttemptId,
        runtimeRunId: "remote-runtime-1",
      }).kind,
      "runtime.terminate",
    );
    assert.equal(
      service.commandExecution(replacementSession.sessionAccessToken, {
        kind: "run.finish",
        runAttemptId: firstClaim.runAttempt.runAttemptId,
        state: "exited",
      }).kind,
      "run.finish",
    );
    assert.equal(
      service.commandExecution(replacementSession.sessionAccessToken, {
        activationId: firstClaim.activation.activationId,
        error: "fixture requests another canonical attempt",
        kind: "activation.retry",
        retryAfterMs: 1_000,
      }).kind,
      "activation.retry",
    );

    const secondClaim = claims.find(
      (claim) => claim?.placement.hostId === secondSession.hostId,
    );
    assert.ok(secondClaim);
    const secondRuntimeIdentity = {
      recoveryDescriptor: {
        driver: "resident-runner/v1",
        metadata: { socketName: "runtime-2.sock" },
        recoveryKey: "remote-runtime-2",
      },
      runAttemptId: secondClaim.runAttempt.runAttemptId,
      runtimeRunId: "remote-runtime-2",
    };
    const workerCredential = service.issueWorkerCredential(
      secondSession.sessionAccessToken,
      {
        activationId: secondClaim.activation.activationId,
        consumerId: `${secondSession.hostId}:runtime`,
        participantId: secondClaim.activation.participantId,
        roomId: secondClaim.activation.roomId,
        runAttemptId: secondClaim.runAttempt.runAttemptId,
        toSeq: secondClaim.activation.toSeq,
      },
    );
    assert.equal(workerCredential.workerApiOrigin, worker.origin);
    assert.equal(
      workerCredential.workerAccessToken.startsWith("rah_wat_"),
      true,
    );
    service.commandExecution(secondSession.sessionAccessToken, {
      kind: "runtime.prepare",
      ...secondRuntimeIdentity,
    });
    service.commandExecution(secondSession.sessionAccessToken, {
      kind: "run.start",
      ...secondRuntimeIdentity,
    });
    const workerSync = await fetch(`${worker.origin}/v1/worker/sync`, {
      body: "{}",
      headers: {
        authorization: `Bearer ${workerCredential.workerAccessToken}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    assert.equal(workerSync.status, 200);
    const delivery = (await workerSync.json()) as { cursorAfter: number };
    const workerAck = await fetch(`${worker.origin}/v1/worker/acknowledge`, {
      body: JSON.stringify({ throughSeq: delivery.cursorAfter }),
      headers: {
        authorization: `Bearer ${workerCredential.workerAccessToken}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    assert.equal(workerAck.status, 200);
    service.commandExecution(secondSession.sessionAccessToken, {
      exit: { code: 0 },
      kind: "runtime.terminate",
      runAttemptId: secondClaim.runAttempt.runAttemptId,
      runtimeRunId: "remote-runtime-2",
    });
    service.commandExecution(secondSession.sessionAccessToken, {
      kind: "run.finish",
      runAttemptId: secondClaim.runAttempt.runAttemptId,
      state: "exited",
    });
    const completion = {
      activationId: secondClaim.activation.activationId,
      consumerId: `${secondSession.hostId}:runtime`,
      kind: "activation.complete" as const,
    };
    assert.equal(
      service.commandExecution(secondSession.sessionAccessToken, completion)
        .kind,
      "activation.complete",
    );
    assert.equal(
      service.commandExecution(secondSession.sessionAccessToken, completion)
        .kind,
      "activation.complete",
      "completion retry after an ambiguous response must be idempotent",
    );
    assert.deepEqual(
      service.revokeWorkerCredential(secondSession.sessionAccessToken, {
        credentialId: workerCredential.credentialId,
      }),
      { revoked: true },
    );
    assert.deepEqual(
      service.revokeWorkerCredential(secondSession.sessionAccessToken, {
        credentialId: workerCredential.credentialId,
      }),
      { revoked: true },
    );
    assert.equal(
      (
        await fetch(`${worker.origin}/v1/worker/sync`, {
          body: "{}",
          headers: {
            authorization: `Bearer ${workerCredential.workerAccessToken}`,
            "content-type": "application/json",
          },
          method: "POST",
        })
      ).status,
      401,
    );

    kernel.revokeHostCredential(hostCredentials[1]!.credentialId);
    assert.throws(
      () =>
        service.heartbeat(secondSession.sessionAccessToken, {
          state: "online",
        }),
      UnauthenticatedError,
    );
    clock.advance(60_001);
    assert.throws(
      () =>
        service.heartbeat(replacementSession.sessionAccessToken, {
          state: "online",
        }),
      UnauthenticatedError,
    );
    const resumedSession = service.openSession(
      hostCredentials[0]!.accessToken,
      sessionRequest(
        "computer-1-replacement",
        303,
        "computer-1-replacement-boot",
      ),
    );
    assert.equal(
      resumedSession.hostInstanceId,
      replacementSession.hostInstanceId,
      "short-session renewal in the same Computer process must preserve the Host generation",
    );
  } finally {
    await worker.close();
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
