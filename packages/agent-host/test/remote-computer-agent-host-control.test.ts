import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  ComputerApplicationService,
  ComputerHttpTransport,
  WorkerApplicationService,
} from "@rah-os/application-service";
import {
  computeRuntimeCertificationDigest,
  createComputerApplicationPort,
  RoomKernel,
} from "@rah-os/kernel";
import type { RuntimeCertification, RuntimeOffer } from "@rah-os/protocol";

import {
  AgentHost,
  ComputerResidentService,
  createRemoteComputerAgentHostControlPort,
  createRemoteWorkerActivationEnvironment,
  GenericProcessAdapter,
  NodeHttpComputerControlClient,
  RemoteComputerAgentHostService,
  requireRemoteComputerAgentHostIdentity,
} from "../src/index.ts";

const fakeCliPath = fileURLToPath(
  new URL("./fixtures/fake-cli.mjs", import.meta.url),
);

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const certificationContent = {
  capabilities: ["worker_commands"],
  certificationId: "certification-remote-agent-host-v1",
  maximumIsolation: "process",
  protocolFamily: "rah-worker-process/v1",
  runtimeProfileDigest: digest("d"),
} satisfies Omit<RuntimeCertification, "certificationDigest">;
const certification: RuntimeCertification = {
  ...certificationContent,
  certificationDigest: computeRuntimeCertificationDigest(certificationContent),
};

function createClock() {
  let value = Date.parse("2026-08-28T00:00:00.000Z");
  return {
    advance: (milliseconds: number) => {
      value += milliseconds;
    },
    now: () => new Date(value),
  };
}

