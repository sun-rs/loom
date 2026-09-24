import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  ConflictError,
  ForbiddenError,
  KERNEL_SCHEMA_VERSION,
  NotFoundError,
  RoomKernel,
} from "../src/index.ts";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-run-usage-"));
  let nowMs = Date.parse("2026-09-24T01:00:00.000Z");
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath, now: () => new Date(nowMs) });
  kernel.initialize();
  const advance = () => {
    nowMs += 1_000;
  };
  const owner = kernel.provisionPrincipal({
    handle: "usage-owner",
    kind: "human",
  });
  const viewer = kernel.provisionPrincipal({
    handle: "usage-viewer",
    kind: "human",
  });
  const agent = kernel.provisionPrincipal({
    handle: "usage-agent",
    kind: "agent",
  });
  const ownerActor = kernel.authenticateAccessToken(owner.accessToken);
  const viewerActor = kernel.authenticateAccessToken(viewer.accessToken);
  const workspace = kernel.createWorkspace(ownerActor, {
    idempotencyKey: "usage-workspace",
    name: "Usage Workspace",
    slug: "usage-workspace",
  });
  const controlRoomId = workspace.controlRoom.roomId;
  const controlSeq = () =>
    kernel.sync(ownerActor, {
      afterSeq: 0,
      consumerId: `usage-seq-${nowMs}`,
      roomId: controlRoomId,
    }).latestRoomSeq;
  kernel.addMember(ownerActor, {
    principalId: viewer.principal.principalId,
    roomId: controlRoomId,
  });
  kernel.addMember(ownerActor, {
    principalId: agent.principal.principalId,
    roomId: controlRoomId,
  });
  advance();
  const policy = kernel.createExecutionPolicy(ownerActor, {
    basedOnRoomSeq: controlSeq(),
    controlRoomId,
    idempotencyKey: "usage-policy",
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
      artifactId: "usage-retry-policy",
      contentDigest: digest("f"),
      versionId: "usage-retry-policy-v1",
    },
    sessionPolicy: "prefer_resume",
  });
  advance();
  const definition = kernel.createAgentDefinition(ownerActor, {
    basedOnRoomSeq: policy.event.roomSeq,
    controlRoomId,
    executionPolicyRevisionId: policy.policy.executionPolicyRevisionId,
    idempotencyKey: "usage-agent-created",
    instructionRefs: [],
    memoryPolicyRef: {
      artifactId: "usage-memory-policy",
      contentDigest: digest("e"),
      versionId: "usage-memory-policy-v1",
    },
    participantId: agent.principal.principalId,
    role: "Usage Agent",
    skillRefs: [],
  });
  advance();
  const room = kernel.createWorkspaceRoom(ownerActor, {
    basedOnControlRoomSeq: definition.event.roomSeq,
    idempotencyKey: "usage-room",
    kind: "channel",
    name: "Usage Lab",
    slug: "usage-lab",
    workspaceId: workspace.workspace.workspaceId,
  }).room;
  kernel.onboardAgentToRoom(ownerActor, {
    agentId: definition.definition.agentId,
    basedOnRoomSeq: kernel.sync(ownerActor, {
      afterSeq: 0,
      consumerId: "usage-onboard",
      roomId: room.roomId,
    }).latestRoomSeq,
    idempotencyKey: "usage-onboarded",
    roomId: room.roomId,
  });
  advance();
  kernel.postRoomMessage(ownerActor, {
    body: "Please answer.",
    idempotencyKey: "usage-message",
    recipients: [],
    roomId: room.roomId,
  });
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "usage-host",
      participantIds: [agent.principal.principalId],
    }).accessToken,
  );
  const otherHost = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "usage-other-host",
      participantIds: [agent.principal.principalId],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  kernel.heartbeatHost(otherHost);
  advance();
  const activation = kernel.leaseNextActivation(host, { leaseMs: 30_000 });
  assert.ok(activation);
  const runAttempt = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  const runtimeRunId = "usage-runtime-run";
  kernel.prepareRunAttemptRuntime(host, {
    recoveryDescriptor: {
      driver: "test-runtime",
      metadata: {},
      recoveryKey: runtimeRunId,
    },
    runAttemptId: runAttempt.runAttemptId,
    runtimeRunId,
  });
  return {
    advance,
    agentId: definition.definition.agentId,
    cleanup() {
      kernel.close();
      rmSync(directory, { force: true, recursive: true });
    },
    databasePath,
    host,
    kernel,
    otherHost,
    ownerActor,
    roomId: room.roomId,
    runAttemptId: runAttempt.runAttemptId,
    runtimeRunId,
    viewerActor,
  };
}

