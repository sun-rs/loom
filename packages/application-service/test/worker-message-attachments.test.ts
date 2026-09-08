import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { WorkerApplicationService } from "../src/index.ts";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { afterEach } from "node:test";

import {
  AuthenticatedHostContext,
  ConflictError,
  ForbiddenError,
  IdempotencyConflictError,
  RoomKernel,
} from "@rah-os/kernel";
const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) rmSync(directory, { force: true, recursive: true });
  }
});

function createClock(initial = "2026-08-25T00:00:00.000Z") {
  let now = new Date(initial).getTime();
  return {
    now: () => new Date(now),
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-kernel-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "room.db");
  const clock = createClock();
  const kernel = new RoomKernel({ databasePath, now: clock.now });
  kernel.initialize();

  const humanProvisioning = kernel.provisionPrincipal({
    handle: "sun",
    kind: "human",
  });
  const agentProvisioning = kernel.provisionPrincipal({
    handle: "codex",
    kind: "agent",
  });
  const otherAgentProvisioning = kernel.provisionPrincipal({
    handle: "opencode",
    kind: "agent",
  });
  const human = humanProvisioning.principal;
  const agent = agentProvisioning.principal;
  const otherAgent = otherAgentProvisioning.principal;
  const humanActor = kernel.authenticateAccessToken(
    humanProvisioning.accessToken,
  );
  const agentActor = kernel.authenticateAccessToken(
    agentProvisioning.accessToken,
  );
  const otherAgentActor = kernel.authenticateAccessToken(
    otherAgentProvisioning.accessToken,
  );
  const room = kernel.createRoom(humanActor, {
    name: "Kernel test",
    slug: "kernel-test",
  });
  kernel.addMember(humanActor, {
    principalId: agent.principalId,
    roomId: room.roomId,
  });
  kernel.addMember(humanActor, {
    principalId: otherAgent.principalId,
    roomId: room.roomId,
  });

  return {
    agent,
    agentActor,
    clock,
    databasePath,
    human,
    humanAccessToken: humanProvisioning.accessToken,
    humanActor,
    kernel,
    otherAgent,
    otherAgentActor,
    room,
  };
}

function authenticateHost(
  kernel: RoomKernel,
  hostId: string,
  participantIds: string[],
): AuthenticatedHostContext {
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({ hostId, participantIds }).accessToken,
  );
  kernel.heartbeatHost(host);
  return host;
}

function startWorkerExecution(
  kernel: RoomKernel,
  label: string,
  participantId: string,
  roomId: string,
) {
  const host = authenticateHost(kernel, `${label}-host`, [participantId]);
  const activation = kernel.leaseNextActivation(host, { leaseMs: 30_000 });
  assert.ok(activation);
  const run = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  prepareAndMarkRunAttemptRunning(kernel, host, {
    recoveryDescriptor: fakeRecovery(`${label}-runtime`),
    runAttemptId: run.runAttemptId,
    runtimeRunId: `${label}-runtime`,
  });
  const execution = kernel.authorizeWorkerExecution(host, {
    activationId: activation.activationId,
    consumerId: `${label}-consumer`,
    hostId: host.hostId,
    participantId,
    roomId,
    runAttemptId: run.runAttemptId,
    toSeq: activation.toSeq,
  });
  const delivery = kernel.syncWorker(execution, {});
  kernel.acknowledgeWorkerCursor(execution, {
    throughSeq: delivery.cursorAfter,
  });
  return { activation, execution, host };
}

function fakeRecovery(recoveryKey: string) {
  return {
    driver: "fake-runtime",
    metadata: {},
    recoveryKey,
  };
}

function prepareAndMarkRunAttemptRunning(
  kernel: RoomKernel,
  host: AuthenticatedHostContext,
  input: Parameters<RoomKernel["markRunAttemptRunning"]>[1],
): void {
  kernel.prepareRunAttemptRuntime(host, input);
  kernel.markRunAttemptRunning(host, input);
}

const execFileAsync = promisify(execFile);
const workerCliUrl = new URL(
  "../../agent-host/src/worker-cli.ts",
  import.meta.url,
).href;