test("AgentHost executes one canonical Placement over a renewable remote Computer session", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-remote-host-"));
  const clock = createClock();
  const kernel = new RoomKernel({
    databasePath: join(directory, "room.db"),
    now: clock.now,
    runtimeCertifications: [certification],
  });
  const worker = new WorkerApplicationService({ kernel, now: clock.now });
  const computer = new ComputerApplicationService({
    computer: createComputerApplicationPort(kernel),
    now: clock.now,
    sessionTtlMs: 1_000,
    workerCredentials: worker,
  });
  const transport = new ComputerHttpTransport({ computer });
  try {
    kernel.initialize();
    await worker.start();
    const human = kernel.provisionPrincipal({
      handle: "remote-host-human",
      kind: "human",
    });
    const agent = kernel.provisionPrincipal({
      handle: "remote-host-agent",
      kind: "agent",
    });
    const humanActor = kernel.authenticateAccessToken(human.accessToken);
    const workspace = kernel.createWorkspace(humanActor, {
      idempotencyKey: "remote-host-workspace",
      name: "Remote Host Workspace",
      slug: "remote-host-workspace",
    });
    const room = kernel.createWorkspaceRoom(humanActor, {
      basedOnControlRoomSeq: workspace.event.roomSeq,
      idempotencyKey: "remote-host-room",
      kind: "channel",
      name: "Remote Host Room",
      slug: "remote-host-room",
      workspaceId: workspace.workspace.workspaceId,
    }).room;
    for (const roomId of [workspace.controlRoom.roomId, room.roomId]) {
      kernel.addMember(humanActor, {
        principalId: agent.principal.principalId,
        roomId,
      });
    }
    const controlSeq = () =>
      kernel.sync(humanActor, {
        afterSeq: 0,
        consumerId: "remote-host-fixture",
        roomId: workspace.controlRoom.roomId,
      }).latestRoomSeq;
    const policy = kernel.createExecutionPolicy(humanActor, {
      basedOnRoomSeq: controlSeq(),
      controlRoomId: workspace.controlRoom.roomId,
      idempotencyKey: "remote-host-policy",
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
        artifactId: "remote-host-retry",
        contentDigest: digest("a"),
        versionId: "remote-host-retry-v1",
      },
      sessionPolicy: "fresh",
    }).policy;
    kernel.createAgentDefinition(humanActor, {
      basedOnRoomSeq: controlSeq(),
      controlRoomId: workspace.controlRoom.roomId,
      executionPolicyRevisionId: policy.executionPolicyRevisionId,
      idempotencyKey: "remote-host-agent-definition",
      instructionRefs: [],
      memoryPolicyRef: {
        artifactId: "remote-host-memory",
        contentDigest: digest("b"),
        versionId: "remote-host-memory-v1",
      },
      participantId: agent.principal.principalId,
      role: "remote execution fixture",
      skillRefs: [],
    });
    const credential = kernel.provisionHostCredential({
      hostId: "remote-computer",
      participantIds: [agent.principal.principalId],
    });
    await transport.start();
    const resident = new ComputerResidentService({
      buildVersion: "remote-agent-host-test/1.0.0",
      client: new NodeHttpComputerControlClient({
        hostAccessToken: credential.accessToken,
        origin: transport.origin,
      }),
      computerInstanceId: "remote-computer-boot-1",
      connectionId: "remote-computer-attachment-1",
      runtimeOffers: async (identity): Promise<readonly RuntimeOffer[]> => [
        {
          capacityPoolIds: ["pool-remote"],
          certificationRefs: [
            {
              certificationDigest: certification.certificationDigest,
              certificationId: certification.certificationId,
            },
          ],
          capabilityEvidence: [
            { capability: "worker_commands", evidence: "certified" },
          ],
          hostId: identity.hostId,
          hostInstanceId: identity.hostInstanceId,
          isolation: { evidence: "certified", level: "process" },
          leaseUntil: new Date(clock.now().getTime() + 60_000).toISOString(),
          maxConcurrent: 1,
          modelBindingDescriptors: [],
          observedAt: clock.now().toISOString(),
          protocolFamily: "rah-worker-process/v1",
          revisionDigest: certification.runtimeProfileDigest,
          runtimeOfferId: "offer-remote",
          runtimeProfileId: "profile-remote",
          runtimeProfileRevisionId: "profile-remote-v1",
          state: "available",
          workspaceMountDescriptors: [
            {
              modes: ["in_place"],
              workspaceDefinitionId: "workspace-main",
              workspaceMountDigest: digest("e"),
              workspaceMountRevisionId: "mount-remote-v1",
            },
          ],
        },
      ],
      runtimeProtocolVersion: 1,
    });
    await resident.reconcileOnce();
    const identity = requireRemoteComputerAgentHostIdentity(resident);

    const runtime = new GenericProcessAdapter({
      activationEnvironment: createRemoteWorkerActivationEnvironment(resident, {
        credentialDirectory: join(directory, "worker-credentials"),
      }),
      args: [fakeCliPath],
      command: process.execPath,
      cwd: directory,
      env: { RAH_FAKE_MODE: "worker-sync" },
      supervisorDirectory: join(directory, "supervisors"),
    });
    kernel.postMessage(humanActor, {
      body: "Execute through the remote Computer control protocol",
      idempotencyKey: "remote-host-message",
      recipients: [
        { participantId: agent.principal.principalId, reason: "mention" },
      ],
      roomId: room.roomId,
    });
    assert.ok(kernel.scheduleNextPlacement({ leaseMs: 30_000 }));

    const remoteControl = createRemoteComputerAgentHostControlPort(resident);
    const host = new AgentHost({
      control: {
        ...remoteControl,
        prepareRunAttemptRuntime: async (input) => {
          const prepared = await remoteControl.prepareRunAttemptRuntime(input);
          // Expire only the short session after durable prepare. The
          // subsequent run.start must reopen the same Computer generation.
          clock.advance(1_001);
          return prepared;
        },
      },
      host: identity,
      leaseMs: 30_000,
      manageHostLifecycle: false,
      placementRuntimeResolver: () => runtime,
      runtime,
      runtimeRecoveryDrivers: [],
    });
    const result = await host.reconcileOnce();
    assert.equal(result.state, "completed");
    assert.match(
      runtime.diagnostics({
        runId: result.state === "completed" ? result.runId : "unreachable",
      }).stdout,
      /worker-sync-finished/u,
    );
    assert.match(
      runtime.diagnostics({
        runId: result.state === "completed" ? result.runId : "unreachable",
      }).stdout,
      /contextManifestId/u,
    );
    assert.equal(resident.snapshot().hostInstanceId, identity.instanceId);
    assert.deepEqual(
      kernel.listRunAttempts({ roomId: room.roomId }).map((attempt) => ({
        hostId: attempt.hostId,
        state: attempt.state,
      })),
      [{ hostId: identity.hostId, state: "exited" }],
    );
    assert.equal(
      kernel.listRuntimeProcesses({ roomId: room.roomId })[0]?.state,
      "terminated",
    );

    kernel.postMessage(humanActor, {
      body: "Execute through the production remote Computer composition",
      idempotencyKey: "remote-host-message-composed",
      recipients: [
        { participantId: agent.principal.principalId, reason: "mention" },
      ],
      roomId: room.roomId,
    });
    assert.ok(kernel.scheduleNextPlacement({ leaseMs: 30_000 }));
    const controller = new AbortController();
    const service = new RemoteComputerAgentHostService({
      agentHost: {
        leaseMs: 30_000,
        placementRuntimeResolver: () => runtime,
        runtime,
      },
      capacity: 1,
      resident,
    });
    const serviceRun = service.run({ signal: controller.signal });
    await waitFor(
      () =>
        kernel
          .listRunAttempts({ roomId: room.roomId })
          .filter((attempt) => attempt.state === "exited").length === 2,
    );
    controller.abort("test complete");
    await serviceRun;
    assert.equal(service.snapshot().state, "stopped");
    assert.equal(service.snapshot().hostId, identity.hostId);
    assert.equal(service.snapshot().hostInstanceId, identity.instanceId);
    assert.equal(resident.snapshot().state, "stopped");
  } finally {
    await transport.close();
    computer.dispose();
    await worker.close();
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition was not reached");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
