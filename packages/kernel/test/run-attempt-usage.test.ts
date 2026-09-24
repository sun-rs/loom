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

function gap(
  state: ReturnType<typeof fixture>,
  reason: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    provider: "codex-app-server/v1",
    reason,
    observedAt: "2026-09-24T01:00:06.000Z",
    runAttemptId: state.runAttemptId,
    runtimeRunId: state.runtimeRunId,
    ...overrides,
  } as Parameters<RoomKernel["runAttemptUsage"]["recordGap"]>[1];
}

const read = (state: ReturnType<typeof fixture>) =>
  state.kernel.runAttemptUsage.get(state.ownerActor, {
    agentId: state.agentId,
    runAttemptId: state.runAttemptId,
  });

test("no recorded usage is unavailable with unknown totals, never zero", () => {
  const state = fixture();
  try {
    const summary = read(state);
    assert.equal(summary.completeness, "unavailable");
    assert.deepEqual(summary.gaps, []);
    assert.deepEqual(summary.totals, {
      generations: null,
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      reasoningOutputTokens: null,
    });
  } finally {
    state.cleanup();
  }
});

test("review sequence: a gap between recorded generations makes usage partial", () => {
  const state = fixture();
  try {
    const { kernel, host } = state;
    const frame = { inputTokens: 100, cachedInputTokens: 0, outputTokens: 10 };
    kernel.runAttemptUsage.record(
      host,
      usage(state, "turn-1:110", { ...frame, reasoningOutputTokens: 0 }),
    );
    kernel.runAttemptUsage.recordGap(host, gap(state, "inconsistent_total"));
    kernel.runAttemptUsage.record(
      host,
      usage(state, "turn-1:440", {
        ...frame,
        reasoningOutputTokens: 0,
        observedAt: "2026-09-24T01:00:07.000Z",
      }),
    );
    const summary = read(state);
    assert.equal(summary.completeness, "partial");
    // Observed sums only; the missing 200 input tokens are not invented.
    assert.equal(summary.totals.generations, 2);
    assert.equal(summary.totals.inputTokens, 200);
    assert.deepEqual(summary.gaps, [
      {
        reason: "inconsistent_total",
        provider: "codex-app-server/v1",
        occurrences: 1,
        firstObservedAt: "2026-09-24T01:00:06.000Z",
        lastObservedAt: "2026-09-24T01:00:06.000Z",
      },
    ]);
  } finally {
    state.cleanup();
  }
});

test("repeated correction frames aggregate into one partial-usage gap", () => {
  const state = fixture();
  try {
    const { kernel, host } = state;
    kernel.runAttemptUsage.record(host, usage(state, "turn-1:1060"));
    kernel.runAttemptUsage.recordGap(host, gap(state, "correction_frame"));
    kernel.runAttemptUsage.recordGap(
      host,
      gap(state, "correction_frame", {
        observedAt: "2026-09-24T01:00:09.000Z",
      }),
    );
    const summary = read(state);
    assert.equal(summary.completeness, "partial");
    assert.deepEqual(
      summary.gaps.map((item) => [
        item.reason,
        item.occurrences,
        item.lastObservedAt,
      ]),
      [["correction_frame", 2, "2026-09-24T01:00:09.000Z"]],
    );
    assert.throws(
      () =>
        kernel.runAttemptUsage.recordGap(
          state.otherHost,
          gap(state, "parse_error"),
        ),
      ForbiddenError,
    );
    assert.throws(
      () =>
        kernel.runAttemptUsage.recordGap(
          host,
          gap(state, "parse_error", { runtimeRunId: "other-runtime" }),
        ),
      ConflictError,
    );
    assert.throws(
      () => kernel.runAttemptUsage.recordGap(host, gap(state, "guessed")),
      /reason/u,
    );
  } finally {
    state.cleanup();
  }
});

test("an unsupported Provider (Kimi ACP) reports unavailable usage with its reason", () => {
  const state = fixture();
  try {
    state.kernel.runAttemptUsage.recordGap(
      state.host,
      gap(state, "unsupported_provider", { provider: "kimi-acp/v1" }),
    );
    const summary = read(state);
    assert.equal(summary.completeness, "unavailable");
    assert.equal(summary.totals.inputTokens, null);
    assert.deepEqual(
      summary.gaps.map((item) => [item.reason, item.provider]),
      [["unsupported_provider", "kimi-acp/v1"]],
    );
  } finally {
    state.cleanup();
  }
});

test("schema 61 adds run_attempt_usage keyed by RunAttempt and response", () => {
  const state = fixture();
  try {
    assert.equal(KERNEL_SCHEMA_VERSION, 63);
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
      assert.deepEqual(
        database
          .prepare("PRAGMA table_info(run_attempt_usage_gaps)")
          .all()
          .map((row) => [row.name, row.pk]),
        [
          ["run_attempt_id", 1],
          ["reason", 2],
          ["provider", 0],
          ["occurrences", 0],
          ["first_observed_at", 0],
          ["last_observed_at", 0],
          ["recorded_at", 0],
        ],
      );
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
    assert.equal(summary.completeness, "complete");
    assert.deepEqual(summary.gaps, []);
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
    kernel.runAttemptUsage.recordGap(host, gap(state, "correction_frame"));
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
    assert.throws(
      () => kernel.runAttemptUsage.recordGap(host, gap(state, "parse_error")),
      ConflictError,
      "a finished RunAttempt accepts no late gap either",
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
      assert.equal(
        audit
          .prepare("SELECT COUNT(*) AS count FROM run_attempt_usage_gaps")
          .get()!.count,
        0,
      );
    } finally {
      audit.close();
    }
  } finally {
    state.cleanup();
  }
});

test("a schema 60 database upgrades to the current schema without touching existing RunAttempts", () => {
  const state = fixture();
  const { databasePath, runAttemptId } = state;
  state.kernel.close();
  try {
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(
      "DROP TABLE run_attempt_usage_gaps; DROP TABLE run_attempt_usage; PRAGMA user_version = 60;",
    );
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
        63,
      );
      assert.equal(
        database
          .prepare("SELECT COUNT(*) AS count FROM run_attempt_usage_gaps")
          .get()!.count,
        0,
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
