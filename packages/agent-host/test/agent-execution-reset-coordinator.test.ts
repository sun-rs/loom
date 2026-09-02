import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AgentExecutionResetCoordinator,
  createAgentExecutionResetFenceAcquirer,
} from "../src/agent-execution-reset-coordinator.ts";

test("restart preserves Provider continuity and replays one terminal receipt", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "rah-execution-restart-"));
  const calls: string[] = [];
  const coordinator = new AgentExecutionResetCoordinator({
    acquireFence: async (participantId, operationId) => {
      calls.push(`acquire:${participantId}:${operationId}`);
      return {
        release: async () => {
          calls.push(`release:${operationId}`);
        },
      };
    },
    computerHostId: "host-local",
    now: () => new Date("2026-09-01T02:00:00.000Z"),
    quarantineProviderContinuity: async () => {
      calls.push("unexpected-quarantine");
      throw new Error("restart must preserve Provider continuity");
    },
    rootDirectory,
  });

  const first = await coordinator.reset({
    agentDefinitionId: "agent-definition-1",
    mode: "restart",
    operationId: "operation-1",
    ownerParticipantId: "agent-1",
  });
  const replay = await coordinator.reset({
    agentDefinitionId: "agent-definition-1",
    mode: "restart",
    operationId: "operation-1",
    ownerParticipantId: "agent-1",
  });

  assert.deepEqual(calls, [
    "acquire:agent-1:operation-1",
    "release:operation-1",
  ]);
  assert.equal(first.deduplicated, false);
  assert.equal(replay.deduplicated, true);
  assert.equal(first.providerContinuityRecords, 0);
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(rootDirectory, ".receipts", "operation-1.json"),
        "utf8",
      ),
    ).mode,
    "restart",
  );
});

test("session reset quarantines Provider continuity exactly once", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "rah-execution-session-"));
  let quarantineCount = 0;
  let releaseCount = 0;
  const coordinator = new AgentExecutionResetCoordinator({
    acquireFence: async () => ({
      release: async () => {
        releaseCount += 1;
      },
    }),
    computerHostId: "host-local",
    now: () => new Date("2026-09-01T02:05:00.000Z"),
    quarantineProviderContinuity: async (participantId, operationId) => {
      quarantineCount += 1;
      assert.equal(participantId, "agent-1");
      assert.equal(operationId, "operation-2");
      return { recordCount: 3, rollback: async () => undefined };
    },
    rootDirectory,
  });

  const result = await coordinator.reset({
    agentDefinitionId: "agent-definition-1",
    mode: "session",
    operationId: "operation-2",
    ownerParticipantId: "agent-1",
  });
  const replay = await coordinator.reset({
    agentDefinitionId: "agent-definition-1",
    mode: "session",
    operationId: "operation-2",
    ownerParticipantId: "agent-1",
  });

  assert.equal(quarantineCount, 1);
  assert.equal(releaseCount, 1);
  assert.equal(result.providerContinuityRecords, 3);
  assert.equal(replay.deduplicated, true);
});

test("full reset composes workspace and Provider continuity under one execution fence", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "rah-execution-full-"));
  const calls: string[] = [];
  const coordinator = new AgentExecutionResetCoordinator({
    acquireFence: async () => {
      calls.push("acquire");
      return {
        release: async () => {
          calls.push("release");
        },
      };
    },
    computerHostId: "host-local",
    quarantineAgentWorkspace: async (participantId, operationId) => {
      calls.push(`workspace:${participantId}:${operationId}`);
      return {
        commit: () => {
          calls.push("workspace:commit");
        },
        rollback: async () => {
          calls.push("workspace:rollback");
        },
      };
    },
    quarantineProviderContinuity: async () => {
      calls.push("continuity");
      return {
        recordCount: 2,
        rollback: async () => {
          calls.push("continuity:rollback");
        },
      };
    },
    rootDirectory,
  });

  const result = await coordinator.reset(
    {
      agentDefinitionId: "agent-definition-1",
      mode: "full",
      operationId: "operation-full-1",
      ownerParticipantId: "agent-1",
    },
    {
      afterContinuity: async () => {
        calls.push("enable");
      },
    },
  );

  assert.equal(result.mode, "full");
  assert.equal(result.providerContinuityRecords, 2);
  assert.deepEqual(calls, [
    "acquire",
    "workspace:agent-1:operation-full-1",
    "continuity",
    "enable",
    "workspace:commit",
    "release",
  ]);
});

