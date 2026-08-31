import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { bootstrapStable, slotArtifactPath } from "@rah-os/k-carrier";

import {
  ComputerAttachmentStore,
  ComputerOperationReceiptStore,
  ComputerUpgradeCoordinatorRequestStore,
  ComputerUpgradeParkedAttachmentStore,
  computerServiceSupervisorControlSocketPath,
  createComputerReleaseManifestSignaturePayload,
  createComputerServiceOwnershipProofToken,
  NODE_K_CARRIER_COMPUTER_UPGRADE_PROCESS_CONFIGURATION_SCHEMA_VERSION,
  NodeComputerUpgradeCoordinatorLauncher,
  readComputerServiceLiveAttestation,
  runNodeKCarrierComputerSupervisorProcess,
  UnixSocketInstanceLock,
  type ComputerReleaseManifest,
  type ComputerServiceSupervisorCompletion,
} from "../src/index.ts";

test("detached K composition replaces the live Computer service across a process boundary", async (context) => {
  await exerciseDetachedReplacement(context, false);
});

test("service startup safely rolls back a SIGKILLed handoff from K and the durable request", async (context) => {
  await exerciseDetachedReplacement(context, true);
});

async function exerciseDetachedReplacement(
  context: TestContext,
  recoverAfterCoordinatorCrash: boolean,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "rah-k-detached-"));
  chmodSync(directory, 0o700);
  const kStateDir = join(directory, "k");
  const receiptDirectory = join(directory, "receipts");
  const socketDirectory = join(directory, "sockets");
  await Promise.all(
    [kStateDir, receiptDirectory, socketDirectory].map(
      async (path) => await mkdir(path, { mode: 0o700 }),
    ),
  );
  const serverState = {
    acknowledgements: [] as unknown[],
    opened: [] as unknown[],
  };
  const hostAccessToken = "rah-host-detached";
  const controlServer = await startControlServer(hostAccessToken, serverState);
  const ownershipControlToken = createComputerServiceOwnershipProofToken();
  const supervisorControlToken = createComputerServiceOwnershipProofToken();
  const upgradeControlToken = createComputerServiceOwnershipProofToken();
  const managedAttachmentIdentities = {
    primary: "connection-primary",
    secondary: "connection-secondary",
  };
  const serviceFixturePath = join(
    import.meta.dirname,
    "fixtures",
    "k-computer-service-child.mjs",
  );
  const sourceArtifactPath = join(directory, "computer-1.0.0");
  writeFileSync(
    sourceArtifactPath,
    `#!/bin/sh\nexec "${process.execPath}" "${serviceFixturePath}" --build-version=1.0.0 "$@"\n`,
    { mode: 0o700 },
  );
  chmodSync(sourceArtifactPath, 0o500);
  await bootstrapStable({
    artifactPath: sourceArtifactPath,
    stateDir: kStateDir,
    version: "1.0.0",
  });
  const targetArtifact = Buffer.from(
    `#!/bin/sh\nexec "${process.execPath}" "${serviceFixturePath}" --build-version=2.0.0 "$@"\n`,
  );
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const processConfigurationPath = join(directory, "coordinator-config.json");
  const serviceConfigurationPath = join(directory, "service-config.json");
  const requestPath = join(directory, "upgrade-request.json");
  const holdBarrierPath = join(directory, "hold-upgrade.barrier");
  if (recoverAfterCoordinatorCrash) {
    writeFileSync(holdBarrierPath, "hold", { mode: 0o600 });
  }
  const ownershipAddress = new UnixSocketInstanceLock({
    directory: socketDirectory,
    hostId: "computer-service",
  });
  const controlAddress = new UnixSocketInstanceLock({
    directory: socketDirectory,
    hostId: "computer-service-upgrade-control",
  });
  writeFileSync(
    processConfigurationPath,
    `${JSON.stringify({
      configuration: {
        attachmentStatePath: join(directory, "attachments.json"),
        ownershipControlToken,
        ownershipSocketPath: ownershipAddress.socketPath,
        receiptStatePath: join(receiptDirectory, "operation.json"),
        releaseBaseUrl: "https://releases.example/rah-computer",
        releasePublicKeyPem: publicKey.export({
          format: "pem",
          type: "spki",
        }),
        requestPath,
        runtimeProtocolVersion: 1,
        serviceConfigurationPath,
        stateDir: kStateDir,
        supervisorControlSocketPath:
          computerServiceSupervisorControlSocketPath(socketDirectory),
        supervisorControlTimeoutMs: 2_000,
        supervisorControlToken,
        upgradeControlSocketPath: controlAddress.socketPath,
        upgradeControlToken,
      },
      schemaVersion:
        NODE_K_CARRIER_COMPUTER_UPGRADE_PROCESS_CONFIGURATION_SCHEMA_VERSION,
    })}\n`,
    { mode: 0o600 },
  );
  writeFileSync(
    serviceConfigurationPath,
    JSON.stringify({
      managedAttachmentIdentities,
      ...(recoverAfterCoordinatorCrash ? { holdBarrierPath } : {}),
      ownershipControlToken,
      parkedAttachmentStateDir: kStateDir,
      socketDirectory,
      upgradeCoordinatorArgumentPrefix: [
        join(import.meta.dirname, "fixtures", "k-upgrade-process-child.mjs"),
      ],
      upgradeCoordinatorConfigurationPath: processConfigurationPath,
      upgradeCoordinatorExecutablePath: process.execPath,
      upgradeControlToken,
    }),
    { mode: 0o600 },
  );
  let supervisor = startSupervisor({
    controlToken: supervisorControlToken,
    serviceConfigurationPath,
    socketDirectory,
    stateDir: kStateDir,
  });
  let successorProcessId: number | undefined;
  context.after(async () => {
    supervisor.signals.emit("SIGTERM");
    await supervisor.completion.catch(() => undefined);
    await closeServer(controlServer.server);
    await waitUntil(
      () => successorProcessId === undefined || !alive(successorProcessId),
      2_000,
    ).catch(() => undefined);
    rmSync(directory, { force: true, recursive: true });
  });
  const incumbentAttestation = await waitForAttestation({
    controlToken: ownershipControlToken,
    socketPath: ownershipAddress.socketPath,
  });
  const requestStore = new ComputerUpgradeCoordinatorRequestStore({
    requestPath,
  });
  await requestStore.save({
    carrier: "rah-k",
    controlAttachmentId: "primary",
    currentArtifactPath: sourceArtifactPath,
    managedAttachmentIdentities,
    mode: "upgrade",
    operationId: "detached-upgrade-1",
    requestedAt: "2026-08-28T15:00:00.000Z",
    sourceBuildVersion: "1.0.0",
    sourceComputerInstanceId: incumbentAttestation.candidateComputerInstanceId,
    targetBuildVersion: "2.0.0",
  });
  await new ComputerAttachmentStore({
    statePath: join(directory, "attachments.json"),
  }).save([
    {
      attachmentId: "primary",
      connectionId: "connection-primary",
      createdAt: "2026-08-28T15:00:00.000Z",
      hostAccessToken,
      origin: controlServer.origin,
    },
    {
      attachmentId: "secondary",
      connectionId: "connection-secondary",
      createdAt: "2026-08-28T15:00:00.000Z",
      hostAccessToken: "rah-host-secondary",
      origin: controlServer.origin,
    },
  ]);
  const platformKey = `${process.platform}-${process.arch}`;
  const manifest: ComputerReleaseManifest = {
    schemaVersion: 1,
    targets: {
      [platformKey]: {
        file: "rah-computer",
        sha256: createHash("sha256").update(targetArtifact).digest("hex"),
        size: targetArtifact.byteLength,
      },
    },
    version: "2.0.0",
  };
  writeFileSync(
    `${requestPath}.release-manifest.json`,
    JSON.stringify({
      ...manifest,
      signature: sign(
        null,
        createComputerReleaseManifestSignaturePayload(manifest),
        privateKey,
      ).toString("base64"),
    }),
    { mode: 0o600 },
  );
  writeFileSync(`${requestPath}.release-artifact`, targetArtifact, {
    mode: 0o600,
  });
  const launched = await new NodeComputerUpgradeCoordinatorLauncher({
    argumentPrefix: [
      join(import.meta.dirname, "fixtures", "k-upgrade-process-child.mjs"),
    ],
    executablePath: process.execPath,
  }).launch({
    configurationPath: processConfigurationPath,
    requestPath,
  });
  assert.ok(launched.processId > 0);

  if (recoverAfterCoordinatorCrash) {
    await waitUntil(
      async () =>
        (await new ComputerUpgradeParkedAttachmentStore({
          stateDir: kStateDir,
        }).read()) !== null,
      4_000,
    );
    process.kill(launched.processId, "SIGKILL");
    await waitUntil(() => !alive(launched.processId), 2_000);
    rmSync(holdBarrierPath, { force: true });
    process.kill(incumbentAttestation.candidateProcessId, "SIGKILL");
    await waitUntil(
      () => !alive(incumbentAttestation.candidateProcessId),
      2_000,
    );
    assert.deepEqual(await supervisor.completion, {
      kind: "fatal",
      reason: "child_exited",
    });
    rmSync(`${requestPath}.startup-recovery-result`, { force: true });
    supervisor = startSupervisor({
      controlToken: supervisorControlToken,
      serviceConfigurationPath,
      socketDirectory,
      stateDir: kStateDir,
    });
    const startupResult = (await waitForJson(
      `${requestPath}.startup-recovery-result`,
    )) as {
      result?: { kind?: string; operationId?: string; processId?: number };
    };
    assert.equal(startupResult.result?.kind, "coordinator_launched");
    assert.equal(startupResult.result?.operationId, "detached-upgrade-1");
    assert.ok(
      typeof startupResult.result?.processId === "number" &&
        startupResult.result.processId > 0,
    );
  }

  const processResult = await waitForJson(`${requestPath}.process-result`);
  if (recoverAfterCoordinatorCrash) {
    assert.deepEqual(processResult, {
      result: {
        failureCode: "replacement_failed",
        kind: "failed",
        operationId: "detached-upgrade-1",
        phase: "replacing",
      },
    });
    assert.equal(
      readFileSync(join(kStateDir, "slots", "stable", "VERSION"), "utf8"),
      "1.0.0",
    );
    assert.equal(
      await new ComputerUpgradeParkedAttachmentStore({
        stateDir: kStateDir,
      }).read(),
      null,
    );
    assert.equal(await requestStore.read(), null);
    assert.equal(
      await new ComputerOperationReceiptStore({
        statePath: join(receiptDirectory, "operation.json"),
      }).read(),
      null,
    );
    assert.ok(
      serverState.acknowledgements.some(
        (value) =>
          typeof value === "object" &&
          value !== null &&
          "kind" in value &&
          value.kind === "operation.failed",
      ),
    );
    return;
  }
  assert.deepEqual(processResult, {
    result: {
      kind: "awaiting_successor",
      operationId: "detached-upgrade-1",
    },
  });
  assert.equal(alive(incumbentAttestation.candidateProcessId), false);
  const successor = await waitForAttestation({
    controlToken: ownershipControlToken,
    socketPath: ownershipAddress.socketPath,
  });
  successorProcessId = successor.candidateProcessId;
  assert.equal(successor.buildVersion, "2.0.0");
  assert.notEqual(
    successor.serviceGeneration,
    incumbentAttestation.serviceGeneration,
  );
  assert.equal(
    readFileSync(join(kStateDir, "slots", "stable", "VERSION"), "utf8"),
    "2.0.0",
  );
  assert.equal(
    await new ComputerUpgradeParkedAttachmentStore({
      stateDir: kStateDir,
    }).read(),
    null,
  );
  assert.ok(
    serverState.acknowledgements.some(
      (value) =>
        typeof value === "object" &&
        value !== null &&
        "phase" in value &&
        value.phase === "restarting",
    ),
  );
  assert.deepEqual(await waitForJson(`${requestPath}.successor-result`), {
    result: {
      kind: "ready_acknowledged",
      operationId: "detached-upgrade-1",
    },
  });
  assert.equal(await requestStore.read(), null);
  assert.equal(
    await new ComputerOperationReceiptStore({
      statePath: join(receiptDirectory, "operation.json"),
    }).read(),
    null,
  );
  assert.ok(
    serverState.acknowledgements.some(
      (value) =>
        typeof value === "object" &&
        value !== null &&
        "kind" in value &&
        value.kind === "operation.ready",
    ),
  );
}

