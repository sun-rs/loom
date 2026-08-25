import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { RoomKernel } from "@rah-os/kernel";

import {
  DaemonApplication,
  DaemonConfigSchema,
  FileSecretProvider,
} from "../src/index.ts";

const fakeCliPath = fileURLToPath(
  new URL("../../agent-host/test/fixtures/fake-cli.mjs", import.meta.url),
);
const daemonCliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

test("daemon config is strict and file secrets must be owner-private", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-daemon-config-"));
  try {
    const secretPath = join(directory, "host.token");
    writeFileSync(secretPath, "rah_hat_test\n", { mode: 0o600 });
    const config = validConfig(directory, secretPath);

    assert.throws(() =>
      DaemonConfigSchema.parse({ ...config, unexpected: true }),
    );
    assert.deepEqual(DaemonConfigSchema.parse(config), config);
    assert.throws(() =>
      DaemonConfigSchema.parse({ ...config, schemaVersion: 1 }),
    );
    assert.throws(() =>
      DaemonConfigSchema.parse({
        ...config,
        client: { bindHost: "0.0.0.0", port: 7_777 },
      }),
    );
    assert.throws(() =>
      DaemonConfigSchema.parse({
        ...config,
        taskClaimHeartbeatIntervalMs: config.taskClaimLeaseMs,
      }),
    );

    chmodSync(secretPath, 0o644);
    await assert.rejects(
      new FileSecretProvider().load({ path: secretPath, source: "file" }),
      /owner-private/,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("the composed daemon runs a process Worker without an Agent PAT and restarts cleanly", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-daemon-e2e-"));
  const stateDirectory = join(directory, "state");
  mkdirSync(stateDirectory, { mode: 0o700 });
  const databasePath = join(stateDirectory, "room.db");
  const secretPath = join(stateDirectory, "host.token");
  const seed = new RoomKernel({ databasePath });
  let roomId = "";
  try {
    seed.initialize();
    const human = seed.provisionPrincipal({
      handle: "daemon-e2e-human",
      kind: "human",
    });
    const agent = seed.provisionPrincipal({
      handle: "daemon-e2e-agent",
      kind: "agent",
    });
    const humanActor = seed.authenticateAccessToken(human.accessToken);
    const room = seed.createRoom(humanActor, {
      name: "Daemon E2E",
      slug: "daemon-e2e",
    });
    roomId = room.roomId;
    seed.addMember(humanActor, {
      principalId: agent.principal.principalId,
      roomId,
    });
    seed.postMessage(humanActor, {
      body: "Run through the composed daemon",
      idempotencyKey: "daemon-e2e-message",
      recipients: [
        {
          participantId: agent.principal.principalId,
          reason: "mention",
        },
      ],
      roomId,
    });
    const hostCredential = seed.provisionHostCredential({
      hostId: "daemon-e2e-host",
      participantIds: [agent.principal.principalId],
    });
    writeFileSync(secretPath, `${hostCredential.accessToken}\n`, {
      mode: 0o600,
    });
    seed.close();

    const config = DaemonConfigSchema.parse({
      ...validConfig(stateDirectory, secretPath),
      host: {
        credential: { path: secretPath, source: "file" },
        hostId: "daemon-e2e-host",
        participantId: agent.principal.principalId,
      },
    });
    const application = new DaemonApplication({ config });
    const shutdown = new AbortController();
    const running = application.run({ signal: shutdown.signal });
    const observer = new RoomKernel({ databasePath });
    observer.initialize();
    await waitUntil(
      () => observer.listActivations({ roomId })[0]?.state === "completed",
    );
    const clientOrigin = application.clientOrigin();
    assert.ok(clientOrigin);
    const healthResponse = await fetch(`${clientOrigin}/v1/client/health`);
    assert.equal(healthResponse.status, 200);
    shutdown.abort("test-complete");
    await running;

    assert.equal(observer.listHosts()[0]?.state, "offline");
    assert.equal(application.health().state, "offline");
    assert.equal(application.clientOrigin(), undefined);
    observer.close();

    const restarted = new DaemonApplication({ config });
    const restartShutdown = new AbortController();
    const restartRun = restarted.run({ signal: restartShutdown.signal });
    await waitUntil(() => restarted.health().state === "online");
    restartShutdown.abort("restart-proven");
    await restartRun;
    assert.equal(restarted.health().state, "offline");
  } finally {
    try {
      seed.close();
    } catch {
      // The seed connection was already closed before the daemon started.
    }
    rmSync(directory, { force: true, recursive: true });
  }
});

test("the composed daemon lets an opaque process complete the Task business protocol", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-daemon-task-e2e-"));
  const stateDirectory = join(directory, "state");
  mkdirSync(stateDirectory, { mode: 0o700 });
  const databasePath = join(stateDirectory, "room.db");
  const secretPath = join(stateDirectory, "host.token");
  const seed = new RoomKernel({ databasePath });
  const shutdown = new AbortController();
  let running: Promise<void> | undefined;
  let observer: RoomKernel | undefined;
  try {
    seed.initialize();
    const human = seed.provisionPrincipal({
      handle: "daemon-task-human",
      kind: "human",
    });
    const agent = seed.provisionPrincipal({
      handle: "daemon-task-agent",
      kind: "agent",
    });
    const humanActor = seed.authenticateAccessToken(human.accessToken);
    const room = seed.createRoom(humanActor, {
      name: "Daemon Task E2E",
      slug: "daemon-task-e2e",
    });
    seed.addMember(humanActor, {
      principalId: agent.principal.principalId,
      roomId: room.roomId,
    });
    const created = seed.createTask(humanActor, {
      assigneeId: agent.principal.principalId,
      idempotencyKey: "daemon-task-created",
      roomId: room.roomId,
      title: "Submit through the Worker Task API",
    });
    const hostCredential = seed.provisionHostCredential({
      hostId: "daemon-task-host",
      participantIds: [agent.principal.principalId],
    });
    writeFileSync(secretPath, `${hostCredential.accessToken}\n`, {
      mode: 0o600,
    });
    seed.close();

    const config = DaemonConfigSchema.parse({
      ...validConfig(stateDirectory, secretPath),
      host: {
        credential: { path: secretPath, source: "file" },
        hostId: "daemon-task-host",
        participantId: agent.principal.principalId,
      },
      runtime: {
        ...validConfig(stateDirectory, secretPath).runtime,
        env: { RAH_FAKE_MODE: "worker-task" },
      },
    });
    const application = new DaemonApplication({ config });
    running = application.run({ signal: shutdown.signal });
    observer = new RoomKernel({ databasePath });
    observer.initialize();
    const activeObserver = observer;
    await waitUntil(
      () =>
        activeObserver.listActivations({ roomId: room.roomId })[0]?.state ===
          "completed" &&
        activeObserver.listTasks(humanActor, { roomId: room.roomId })[0]
          ?.state === "submitted",
      2_000,
    );

    const task = activeObserver.listTasks(humanActor, {
      roomId: room.roomId,
    })[0];
    assert.equal(task?.taskId, created.task.taskId);
    assert.equal(task?.state, "submitted");
    const taskEvents = activeObserver
      .sync(humanActor, {
        consumerId: "daemon-task-verifier",
        roomId: room.roomId,
      })
      .events.filter((event) => event.aggregateId === created.task.taskId)
      .map((event) => event.type);
    assert.deepEqual(taskEvents, [
      "task.created",
      "task.claimed",
      "task.started",
      "task.progressed",
      "task.submitted",
    ]);
  } finally {
    shutdown.abort("task-test-complete");
    await running?.catch(() => undefined);
    observer?.close();
    try {
      seed.close();
    } catch {
      // The seed connection was already closed before daemon startup.
    }
    rmSync(directory, { force: true, recursive: true });
  }
});

test("the daemon retries rather than losing a Task when a Worker only acknowledges delivery", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-daemon-task-retry-"));
  const stateDirectory = join(directory, "state");
  mkdirSync(stateDirectory, { mode: 0o700 });
  const databasePath = join(stateDirectory, "room.db");
  const secretPath = join(stateDirectory, "host.token");
  const seed = new RoomKernel({ databasePath });
  const shutdown = new AbortController();
  let running: Promise<void> | undefined;
  let observer: RoomKernel | undefined;
  try {
    seed.initialize();
    const human = seed.provisionPrincipal({
      handle: "daemon-task-retry-human",
      kind: "human",
    });
    const agent = seed.provisionPrincipal({
      handle: "daemon-task-retry-agent",
      kind: "agent",
    });
    const humanActor = seed.authenticateAccessToken(human.accessToken);
    const room = seed.createRoom(humanActor, {
      name: "Daemon Task retry",
      slug: "daemon-task-retry",
    });
    seed.addMember(humanActor, {
      principalId: agent.principal.principalId,
      roomId: room.roomId,
    });
    seed.createTask(humanActor, {
      assigneeId: agent.principal.principalId,
      idempotencyKey: "daemon-unfinished-task-created",
      roomId: room.roomId,
      title: "Remain durable when the Worker does not submit",
    });
    const hostCredential = seed.provisionHostCredential({
      hostId: "daemon-task-retry-host",
      participantIds: [agent.principal.principalId],
    });
    writeFileSync(secretPath, `${hostCredential.accessToken}\n`, {
      mode: 0o600,
    });
    seed.close();

    const config = DaemonConfigSchema.parse({
      ...validConfig(stateDirectory, secretPath),
      host: {
        credential: { path: secretPath, source: "file" },
        hostId: "daemon-task-retry-host",
        participantId: agent.principal.principalId,
      },
    });
    const application = new DaemonApplication({ config });
    running = application.run({ signal: shutdown.signal });
    observer = new RoomKernel({ databasePath });
    observer.initialize();
    const activeObserver = observer;
    await waitUntil(() => {
      const activation = activeObserver.listActivations({
        roomId: room.roomId,
      })[0];
      return activation?.state === "queued" && activation.attemptCount > 0;
    });
    const activation = activeObserver.listActivations({
      roomId: room.roomId,
    })[0];
    assert.match(activation?.lastError ?? "", /unfinished Task/);
    assert.equal(
      activeObserver.listTasks(humanActor, { roomId: room.roomId })[0]?.state,
      "todo",
    );
  } finally {
    shutdown.abort("task-retry-test-complete");
    await running?.catch(() => undefined);
    observer?.close();
    try {
      seed.close();
    } catch {
      // The seed connection was already closed before daemon startup.
    }
    rmSync(directory, { force: true, recursive: true });
  }
});

