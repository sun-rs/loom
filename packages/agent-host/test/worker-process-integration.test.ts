import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { WorkerApplicationService } from "@rah-os/application-service";
import { RoomKernel } from "@rah-os/kernel";

import { AgentHost, GenericProcessAdapter } from "../src/index.ts";

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
      activationEnvironment: (input) => {
        const credential = service.issueActivationCredential(
          hostContext,
          input,
        );
        issuedToken = credential.accessToken;
        return {
          env: {
            RAH_WORKER_API_URL: service.origin,
            RAH_WORKER_TOKEN: credential.accessToken,
          },
          release: credential.revoke,
        };
      },
      args: [fakeCliPath],
      command: process.execPath,
      cwd: directory,
      env: { RAH_FAKE_MODE: "worker-sync" },
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
      /worker-sync-finished/,
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