async function startControlServer(
  hostAccessToken: string,
  state: { acknowledgements: unknown[]; opened: unknown[] },
) {
  const sessionToken = `rah_host_session_${"c".repeat(32)}`;
  const server = createServer((request, response) => {
    void handleControlRequest(
      request,
      response,
      hostAccessToken,
      sessionToken,
      state,
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("control fixture did not bind TCP");
  }
  return { origin: `http://127.0.0.1:${String(address.port)}`, server };
}

async function handleControlRequest(
  request: IncomingMessage,
  response: ServerResponse,
  hostAccessToken: string,
  sessionToken: string,
  state: { acknowledgements: unknown[]; opened: unknown[] },
): Promise<void> {
  const body = await readJson(request);
  if (request.url === "/v1/computer/session/open") {
    assert.equal(request.headers.authorization, `Bearer ${hostAccessToken}`);
    state.opened.push(body);
    const opened = body as { computerInstanceId: string };
    sendJson(response, {
      acceptedControlApiVersion: 1,
      hostId: "host-detached",
      hostInstanceId: `host-${opened.computerInstanceId}`,
      serverTime: "2026-08-28T15:00:01.000Z",
      sessionAccessToken: sessionToken,
      sessionExpiresAt: "2026-08-28T15:10:01.000Z",
    });
    return;
  }
  assert.equal(request.headers.authorization, `Bearer ${sessionToken}`);
  if (request.url === "/v1/computer/heartbeat") {
    const heartbeat = body as { state: string };
    const opened = state.opened.at(-1) as { computerInstanceId: string };
    sendJson(response, {
      host: {
        hostId: "host-detached",
        instanceId: `host-${opened.computerInstanceId}`,
        lastSeenAt: "2026-08-28T15:00:02.000Z",
        participantIds: ["agent-detached"],
        state: heartbeat.state,
      },
      serverTime: "2026-08-28T15:00:02.000Z",
      sessionExpiresAt: "2026-08-28T15:10:02.000Z",
    });
    return;
  }
  if (request.url === "/v1/computer/operations/acknowledge") {
    state.acknowledgements.push(body);
    sendJson(response, {
      accepted: true,
      terminal:
        typeof body === "object" &&
        body !== null &&
        "kind" in body &&
        (body.kind === "operation.ready" || body.kind === "operation.failed"),
    });
    return;
  }
  response.writeHead(404).end();
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function sendJson(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

function startSupervisor(input: {
  controlToken: string;
  serviceConfigurationPath: string;
  socketDirectory: string;
  stateDir: string;
}): Readonly<{
  completion: Promise<ComputerServiceSupervisorCompletion>;
  signals: EventEmitter;
}> {
  const signals = new EventEmitter();
  const completion = runNodeKCarrierComputerSupervisorProcess({
    configuration: {
      controlToken: input.controlToken,
      handoffTimeoutMs: 3_000,
      serviceArgumentPrefix: [],
      serviceConfigurationPath: input.serviceConfigurationPath,
      socketDirectory: input.socketDirectory,
      stateDir: input.stateDir,
      stopTimeoutMs: 2_000,
    },
    signalSource: signals,
  });
  return Object.freeze({ completion, signals });
}

async function waitForAttestation(input: {
  controlToken: string;
  socketPath: string;
}) {
  let observed = null;
  await waitUntil(async () => {
    try {
      observed = await readComputerServiceLiveAttestation({
        ...input,
        timeoutMs: 100,
      });
      return observed !== null;
    } catch {
      return false;
    }
  }, 4_000);
  return observed!;
}

async function waitForJson(path: string): Promise<unknown> {
  let value: unknown;
  await waitUntil(() => {
    try {
      value = JSON.parse(readFileSync(path, "utf8")) as unknown;
      return true;
    } catch {
      return false;
    }
  }, 6_000);
  return value;
}

function alive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function closeServer(
  server: ReturnType<typeof createServer>,
): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