function usage(
  state: ReturnType<typeof fixture>,
  responseId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    provider: "codex-app-server/v1",
    responseId,
    inputTokens: 1000,
    cachedInputTokens: 800,
    outputTokens: 60,
    reasoningOutputTokens: 20,
    contextWindow: 258400,
    contextUsedTokens: 1060,
    observedAt: "2026-09-24T01:00:05.000Z",
    runAttemptId: state.runAttemptId,
    runtimeRunId: state.runtimeRunId,
    ...overrides,
  };
}

test("schema 61 adds run_attempt_usage keyed by RunAttempt and response", () => {
  const state = fixture();
  try {
    assert.equal(KERNEL_SCHEMA_VERSION, 61);
    const database = new DatabaseSync(state.databasePath);
    try {
      const columns = database
        .prepare("PRAGMA table_info(run_attempt_usage)")
        .all()
        .map((row) => [row.name, row.pk]);
      assert.deepEqual(columns, [
        ["run_attempt_id", 1],
        ["response_id", 2],
        ["provider", 0],
        ["input_tokens", 0],
        ["cached_input_tokens", 0],
        ["output_tokens", 0],
        ["reasoning_output_tokens", 0],
        ["context_window", 0],
        ["context_used_tokens", 0],
        ["observed_at", 0],
        ["recorded_at", 0],
      ]);
    } finally {
      database.close();
    }
  } finally {
    state.cleanup();
  }
});

test("the owning Host records native usage idempotently per response id", () => {
  const state = fixture();
  try {
    const { kernel, host } = state;
    const first = kernel.runAttemptUsage.record(
      host,
      usage(state, "turn-1:1060"),
    );
    assert.equal(first.responseId, "turn-1:1060");
    assert.equal(first.runAttemptId, state.runAttemptId);
    assert.equal(first.recordedAt, "2026-09-24T01:00:05.000Z");
    state.advance();
    assert.deepEqual(
      kernel.runAttemptUsage.record(host, usage(state, "turn-1:1060")),
      first,
      "a replayed frame returns the immutable first fact",
    );
    assert.throws(
      () =>
        kernel.runAttemptUsage.record(
          host,
          usage(state, "turn-1:1060", { outputTokens: 61 }),
        ),
      ConflictError,
    );
    kernel.runAttemptUsage.record(
      host,
      usage(state, "turn-1:2200", {
        inputTokens: 1100,
        cachedInputTokens: 1000,
        outputTokens: 40,
        reasoningOutputTokens: 0,
        observedAt: "2026-09-24T01:00:06.000Z",
      }),
    );
    assert.throws(
      () =>
        kernel.runAttemptUsage.record(
          host,
          usage(state, "bad", { cachedInputTokens: 1001 }),
        ),
      /cachedInputTokens/u,
    );
    assert.throws(
      () =>
        kernel.runAttemptUsage.record(state.otherHost, usage(state, "foreign")),
      ForbiddenError,
    );
    assert.throws(
      () =>
        kernel.runAttemptUsage.record(
          host,
          usage(state, "wrong-runtime", { runtimeRunId: "other-runtime" }),
        ),
      ConflictError,
    );

    const summary = kernel.runAttemptUsage.get(state.ownerActor, {
      agentId: state.agentId,
      runAttemptId: state.runAttemptId,
    });
    assert.deepEqual(
      summary.generations.map((generation) => generation.responseId),
      ["turn-1:1060", "turn-1:2200"],
    );
    assert.deepEqual(summary.totals, {
      generations: 2,
      inputTokens: 2100,
      cachedInputTokens: 1800,
      outputTokens: 100,
      reasoningOutputTokens: 20,
    });
    assert.equal(summary.truncated, false);
  } finally {
    state.cleanup();
  }
});