test("the daemon resumes a partially progressed Task in a new RunAttempt without duplicate business events", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-daemon-task-resume-"));
  const stateDirectory = join(directory, "state");
  mkdirSync(stateDirectory, { mode: 0o700 });
  const databasePath = join(stateDirectory, "room.db");
  const secretPath = join(stateDirectory, "host.token");
  const resumeMarkerPath = join(stateDirectory, "resume-once.marker");
  const seed = new RoomKernel({ databasePath });
  const shutdown = new AbortController();
  let running: Promise<void> | undefined;
  let observer: RoomKernel | undefined;
  try {
    seed.initialize();
    const human = seed.provisionPrincipal({
      handle: "daemon-task-resume-human",
      kind: "human",
    });
    const agent = seed.provisionPrincipal({
      handle: "daemon-task-resume-agent",
      kind: "agent",
    });
    const humanActor = seed.authenticateAccessToken(human.accessToken);
    const room = seed.createRoom(humanActor, {
      name: "Daemon Task resume",
      slug: "daemon-task-resume",
    });
    seed.addMember(humanActor, {
      principalId: agent.principal.principalId,
      roomId: room.roomId,
    });
    const created = seed.createTask(humanActor, {
      assigneeId: agent.principal.principalId,
      idempotencyKey: "daemon-task-resume-created",
      roomId: room.roomId,
      title: "Resume after a partial Worker failure",
    });
    const hostCredential = seed.provisionHostCredential({
      hostId: "daemon-task-resume-host",
      participantIds: [agent.principal.principalId],
    });
    writeFileSync(secretPath, `${hostCredential.accessToken}\n`, {
      mode: 0o600,
    });
    seed.close();

    const config = DaemonConfigSchema.parse({
      ...validConfig(stateDirectory, secretPath),
      host: {
        credential: { path: secretPath, source: "file" },
        hostId: "daemon-task-resume-host",
        participantId: agent.principal.principalId,
      },
      retryAfterMs: 0,
      runtime: {
        ...validConfig(stateDirectory, secretPath).runtime,
        env: {
          RAH_FAKE_MODE: "worker-task-resume",
          RAH_FAKE_RESUME_MARKER: resumeMarkerPath,
        },
      },
    });
    const application = new DaemonApplication({ config });
    running = application.run({ signal: shutdown.signal });
    observer = new RoomKernel({ databasePath });
    observer.initialize();
    const activeObserver = observer;
    try {
      await waitUntil(
        () =>
          activeObserver.listTasks(humanActor, { roomId: room.roomId })[0]
            ?.state === "submitted" &&
          activeObserver.listActivations({ roomId: room.roomId })[0]?.state ===
            "completed",
        3_000,
      );
    } catch (error) {
      throw new Error(
        `Task resume did not converge: ${JSON.stringify(
          {
            activations: activeObserver.listActivations({
              roomId: room.roomId,
            }),
            originalError: String(error),
            runAttempts: activeObserver.listRunAttempts({
              roomId: room.roomId,
            }),
            tasks: activeObserver.listTasks(humanActor, {
              roomId: room.roomId,
            }),
          },
          null,
          2,
        )}`,
      );
    }

    const taskEvents = activeObserver
      .sync(humanActor, {
        consumerId: "daemon-task-resume-verifier",
        roomId: room.roomId,
      })
      .events.filter((event) => event.aggregateId === created.task.taskId)
      .map((event) => event.type);
    assert.deepEqual(taskEvents, [
      "task.created",
      "task.claimed",
      "task.started",
      "task.progressed",
      "task.submitted",
    ]);
    assert.equal(
      activeObserver.listRunAttempts({ roomId: room.roomId }).length,
      2,
    );
  } finally {
    shutdown.abort("task-resume-test-complete");
    await running?.catch(() => undefined);
    observer?.close();
    try {
      seed.close();
    } catch {
      // The seed connection was already closed before daemon startup.
    }
    rmSync(directory, { force: true, recursive: true });
  }
});

