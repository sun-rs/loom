import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { WorkerApplicationService } from "@rah-os/application-service";
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

test("AgentHost records runtime Provider usage through its own Host credential", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-agent-host-usage-"));
  try {
    const databasePath = join(directory, "room.db");
    const kernel = new RoomKernel({ databasePath });
    kernel.initialize();
    const human = kernel.provisionPrincipal({
      handle: "usage-human",
      kind: "human",
    });
    const agent = kernel.provisionPrincipal({
      handle: "usage-agent",
      kind: "agent",
    });
    const humanActor = kernel.authenticateAccessToken(human.accessToken);
    const agentActor = kernel.authenticateAccessToken(agent.accessToken);
    const room = kernel.createRoom(humanActor, {
      name: "Usage host",
      slug: "usage-host",
    });
    kernel.addMember(humanActor, {
      principalId: agent.principal.principalId,
      roomId: room.roomId,
    });
    kernel.postMessage(humanActor, {
      body: "Count my tokens",
      idempotencyKey: "usage-host-message",
      recipients: [
        { participantId: agent.principal.principalId, reason: "mention" },
      ],
      roomId: room.roomId,
    });
    const usageFrame = {
      provider: "fixture-provider/v1",
      responseId: "response-1",
      inputTokens: 500,
      cachedInputTokens: 400,
      outputTokens: 20,
      reasoningOutputTokens: null,
      contextWindow: null,
      contextUsedTokens: null,
      observedAt: "2026-09-24T01:00:00.000Z",
    };
    const runtime: RuntimeAdapter = {
      async cancel() {
        return { code: null, signal: "SIGTERM" };
      },
      async probe() {
        return { available: true };
      },
      async reap() {
        return { code: 0 };
      },
      async start(input, lifecycle) {
        const run = {
          recoveryDescriptor: {
            driver: "usage-runtime",
            metadata: {},
            recoveryKey: "usage-run",
          },
          runId: "usage-run",
        };
        await lifecycle.registerPrepared(run);
        await lifecycle.recordUsage?.({
          ...usageFrame,
          runAttemptId: input.runAttemptId,
          runtimeRunId: run.runId,
        });
        await lifecycle.recordUsageAggregate?.({
          provider: "fixture-provider/v1",
          kind: "compaction",
          nativeSessionId: "fixture-session",
          entryId: "compaction-entry",
          inputTokens: 100,
          outputTokens: 5,
          cachedInputTokens: null,
          reasoningOutputTokens: null,
          observedAt: "2026-09-24T01:00:00.500Z",
          runAttemptId: input.runAttemptId,
          runtimeRunId: run.runId,
        });
        await lifecycle.recordUsageGap?.({
          provider: "fixture-provider/v1",
          reason: "correction_frame",
          observedAt: "2026-09-24T01:00:01.000Z",
          runAttemptId: input.runAttemptId,
          runtimeRunId: run.runId,
        });
        const delivery = kernel.sync(agentActor, {
          consumerId: input.consumerId,
          roomId: input.roomId,
        });
        kernel.acknowledgeCursor(agentActor, {
          consumerId: input.consumerId,
          roomId: input.roomId,
          throughSeq: delivery.cursorAfter,
        });
        return run;
      },
    };
    const host = new AgentHost({
      host: authenticateHost(kernel, "usage-host", [
        agent.principal.principalId,
      ]),
      kernel,
      leaseMs: 30_000,
      runtime,
    });
    const result = await host.reconcileOnce();
    assert.equal(result.state, "completed");
    const runAttemptId = kernel.listRunAttempts({ roomId: room.roomId })[0]
      ?.runAttemptId;
    assert.ok(runAttemptId);
    const audit = new DatabaseSync(databasePath, { readOnly: true });
    try {
      assert.deepEqual(
        audit
          .prepare(
            "SELECT run_attempt_id, input_tokens, output_tokens, native_session_id, entry_id FROM run_attempt_usage_aggregates",
          )
          .all()
          .map((row) => ({ ...row })),
        [
          {
            run_attempt_id: runAttemptId,
            input_tokens: 100,
            output_tokens: 5,
            native_session_id: "fixture-session",
            entry_id: "compaction-entry",
          },
        ],
      );
      assert.deepEqual(
        audit
          .prepare(
            "SELECT run_attempt_id, response_id, input_tokens, cached_input_tokens, output_tokens FROM run_attempt_usage",
          )
          .all()
          .map((row) => ({ ...row })),
        [
          {
            cached_input_tokens: 400,
            input_tokens: 500,
            output_tokens: 20,
            response_id: "response-1",
            run_attempt_id: runAttemptId,
          },
        ],
      );
      assert.deepEqual(
        audit
          .prepare(
            "SELECT run_attempt_id, reason, occurrences FROM run_attempt_usage_gaps ORDER BY reason",
          )
          .all()
          .map((row) => ({ ...row })),
        [
          {
            occurrences: 1,
            reason: "correction_frame",
            run_attempt_id: runAttemptId,
          },
          {
            occurrences: 1,
            reason: "parse_error",
            run_attempt_id: runAttemptId,
          },
        ],
      );
    } finally {
      audit.close();
    }
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

for (const alive of [false, true])
  test(`AgentHost ${alive ? "retains a live runtime across watchdog intervals" : "cancels an unresponsive runtime, records timeout, and requeues"}`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "rah-os-agent-host-timeout-"));
    try {
      const kernel = new RoomKernel({
        databasePath: join(directory, "room.db"),
      });
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

      let finish!: (exit: { code: number }) => void;
      const completion = new Promise<{ code: number }>((resolve) => {
        finish = resolve;
      });
      const runtime = Object.assign(
        new FakeRuntimeAdapter({
          onReap: async () => await completion,
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
        }),
        { isAlive: async () => alive },
      );
      let intervals = 0;
      const host = new AgentHost({
        host: authenticateHost(kernel, "timeout-host", [
          agentProvisioning.principal.principalId,
        ]),
        kernel,
        leaseMs: 30_000,
        maintenanceWait: waitUntilAborted,
        runTimeoutMs: 60_000,
        runtime,
        timeoutWait: async (_delay, signal) => {
          if (++intervals === 3) {
            finish({ code: 0 });
            await waitUntilAborted(_delay, signal);
          }
        },
      });

      const result = await host.reconcileOnce();

      if (alive) {
        assert.equal(result.state, "completed");
        assert.equal(intervals, 3);
        assert.equal(runtime.cancellations.length, 0);
        assert.equal(kernel.listRunAttempts({ roomId: room.roomId }).length, 1);
        assert.equal(
          kernel.listActivations({ roomId: room.roomId })[0]?.state,
          "completed",
        );
      } else {
        assert.equal(result.state, "failed");
        assert.match(
          result.state === "failed" ? result.error : "",
          /timed out/i,
        );
        assert.equal(runtime.cancellations.length, 1);
        assert.equal(
          kernel.listRunAttempts({ roomId: room.roomId })[0]?.state,
          "timed_out",
        );
        assert.equal(
          kernel.listActivations({ roomId: room.roomId })[0]?.state,
          "queued",
        );
      }

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

test("session binding failure quarantines even when the process exits zero", async () => {
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
      code: 0,
      failure: classifyRuntimeFailure(
        "RAH_SESSION_CONTINUITY_REQUIRED: session binding rejected",
      ),
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

test("missing session binding at startup quarantines without a retry loop", async () => {
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
    const runtime = new FakeRuntimeAdapter({
      onStart: () => {
        throw new Error(
          "RAH_SESSION_CONTINUITY_REQUIRED: missing binding before spawn",
        );
      },
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

for (const [label, finalReplyCommitted, expected] of [
  ["completes without re-executing", true, "completed"],
  ["is retried as a failure", false, "failed"],
] as const) {
  test(`S2-b: a run the Host killed after a stall ${finalReplyCommitted ? "with" : "without"} a committed final reply ${label}`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "rah-os-agent-host-final-"));
    try {
      const kernel = new RoomKernel({
        databasePath: join(directory, "room.db"),
      });
      kernel.initialize();
      const human = kernel.provisionPrincipal({ handle: "h", kind: "human" });
      const agent = kernel.provisionPrincipal({ handle: "a", kind: "agent" });
      const humanActor = kernel.authenticateAccessToken(human.accessToken);
      const agentActor = kernel.authenticateAccessToken(agent.accessToken);
      const room = kernel.createRoom(humanActor, { name: "F", slug: "f" });
      kernel.addMember(humanActor, {
        principalId: agent.principal.principalId,
        roomId: room.roomId,
      });
      kernel.postMessage(humanActor, {
        body: "answer",
        idempotencyKey: "final-stall",
        recipients: [
          { participantId: agent.principal.principalId, reason: "mention" },
        ],
        roomId: room.roomId,
      });
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
      // A proven SIGKILL of a wedged runtime: a real exit, never success.
      runtime.enqueueExit({
        code: null,
        signal: "SIGKILL",
        ...(finalReplyCommitted ? { finalReplyCommitted: true } : {}),
      });
      const host = new AgentHost({
        host: authenticateHost(kernel, "final-host", [
          agent.principal.principalId,
        ]),
        kernel,
        leaseMs: 30_000,
        runtime,
      });
      const result = await host.reconcileOnce();
      assert.equal(result.state, expected, JSON.stringify(result));
      assert.equal(runtime.starts.length, 1);
      const [run] = kernel.listRunAttempts({ roomId: room.roomId });
      assert.equal(run?.exitSignal, "SIGKILL", "the real exit is kept");
      assert.equal(
        kernel.listActivations({ roomId: room.roomId })[0]?.state,
        finalReplyCommitted ? "completed" : "queued",
      );
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
}

/**
 * Real Claude smoke 2026-09-25 (cold, Haiku): the RunAttempt had committed its
 * `--final` reply (Kernel marker) and delivery was acknowledged through
 * `toSeq`, yet the run exited 1 and the Activation was retried twice into
 * duplicate replies and quarantined. A reply that is committed and
 * acknowledged is a finished obligation: the Host completes the Activation
 * (the Kernel still proves ACK through `toSeq`); the failed exit stays on the
 * RunAttempt as recorded. Without the marker, or without the ACK, the normal
 * retry applies.
 */
for (const [label, marker, acknowledged, expected] of [
  [
    "with the final marker and ACK completes without re-executing",
    true,
    true,
    "completed",
  ],
  ["with a legacy final marker but no ACK is retried", true, false, "queued"],
  ["with ACK but no final marker is retried", false, true, "queued"],
] as const) {
  test(`a run that exits 1 ${label}`, async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "rah-os-agent-host-final-exit-"),
    );
    try {
      const kernel = new RoomKernel({
        databasePath: join(directory, "room.db"),
      });
      kernel.initialize();
      const human = kernel.provisionPrincipal({ handle: "h", kind: "human" });
      const agent = kernel.provisionPrincipal({ handle: "a", kind: "agent" });
      const humanActor = kernel.authenticateAccessToken(human.accessToken);
      const agentActor = kernel.authenticateAccessToken(agent.accessToken);
      const room = kernel.createRoom(humanActor, { name: "F", slug: "f" });
      kernel.addMember(humanActor, {
        principalId: agent.principal.principalId,
        roomId: room.roomId,
      });
      kernel.postMessage(humanActor, {
        body: "answer",
        idempotencyKey: "final-exit",
        recipients: [
          { participantId: agent.principal.principalId, reason: "mention" },
        ],
        roomId: room.roomId,
      });
      const runtime = new FakeRuntimeAdapter({
        onStart: (input) => {
          const delivery = kernel.sync(agentActor, {
            consumerId: input.consumerId,
            roomId: input.roomId,
          });
          if (acknowledged) {
            kernel.acknowledgeCursor(agentActor, {
              consumerId: input.consumerId,
              roomId: input.roomId,
              throughSeq: delivery.cursorAfter,
            });
          }
          const reply = kernel.postMessage(agentActor, {
            basedOnRoomSeq: delivery.cursorAfter,
            body: "FAKE final reply",
            idempotencyKey: `reply-${input.runAttemptId}`,
            recipients: [],
            roomId: input.roomId,
          });
          if (marker && !acknowledged) {
            // Historical database state written before final ACK admission was
            // enforced. Seed only its old marker, never fake a delivery ACK.
            const legacy = new DatabaseSync(join(directory, "room.db"));
            try {
              legacy
                .prepare(
                  `INSERT INTO run_attempt_final_replies
                (run_attempt_id,activation_id,room_id,event_id,room_seq,committed_at)
                VALUES (?,?,?,?,?,?)`,
                )
                .run(
                  input.runAttemptId,
                  input.activationId,
                  input.roomId,
                  reply.event.eventId,
                  reply.event.roomSeq,
                  new Date().toISOString(),
                );
            } finally {
              legacy.close();
            }
          } else if (marker)
            kernel.finalReplies.recordInTransaction(
              {
                activationId: input.activationId,
                consumerId: input.consumerId,
                hostId: input.hostId,
                participantId: input.participantId,
                roomId: input.roomId,
                runAttemptId: input.runAttemptId,
                toSeq: input.toSeq,
              },
              reply.event,
            );
        },
      });
      // The CLI's exit after its interrupted, committed final turn.
      runtime.enqueueExit({ code: 1 });
      const host = new AgentHost({
        host: authenticateHost(kernel, "final-exit-host", [
          agent.principal.principalId,
        ]),
        kernel,
        leaseMs: 30_000,
        runtime,
      });
      const result = await host.reconcileOnce();
      assert.equal(
        result.state,
        expected === "completed" ? "completed" : "failed",
        JSON.stringify(result),
      );
      assert.equal(runtime.starts.length, 1);
      const [run] = kernel.listRunAttempts({ roomId: room.roomId });
      assert.equal(run?.exitCode, 1, "the real exit is kept");
      const activation = kernel.listActivations({ roomId: room.roomId })[0];
      assert.equal(activation?.state, expected);
      assert.equal(activation?.attemptCount, 1);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
}

/**
 * Eighth review P2-2, retained for the pending-presented-delivery race:
 * a model-confirmed final can commit before the Host marks the full wake sent.
 * If sent proof never arrives and the runtime exits 1, delivery remains unACKed
 * and the existing recovery retries; the retry reason is the
 * Kernel's completion refusal (delivery not acknowledged) with the run
 * failure kept for diagnosis, so the next wake names the already committed
 * reply. After the retry only checks and acknowledges, the Room holds one
 * reply.
 */
test("a run that exits 1 after a pending-delivery final with delayed Host sent proof retries with the existing reply; the retry's check leaves one reply", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "rah-os-agent-host-final-noack-"),
  );
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  kernel.initialize();
  const worker = new WorkerApplicationService({ kernel });
  await worker.start();
  try {
    const human = kernel.provisionPrincipal({ handle: "h", kind: "human" });
    const agent = kernel.provisionPrincipal({ handle: "a", kind: "agent" });
    const agentId = agent.principal.principalId;
    const humanActor = kernel.authenticateAccessToken(human.accessToken);
    const room = kernel.createRoom(humanActor, { name: "F", slug: "f" });
    kernel.addMember(humanActor, { principalId: agentId, roomId: room.roomId });
    kernel.postMessage(humanActor, {
      body: "answer",
      idempotencyKey: "final-noack",
      recipients: [{ participantId: agentId, reason: "mention" }],
      roomId: room.roomId,
    });
    const host = authenticateHost(kernel, "final-noack-host", [agentId]);
    let firstReplyId: string | undefined;
    let presentedRetry: Record<string, unknown> | undefined;
    const call = async (token: string, path: string, body: unknown = {}) => {
      const response = await fetch(`${worker.origin}/v1/worker/${path}`, {
        body: JSON.stringify(body),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        method: "POST",
      });
      const parsed = (await response.json()) as Record<string, any>;
      assert.equal(response.status, 200, JSON.stringify(parsed));
      return parsed;
    };
    const runtime = new FakeRuntimeAdapter({
      onStart: async (input) => {
        const { accessToken } = worker.issueActivationCredential(host, input);
        if (firstReplyId === undefined) {
          await call(accessToken, "message-present");
          // A fully presented wake and model-confirmed seq permit the final,
          // but the Host's sent proof has not arrived. Keep ACK genuinely absent
          // to exercise the existing residual-race recovery, not a refused write.
          const posted = await call(accessToken, "messages/post", {
            body: "FAKE final reply",
            basedOnRoomSeq: input.toSeq,
            final: true,
          });
          assert.ok(posted.event, JSON.stringify(posted));
          firstReplyId = posted.event.aggregateId;
          return;
        }
        presentedRetry = await call(accessToken, "message-present");
        const check = await call(accessToken, "message-check");
        await call(accessToken, "acknowledge", {
          throughSeq: check.delivery.cursorAfter,
        });
      },
    });
    runtime.enqueueExit({ code: 1 });
    runtime.enqueueExit({ code: 0 });
    const agentHost = new AgentHost({
      host,
      kernel,
      leaseMs: 30_000,
      retryAfterMs: 0,
      runtime,
    });
    const first = await agentHost.reconcileOnce();
    assert.equal(first.state, "failed", JSON.stringify(first));
    const [activation] = kernel.listActivations({ roomId: room.roomId });
    assert.equal(activation?.state, "queued");
    assert.match(
      String(activation?.lastError),
      /not acknowledged/u,
      "the retry reason is the Kernel's completion refusal",
    );
    assert.match(
      String(activation?.lastError),
      /exited with code 1/u,
      "the run failure is kept for diagnosis",
    );
    const second = await agentHost.reconcileOnce();
    assert.equal(second.state, "completed", JSON.stringify(second));
    assert.equal(presentedRetry?.previousAttemptReplyMessageId, firstReplyId);
    assert.equal(presentedRetry?.previousAttemptReplyFinal, true);
    const replies = kernel
      .sync(humanActor, { consumerId: "audit", roomId: room.roomId })
      .events.filter(
        (event) => event.type === "message.posted" && event.actorId === agentId,
      );
    assert.equal(replies.length, 1, "one reply in the Room");
  } finally {
    await worker.close();
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

/**
 * Acceptance follow-up 1: a run that ends cleanly without a reply or a
 * delivery confirmation is retried by the Host loop straight away. With the
 * fake clock advanced only by the loop's own waits, the retry must start at
 * the instant the first attempt finished, not after the backoff plus a poll.
 */
test("the Host loop starts the retry of a clean exit that neither posted nor acknowledged without any idle wait", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "rah-os-agent-host-unconfirmed-"),
  );
  let nowMs = Date.parse("2026-09-25T12:00:00.000Z");
  const kernel = new RoomKernel({
    databasePath: join(directory, "room.db"),
    now: () => new Date(nowMs),
  });
  kernel.initialize();
  try {
    const human = kernel.provisionPrincipal({ handle: "h", kind: "human" });
    const agent = kernel.provisionPrincipal({ handle: "a", kind: "agent" });
    const agentId = agent.principal.principalId;
    const humanActor = kernel.authenticateAccessToken(human.accessToken);
    const agentActor = kernel.authenticateAccessToken(agent.accessToken);
    const room = kernel.createRoom(humanActor, { name: "U", slug: "u" });
    kernel.addMember(humanActor, { principalId: agentId, roomId: room.roomId });
    kernel.postMessage(humanActor, {
      body: "answer",
      idempotencyKey: "unconfirmed",
      recipients: [{ participantId: agentId, reason: "mention" }],
      roomId: room.roomId,
    });
    let starts = 0;
    const runtime = new FakeRuntimeAdapter({
      onStart: (input) => {
        starts += 1;
        if (starts === 1) return; // plain-text answer: no post, no check
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
    runtime.enqueueExit({ code: 0 });
    runtime.enqueueExit({ code: 0 });
    const abortController = new AbortController();
    const waited: number[] = [];
    const agentHost = new AgentHost({
      host: authenticateHost(kernel, "unconfirmed-host", [agentId]),
      kernel,
      leaseMs: 30_000,
      pollIntervalMs: 30_000,
      retryAfterMs: 10_000,
      retryJitterRatio: 0,
      runtime,
      wait: async (delayMs) => {
        waited.push(delayMs);
        nowMs += delayMs;
        const done = kernel
          .listActivations({ roomId: room.roomId })
          .every((activation) => activation.state === "completed");
        if (done || waited.length > 5) abortController.abort();
      },
    });
    await agentHost.run({ signal: abortController.signal });
    const [activation] = kernel.listActivations({ roomId: room.roomId });
    assert.equal(activation?.state, "completed");
    const attempts = kernel
      .listRunAttempts({ roomId: room.roomId })
      .sort((a, b) => a.attemptNumber - b.attemptNumber);
    assert.equal(attempts.length, 2);
    assert.equal(
      Date.parse(attempts[1]!.startedAt) - Date.parse(attempts[0]!.finishedAt!),
      0,
      "no backoff or poll wait between the attempts",
    );
    assert.deepEqual(
      waited.slice(0, 1),
      [30_000],
      "the only wait is the idle poll after completion",
    );
    assert.equal(waited.length, 1);
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("D2-1: a business-obligation completion refusal after a committed final reply is not re-executed; it needs Human action", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "rah-os-agent-host-final-obligation-"),
  );
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  kernel.initialize();
  const worker = new WorkerApplicationService({ kernel });
  await worker.start();
  try {
    const human = kernel.provisionPrincipal({ handle: "h", kind: "human" });
    const agent = kernel.provisionPrincipal({ handle: "a", kind: "agent" });
    const agentId = agent.principal.principalId;
    const humanActor = kernel.authenticateAccessToken(human.accessToken);
    const room = kernel.createRoom(humanActor, { name: "F", slug: "f" });
    kernel.addMember(humanActor, { principalId: agentId, roomId: room.roomId });
    const assigned = kernel.createTask(humanActor, {
      assigneeId: agentId,
      idempotencyKey: "assigned-obligation",
      roomId: room.roomId,
      title: "Assigned work",
    });
    const host = authenticateHost(kernel, "final-obligation-host", [agentId]);
    let starts = 0;
    const call = async (token: string, path: string, body: unknown = {}) => {
      const response = await fetch(`${worker.origin}/v1/worker/${path}`, {
        body: JSON.stringify(body),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        method: "POST",
      });
      const parsed = (await response.json()) as Record<string, any>;
      assert.equal(response.status, 200, JSON.stringify(parsed));
      return parsed;
    };
    const runtime = new FakeRuntimeAdapter({
      onStart: async (input) => {
        starts += 1;
        const { accessToken } = worker.issueActivationCredential(host, input);
        const check = await call(accessToken, "message-check");
        await call(accessToken, "acknowledge", {
          throughSeq: check.delivery.cursorAfter,
        });
        await call(accessToken, "messages/post", {
          body: "FAKE final reply",
          channel: "#f",
          final: true,
          threadId: assigned.task.threadId,
        });
      },
    });
    runtime.enqueueExit({ code: 0 });
    const agentHost = new AgentHost({
      host,
      kernel,
      leaseMs: 30_000,
      retryAfterMs: 0,
      runtime,
    });
    const first = await agentHost.reconcileOnce();
    assert.equal(first.state, "failed", JSON.stringify(first));
    const [activation] = kernel.listActivations({ roomId: room.roomId });
    assert.match(String(activation?.lastError), /unfinished Task/u);
    assert.equal(activation?.state, "quarantined");
    const events = kernel.sync(humanActor, {
      consumerId: "audit",
      roomId: room.roomId,
    }).events;
    const blocked = events.find(
      (event) => event.type === "activation.retry_blocked",
    );
    assert.equal(blocked?.payload.retryDisposition, "action_required");
    assert.equal(
      events.some((event) => event.type === "activation.retry_scheduled"),
      false,
    );
    const idle = await agentHost.reconcileOnce();
    assert.equal(idle.state, "idle", JSON.stringify(idle));
    assert.equal(starts, 1, "the turn is never re-executed");
  } finally {
    await worker.close();
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("review round 2 P1-2: paused admission claims nothing until resumed", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-agent-host-pause-"));
  try {
    const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
    kernel.initialize();
    const human = kernel.provisionPrincipal({
      handle: "pause-human",
      kind: "human",
    });
    const agent = kernel.provisionPrincipal({
      handle: "pause-agent",
      kind: "agent",
    });
    const humanActor = kernel.authenticateAccessToken(human.accessToken);
    const room = kernel.createRoom(humanActor, {
      name: "Pause",
      slug: "pause",
    });
    kernel.addMember(humanActor, {
      principalId: agent.principal.principalId,
      roomId: room.roomId,
    });
    kernel.postMessage(humanActor, {
      body: "queued while an update restart prepares",
      idempotencyKey: "pause-message",
      recipients: [
        { participantId: agent.principal.principalId, reason: "mention" },
      ],
      roomId: room.roomId,
    });
    const runtime = new FakeRuntimeAdapter({});
    const host = new AgentHost({
      host: authenticateHost(kernel, "pause-host", [
        agent.principal.principalId,
      ]),
      kernel,
      leaseMs: 30_000,
      runtime,
    });
    await host.pauseAdmission();
    assert.equal((await host.reconcileOnce()).state, "idle");
    assert.equal(runtime.starts.length, 0);
    assert.equal(
      kernel.listActivations({ roomId: room.roomId })[0]?.state,
      "queued",
    );
    host.resumeAdmission();
    await host.reconcileOnce();
    assert.equal(
      runtime.starts.length,
      1,
      "resumed admission claims the queued work",
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
