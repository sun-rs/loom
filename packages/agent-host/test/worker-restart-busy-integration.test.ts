import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { WorkerApplicationService } from "@rah-os/application-service";
import { RoomKernel } from "@rah-os/kernel";

import {
  AgentHost,
  AgentHostDaemon,
  createWorkerToolTransportEnvironment,
  GenericProcessAdapter,
  UnixSocketInstanceLock,
} from "../src/index.ts";

const fakeCliPath = fileURLToPath(
  new URL("./fixtures/fake-cli.mjs", import.meta.url),
);

test("busy cross-Room work survives a daemon restart without a second Agent lane or lost delivery", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-rb-"));
  const databasePath = join(directory, "room.db");
  const barrierPath = join(directory, "release-first-runtime");
  const barrierStartedPath = `${barrierPath}.started`;
  const hostId = "restart-busy-host";
  let kernel = new RoomKernel({ databasePath });
  let service = new WorkerApplicationService({ kernel });
  try {
    kernel.initialize();
    const humanProvisioning = kernel.provisionPrincipal({
      handle: "worker-restart-busy-human",
      kind: "human",
    });
    const agentProvisioning = kernel.provisionPrincipal({
      handle: "worker-restart-busy-agent",
      kind: "agent",
    });
    const humanAccessToken = humanProvisioning.accessToken;
    const humanActor = kernel.authenticateAccessToken(humanAccessToken);
    const rooms = [
      kernel.createRoom(humanActor, {
        name: "Restart busy primary",
        slug: "restart-busy-primary",
      }),
      kernel.createRoom(humanActor, {
        name: "Restart busy secondary",
        slug: "restart-busy-secondary",
      }),
    ];
    for (const room of rooms) {
      kernel.addMember(humanActor, {
        principalId: agentProvisioning.principal.principalId,
        roomId: room.roomId,
      });
    }
    const hostCredential = kernel.provisionHostCredential({
      hostId,
      participantIds: [agentProvisioning.principal.principalId],
    });

    await service.start();
    const firstHost = kernel.authenticateHostAccessToken(
      hostCredential.accessToken,
    );
    const firstRuntime = createWorkerRuntime({
      barrierPath,
      credentialDirectory: join(directory, "worker-credentials-first"),
      host: firstHost,
      kernel,
      service,
    });
    const firstRunner = new AgentHost({
      drainTimeoutMs: 40,
      host: firstHost,
      kernel,
      leaseMs: 30_000,
      pollIntervalMs: 5,
      retryAfterMs: 0,
      runtime: firstRuntime,
      runtimeCancelTimeoutMs: 500,
    });
    const firstDaemon = new AgentHostDaemon({
      host: firstHost,
      instanceLock: new UnixSocketInstanceLock({
        directory: join(directory, "run"),
        hostId,
      }),
      kernel,
      runner: firstRunner,
    });

    postMention(kernel, humanActor, rooms[0]!.roomId, {
      body: "Hold this Activation while cross-Room work arrives",
      idempotencyKey: "restart-busy-initial",
      participantId: agentProvisioning.principal.principalId,
    });
    const firstShutdown = new AbortController();
    const firstRunning = firstDaemon.run({ signal: firstShutdown.signal });
    await waitUntil(() => existsSync(barrierStartedPath));

    postMention(kernel, humanActor, rooms[0]!.roomId, {
      body: "Primary follow-up one",
      idempotencyKey: "restart-busy-primary-follow-up-one",
      participantId: agentProvisioning.principal.principalId,
    });
    postMention(kernel, humanActor, rooms[0]!.roomId, {
      body: "Primary follow-up two",
      idempotencyKey: "restart-busy-primary-follow-up-two",
      participantId: agentProvisioning.principal.principalId,
    });
    postMention(kernel, humanActor, rooms[1]!.roomId, {
      body: "Secondary follow-up one",
      idempotencyKey: "restart-busy-secondary-follow-up-one",
      participantId: agentProvisioning.principal.principalId,
    });
    postMention(kernel, humanActor, rooms[1]!.roomId, {
      body: "Secondary follow-up two",
      idempotencyKey: "restart-busy-secondary-follow-up-two",
      participantId: agentProvisioning.principal.principalId,
    });

    const busyActivations = kernel.listActivations({
      participantId: agentProvisioning.principal.principalId,
    });
    assert.equal(
      busyActivations.filter((activation) => activation.state === "leased")
        .length,
      1,
      "the active Agent must keep exactly one leased lane",
    );
    assert.equal(
      busyActivations.filter((activation) => activation.state === "queued")
        .length,
      2,
      "busy delivery coalesces per Room while preserving both Room targets",
    );
    assert.equal(
      kernel
        .listRuntimeProcesses()
        .filter((runtime) => runtime.state !== "terminated").length,
      1,
      "cross-Room arrivals must not launch a second runtime",
    );

    firstShutdown.abort("restart while runtime is busy");
    await firstRunning;
    assert.equal(kernel.listHosts()[0]?.state, "offline");
    assert.equal(
      kernel
        .listRuntimeProcesses()
        .filter((runtime) => runtime.state !== "terminated").length,
      0,
      "the first daemon must record terminal proof before releasing work",
    );
    assert.deepEqual(
      activationStateCounts(
        kernel.listActivations({
          participantId: agentProvisioning.principal.principalId,
        }),
      ),
      { cancelled: 1, queued: 2 },
      "the interrupted primary range absorbs its same-Room follow-up while the other Room remains queued",
    );

    await service.close();
    kernel.close();

    kernel = new RoomKernel({ databasePath });
    kernel.initialize();
    service = new WorkerApplicationService({ kernel });
    await service.start();
    writeFileSync(barrierPath, "release restarted runtime\n");
    const restartedHost = kernel.authenticateHostAccessToken(
      hostCredential.accessToken,
    );
    const restartedRuntime = createWorkerRuntime({
      barrierPath,
      credentialDirectory: join(directory, "worker-credentials-restarted"),
      host: restartedHost,
      kernel,
      service,
    });
    const restartedRunner = new AgentHost({
      host: restartedHost,
      kernel,
      leaseMs: 30_000,
      pollIntervalMs: 5,
      retryAfterMs: 0,
      runtime: restartedRuntime,
    });
    const restartedDaemon = new AgentHostDaemon({
      host: restartedHost,
      instanceLock: new UnixSocketInstanceLock({
        directory: join(directory, "run"),
        hostId,
      }),
      kernel,
      runner: restartedRunner,
    });
    const restartedShutdown = new AbortController();
    const restartedRunning = restartedDaemon.run({
      signal: restartedShutdown.signal,
    });
    await waitUntil(() =>
      kernel
        .listActivations({
          participantId: agentProvisioning.principal.principalId,
        })
        .every((activation) =>
          ["cancelled", "completed"].includes(activation.state),
        ),
    );
    restartedShutdown.abort("restart gate complete");
    await restartedRunning;

    const finalActivations = kernel.listActivations({
      participantId: agentProvisioning.principal.principalId,
    });
    assert.deepEqual(activationStateCounts(finalActivations), {
      cancelled: 1,
      completed: 2,
    });
    assert.equal(
      finalActivations.filter((activation) => activation.attemptCount === 2)
        .length,
      1,
      "only the interrupted Activation is retried after restart",
    );
    assert.equal(
      kernel
        .listRunAttempts()
        .filter((attempt) =>
          ["starting", "running", "orphaned"].includes(attempt.state),
        ).length,
      0,
    );
    assert.equal(
      kernel
        .listRuntimeProcesses()
        .filter((runtime) => runtime.state !== "terminated").length,
      0,
    );

    const restartedHuman = kernel.authenticateAccessToken(humanAccessToken);
    for (const room of rooms) {
      const latestRoomSeq = kernel.sync(restartedHuman, {
        consumerId: `restart-busy-verifier:${room.roomId}`,
        roomId: room.roomId,
      }).cursorAfter;
      const agentCursor = kernel.sync(
        kernel.authenticateAccessToken(agentProvisioning.accessToken),
        {
          consumerId: `${hostId}:runtime`,
          roomId: room.roomId,
        },
      );
      const requiredThrough = Math.max(
        ...finalActivations
          .filter(
            (activation) =>
              activation.roomId === room.roomId &&
              activation.state === "completed",
          )
          .map((activation) => activation.toSeq),
      );
      assert.ok(
        agentCursor.cursorBefore >= requiredThrough,
        `restarted Agent must acknowledge the complete ${room.slug} Activation range`,
      );
      assert.ok(
        agentCursor.cursorBefore <= latestRoomSeq,
        "delivery acknowledgement cannot move beyond canonical Room history",
      );
    }
  } finally {
    await service.close().catch(() => undefined);
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

function createWorkerRuntime(input: {
  barrierPath: string;
  credentialDirectory: string;
  host: ReturnType<RoomKernel["authenticateHostAccessToken"]>;
  kernel: RoomKernel;
  service: WorkerApplicationService;
}): GenericProcessAdapter {
  return new GenericProcessAdapter({
    activationEnvironment: async (activation) => {
      const credential = input.service.issueActivationCredential(
        input.host,
        activation,
      );
      return await createWorkerToolTransportEnvironment({
        credentialDirectory: input.credentialDirectory,
        revokeCredential: credential.revoke,
        workerAccessToken: credential.accessToken,
        workerApiOrigin: input.service.origin,
      });
    },
    args: [fakeCliPath],
    command: process.execPath,
    cwd: input.credentialDirectory,
    env: {
      RAH_FAKE_MODE: "worker-task",
      RAH_FAKE_PRE_SYNC_BARRIER_PATH: input.barrierPath,
    },
  });
}

function postMention(
  kernel: RoomKernel,
  actor: ReturnType<RoomKernel["authenticateAccessToken"]>,
  roomId: string,
  input: {
    body: string;
    idempotencyKey: string;
    participantId: string;
  },
): void {
  kernel.postMessage(actor, {
    body: input.body,
    idempotencyKey: input.idempotencyKey,
    recipients: [{ participantId: input.participantId, reason: "mention" }],
    roomId,
  });
}

function activationStateCounts(
  activations: ReturnType<RoomKernel["listActivations"]>,
): Record<string, number> {
  return Object.fromEntries(
    [...new Set(activations.map((activation) => activation.state))]
      .sort()
      .map((state) => [
        state,
        activations.filter((activation) => activation.state === state).length,
      ]),
  );
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