test("a real fake child uploads PNG and text discussion evidence, publishes once, and downloads exact bytes", async () => {
  const f = createFixture();
  const service = new WorkerApplicationService({ kernel: f.kernel });
  const directory = mkdtempSync(join(tmpdir(), "rah-worker-attachment-child-"));
  try {
    f.kernel.postMessage(f.humanActor, {
      roomId: f.room.roomId,
      body: "Share evidence",
      recipients: [{ participantId: f.agent.principalId, reason: "mention" }],
      idempotencyKey: "wake",
    });
    const run = startWorkerExecution(
      f.kernel,
      "child-file",
      f.agent.principalId,
      f.room.roomId,
    );
    await service.start();
    const credential = service.issueActivationCredential(
      run.host,
      run.execution.scope,
    );
    const tokenPath = join(directory, "token");
    writeFileSync(tokenPath, credential.accessToken, { mode: 0o600 });
    const invoke = async (args: string[]) => {
      const result = await execFileAsync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import {runWorkerCliCommand} from ${JSON.stringify(workerCliUrl)}; process.exitCode=await runWorkerCliCommand(process.argv.slice(1));`,
          ...args,
        ],
        {
          env: {
            ...process.env,
            RAH_WORKER_API_URL: service.origin!,
            RAH_WORKER_SESSION_FILE: tokenPath,
            RAH_ACTIVATION_ID: run.activation.activationId,
          },
          timeout: 20000,
          maxBuffer: 1024 * 1024,
        },
      );
      return JSON.parse(result.stdout) as Record<string, unknown>;
    };
    const delivery = await invoke(["worker", "sync"]);
    assert.equal(delivery.cursorAfter, run.activation.toSeq);
    const textBytes = Buffer.from("fake-child actual attachment evidence\n");
    const imageBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII=",
      "base64",
    );
    const ids: string[] = [];
    for (const [name, mime, content] of [
      ["evidence.txt", "text/plain", textBytes],
      ["pixel.png", "image/png", imageBytes],
    ] as const) {
      const source = join(directory, name);
      writeFileSync(source, content);
      const published = await invoke([
        "worker",
        "attachment-publish",
        "--path",
        source,
        "--mime-type",
        mime,
        "--idempotency-key",
        `upload:${name}`,
      ]);
      assert.equal(published.state, "completed");
      ids.push(String(published.attachmentId));
      assert.deepEqual(
        await invoke([
          "worker",
          "attachment-publish",
          "--path",
          source,
          "--mime-type",
          mime,
          "--idempotency-key",
          `upload:${name}`,
        ]),
        published,
      );
    }
    const post = [
      "worker",
      "message-post",
      "--body",
      "PNG and text from a real fake child",
      "--attachment-ids",
      ids.join(","),
      "--top-level",
      "--based-on-room-seq",
      String(delivery.cursorAfter),
      "--idempotency-key",
      "post-files",
    ];
    const sent = await invoke(post);
    assert.equal(sent.deduplicated, false);
    assert.equal((await invoke(post)).deduplicated, true);
    assert.equal(
      f.kernel.listTasks(f.humanActor, { roomId: f.room.roomId }).length,
      0,
    );
    const listed = f.kernel.files.list(f.humanActor, {
      roomId: f.room.roomId,
    }).files;
    assert.equal(listed.length, 2);
    assert.deepEqual(
      new Set(listed.map((file) => file.mimeType)),
      new Set(["text/plain", "image/png"]),
    );
    for (const [index, expected] of [textBytes, imageBytes].entries()) {
      const output = join(directory, `read-${index}`);
      await invoke([
        "worker",
        "attachment-download",
        "--attachment-id",
        ids[index]!,
        "--output",
        output,
      ]);
      assert.deepEqual(readFileSync(output), expected);
    }
    await invoke([
      "worker",
      "acknowledge",
      "--through-seq",
      String(delivery.cursorAfter),
    ]);
  } finally {
    await service.close();
    f.kernel.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
