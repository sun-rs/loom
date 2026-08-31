import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";

import {
  ComputerOperationStore,
  computeRuntimeCertificationDigest,
  createComputerApplicationPort,
  RoomKernel,
} from "@rah-os/kernel";
import type { RuntimeCertification } from "@rah-os/protocol";

import {
  ComputerApplicationService,
  ComputerHttpTransport,
} from "../src/index.ts";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const runtimeCertificationContent = {
  capabilities: ["worker_commands"],
  certificationId: "certification-http-worker-v1",
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
const childFixture = new URL(
  "./fixtures/fake-computer-client.mjs",
  import.meta.url,
);

function latestRoomSeq(
  kernel: RoomKernel,
  actor: Parameters<RoomKernel["sync"]>[0],
  roomId: string,
): number {
  return kernel.sync(actor, {
    afterSeq: 0,
    consumerId: "computer-http-fixture",
    roomId,
  }).latestRoomSeq;
}

function waitForLine(
  child: ChildProcess,
  prefix: string,
  stderr: () => string,
): Promise<Record<string, string>> {
  assert.ok(child.stdout);
  const lines = createInterface({ input: child.stdout });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${prefix}: ${stderr()}`));
    }, 10_000);
    const cleanup = () => {
      clearTimeout(timer);
      lines.off("line", onLine);
      child.off("exit", onExit);
    };
    const onLine = (line: string) => {
      if (!line.startsWith(prefix)) return;
      cleanup();
      try {
        resolve(
          JSON.parse(line.slice(prefix.length)) as Record<string, string>,
        );
      } catch (error) {
        reject(error);
      }
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(
        new Error(
          `fake Computer exited with ${String(code)} before ${prefix}: ${stderr()}`,
        ),
      );
    };
    lines.on("line", onLine);
    child.once("exit", onExit);
  });
}

function launchComputer(input: {
  accessToken: string;
  connectionId: string;
  origin: string;
  runtimeOfferId: string;
}) {
  let stderr = "";
  const child = spawn(process.execPath, [childFixture.pathname], {
    env: {
      ...process.env,
      RAH_CERTIFICATION_DIGEST: runtimeCertification.certificationDigest,
      RAH_CERTIFICATION_ID: runtimeCertification.certificationId,
      RAH_COMPUTER_ORIGIN: input.origin,
      RAH_CONNECTION_ID: input.connectionId,
      RAH_HOST_ACCESS_TOKEN: input.accessToken,
      RAH_RUNTIME_OFFER_ID: input.runtimeOfferId,
      RAH_RUNTIME_PROFILE_DIGEST: runtimeCertification.runtimeProfileDigest,
      RAH_WORKSPACE_MOUNT_DIGEST: digest("e"),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });
  return { child, stderr: () => stderr };
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
}

test("Computer transport advertises and relays the activation-scoped Worker API without exposing a general proxy", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-worker-relay-http-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  const workerRequests: Array<{
    authorization: string | undefined;
    body: string;
    url: string | undefined;
  }> = [];
  const workerServer = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    workerRequests.push({
      authorization: request.headers.authorization,
      body: Buffer.concat(chunks).toString("utf8"),
      url: request.url,
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ cursorAfter: 7, events: [] }));
  });
  let computer: ComputerApplicationService | undefined;
  let transport: ComputerHttpTransport | undefined;
  try {
    kernel.initialize();
    const agent = kernel.provisionPrincipal({
      handle: "worker-relay-agent",
      kind: "agent",
    });
    const hostCredential = kernel.provisionHostCredential({
      hostId: "worker-relay-computer",
      participantIds: [agent.principal.principalId],
    });
    await new Promise<void>((resolve, reject) => {
      workerServer.once("error", reject);
      workerServer.listen(0, "127.0.0.1", () => {
        workerServer.off("error", reject);
        resolve();
      });
    });
    const workerAddress = workerServer.address() as AddressInfo;
    const workerOrigin = `http://127.0.0.1:${String(workerAddress.port)}`;
    computer = new ComputerApplicationService({
      computer: createComputerApplicationPort(kernel),
      workerCredentials: {
        issueActivationCredential: () => ({
          accessToken: "rah_wat_abcdefghijklmnopqrstuvwxyz0123456789",
          expiresAt: "2099-01-01T00:00:00.000Z",
          revoke() {},
        }),
        origin: workerOrigin,
      },
    });
    transport = new ComputerHttpTransport({
      computer,
      workerRelay: { targetOrigin: workerOrigin },
    });
    await transport.start();
    const post = async (
      path: string,
      accessToken: string,
      body: Record<string, unknown>,
    ) =>
      await fetch(`${transport!.origin}${path}`, {
        body: JSON.stringify(body),
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        method: "POST",
      });
    const sessionResponse = await post(
      "/v1/computer/session/open",
      hostCredential.accessToken,
      {
        capabilities: [
          "placement_pull",
          "runtime_activity_publish",
          "runtime_offer_publish",
          "terminal_proof",
          "worker_credential_issue",
        ],
        computerBuildVersion: "worker-relay-test/1.0.0",
        computerInstanceId: "worker-relay-boot",
        connectionId: "worker-relay-connection",
        controlApiVersions: [1],
        processId: 701,
        runtimeProtocolVersion: 1,
      },
    );
    assert.equal(sessionResponse.status, 200);
    const session = (await sessionResponse.json()) as {
      sessionAccessToken: string;
    };
    const credentialResponse = await post(
      "/v1/computer/worker-credentials/issue",
      session.sessionAccessToken,
      {
        activationId: "activation-relay-1",
        consumerId: "worker-relay-consumer",
        participantId: agent.principal.principalId,
        roomId: "room-relay-1",
        runAttemptId: "run-relay-1",
        toSeq: 7,
      },
    );
    assert.equal(credentialResponse.status, 200);
    const issued = (await credentialResponse.json()) as {
      workerAccessToken: string;
      workerApiOrigin: string;
    };
    assert.equal(issued.workerApiOrigin, transport.origin);
    const relayed = await fetch(`${issued.workerApiOrigin}/v1/worker/sync`, {
      body: "{}",
      headers: {
        authorization: `Bearer ${issued.workerAccessToken}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    assert.equal(relayed.status, 200);
    assert.equal(
      ((await relayed.json()) as { cursorAfter: number }).cursorAfter,
      7,
    );
    assert.deepEqual(workerRequests, [
      {
        authorization: `Bearer ${issued.workerAccessToken}`,
        body: "{}",
        url: "/v1/worker/sync",
      },
    ]);
    const arbitrary = await fetch(
      `${transport.origin}/v1/worker/http://127.0.0.1:1`,
      { method: "POST" },
    );
    assert.equal(arbitrary.status, 404);
    assert.equal(workerRequests.length, 1);
  } finally {
    await transport?.close();
    computer?.dispose();
    await new Promise<void>((resolve, reject) => {
      workerServer.close((error) => (error ? reject(error) : resolve()));
    });
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("managed Computer operation routes expose only assignment and typed acknowledgements", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "rah-os-computer-operation-http-"),
  );
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath });
  let operations: ComputerOperationStore | undefined;
  let computer: ComputerApplicationService | undefined;
  let transport: ComputerHttpTransport | undefined;
  try {
    kernel.initialize();
    const agent = kernel.provisionPrincipal({
      handle: "computer-operation-http-agent",
      kind: "agent",
    });
    const credential = kernel.provisionHostCredential({
      hostId: "computer-operation-http-host",
      participantIds: [agent.principal.principalId],
    });
    operations = new ComputerOperationStore({ databasePath });
    computer = new ComputerApplicationService({
      computer: createComputerApplicationPort(kernel, { operations }),
    });
    transport = new ComputerHttpTransport({ computer });
    await transport.start();
    const post = async (
      path: string,
      token: string,
      body: Record<string, unknown>,
    ) => {
      const response = await fetch(`${transport!.origin}${path}`, {
        body: JSON.stringify(body),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        method: "POST",
      });
      return { response, value: (await response.json()) as unknown };
    };
    const opened = await post(
      "/v1/computer/session/open",
      credential.accessToken,
      {
        capabilities: [
          "managed_operations",
          "placement_pull",
          "runtime_activity_publish",
          "runtime_offer_publish",
          "terminal_proof",
          "worker_credential_issue",
        ],
        computerBuildVersion: "computer-http/1.0.0",
        computerInstanceId: "computer-operation-http-boot",
        connectionId: "computer-operation-http-connection",
        controlApiVersions: [1],
        processId: 501,
        runtimeProtocolVersion: 1,
      },
    );
    assert.equal(opened.response.status, 200);
    const sessionToken = (opened.value as { sessionAccessToken: string })
      .sessionAccessToken;
    const requested = operations.request({
      action: "restart",
      hostId: "computer-operation-http-host",
      idempotencyKey: "restart-http-host",
    });
    const claimed = await post(
      "/v1/computer/operations/claim",
      sessionToken,
      {},
    );
    assert.equal(claimed.response.status, 200);
    assert.deepEqual(claimed.value, {
      operation: {
        action: "restart",
        operationId: requested.operationId,
        requestedAt: requested.requestedAt,
      },
    });
    const acknowledged = await post(
      "/v1/computer/operations/acknowledge",
      sessionToken,
      {
        kind: "operation.progress",
        operationId: requested.operationId,
        phase: "draining",
      },
    );
    assert.equal(acknowledged.response.status, 200);
    assert.deepEqual(acknowledged.value, {
      accepted: true,
      terminal: false,
    });
    const rejected = await post("/v1/computer/operations/claim", sessionToken, {
      command: "arbitrary-shell-is-forbidden",
    });
    assert.equal(rejected.response.status, 400);
  } finally {
    await transport?.close();
    computer?.dispose();
    operations?.close();
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("two independent Computer processes use only the loopback control transport", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-computer-http-"));
  const kernel = new RoomKernel({
    databasePath: join(directory, "room.db"),
    runtimeCertifications: [runtimeCertification],
  });
  const children: ChildProcess[] = [];
  const computer = new ComputerApplicationService({
    computer: createComputerApplicationPort(kernel),
  });
  const transport = new ComputerHttpTransport({ computer });
  try {
    kernel.initialize();
    const human = kernel.provisionPrincipal({
      handle: "computer-http-human",
      kind: "human",
    });
    const agents = ["remote-alice", "remote-cindy"].map((handle) =>
      kernel.provisionPrincipal({ handle, kind: "agent" }),
    );
    const actor = kernel.authenticateAccessToken(human.accessToken);
    const workspace = kernel.createWorkspace(actor, {
      idempotencyKey: "computer-http-workspace",
      name: "Computer HTTP Workspace",
      slug: "computer-http-workspace",
    });
    const room = kernel.createWorkspaceRoom(actor, {
      basedOnControlRoomSeq: workspace.event.roomSeq,
      idempotencyKey: "computer-http-room",
      kind: "channel",
      name: "Computer HTTP Room",
      slug: "computer-http-room",
      workspaceId: workspace.workspace.workspaceId,
    }).room;
    for (const agent of agents) {
      for (const roomId of [workspace.controlRoom.roomId, room.roomId]) {
        kernel.addMember(actor, {
          principalId: agent.principal.principalId,
          roomId,
        });
      }
    }
    const policy = kernel.createExecutionPolicy(actor, {
      basedOnRoomSeq: latestRoomSeq(
        kernel,
        actor,
        workspace.controlRoom.roomId,
      ),
      controlRoomId: workspace.controlRoom.roomId,
      idempotencyKey: "computer-http-policy",
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
        artifactId: "computer-http-retry",
        contentDigest: digest("a"),
        versionId: "computer-http-retry-v1",
      },
      sessionPolicy: "fresh",
    }).policy;
    agents.forEach((agent, index) => {
      kernel.createAgentDefinition(actor, {
        basedOnRoomSeq: latestRoomSeq(
          kernel,
          actor,
          workspace.controlRoom.roomId,
        ),
        controlRoomId: workspace.controlRoom.roomId,
        executionPolicyRevisionId: policy.executionPolicyRevisionId,
        idempotencyKey: `computer-http-agent-${String(index)}`,
        instructionRefs: [],
        memoryPolicyRef: {
          artifactId: `computer-http-memory-${String(index)}`,
          contentDigest: digest(index === 0 ? "b" : "c"),
          versionId: `computer-http-memory-${String(index)}-v1`,
        },
        participantId: agent.principal.principalId,
        role: "remote HTTP agent",
        skillRefs: [],
      });
    });
    const credentials = agents.map((agent, index) =>
      kernel.provisionHostCredential({
        hostId: `remote-computer-${String(index + 1)}`,
        participantIds: [agent.principal.principalId],
      }),
    );
    await transport.start();
    assert.match(transport.origin, /^http:\/\/127\.0\.0\.1:/u);

    const leakedLongCredential = await fetch(
      `${transport.origin}/v1/computer/heartbeat`,
      {
        body: JSON.stringify({ state: "online" }),
        headers: {
          authorization: `Bearer ${credentials[0]!.accessToken}`,
          "content-type": "application/json",
        },
        method: "POST",
      },
    );
    assert.equal(leakedLongCredential.status, 401);

    const clients = credentials.map((credential, index) =>
      launchComputer({
        accessToken: credential.accessToken,
        connectionId: `remote-connection-${String(index + 1)}`,
        origin: transport.origin,
        runtimeOfferId: `remote-offer-${String(index + 1)}`,
      }),
    );
    children.push(...clients.map(({ child }) => child));
    const ready = await Promise.all(
      clients.map(({ child, stderr }) =>
        waitForLine(child, "RAH_FAKE_COMPUTER_READY ", stderr),
      ),
    );
    assert.equal(new Set(ready.map((entry) => entry.hostId)).size, 2);
    assert.equal(new Set(ready.map((entry) => entry.hostInstanceId)).size, 2);

    const firstClient = clients[0]!;
    const offline = waitForLine(
      firstClient.child,
      "RAH_FAKE_COMPUTER_OFFLINE ",
      firstClient.stderr,
    );
    firstClient.child.stdin?.write("offline\n");
    const offlineResult = await offline;
    assert.equal(offlineResult.hostId, ready[0]!.hostId);

    const fenced = waitForLine(
      firstClient.child,
      "RAH_FAKE_COMPUTER_ERROR ",
      firstClient.stderr,
    );
    firstClient.child.stdin?.write("heartbeat\n");
    assert.deepEqual(await fenced, {
      command: "heartbeat",
      status: 401,
    });

    const replacement = launchComputer({
      accessToken: credentials[0]!.accessToken,
      connectionId: "remote-connection-1-reconnected",
      origin: transport.origin,
      runtimeOfferId: "remote-offer-1-reconnected",
    });
    clients[0] = replacement;
    children.push(replacement.child);
    const replacementReady = await waitForLine(
      replacement.child,
      "RAH_FAKE_COMPUTER_READY ",
      replacement.stderr,
    );
    assert.equal(replacementReady.hostId, ready[0]!.hostId);
    assert.notEqual(replacementReady.hostInstanceId, ready[0]!.hostInstanceId);

    kernel.postMessage(actor, {
      body: "Each remote Computer should claim exactly its own Agent",
      idempotencyKey: "computer-http-message",
      recipients: agents.map((agent) => ({
        participantId: agent.principal.principalId,
        reason: "mention" as const,
      })),
      roomId: room.roomId,
    });
    assert.ok(kernel.scheduleNextPlacement({ leaseMs: 30_000 }));
    assert.ok(kernel.scheduleNextPlacement({ leaseMs: 30_000 }));
    const claimPromises = clients.map(({ child, stderr }) => {
      const result = waitForLine(child, "RAH_FAKE_COMPUTER_CLAIM ", stderr);
      child.stdin?.end("claim\n");
      return result;
    });
    const claims = await Promise.all(claimPromises);
    assert.deepEqual(
      new Set(claims.map((claim) => claim.hostId)),
      new Set(ready.map((entry) => entry.hostId)),
    );
    assert.deepEqual(
      new Set(claims.map((claim) => claim.participantId)),
      new Set(agents.map((agent) => agent.principal.principalId)),
    );
    assert.equal(kernel.listRunAttempts({ roomId: room.roomId }).length, 2);
    assert.equal(
      claims.every(
        (claim) =>
          claim.activationState === "queued" && claim.runState === "exited",
      ),
      true,
    );
    assert.equal(
      kernel
        .listRunAttempts({ roomId: room.roomId })
        .every((attempt) => attempt.state === "exited"),
      true,
    );
  } finally {
    await Promise.all(children.map(stopChild));
    await transport.close();
    computer.dispose();
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
