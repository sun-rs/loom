import { DatabaseSync } from "node:sqlite";
import { bindRoleDefinitionFixture } from "../../kernel/test/role-definition-fixture.ts";
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

test("remote execution protocol consumes an explicitly queued generic worker Placement and renews its Computer session", async () => {
  await remoteControlScenario(false);
});

test("remote Role instance without session-binding capability fails closed before spawning any process", async () => {
  await remoteControlScenario(true);
});

async function remoteControlScenario(roleInstance: boolean) {
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
    const definition = kernel.createAgentDefinition(humanActor, {
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
    if (roleInstance)
      bindRoleDefinitionFixture(
        kernel,
        humanActor,
        join(directory, "room.db"),
        definition.definition.agentId,
        room.roomId,
        "offer-remote",
      );
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
    const firstMessage = kernel.postMessage(humanActor, {
      body: "Execute through the remote Computer control protocol",
      idempotencyKey: "remote-host-message",
      recipients: [
        { participantId: agent.principal.principalId, reason: "mention" },
      ],
      roomId: room.roomId,
    });
    if (!roleInstance) queueProtocolInput(firstMessage.event);
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
    if (roleInstance) {
      assert.equal(result.state, "failed");
      assert.ok("error" in result);
      assert.match(result.error, /RAH_INSTANCE_HOST_UNSUPPORTED/);
      assert.equal(
        kernel.listRuntimeProcesses({ roomId: room.roomId }).length,
        0,
        "unsupported remote Role must not spawn or silently create a session",
      );
      assert.equal(
        kernel.listRunAttempts({ roomId: room.roomId })[0]?.state,
        "failed",
      );
      const audit = new DatabaseSync(join(directory, "room.db"));
      try {
        assert.equal(
          audit.prepare("SELECT count(*) n FROM role_instance_sessions").get()!
            .n,
          0,
        );
      } finally {
        audit.close();
      }
      await resident.stop();
      return;
    }
    assert.equal(result.state, "completed", JSON.stringify(result));
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

    const secondMessage = kernel.postMessage(humanActor, {
      body: "Execute through the production remote Computer composition",
      idempotencyKey: "remote-host-message-composed",
      recipients: [
        { participantId: agent.principal.principalId, reason: "mention" },
      ],
      roomId: room.roomId,
    });
    queueProtocolInput(secondMessage.event);
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
    // Protocol-only input fixture: materialize an explicit queue input rather
    // than asking product delivery to schedule a persona. No Role and no native
    // session lifecycle are claimed by this positive test. Product delivery's
    // unconditional persona fence remains exercised and is asserted below.
    function queueProtocolInput(event: {
      eventId: string;
      roomId: string;
      roomSeq: number;
    }) {
      const db = new DatabaseSync(join(directory, "room.db"));
      try {
        assert.equal(
          db.prepare("SELECT count(*) n FROM role_instances").get()!.n,
          0,
        );
        assert.equal(
          db
            .prepare("SELECT count(*) n FROM inbox_items WHERE event_id=?")
            .get(event.eventId)!.n,
          0,
          "product must not deliver to this generic definition; queue input is fixture-only",
        );
        const at = clock.now().toISOString();
        db.exec("BEGIN");
        db.prepare(
          "INSERT INTO inbox_items(inbox_item_id,room_id,participant_id,event_id,event_seq,reason,state,created_at) VALUES(?,?,?,?,?,'mention','pending',?)",
        ).run(
          `inbox-protocol-${event.eventId}`,
          event.roomId,
          agent.principal.principalId,
          event.eventId,
          event.roomSeq,
          at,
        );
        db.prepare(
          "INSERT INTO activations(activation_id,room_id,participant_id,from_seq,to_seq,reason,state,available_at,available_at_ms,attempt_count,created_at,updated_at) VALUES(?,?,?,?,?,'mention','queued',?,?,0,?,?)",
        ).run(
          `activation-protocol-${event.eventId}`,
          event.roomId,
          agent.principal.principalId,
          event.roomSeq,
          event.roomSeq,
          at,
          clock.now().getTime(),
          at,
          at,
        );
        db.exec("COMMIT");
      } finally {
        db.close();
      }
    }
  } finally {
    await transport.close();
    computer.dispose();
    await worker.close();
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition was not reached");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