test("the daemon recovers a committed InputRequest, waits without a model, and resumes from resolution", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-daemon-task-input-"));
  const stateDirectory = join(directory, "state");
  mkdirSync(stateDirectory, { mode: 0o700 });
  const databasePath = join(stateDirectory, "room.db");
  const secretPath = join(stateDirectory, "host.token");
  const resumeMarkerPath = join(stateDirectory, "input-resume-once.marker");
  const seed = new RoomKernel({ databasePath });
  const shutdown = new AbortController();
  let running: Promise<void> | undefined;
  let observer: RoomKernel | undefined;
  try {
    seed.initialize();
    const human = seed.provisionPrincipal({
      handle: "daemon-task-input-human",
      kind: "human",
    });
    const agent = seed.provisionPrincipal({
      handle: "daemon-task-input-agent",
      kind: "agent",
    });
    const humanActor = seed.authenticateAccessToken(human.accessToken);
    const room = seed.createRoom(humanActor, {
      name: "Daemon Task input",
      slug: "daemon-task-input",
    });
    seed.addMember(humanActor, {
      principalId: agent.principal.principalId,
      roomId: room.roomId,
    });
    const created = seed.createTask(humanActor, {
      assigneeId: agent.principal.principalId,
      idempotencyKey: "daemon-task-input-created",
      roomId: room.roomId,
      title: "Pause for a durable human decision",
    });
    const hostCredential = seed.provisionHostCredential({
      hostId: "daemon-task-input-host",
      participantIds: [agent.principal.principalId],
    });
    writeFileSync(secretPath, `${hostCredential.accessToken}\n`, {
      mode: 0o600,
    });
    seed.close();

    const config = DaemonConfigSchema.parse({
      ...validConfig(stateDirectory, secretPath),
      host: {
        credential: { path: secretPath, source: "file" },
        hostId: "daemon-task-input-host",
        participantId: agent.principal.principalId,
      },
      runtime: {
        ...validConfig(stateDirectory, secretPath).runtime,
        env: {
          RAH_FAKE_MODE: "worker-task-input-resume",
          RAH_FAKE_RESUME_MARKER: resumeMarkerPath,
        },
      },
    });
    const application = new DaemonApplication({ config });
    running = application.run({ signal: shutdown.signal });
    observer = new RoomKernel({ databasePath });
    observer.initialize();
    const activeObserver = observer;
    await waitUntil(
      () =>
        application.clientOrigin() !== undefined &&
        activeObserver.listTasks(humanActor, { roomId: room.roomId })[0]
          ?.state === "waiting_input" &&
        activeObserver
          .listActivations({ roomId: room.roomId })
          .some((activation) => activation.state === "completed"),
      2_000,
    );
    const pending = activeObserver.listInputRequests(humanActor, {
      roomId: room.roomId,
    })[0];
    assert.equal(pending?.state, "pending");
    assert.equal(
      pending?.question,
      "Should the daemon remain loopback-only for this phase?",
    );
    assert.equal(
      activeObserver.listRunAttempts({ roomId: room.roomId }).length,
      2,
      "the second RunAttempt acknowledges the original range without recreating the InputRequest",
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(
      activeObserver.listRunAttempts({ roomId: room.roomId }).length,
      2,
      "waiting for the human must not keep spawning or polling an Agent CLI",
    );

    const clientOrigin = application.clientOrigin();
    assert.ok(clientOrigin);
    const clientRequest = async (path: string, body: Record<string, unknown>) =>
      await fetch(`${clientOrigin}${path}`, {
        body: JSON.stringify(body),
        headers: {
          authorization: `Bearer ${human.accessToken}`,
          "content-type": "application/json",
        },
        method: "POST",
      });
    const healthResponse = await fetch(`${clientOrigin}/v1/client/health`);
    assert.equal(healthResponse.status, 200);
    const health = (await healthResponse.json()) as Record<string, unknown>;
    assert.equal(health.state, "online");
    assert.equal(health.apiVersion, 1);

    const pendingResponse = await clientRequest(
      "/v1/client/input-requests/list",
      { roomId: room.roomId, state: "pending" },
    );
    assert.equal(pendingResponse.status, 200);
    const pendingProjection = (await pendingResponse.json()) as {
      inputRequests: Array<{ inputRequestId: string }>;
    };
    assert.equal(
      pendingProjection.inputRequests[0]?.inputRequestId,
      pending?.inputRequestId,
    );
    const humanSyncResponse = await clientRequest("/v1/client/rooms/sync", {
      consumerId: "daemon-task-input-human",
      roomId: room.roomId,
    });
    assert.equal(humanSyncResponse.status, 200);
    const humanSync = (await humanSyncResponse.json()) as {
      latestRoomSeq: number;
    };
    assert.ok(pending);
    const resolveResponse = await clientRequest(
      "/v1/client/input-requests/resolve",
      {
        answer: "Yes, remain loopback-only",
        basedOnRoomSeq: humanSync.latestRoomSeq,
        idempotencyKey: "daemon-task-input-resolved",
        inputRequestId: pending.inputRequestId,
      },
    );
    assert.equal(resolveResponse.status, 200);
    const resolution = (await resolveResponse.json()) as {
      inputRequest: { state: string };
      task: { state: string };
    };
    assert.equal(resolution.inputRequest.state, "resolved");
    assert.equal(resolution.task.state, "todo");
    await waitUntil(
      () =>
        activeObserver.listTasks(humanActor, { roomId: room.roomId })[0]
          ?.state === "submitted" &&
        activeObserver
          .listActivations({ roomId: room.roomId })
          .filter((activation) => activation.state === "completed").length ===
          2,
      3_000,
    );

    assert.equal(
      activeObserver.listInputRequests(humanActor, {
        roomId: room.roomId,
      })[0]?.answer,
      "Yes, remain loopback-only",
    );
    assert.equal(
      activeObserver.listRunAttempts({ roomId: room.roomId }).length,
      3,
    );
    const workflowEvents = activeObserver
      .sync(humanActor, {
        consumerId: "daemon-task-input-verifier",
        roomId: room.roomId,
      })
      .events.filter(
        (event) =>
          event.aggregateId === created.task.taskId ||
          event.aggregateId === pending.inputRequestId,
      )
      .map((event) => event.type);
    assert.deepEqual(workflowEvents, [
      "task.created",
      "task.claimed",
      "task.started",
      "input.requested",
      "input.resolved",
      "task.claimed",
      "task.started",
      "task.progressed",
      "task.submitted",
    ]);
  } finally {
    shutdown.abort("task-input-test-complete");
    await running?.catch(() => undefined);
    observer?.close();
    try {
      seed.close();
    } catch {
      // The seed connection was already closed before daemon startup.
    }
    rmSync(directory, { force: true, recursive: true });
  }
});