test("full reset rolls continuity and workspace back before releasing its fence", async () => {
  const rootDirectory = await mkdtemp(
    join(tmpdir(), "rah-execution-full-rollback-"),
  );
  const calls: string[] = [];
  const coordinator = new AgentExecutionResetCoordinator({
    acquireFence: async () => ({
      release: async () => {
        calls.push("release");
      },
    }),
    computerHostId: "host-local",
    quarantineAgentWorkspace: async () => ({
      commit: () => {
        calls.push("workspace:commit");
      },
      rollback: async () => {
        calls.push("workspace:rollback");
      },
    }),
    quarantineProviderContinuity: async () => ({
      recordCount: 1,
      rollback: async () => {
        calls.push("continuity:rollback");
      },
    }),
    rootDirectory,
  });

  await assert.rejects(
    coordinator.reset(
      {
        agentDefinitionId: "agent-definition-1",
        mode: "full",
        operationId: "operation-full-rollback",
        ownerParticipantId: "agent-1",
      },
      {
        afterContinuity: async () => Promise.reject(new Error("enable failed")),
      },
    ),
    /enable failed/u,
  );
  assert.deepEqual(calls, [
    "continuity:rollback",
    "workspace:rollback",
    "release",
  ]);
});

test("continuity failure rolls back and releases only after rollback succeeds", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "rah-execution-failure-"));
  const calls: string[] = [];
  const coordinator = new AgentExecutionResetCoordinator({
    acquireFence: async () => ({
      release: async () => {
        calls.push("release");
      },
    }),
    computerHostId: "host-local",
    quarantineProviderContinuity: async () => {
      calls.push("quarantine");
      return {
        recordCount: 1,
        rollback: async () => {
          calls.push("rollback");
        },
      };
    },
    rootDirectory,
  });

  await assert.rejects(
    coordinator.reset(
      {
        agentDefinitionId: "agent-definition-1",
        mode: "session",
        operationId: "operation-3",
        ownerParticipantId: "agent-1",
      },
      { afterContinuity: () => Promise.reject(new Error("receipt failed")) },
    ),
    /receipt failed/,
  );
  assert.deepEqual(calls, ["quarantine", "rollback", "release"]);
});

test("an idempotency operation cannot change Agent or mode", async () => {
  const rootDirectory = await mkdtemp(
    join(tmpdir(), "rah-execution-conflict-"),
  );
  const coordinator = new AgentExecutionResetCoordinator({
    acquireFence: async () => ({ release: async () => undefined }),
    computerHostId: "host-local",
    quarantineProviderContinuity: async () => ({
      recordCount: 0,
      rollback: async () => undefined,
    }),
    rootDirectory,
  });
  await coordinator.reset({
    agentDefinitionId: "agent-definition-1",
    mode: "restart",
    operationId: "operation-4",
    ownerParticipantId: "agent-1",
  });
  await assert.rejects(
    coordinator.reset({
      agentDefinitionId: "agent-definition-1",
      mode: "session",
      operationId: "operation-4",
      ownerParticipantId: "agent-1",
    }),
    /immutable identity/,
  );
});

test("execution reset fence waits for terminal proof instead of bypassing an active lane", async () => {
  let attempts = 0;
  let releases = 0;
  const acquire = createAgentExecutionResetFenceAcquirer(
    {
      acquireAgentExclusiveOperationLease: async () => {
        attempts += 1;
        if (attempts < 3) {
          const conflict = new Error(
            "Agent still has an active RuntimeProcess",
          );
          Object.assign(conflict, { code: "conflict" });
          throw conflict;
        }
        return {
          acquiredAt: "2026-09-01T02:00:00.000Z",
          kind: "execution_restart",
          leaseId: "lease-1",
          leaseUntil: "2026-09-01T02:00:30.000Z",
          operationId: "operation-5",
          ownerHostId: "host-local",
          ownerHostInstanceId: "host-instance",
          participantId: "agent-1",
          renewedAt: "2026-09-01T02:00:00.000Z",
          schemaVersion: 1,
          state: "active",
        };
      },
      releaseAgentExclusiveOperationLease: async () => {
        releases += 1;
        return {} as never;
      },
    },
    {
      retryDelayMs: 1,
      timeoutMs: 100,
      wait: async () => undefined,
    },
  );
  const fence = await acquire("agent-1", "operation-5");
  await fence.release();
  assert.equal(attempts, 3);
  assert.equal(releases, 1);
});
