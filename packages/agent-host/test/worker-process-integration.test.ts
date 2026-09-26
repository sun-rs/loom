import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { WorkerApplicationService } from "@rah-os/application-service";
import { RoomKernel } from "@rah-os/kernel";

import {
  AgentHost,
  createWorkerToolTransportEnvironment,
  GenericProcessAdapter,
} from "../src/index.ts";

const fakeCliPath = fileURLToPath(
  new URL("./fixtures/fake-cli.mjs", import.meta.url),
);

test("an external process proves Room delivery through a scoped Worker API", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-worker-process-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  const service = new WorkerApplicationService({ kernel });
  try {
    kernel.initialize();
    const humanProvisioning = kernel.provisionPrincipal({
      handle: "worker-process-human",
      kind: "human",
    });
    const agentProvisioning = kernel.provisionPrincipal({
      handle: "worker-process-agent",
      kind: "agent",
    });
    const humanActor = kernel.authenticateAccessToken(
      humanProvisioning.accessToken,
    );
    const room = kernel.createRoom(humanActor, {
      name: "Worker process integration",
      slug: "worker-process-integration",
    });
    kernel.addMember(humanActor, {
      principalId: agentProvisioning.principal.principalId,
      roomId: room.roomId,
    });
    kernel.postMessage(humanActor, {
      body: "Read this through the scoped Worker API",
      idempotencyKey: "worker-process-message",
      recipients: [
        {
          participantId: agentProvisioning.principal.principalId,
          reason: "mention",
        },
      ],
      roomId: room.roomId,
    });
    await service.start();

    const hostContext = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId: "worker-process-host",
        participantIds: [agentProvisioning.principal.principalId],
      }).accessToken,
    );

    let issuedToken: string | undefined;
    const runtime = new GenericProcessAdapter({
      activationEnvironment: async (input) => {
        const credential = service.issueActivationCredential(
          hostContext,
          input,
        );
        issuedToken = credential.accessToken;
        return await createWorkerToolTransportEnvironment({
          credentialDirectory: join(directory, "worker-credentials"),
          revokeCredential: credential.revoke,
          workerAccessToken: credential.accessToken,
          workerApiOrigin: service.origin,
        });
      },
      args: [fakeCliPath],
      command: process.execPath,
      cwd: directory,
      env: { RAH_FAKE_MODE: "worker-cli-sync" },
    });
    const host = new AgentHost({
      host: hostContext,
      kernel,
      leaseMs: 30_000,
      runtime,
    });

    const result = await host.reconcileOnce();

    assert.equal(result.state, "completed", JSON.stringify(result));
    assert.equal(
      kernel.listActivations({ roomId: room.roomId })[0]?.state,
      "completed",
    );
    assert.match(
      runtime.diagnostics({
        runId: result.state === "completed" ? result.runId : "unreachable",
      }).stdout,
      /worker-cli-sync-finished/,
    );
    assert.ok(issuedToken);
    const revokedResponse = await fetch(`${service.origin}/v1/worker/sync`, {
      body: "{}",
      headers: {
        authorization: `Bearer ${issuedToken}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    assert.equal(revokedResponse.status, 401);
  } finally {
    await service.close();
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("two external Agent processes take turns from committed Room replies without collisions", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-worker-turn-taking-"));
  const databasePath = join(directory, "room.db");
  let kernel = new RoomKernel({ databasePath });
  let service = new WorkerApplicationService({ kernel });
  try {
    kernel.initialize();
    const humanProvisioning = kernel.provisionPrincipal({
      handle: "turn-taking-human",
      kind: "human",
    });
    const agentProvisionings = ["turn-taking-a", "turn-taking-b"].map(
      (handle) => kernel.provisionPrincipal({ handle, kind: "agent" }),
    );
    let humanActor = kernel.authenticateAccessToken(
      humanProvisioning.accessToken,
    );
    const room = kernel.createRoom(humanActor, {
      name: "Worker turn-taking integration",
      slug: "worker-turn-taking-integration",
    });
    for (const agent of agentProvisionings) {
      kernel.addMember(humanActor, {
        principalId: agent.principal.principalId,
        roomId: room.roomId,
      });
    }
    await service.start();

    const hostAccessTokens = agentProvisionings.map(
      (agent, index) =>
        kernel.provisionHostCredential({
          hostId: `worker-turn-taking-host-${String(index)}`,
          participantIds: [agent.principal.principalId],
        }).accessToken,
    );
    const createHosts = () =>
      agentProvisionings.map((_agent, index) => {
        const hostContext = kernel.authenticateHostAccessToken(
          hostAccessTokens[index]!,
        );
        const runtime = new GenericProcessAdapter({
          activationEnvironment: async (input) => {
            const credential = service.issueActivationCredential(
              hostContext,
              input,
            );
            return await createWorkerToolTransportEnvironment({
              credentialDirectory: join(
                directory,
                `worker-credentials-${String(index)}`,
              ),
              revokeCredential: credential.revoke,
              workerAccessToken: credential.accessToken,
              workerApiOrigin: service.origin,
            });
          },
          args: [fakeCliPath],
          command: process.execPath,
          cwd: directory,
          env: {
            RAH_FAKE_MODE: "worker-task",
            RAH_FAKE_ROOM_REPLY_MODE: "turn-taking-counter",
            RAH_FAKE_TURN_PEER: index === 0 ? "turn-taking-b" : "turn-taking-a",
          },
        });
        return {
          context: hostContext,
          runner: new AgentHost({
            host: hostContext,
            kernel,
            leaseMs: 30_000,
            runtime,
          }),
        };
      });
    let hostEntries = createHosts();

    kernel.postRoomMessage(humanActor, {
      body: "请你们两个轮流报数，从1开始直到10",
      idempotencyKey: "worker-turn-taking-message",
      roomId: room.roomId,
    });

    let consecutiveIdleCycles = 0;
    let restarted = false;
    for (let cycle = 0; cycle < 30; cycle += 1) {
      const results = await Promise.all(
        hostEntries.map(({ runner }) => runner.reconcileOnce()),
      );
      consecutiveIdleCycles = results.every((result) => result.state === "idle")
        ? consecutiveIdleCycles + 1
        : 0;
      const numberBodies = roomNumberEvents(kernel, humanActor, room.roomId);
      if (!restarted && numberBodies.length >= 4) {
        for (const { context } of hostEntries) {
          kernel.heartbeatHost(context, { state: "offline" });
        }
        await service.close();
        kernel.close();
        kernel = new RoomKernel({ databasePath });
        kernel.initialize();
        service = new WorkerApplicationService({ kernel });
        await service.start();
        humanActor = kernel.authenticateAccessToken(
          humanProvisioning.accessToken,
        );
        hostEntries = createHosts();
        consecutiveIdleCycles = 0;
        restarted = true;
      }
      if (numberBodies.length >= 10 && consecutiveIdleCycles >= 2) break;
    }

    const numberEvents = roomNumberEvents(kernel, humanActor, room.roomId);
    assert.deepEqual(
      numberEvents.map((event) =>
        String(event.payload.body).replace(/^@\S+\s+/u, ""),
      ),
      ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
    );
    assert.equal(new Set(numberEvents.map((event) => event.actorId)).size, 2);
    assert.equal(restarted, true, "the count must cross a durable restart");
    for (let index = 1; index < numberEvents.length; index += 1) {
      assert.notEqual(
        numberEvents[index]?.actorId,
        numberEvents[index - 1]?.actorId,
      );
    }
    assert.ok(
      kernel
        .listActivations({ roomId: room.roomId })
        .every((activation) => activation.state === "completed"),
    );
  } finally {
    await service.close();
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

function roomNumberEvents(
  kernel: RoomKernel,
  actor: ReturnType<RoomKernel["authenticateAccessToken"]>,
  roomId: string,
) {
  return kernel
    .sync(actor, { consumerId: "worker-turn-taking-observer", roomId })
    .events.filter(
      (event) =>
        event.type === "message.posted" &&
        typeof event.payload.body === "string" &&
        /^(?:@\S+\s+)?\d+$/u.test(event.payload.body),
    );
}