test("an Outbox wake interrupts a long reconciliation poll without becoming authoritative", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-daemon-wake-"));
  const stateDirectory = join(directory, "state");
  mkdirSync(stateDirectory, { mode: 0o700 });
  const databasePath = join(stateDirectory, "room.db");
  const secretPath = join(stateDirectory, "host.token");
  const seed = new RoomKernel({ databasePath });
  const shutdown = new AbortController();
  let running: Promise<void> | undefined;
  let observer: RoomKernel | undefined;
  try {
    seed.initialize();
    const human = seed.provisionPrincipal({
      handle: "daemon-wake-human",
      kind: "human",
    });
    const agent = seed.provisionPrincipal({
      handle: "daemon-wake-agent",
      kind: "agent",
    });
    const humanActor = seed.authenticateAccessToken(human.accessToken);
    const room = seed.createRoom(humanActor, {
      name: "Daemon wake",
      slug: "daemon-wake",
    });
    seed.addMember(humanActor, {
      principalId: agent.principal.principalId,
      roomId: room.roomId,
    });
    const credential = seed.provisionHostCredential({
      hostId: "daemon-wake-host",
      participantIds: [agent.principal.principalId],
    });
    writeFileSync(secretPath, `${credential.accessToken}\n`, { mode: 0o600 });
    seed.close();

    const config = DaemonConfigSchema.parse({
      ...validConfig(stateDirectory, secretPath),
      host: {
        credential: { path: secretPath, source: "file" },
        hostId: "daemon-wake-host",
        participantId: agent.principal.principalId,
      },
      pollIntervalMs: 60_000,
    });
    const application = new DaemonApplication({ config });
    running = application.run({ signal: shutdown.signal });
    observer = new RoomKernel({ databasePath });
    observer.initialize();
    const activeObserver = observer;
    await waitUntil(() => activeObserver.listHosts()[0]?.state === "online");
    await new Promise((resolve) => setTimeout(resolve, 50));

    const startedAt = Date.now();
    activeObserver.postMessage(
      activeObserver.authenticateAccessToken(human.accessToken),
      {
        body: "Wake the idle daemon from durable Outbox state",
        idempotencyKey: "daemon-wake-message",
        recipients: [
          {
            participantId: agent.principal.principalId,
            reason: "mention",
          },
        ],
        roomId: room.roomId,
      },
    );
    await waitUntil(
      () =>
        activeObserver.listActivations({ roomId: room.roomId })[0]?.state ===
        "completed",
      2_000,
    );
    assert.ok(Date.now() - startedAt < 2_000);
  } finally {
    shutdown.abort("wake-test-complete");
    await running?.catch(() => undefined);
    observer?.close();
    try {
      seed.close();
    } catch {
      // The seed connection was already closed before daemon startup.
    }
    rmSync(directory, { force: true, recursive: true });
  }
});

