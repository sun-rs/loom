import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RoomKernel } from "@rah-os/kernel";

import {
  AgentHost,
  classifyRuntimeFailure,
  FakeRuntimeAdapter,
  type RuntimeAdapter,
} from "../src/index.ts";

function authenticateHost(
  kernel: RoomKernel,
  hostId: string,
  participantIds: string[],
) {
  const credential = kernel.provisionHostCredential({
    hostId,
    participantIds,
  });
  const host = kernel.authenticateHostAccessToken(credential.accessToken);
  kernel.heartbeatHost(host);
  return host;
}

test("AgentHost leases a durable Activation and executes it through a Fake Runtime", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-agent-host-"));
  try {
    const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
    kernel.initialize();
    const humanProvisioning = kernel.provisionPrincipal({
      handle: "host-test-human",
      kind: "human",
    });
    const agentProvisioning = kernel.provisionPrincipal({
      handle: "host-test-agent",
      kind: "agent",
    });
    const humanActor = kernel.authenticateAccessToken(
      humanProvisioning.accessToken,
    );
    const room = kernel.createRoom(humanActor, {
      name: "AgentHost test",
      slug: "agent-host-test",
    });
    kernel.addMember(humanActor, {
      principalId: agentProvisioning.principal.principalId,
      roomId: room.roomId,
    });
    kernel.postMessage(humanActor, {
      body: "Run through the durable host lane",
      idempotencyKey: "host-test-message",
      recipients: [
        {
          participantId: agentProvisioning.principal.principalId,
          reason: "mention",
        },
      ],
      roomId: room.roomId,
    });

    const agentActor = kernel.authenticateAccessToken(
      agentProvisioning.accessToken,
    );
    const runtime = new FakeRuntimeAdapter({
      onStart: (input) => {
        assert.equal(
          kernel.listRuntimeProcesses({ roomId: room.roomId })[0]?.state,
          "prepared",
          "the recovery capability must be durable before runtime side effects",
        );
        const delivery = kernel.sync(agentActor, {
          consumerId: input.consumerId,
          roomId: input.roomId,
        });
        kernel.acknowledgeCursor(agentActor, {
          consumerId: input.consumerId,
          roomId: input.roomId,
          throughSeq: delivery.cursorAfter,
        });
      },
    });
    const host = new AgentHost({
      host: authenticateHost(kernel, "host-test", [
        agentProvisioning.principal.principalId,
      ]),
      kernel,
      leaseMs: 30_000,
      runtime,
    });
    const result = await host.reconcileOnce();

    assert.equal(result.state, "completed");
    assert.equal(runtime.starts.length, 1);
    assert.equal(
      runtime.starts[0]?.participantId,
      agentProvisioning.principal.principalId,
    );
    assert.equal("body" in (runtime.starts[0] ?? {}), false);
    assert.equal(
      kernel.listActivations({ roomId: room.roomId })[0]?.state,
      "completed",
    );
    const runAttempt = kernel.listRunAttempts({ roomId: room.roomId })[0];
    assert.equal(runAttempt?.state, "exited");
    assert.equal(runAttempt?.exitCode, 0);
    assert.equal(runAttempt?.runtimeRunId, "fake-run-1");
    assert.equal(
      result.state === "completed" ? result.runAttemptId : undefined,
      runAttempt?.runAttemptId,
    );
    assert.equal(
      kernel.listRuntimeProcesses({ roomId: room.roomId })[0]?.state,
      "terminated",
    );

    kernel.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("AgentHost does not complete an Activation from exit zero without delivery proof", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-agent-host-proof-"));
  try {
    const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
    kernel.initialize();
    const humanProvisioning = kernel.provisionPrincipal({
      handle: "proof-human",
      kind: "human",
    });
    const agentProvisioning = kernel.provisionPrincipal({
      handle: "proof-agent",
      kind: "agent",
    });
    const humanActor = kernel.authenticateAccessToken(
      humanProvisioning.accessToken,
    );
    const room = kernel.createRoom(humanActor, {
      name: "Delivery proof",
      slug: "delivery-proof",
    });
    kernel.addMember(humanActor, {
      principalId: agentProvisioning.principal.principalId,
      roomId: room.roomId,
    });
    kernel.postMessage(humanActor, {
      body: "Do not infer reading from exit zero",
      idempotencyKey: "proof-message",
      recipients: [
        {
          participantId: agentProvisioning.principal.principalId,
          reason: "mention",
        },
      ],
      roomId: room.roomId,
    });

    const host = new AgentHost({
      host: authenticateHost(kernel, "proof-host", [
        agentProvisioning.principal.principalId,
      ]),
      kernel,
      leaseMs: 30_000,
      runtime: new FakeRuntimeAdapter(),
    });
    const result = await host.reconcileOnce();

    assert.equal(result.state, "failed");
    assert.match(result.state === "failed" ? result.error : "", /delivery/i);
    assert.equal(
      kernel.listActivations({ roomId: room.roomId })[0]?.state,
      "queued",
    );
    assert.equal(
      kernel.listRuntimeProcesses({ roomId: room.roomId })[0]?.state,
      "terminated",
    );
    assert.equal(
      kernel.listRunAttempts({ roomId: room.roomId })[0]?.state,
      "exited",
    );
    assert.equal(
      kernel.listRunAttempts({ roomId: room.roomId })[0]?.exitCode,
      0,
    );

    kernel.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("AgentHost durably requeues an Activation after a runtime failure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-agent-host-retry-"));
  try {
    let nowMs = Date.parse("2026-08-28T00:00:00.000Z");
    const kernel = new RoomKernel({
      databasePath: join(directory, "room.db"),
      now: () => new Date(nowMs),
    });
    kernel.initialize();
    const humanProvisioning = kernel.provisionPrincipal({
      handle: "retry-human",
      kind: "human",
    });
    const agentProvisioning = kernel.provisionPrincipal({
      handle: "retry-agent",
      kind: "agent",
    });
    const humanActor = kernel.authenticateAccessToken(
      humanProvisioning.accessToken,
    );
    const room = kernel.createRoom(humanActor, {
      name: "Host retry",
      slug: "host-retry",
    });
    kernel.addMember(humanActor, {
      principalId: agentProvisioning.principal.principalId,
      roomId: room.roomId,
    });
    kernel.postMessage(humanActor, {
      body: "Retry after the runtime fails",
      idempotencyKey: "host-retry-message",
      recipients: [
        {
          participantId: agentProvisioning.principal.principalId,
          reason: "mention",
        },
      ],
      roomId: room.roomId,
    });

    const runtime = new FakeRuntimeAdapter();
    runtime.enqueueExit({ code: 1 });
    runtime.enqueueExit({ code: 1 });
    runtime.enqueueExit({ code: 1 });
    const host = new AgentHost({
      host: authenticateHost(kernel, "retry-host", [
        agentProvisioning.principal.principalId,
      ]),
      kernel,
      leaseMs: 30_000,
      retryAfterMs: 1_000,
      retryJitterRandom: () => 0,
      runtime,
    });
    const result = await host.reconcileOnce();

    assert.equal(result.state, "failed");
    const activation = kernel.listActivations({ roomId: room.roomId })[0];
    assert.equal(activation?.state, "queued");
    assert.match(activation?.lastError ?? "", /code 1/);
    const runAttempt = kernel.listRunAttempts({ roomId: room.roomId })[0];
    assert.equal(runAttempt?.state, "exited");
    assert.equal(runAttempt?.exitCode, 1);

    assert.equal(
      Date.parse(activation?.availableAt ?? ""),
      nowMs + 1_000,
      "the first failure uses the configured base delay",
    );
    nowMs += 1_000;
    const second = await host.reconcileOnce();
    assert.equal(second.state, "failed");
    const retried = kernel.listActivations({ roomId: room.roomId })[0];
    assert.equal(retried?.attemptCount, 2);
    assert.equal(
      Date.parse(retried?.availableAt ?? ""),
      nowMs + 2_000,
      "consecutive failures back off instead of creating a retry storm",
    );
    nowMs += 2_000;
    const third = await host.reconcileOnce();
    assert.equal(third.state, "failed");
    const fenced = kernel.listActivations({ roomId: room.roomId })[0];
    assert.equal(fenced?.attemptCount, 3);
    assert.equal(
      fenced?.state,
      "quarantined",
      "Raft stops restarting after three identical Runtime fingerprints",
    );
    assert.deepEqual(await host.reconcileOnce(), { state: "idle" });

    kernel.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("AgentHost forwards a structured action-required failure into immediate durable quarantine", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-agent-host-auth-"));
  try {
    const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
    kernel.initialize();
    const human = kernel.provisionPrincipal({
      handle: "auth-failure-human",
      kind: "human",
    });
    const agent = kernel.provisionPrincipal({
      handle: "auth-failure-agent",
      kind: "agent",
    });
    const actor = kernel.authenticateAccessToken(human.accessToken);
    const room = kernel.createRoom(actor, {
      name: "Auth failure",
      slug: "auth-failure",
    });
    kernel.addMember(actor, {
      principalId: agent.principal.principalId,
      roomId: room.roomId,
    });
    kernel.postMessage(actor, {
      body: "Use the configured runtime",
      idempotencyKey: "auth-failure-message",
      recipients: [
        { participantId: agent.principal.principalId, reason: "mention" },
      ],
      roomId: room.roomId,
    });
    const runtime = new FakeRuntimeAdapter();
    runtime.enqueueExit({
      code: 1,
      failure: classifyRuntimeFailure("Authentication failed: login required"),
    });
    const host = new AgentHost({
      host: authenticateHost(kernel, "auth-failure-host", [
        agent.principal.principalId,
      ]),
      kernel,
      leaseMs: 30_000,
      runtime,
    });

    const result = await host.reconcileOnce();

    assert.equal(result.state, "failed");
    const activation = kernel.listActivations({ roomId: room.roomId })[0];
    assert.equal(activation?.state, "quarantined");
    assert.equal(activation?.attemptCount, 1);
    assert.deepEqual(await host.reconcileOnce(), { state: "idle" });
    kernel.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("AgentHost emits run.started only after the runtime actually starts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-agent-host-start-"));
  try {
    const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
    kernel.initialize();
    const humanProvisioning = kernel.provisionPrincipal({
      handle: "start-event-human",
      kind: "human",
    });
    const agentProvisioning = kernel.provisionPrincipal({
      handle: "start-event-agent",
      kind: "agent",
    });
    const humanActor = kernel.authenticateAccessToken(
      humanProvisioning.accessToken,
    );
    const room = kernel.createRoom(humanActor, {
      name: "Runtime start events",
      slug: "runtime-start-events",
    });
    kernel.addMember(humanActor, {
      principalId: agentProvisioning.principal.principalId,
      roomId: room.roomId,
    });
    kernel.postMessage(humanActor, {
      body: "The runtime will fail before spawn completes",
      idempotencyKey: "start-event-message",
      recipients: [
        {
          participantId: agentProvisioning.principal.principalId,
          reason: "mention",
        },
      ],
      roomId: room.roomId,
    });

    const runtime = new FakeRuntimeAdapter({
      onStart: () => {
        throw new Error("spawn failed before a process existed");
      },
    });
    const host = new AgentHost({
      host: authenticateHost(kernel, "start-event-host", [
        agentProvisioning.principal.principalId,
      ]),
      kernel,
      leaseMs: 30_000,
      runtime,
    });
    const result = await host.reconcileOnce();
    assert.equal(result.state, "failed");
    assert.deepEqual(
      runtime.cancellations.map((cancellation) => cancellation.runId),
      ["fake-run-1"],
    );

    const activation = kernel.listActivations({ roomId: room.roomId })[0];
    assert.equal(activation?.state, "queued");
    const runtimeProcess = kernel.listRuntimeProcesses({
      roomId: room.roomId,
    })[0];
    assert.equal(runtimeProcess?.state, "terminated");

    const eventTypes = kernel
      .sync(humanActor, {
        consumerId: "start-event-audit",
        roomId: room.roomId,
      })
      .events.map((event) => event.type);
    assert.equal(eventTypes.includes("run.created"), true);
    assert.equal(eventTypes.includes("run.runtime_prepared"), true);
    assert.equal(eventTypes.includes("run.started"), false);
    assert.equal(eventTypes.includes("run.finished"), true);

    kernel.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("AgentHost daemon loop reconciles durable work without a wake hint", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-agent-host-loop-"));
  try {
    const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
    kernel.initialize();
    const humanProvisioning = kernel.provisionPrincipal({
      handle: "loop-human",
      kind: "human",
    });
    const agentProvisioning = kernel.provisionPrincipal({
      handle: "loop-agent",
      kind: "agent",
    });
    const humanActor = kernel.authenticateAccessToken(
      humanProvisioning.accessToken,
    );
    const agentActor = kernel.authenticateAccessToken(
      agentProvisioning.accessToken,
    );
    const room = kernel.createRoom(humanActor, {
      name: "Reconciliation loop",
      slug: "reconciliation-loop",
    });
    kernel.addMember(humanActor, {
      principalId: agentProvisioning.principal.principalId,
      roomId: room.roomId,
    });

    const abortController = new AbortController();
    let waitCount = 0;
    const runtime = new FakeRuntimeAdapter({
      onStart: (input) => {
        const delivery = kernel.sync(agentActor, {
          consumerId: input.consumerId,
          roomId: input.roomId,
        });
        kernel.acknowledgeCursor(agentActor, {
          consumerId: input.consumerId,
          roomId: input.roomId,
          throughSeq: delivery.cursorAfter,
        });
      },
    });
    const host = new AgentHost({
      host: authenticateHost(kernel, "loop-host", [
        agentProvisioning.principal.principalId,
      ]),
      kernel,
      leaseMs: 30_000,
      pollIntervalMs: 1_000,
      runtime,
      wait: async () => {
        waitCount += 1;
        if (waitCount === 1) {
          kernel.postMessage(humanActor, {
            body: "This arrives without any wake hint",
            idempotencyKey: "loop-message",
            recipients: [
              {
                participantId: agentProvisioning.principal.principalId,
                reason: "mention",
              },
            ],
            roomId: room.roomId,
          });
        } else {
          abortController.abort();
        }
      },
    });

    await host.run({ signal: abortController.signal });

    assert.equal(runtime.starts.length, 1);
    assert.equal(
      kernel.listActivations({ roomId: room.roomId })[0]?.state,
      "completed",
    );
    const hosts = kernel.listHosts();
    assert.equal(hosts.length, 1);
    assert.equal(hosts[0]?.hostId, "loop-host");
    assert.deepEqual(hosts[0]?.participantIds, [
      agentProvisioning.principal.principalId,
    ]);
    assert.equal(hosts[0]?.state, "offline");
    assert.match(hosts[0]?.lastSeenAt ?? "", /^\d{4}-\d{2}-\d{2}T/);

    kernel.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("AgentHost cancels a hung runtime, records timeout, and requeues", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-agent-host-timeout-"));
  try {
    const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
    kernel.initialize();
    const humanProvisioning = kernel.provisionPrincipal({
      handle: "timeout-human",
      kind: "human",
    });
    const agentProvisioning = kernel.provisionPrincipal({
      handle: "timeout-agent",
      kind: "agent",
    });
    const humanActor = kernel.authenticateAccessToken(
      humanProvisioning.accessToken,
    );
    const agentActor = kernel.authenticateAccessToken(
      agentProvisioning.accessToken,
    );
    const room = kernel.createRoom(humanActor, {
      name: "Runtime timeout",
      slug: "runtime-timeout",
    });
    kernel.addMember(humanActor, {
      principalId: agentProvisioning.principal.principalId,
      roomId: room.roomId,
    });
    kernel.postMessage(humanActor, {
      body: "This runtime will hang",
      idempotencyKey: "timeout-message",
      recipients: [
        {
          participantId: agentProvisioning.principal.principalId,
          reason: "mention",
        },
      ],
      roomId: room.roomId,
    });

    const runtime = new FakeRuntimeAdapter({
      onReap: async () => await new Promise(() => {}),
      onStart: (input) => {
        const delivery = kernel.sync(agentActor, {
          consumerId: input.consumerId,
          roomId: input.roomId,
        });
        kernel.acknowledgeCursor(agentActor, {
          consumerId: input.consumerId,
          roomId: input.roomId,
          throughSeq: delivery.cursorAfter,
        });
      },
    });
    const host = new AgentHost({
      host: authenticateHost(kernel, "timeout-host", [
        agentProvisioning.principal.principalId,
      ]),
      kernel,
      leaseMs: 30_000,
      maintenanceWait: waitUntilAborted,
      runTimeoutMs: 60_000,
      runtime,
      timeoutWait: async () => {},
    });

    const result = await host.reconcileOnce();

    assert.equal(result.state, "failed");
    assert.match(result.state === "failed" ? result.error : "", /timed out/i);
    assert.equal(runtime.cancellations.length, 1);
    assert.equal(
      kernel.listRunAttempts({ roomId: room.roomId })[0]?.state,
      "timed_out",
    );
    assert.equal(
      kernel.listActivations({ roomId: room.roomId })[0]?.state,
      "queued",
    );

    kernel.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("AgentHost quarantines a lane when runtime termination cannot be proven", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "rah-os-agent-host-quarantine-"),
  );
  try {
    const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
    kernel.initialize();
    const humanProvisioning = kernel.provisionPrincipal({
      handle: "quarantine-human",
      kind: "human",
    });
    const agentProvisioning = kernel.provisionPrincipal({
      handle: "quarantine-agent",
      kind: "agent",
    });
    const humanActor = kernel.authenticateAccessToken(
      humanProvisioning.accessToken,
    );
    const room = kernel.createRoom(humanActor, {
      name: "Runtime quarantine",
      slug: "runtime-quarantine",
    });
    kernel.addMember(humanActor, {
      principalId: agentProvisioning.principal.principalId,
      roomId: room.roomId,
    });
    kernel.postMessage(humanActor, {
      body: "This runtime cannot be terminated safely",
      idempotencyKey: "quarantine-message",
      recipients: [
        {
          participantId: agentProvisioning.principal.principalId,
          reason: "mention",
        },
      ],
      roomId: room.roomId,
    });

    const runtime: RuntimeAdapter = {
      cancel: async () => {
        throw new Error("runtime refused cancellation");
      },
      probe: async () => ({ available: true }),
      reap: async () => await new Promise(() => {}),
      start: async (_input, lifecycle) => {
        const run = { runId: "uncooperative-runtime" };
        await lifecycle.registerPrepared(run);
        return run;
      },
    };
    const host = new AgentHost({
      host: authenticateHost(kernel, "quarantine-host", [
        agentProvisioning.principal.principalId,
      ]),
      kernel,
      leaseMs: 30_000,
      maintenanceWait: waitUntilAborted,
      retryAfterMs: 0,
      runtime,
      timeoutWait: async () => {},
    });

    const result = await host.reconcileOnce();

    assert.equal(result.state, "failed");
    assert.match(
      result.state === "failed" ? result.error : "",
      /termination.*not.*proven/i,
    );
    assert.equal(
      kernel.listActivations({ roomId: room.roomId })[0]?.state,
      "quarantined",
    );
    assert.equal(
      kernel.listRuntimeProcesses({ roomId: room.roomId })[0]?.state,
      "orphaned",
    );
    assert.equal(
      kernel.listRunAttempts({ roomId: room.roomId })[0]?.state,
      "orphaned",
    );
    assert.equal(
      kernel.leaseNextActivation(
        authenticateHost(kernel, "competing-host", [
          agentProvisioning.principal.principalId,
        ]),
        { leaseMs: 30_000 },
      ),
      null,
    );

    kernel.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("AgentHost recovers a leased orphan before restarting its participant lane", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-agent-host-recovery-"));
  try {
    const clock = createClock();
    const databasePath = join(directory, "room.db");
    const kernel = new RoomKernel({ databasePath, now: clock.now });
    kernel.initialize();
    const humanProvisioning = kernel.provisionPrincipal({
      handle: "recovery-human",
      kind: "human",
    });
    const agentProvisioning = kernel.provisionPrincipal({
      handle: "recovery-agent",
      kind: "agent",
    });
    const humanActor = kernel.authenticateAccessToken(
      humanProvisioning.accessToken,
    );
    const agentActor = kernel.authenticateAccessToken(
      agentProvisioning.accessToken,
    );
    const room = kernel.createRoom(humanActor, {
      name: "Orphan recovery",
      slug: "orphan-recovery",
    });
    kernel.addMember(humanActor, {
      principalId: agentProvisioning.principal.principalId,
      roomId: room.roomId,
    });
    kernel.postMessage(humanActor, {
      body: "Recover the old execution before starting again",
      idempotencyKey: "orphan-recovery-message",
      recipients: [
        {
          participantId: agentProvisioning.principal.principalId,
          reason: "mention",
        },
      ],
      roomId: room.roomId,
    });
    const crashedHost = authenticateHost(kernel, "crashed-host", [
      agentProvisioning.principal.principalId,
    ]);
    const recoveryHost = authenticateHost(kernel, "recovery-host", [
      agentProvisioning.principal.principalId,
    ]);
    const activation = kernel.leaseNextActivation(crashedHost, {
      leaseMs: 1_000,
    });
    assert.ok(activation);
    const runAttempt = kernel.createRunAttempt(crashedHost, {
      activationId: activation.activationId,
    });
    kernel.prepareRunAttemptRuntime(crashedHost, {
      recoveryDescriptor: {
        driver: "fake-runtime",
        metadata: {},
        recoveryImplementationVersion: "fake-runtime/v1",
        recoveryKey: "orphaned-fake-run",
        runtimeProfileDigest:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        runtimeProfileRevisionId: "legacy-runtime-revision",
      },
      runAttemptId: runAttempt.runAttemptId,
      runtimeRunId: "orphaned-fake-run",
    });
    kernel.markRunAttemptRunning(crashedHost, {
      recoveryDescriptor: {
        driver: "fake-runtime",
        metadata: {},
        recoveryImplementationVersion: "fake-runtime/v1",
        recoveryKey: "orphaned-fake-run",
        runtimeProfileDigest:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        runtimeProfileRevisionId: "legacy-runtime-revision",
      },
      runAttemptId: runAttempt.runAttemptId,
      runtimeRunId: "orphaned-fake-run",
    });
    clock.advance(1_001);
    assert.equal(
      kernel.leaseNextActivation(recoveryHost, { leaseMs: 1_000 }),
      null,
    );

    let recoveredRunAttemptId: string | undefined;
    let resolveRecovery:
      ((exit: { code: null; signal: string }) => void) | undefined;
    const delayedRecovery = new Promise<{ code: null; signal: string }>(
      (resolve) => {
        resolveRecovery = resolve;
      },
    );
    let recoveryMaintenanceCount = 0;
    const legacyRecoveryRuntime = new FakeRuntimeAdapter({
      onRecover: async (input) => {
        recoveredRunAttemptId = input.runAttemptId;
        return await delayedRecovery;
      },
    });
    const currentRuntime = new FakeRuntimeAdapter({
      onStart: (input) => {
        const delivery = kernel.sync(agentActor, {
          consumerId: input.consumerId,
          roomId: input.roomId,
        });
        kernel.acknowledgeCursor(agentActor, {
          consumerId: input.consumerId,
          roomId: input.roomId,
          throughSeq: delivery.cursorAfter,
        });
      },
    });
    const host = new AgentHost({
      host: recoveryHost,
      kernel,
      leaseMs: 1_000,
      maintenanceWait: async (delayMs, signal) => {
        if (recoveryMaintenanceCount < 2) {
          recoveryMaintenanceCount += 1;
          clock.advance(600);
          if (recoveryMaintenanceCount === 2) {
            resolveRecovery?.({ code: null, signal: "SIGKILL" });
          }
          return;
        }
        await waitUntilAborted(delayMs, signal);
      },
      runtime: currentRuntime,
      runtimeRecoveryDrivers: ["fake-runtime"],
      runtimeRecoveryResolver: (descriptor) => {
        assert.equal(
          descriptor.runtimeProfileRevisionId,
          "legacy-runtime-revision",
        );
        return legacyRecoveryRuntime;
      },
    });

    const recovery = await host.reconcileOrphanOnce();
    assert.equal(recovery.state, "recovered");
    assert.equal(recoveryMaintenanceCount, 2);
    assert.equal(recoveredRunAttemptId, runAttempt.runAttemptId);
    assert.equal(
      kernel.listRuntimeProcesses({ roomId: room.roomId })[0]?.state,
      "terminated",
    );
    assert.equal(
      kernel.listActivations({ roomId: room.roomId })[0]?.state,
      "queued",
    );

    const execution = await host.reconcileOnce();
    assert.equal(execution.state, "completed");

    kernel.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("AgentHost renews the Activation lease while a runtime is still running", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-agent-host-renew-"));
  try {
    const clock = createClock();
    const databasePath = join(directory, "room.db");
    const kernel = new RoomKernel({ databasePath, now: clock.now });
    kernel.initialize();
    const humanProvisioning = kernel.provisionPrincipal({
      handle: "renew-human",
      kind: "human",
    });
    const agentProvisioning = kernel.provisionPrincipal({
      handle: "renew-agent",
      kind: "agent",
    });
    const humanActor = kernel.authenticateAccessToken(
      humanProvisioning.accessToken,
    );
    const agentActor = kernel.authenticateAccessToken(
      agentProvisioning.accessToken,
    );
    const room = kernel.createRoom(humanActor, {
      name: "Runtime renewal",
      slug: "runtime-renewal",
    });
    kernel.addMember(humanActor, {
      principalId: agentProvisioning.principal.principalId,
      roomId: room.roomId,
    });
    kernel.postMessage(humanActor, {
      body: "Keep the lease while this runtime is active",
      idempotencyKey: "runtime-renewal-message",
      recipients: [
        {
          participantId: agentProvisioning.principal.principalId,
          reason: "mention",
        },
      ],
      roomId: room.roomId,
    });

    let resolveExit: ((value: { code: number }) => void) | undefined;
    const exit = new Promise<{ code: number }>((resolve) => {
      resolveExit = resolve;
    });
    let observeRenewal: (() => void) | undefined;
    const renewalObserved = new Promise<void>((resolve) => {
      observeRenewal = resolve;
    });
    let maintenanceWaitCount = 0;
    const runtime = new FakeRuntimeAdapter({
      onReap: async () => await exit,
      onStart: (input) => {
        const delivery = kernel.sync(agentActor, {
          consumerId: input.consumerId,
          roomId: input.roomId,
        });
        kernel.acknowledgeCursor(agentActor, {
          consumerId: input.consumerId,
          roomId: input.roomId,
          throughSeq: delivery.cursorAfter,
        });
      },
    });
    const host = new AgentHost({
      host: authenticateHost(kernel, "renewing-host", [
        agentProvisioning.principal.principalId,
      ]),
      kernel,
      leaseMs: 1_000,
      leaseRenewIntervalMs: 500,
      maintenanceWait: async (delayMs, signal) => {
        maintenanceWaitCount += 1;
        if (maintenanceWaitCount === 1) {
          clock.advance(delayMs);
          return;
        }
        observeRenewal?.();
        await waitUntilAborted(delayMs, signal);
      },
      runtime,
      timeoutWait: waitUntilAborted,
    });
    const cycle = host.reconcileOnce();
    await renewalObserved;

    clock.advance(501);
    const competingKernel = new RoomKernel({ databasePath, now: clock.now });
    competingKernel.initialize();
    assert.equal(
      competingKernel.leaseNextActivation(
        authenticateHost(competingKernel, "competing-host", [
          agentProvisioning.principal.principalId,
        ]),
        { leaseMs: 1_000 },
      ),
      null,
    );

    resolveExit?.({ code: 0 });
    const result = await cycle;
    assert.equal(result.state, "completed");

    competingKernel.close();
    kernel.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("AgentHost terminates a cancelled Task runtime before reopening its Activation lane", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-agent-host-cancel-"));
  try {
    const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
    kernel.initialize();
    const humanProvisioning = kernel.provisionPrincipal({
      handle: "cancel-runtime-human",
      kind: "human",
    });
    const agentProvisioning = kernel.provisionPrincipal({
      handle: "cancel-runtime-agent",
      kind: "agent",
    });
    const humanActor = kernel.authenticateAccessToken(
      humanProvisioning.accessToken,
    );
    const room = kernel.createRoom(humanActor, {
      name: "Cancel active runtime",
      slug: "cancel-active-runtime",
    });
    kernel.addMember(humanActor, {
      principalId: agentProvisioning.principal.principalId,
      roomId: room.roomId,
    });
    const task = kernel.createTask(humanActor, {
      assigneeId: agentProvisioning.principal.principalId,
      idempotencyKey: "cancel-runtime-task",
      roomId: room.roomId,
      title: "Stop this long-running job",
    });
    const authenticatedHost = authenticateHost(kernel, "cancel-runtime-host", [
      agentProvisioning.principal.principalId,
    ]);
    let cancelIssued = false;
    const runtime = new FakeRuntimeAdapter({
      onReap: async () =>
        await new Promise(() => {
          // The process intentionally stays live until AgentHost cancels it.
        }),
      onStart: (input) => {
        const execution = kernel.authorizeWorkerExecution(authenticatedHost, {
          activationId: input.activationId,
          consumerId: input.consumerId,
          hostId: input.hostId,
          participantId: input.participantId,
          roomId: input.roomId,
          runAttemptId: input.runAttemptId,
          toSeq: input.toSeq,
        });
        const delivered = kernel.syncWorker(execution, {});
        kernel.acknowledgeWorkerCursor(execution, {
          throughSeq: delivered.cursorAfter,
        });
        const claimed = kernel.claimTask(execution, {
          basedOnRoomSeq: delivered.cursorAfter,
          idempotencyKey: "cancel-runtime-claim",
          leaseMs: 30_000,
          taskId: task.task.taskId,
        });
        kernel.startTask(execution, {
          basedOnRoomSeq: claimed.event.roomSeq,
          idempotencyKey: "cancel-runtime-start",
          leaseMs: 30_000,
          taskId: task.task.taskId,
        });
      },
    });
    const host = new AgentHost({
      host: authenticatedHost,
      kernel,
      leaseMs: 30_000,
      leaseRenewIntervalMs: 10,
      maintenanceWait: async (_delayMs, signal) => {
        if (!cancelIssued) {
          cancelIssued = true;
          const latest = kernel.sync(humanActor, {
            consumerId: "cancel-runtime-human-sync",
            roomId: room.roomId,
          }).cursorAfter;
          kernel.cancelTask(humanActor, {
            basedOnRoomSeq: latest,
            idempotencyKey: "cancel-runtime-stop",
            reason: "Human explicitly closed the long-running Task",
            taskId: task.task.taskId,
          });
          return;
        }
        await waitUntilAborted(10, signal);
      },
      runtime,
      timeoutWait: waitUntilAborted,
    });

    const result = await host.reconcileOnce();
    assert.equal(result.state, "cancelled");
    assert.equal(runtime.cancellations.length, 1);
    assert.equal(
      kernel.listRuntimeProcesses({ roomId: room.roomId })[0]?.state,
      "terminated",
    );
    assert.equal(
      kernel.listRunAttempts({ roomId: room.roomId })[0]?.state,
      "cancelled",
    );
    assert.equal(
      kernel.listActivations({ roomId: room.roomId })[0]?.state,
      "queued",
    );

    kernel.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

async function waitUntilAborted(
  _delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

function createClock(initial = "2026-08-25T00:00:00.000Z") {
  let now = new Date(initial).getTime();
  return {
    now: () => new Date(now),
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}