test("usage reads stay inside the Human's visible Rooms and the Agent's own runs", () => {
  const state = fixture();
  try {
    const { kernel, host } = state;
    kernel.runAttemptUsage.record(
      host,
      usage(state, "msg_1", {
        provider: "claude-stream-json/v1",
        reasoningOutputTokens: null,
        contextWindow: null,
        contextUsedTokens: null,
      }),
    );
    assert.equal(
      kernel.runAttemptUsage.get(state.ownerActor, {
        agentId: state.agentId,
        runAttemptId: state.runAttemptId,
      }).totals.reasoningOutputTokens,
      null,
    );
    assert.throws(
      () =>
        kernel.runAttemptUsage.get(state.viewerActor, {
          agentId: state.agentId,
          runAttemptId: state.runAttemptId,
        }),
      NotFoundError,
      "a control-Room viewer must not read usage from an inaccessible work Room",
    );
    assert.throws(
      () =>
        kernel.runAttemptUsage.get(state.ownerActor, {
          agentId: state.agentId,
          runAttemptId: "missing-run",
        }),
      NotFoundError,
    );
  } finally {
    state.cleanup();
  }
});

test("finished RunAttempts accept no new usage and Channel deletion erases it", () => {
  const state = fixture();
  try {
    const { kernel, host } = state;
    kernel.runAttemptUsage.record(host, usage(state, "kept-until-delete"));
    kernel.recordRuntimeTermination(host, {
      exit: { code: 0 },
      runAttemptId: state.runAttemptId,
      runtimeRunId: state.runtimeRunId,
    });
    kernel.finishRunAttempt(host, {
      exitCode: 0,
      runAttemptId: state.runAttemptId,
      state: "exited",
    });
    assert.throws(
      () => kernel.runAttemptUsage.record(host, usage(state, "late")),
      ConflictError,
    );
    // Settle the Activation directly: deletion only requires inactive work.
    const database = new DatabaseSync(state.databasePath);
    database.exec("UPDATE activations SET state = 'completed'");
    database.close();
    kernel.deleteWorkspaceRoom(state.ownerActor, {
      basedOnRoomSeq: kernel.sync(state.ownerActor, {
        afterSeq: 0,
        consumerId: "usage-delete",
        roomId: state.roomId,
      }).latestRoomSeq,
      idempotencyKey: "usage-room-delete",
      roomId: state.roomId,
    });
    const audit = new DatabaseSync(state.databasePath, { readOnly: true });
    try {
      assert.equal(
        audit.prepare("SELECT COUNT(*) AS count FROM run_attempt_usage").get()!
          .count,
        0,
      );
    } finally {
      audit.close();
    }
  } finally {
    state.cleanup();
  }
});

test("a schema 60 database upgrades to 61 without touching existing RunAttempts", () => {
  const state = fixture();
  const { databasePath, runAttemptId } = state;
  state.kernel.close();
  try {
    const legacy = new DatabaseSync(databasePath);
    legacy.exec("DROP TABLE run_attempt_usage; PRAGMA user_version = 60;");
    legacy.close();
    assert.deepEqual(
      RoomKernel.inspectSchemaState(databasePath).databaseSchemaVersion,
      60,
    );
    const upgraded = new RoomKernel({ databasePath });
    assert.ok(upgraded.pendingSchemaChanges().length > 0);
    upgraded.initialize();
    upgraded.close();
    const database = new DatabaseSync(databasePath);
    try {
      assert.equal(
        database.prepare("PRAGMA user_version").get()!.user_version,
        61,
      );
      assert.equal(
        database
          .prepare("SELECT COUNT(*) AS count FROM run_attempt_usage")
          .get()!.count,
        0,
      );
      assert.equal(
        database.prepare("SELECT run_attempt_id FROM run_attempts").get()!
          .run_attempt_id,
        runAttemptId,
      );
    } finally {
      database.close();
    }
  } finally {
    rmSync(join(databasePath, ".."), { force: true, recursive: true });
  }
});