test("the daemon executable handles a Room Activation and SIGTERM in a separate process", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-daemon-process-"));
  const stateDirectory = join(directory, "state");
  mkdirSync(stateDirectory, { mode: 0o700 });
  const databasePath = join(stateDirectory, "room.db");
  const secretPath = join(stateDirectory, "host.token");
  const configPath = join(directory, "daemon.json");
  const seed = new RoomKernel({ databasePath });
  let child: ReturnType<typeof spawn> | undefined;
  try {
    seed.initialize();
    const human = seed.provisionPrincipal({
      handle: "daemon-process-human",
      kind: "human",
    });
    const agent = seed.provisionPrincipal({
      handle: "daemon-process-agent",
      kind: "agent",
    });
    const humanActor = seed.authenticateAccessToken(human.accessToken);
    const room = seed.createRoom(humanActor, {
      name: "Daemon process",
      slug: "daemon-process",
    });
    seed.addMember(humanActor, {
      principalId: agent.principal.principalId,
      roomId: room.roomId,
    });
    seed.postMessage(humanActor, {
      body: "Prove the executable process boundary",
      idempotencyKey: "daemon-process-message",
      recipients: [
        {
          participantId: agent.principal.principalId,
          reason: "mention",
        },
      ],
      roomId: room.roomId,
    });
    const credential = seed.provisionHostCredential({
      hostId: "daemon-process-host",
      participantIds: [agent.principal.principalId],
    });
    writeFileSync(secretPath, `${credential.accessToken}\n`, { mode: 0o600 });
    writeFileSync(
      configPath,
      JSON.stringify({
        ...validConfig(stateDirectory, secretPath),
        host: {
          credential: { path: secretPath, source: "file" },
          hostId: "daemon-process-host",
          participantId: agent.principal.principalId,
        },
      }),
    );
    seed.close();

    child = spawn(process.execPath, [daemonCliPath, "--config", configPath], {
      cwd: directory,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const observer = new RoomKernel({ databasePath });
    observer.initialize();
    await waitUntil(
      () =>
        observer.listActivations({ roomId: room.roomId })[0]?.state ===
        "completed",
    );
    child.kill("SIGTERM");
    const exit = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child?.once("error", reject);
      child?.once("close", (code, signal) => resolve({ code, signal }));
    });
    assert.deepEqual(exit, { code: 0, signal: null }, stderr);
    assert.equal(observer.listHosts()[0]?.state, "offline");
    observer.close();
  } finally {
    if (child !== undefined && child.exitCode === null) child.kill("SIGKILL");
    try {
      seed.close();
    } catch {
      // The seed connection was already closed before the daemon started.
    }
    rmSync(directory, { force: true, recursive: true });
  }
});

function validConfig(stateDirectory: string, secretPath: string) {
  return {
    client: {
      bindHost: "127.0.0.1" as const,
      port: 0,
    },
    host: {
      credential: { path: secretPath, source: "file" as const },
      hostId: "config-host",
      participantId: "config-participant",
    },
    hostStaleAfterMs: 60_000,
    drainTimeoutMs: 30_000,
    leaseMs: 30_000,
    outboxLeaseMs: 5_000,
    outboxPollIntervalMs: 20,
    outboxRetryAfterMs: 1_000,
    pollIntervalMs: 20,
    runTimeoutMs: 30_000,
    runtimeCancelTimeoutMs: 10_000,
    runtimeRecoveryTimeoutMs: 30_000,
    runtimeStartTimeoutMs: 10_000,
    taskClaimLeaseMs: 30_000,
    taskClaimHeartbeatIntervalMs: 10_000,
    runtime: {
      args: [fakeCliPath],
      command: process.execPath,
      cwd: stateDirectory,
      env: { RAH_FAKE_MODE: "worker-sync" },
      kind: "generic-process" as const,
    },
    schemaVersion: 2 as const,
    stateDirectory,
  };
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition was not met");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
