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
    activation,
    advance,
    agentId: definition.definition.agentId,
    participantId: agent.principal.principalId,
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

test("contract §5: the usage read counts the run's observed native compactions; no trajectory is unknown, never zero", () => {
  const state = fixture();
  try {
    assert.equal(
      read(state).compactionCount,
      null,
      "a run without any runtime trajectory has an unknown compaction count",
    );
    let producerSequence = 0;
    const append = (entry: Record<string, unknown>) =>
      state.kernel.appendRunTrajectory(state.host, {
        entry: entry as never,
        observedAt: "2026-09-24T01:00:07.000Z",
        producerSequence: (producerSequence += 1),
        runAttemptId: state.runAttemptId,
        runtimeRunId: state.runtimeRunId,
      });
    append({ activity: "working", detailKind: "starting", kind: "status" });
    assert.equal(
      read(state).compactionCount,
      0,
      "an observed run with no compaction fact reports zero",
    );
    append({ kind: "compaction_started" });
    append({ kind: "compaction_finished" });
    append({ kind: "compaction_finished", producerFactId: "second" });
    // A subagent's own context is not this session's compaction.
    append({ kind: "compaction_finished", subagent: {} });
    assert.equal(read(state).compactionCount, 2);
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
    assert.equal(KERNEL_SCHEMA_VERSION, 76);
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
        76,
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

// S2-0 leftover-process cleanup records (schema 64).

function cleanup(
  state: ReturnType<typeof fixture>,
  cleanupId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    cleanupId,
    participantId: state.kernel.listRunAttempts({ roomId: state.roomId })[0]!
      .participantId,
    runAttemptId: state.runAttemptId,
    runtimeRunId: state.runtimeRunId,
    trigger: "run_end",
    foundCount: 2,
    killedCount: 2,
    remainingCount: 0,
    releasedPorts: [3000],
    remainingPorts: [],
    capExceeded: [],
    observedAt: "2026-09-24T01:00:07.000Z",
    ...overrides,
  } as Parameters<RoomKernel["runtimeProcessCleanup"]["record"]>[1];
}

test("S2-0 schema 64 records leftover cleanup per RunAttempt and exposes it on the usage read", () => {
  const state = fixture();
  try {
    assert.equal(KERNEL_SCHEMA_VERSION, 76);
    const recorded = state.kernel.runtimeProcessCleanup.record(
      state.host,
      cleanup(state, "cleanup-1"),
    );
    assert.equal(recorded.blocking, false);
    // Replay of the same id is idempotent; a different fact conflicts.
    state.kernel.runtimeProcessCleanup.record(
      state.host,
      cleanup(state, "cleanup-1"),
    );
    assert.throws(
      () =>
        state.kernel.runtimeProcessCleanup.record(
          state.host,
          cleanup(state, "cleanup-1", { killedCount: 1 }),
        ),
      ConflictError,
    );
    assert.throws(
      () =>
        state.kernel.runtimeProcessCleanup.record(
          state.otherHost,
          cleanup(state, "cleanup-foreign"),
        ),
      ForbiddenError,
    );
    const summary = read(state);
    assert.deepEqual(
      summary.processCleanups.map((entry) => ({
        found: entry.foundCount,
        killed: entry.killedCount,
        ports: entry.releasedPorts,
        remaining: entry.remainingCount,
        trigger: entry.trigger,
      })),
      [
        {
          found: 2,
          killed: 2,
          ports: [3000],
          remaining: 0,
          trigger: "run_end",
        },
      ],
    );
  } finally {
    state.cleanup();
  }
});

test("S2-0 an unresolved cleanup blocks admission until a later clean sweep of that runtime", () => {
  const state = fixture();
  try {
    const participantId = state.kernel.listRunAttempts({
      roomId: state.roomId,
    })[0]!.participantId;
    const admission = () =>
      state.kernel.runtimeProcessCleanup.admission(state.host, {
        participantId,
      });
    assert.deepEqual(admission(), { blocked: false });
    state.kernel.runtimeProcessCleanup.record(
      state.host,
      cleanup(state, "cleanup-stuck", {
        killedCount: 1,
        remainingCount: 1,
        remainingPorts: [5173],
        runtimeRunId: "dead-runtime",
      }),
    );
    const blocked = admission();
    assert.equal(blocked.blocked, true);
    assert.match(blocked.blocked ? blocked.reason : "", /1 leftover process/u);
    assert.deepEqual(
      state.kernel.runtimeProcessCleanup.blockedParticipants(state.host),
      [participantId],
    );
    // A record must name its runtime: no synthetic participant "all clear".
    assert.throws(() =>
      state.kernel.runtimeProcessCleanup.record(
        state.host,
        cleanup(state, "cleanup-janitor-anonymous", {
          killedCount: 0,
          releasedPorts: [],
          runAttemptId: undefined,
          runtimeRunId: undefined,
          trigger: "janitor",
        }),
      ),
    );
    assert.equal(admission().blocked, true);
    state.advance();
    state.kernel.runtimeProcessCleanup.record(
      state.host,
      cleanup(state, "cleanup-janitor", {
        foundCount: 1,
        killedCount: 1,
        observedAt: "2026-09-24T01:00:09.000Z",
        releasedPorts: [5173],
        runAttemptId: undefined,
        runtimeRunId: "dead-runtime",
        trigger: "janitor",
      }),
    );
    assert.deepEqual(admission(), { blocked: false });
    // A resource-cap alert blocks new work but never touches the busy run.
    state.advance();
    state.kernel.runtimeProcessCleanup.record(
      state.host,
      cleanup(state, "cleanup-cap", {
        capExceeded: ["listening_ports"],
        foundCount: 0,
        killedCount: 0,
        releasedPorts: [],
        trigger: "resource_cap",
      }),
    );
    const capped = admission();
    assert.match(capped.blocked ? capped.reason : "", /listening_ports/u);
    // The janitor never re-sweeps (or clears) a cap alert of a live runtime.
    assert.deepEqual(
      state.kernel.runtimeProcessCleanup.blockedParticipants(state.host),
      [],
    );
    assert.deepEqual(
      state.kernel.runtimeProcessCleanup.resweepTargets(state.host, {
        participantId,
      }),
      [],
    );
  } finally {
    state.cleanup();
  }
});

test("S2-0 review P1-1: admission aggregates every unresolved runtime, in either order", () => {
  for (const order of ["a-then-b", "b-then-a"] as const) {
    const state = fixture();
    try {
      const participantId = state.kernel.listRunAttempts({
        roomId: state.roomId,
      })[0]!.participantId;
      const admission = () =>
        state.kernel.runtimeProcessCleanup.admission(state.host, {
          participantId,
        });
      const failA = () =>
        state.kernel.runtimeProcessCleanup.record(
          state.host,
          cleanup(state, `a-${order}`, {
            killedCount: 0,
            remainingCount: 1,
            runtimeRunId: "runtime-a",
          }),
        );
      const cleanB = () =>
        state.kernel.runtimeProcessCleanup.record(
          state.host,
          cleanup(state, `b-${order}`, { runtimeRunId: "runtime-b" }),
        );
      if (order === "a-then-b") {
        failA();
        state.advance();
        cleanB();
      } else {
        cleanB();
        state.advance();
        failA();
      }
      const blocked = admission();
      assert.equal(blocked.blocked, true, order);
      assert.match(blocked.blocked ? blocked.reason : "", /runtime-a/u);
      assert.deepEqual(
        state.kernel.runtimeProcessCleanup
          .resweepTargets(state.host, { participantId })
          .map((target) => target.runtimeRunId),
        ["runtime-a"],
      );
      assert.throws(
        () =>
          state.kernel.runtimeProcessCleanup.assertNoUnresolved(participantId),
        /leftover processes/u,
      );
      state.advance();
      state.kernel.runtimeProcessCleanup.record(
        state.host,
        cleanup(state, `a-clean-${order}`, {
          observedAt: "2026-09-24T01:00:30.000Z",
          runtimeRunId: "runtime-a",
          trigger: "janitor",
        }),
      );
      assert.deepEqual(admission(), { blocked: false }, order);
    } finally {
      state.cleanup();
    }
  }
});

test("S2-0 review P1-2: a pending cleanup blocks until a newer recorded sweep; older observations never clear it", () => {
  const state = fixture();
  try {
    const participantId = state.kernel.listRunAttempts({
      roomId: state.roomId,
    })[0]!.participantId;
    const admission = () =>
      state.kernel.runtimeProcessCleanup.admission(state.host, {
        participantId,
      });
    state.kernel.runtimeProcessCleanup.markPending(state.host, {
      observedAt: "2026-09-24T01:00:10.000Z",
      participantId,
      runAttemptId: state.runAttemptId,
      runtimeRunId: "runtime-p",
    });
    const pending = admission();
    assert.equal(pending.blocked, true);
    assert.match(pending.blocked ? pending.reason : "", /not confirmed/u);
    assert.deepEqual(
      state.kernel.runtimeProcessCleanup
        .resweepTargets(state.host, {})
        .map((target) => [target.participantId, target.runtimeRunId]),
      [[participantId, "runtime-p"]],
    );
    // A janitor sweep observed before the pending mark is history only.
    state.kernel.runtimeProcessCleanup.record(
      state.host,
      cleanup(state, "stale-janitor", {
        observedAt: "2026-09-24T01:00:09.000Z",
        runtimeRunId: "runtime-p",
        trigger: "janitor",
      }),
    );
    assert.equal(admission().blocked, true);
    state.kernel.runtimeProcessCleanup.record(
      state.host,
      cleanup(state, "after-run", {
        observedAt: "2026-09-24T01:00:11.000Z",
        runtimeRunId: "runtime-p",
      }),
    );
    assert.deepEqual(admission(), { blocked: false });
    // Unknown processes (unverifiable tags) block like remaining ones.
    state.kernel.runtimeProcessCleanup.record(
      state.host,
      cleanup(state, "unknown", {
        observedAt: "2026-09-24T01:00:12.000Z",
        portsObserved: false,
        runtimeRunId: "runtime-p",
        unknownCount: 1,
      }),
    );
    const unknown = admission();
    assert.match(
      unknown.blocked ? unknown.reason : "",
      /could not be verified/u,
    );
    const [row] = state.kernel.runtimeProcessCleanup
      .listForRunAttempt(state.runAttemptId)
      .filter((entry) => entry.cleanupId === "unknown");
    assert.equal(row?.portsObserved, false);
    assert.equal(row?.unknownCount, 1);
  } finally {
    state.cleanup();
  }
});

test("S2-0 review P2-1: janitor runtime lookup pages instead of truncating at 500", () => {
  const state = fixture();
  try {
    const noise = Array.from(
      { length: 1_200 },
      (_, index) => `unknown-${index}`,
    );
    const targets = state.kernel.runtimeProcessCleanup.resolveRuntimes(
      state.host,
      { runtimeRunIds: [...noise, state.runtimeRunId] },
    );
    assert.deepEqual(
      targets.map((target) => target.runtimeRunId),
      [state.runtimeRunId],
    );
  } finally {
    state.cleanup();
  }
});

test("S2-0 review P2-2: the cleanup notice is reserved per run, released on failure and consumed only on acceptance", () => {
  const state = fixture();
  try {
    const participantId = state.kernel.listRunAttempts({
      roomId: state.roomId,
    })[0]!.participantId;
    const service = state.kernel.runtimeProcessCleanup;
    const reserve = (runAttemptId: string) =>
      service.reserveNotice(state.host, { participantId, runAttemptId });
    service.record(
      state.host,
      cleanup(state, "cleanup-quiet", {
        foundCount: 0,
        killedCount: 0,
        releasedPorts: [],
      }),
    );
    assert.equal(reserve(state.runAttemptId), null);
    service.record(state.host, cleanup(state, "cleanup-loud"));
    const line = reserve(state.runAttemptId);
    assert.ok(line !== null);
    assert.match(line, /2 leftover background process/u);
    assert.match(line, /port 3000/u);
    assert.match(line, /\(notice [0-9a-f]{8}\)/u);
    assert.ok(line.length <= 300);
    // Same-run retry: the same content, even after a newer row appears.
    service.record(
      state.host,
      cleanup(state, "cleanup-later", {
        killedCount: 1,
        releasedPorts: [],
        runtimeRunId: "runtime-later",
      }),
    );
    assert.equal(reserve(state.runAttemptId), line);
    // A live reservation is not handed to another run.
    assert.doesNotMatch(reserve("run-other") ?? "", /port 3000/u);
    // Early failure: the reservation is released and the next run gets it.
    service.releaseNotice(state.host, {
      participantId,
      runAttemptId: state.runAttemptId,
    });
    const redelivered = reserve("run-next");
    assert.match(redelivered ?? "", /port 3000/u);
    assert.match(redelivered ?? "", /\(notice [0-9a-f]{8}\)/u);
    service.acceptNotice(state.host, {
      participantId,
      runAttemptId: "run-next",
    });
    assert.equal(reserve("run-after"), null);
    assert.equal(
      reserve("run-next"),
      redelivered,
      "same-run retry after acceptance",
    );
  } finally {
    state.cleanup();
  }
});

test("S2-0 review P2-2: a reservation of a finished run that never accepted is delivered again", () => {
  const state = fixture();
  try {
    const participantId = state.kernel.listRunAttempts({
      roomId: state.roomId,
    })[0]!.participantId;
    const service = state.kernel.runtimeProcessCleanup;
    service.record(state.host, cleanup(state, "cleanup-loud"));
    // Reserved by a run that is no longer live work (crashed Host).
    const first = service.reserveNotice(state.host, {
      participantId,
      runAttemptId: "run-crashed",
    });
    assert.ok(first !== null);
    assert.equal(
      service.reserveNotice(state.host, {
        participantId,
        runAttemptId: "run-next",
      }),
      first,
    );
  } finally {
    state.cleanup();
  }
});

test("S2-0 room removal waits for an unresolved leftover cleanup", () => {
  const state = fixture();
  try {
    const participantId = state.kernel.listRunAttempts({
      roomId: state.roomId,
    })[0]!.participantId;
    state.kernel.runtimeProcessCleanup.record(
      state.host,
      cleanup(state, "cleanup-stuck", { killedCount: 1, remainingCount: 1 }),
    );
    assert.throws(
      () =>
        state.kernel.runtimeProcessCleanup.assertNoUnresolved(participantId),
      /leftover processes/u,
    );
  } finally {
    state.cleanup();
  }
});

test("S2-0 review: a schema 65 database backfills per-runtime cleanup state and accepted notices", () => {
  const state = fixture();
  const { databasePath } = state;
  const participantId = state.kernel.listRunAttempts({
    roomId: state.roomId,
  })[0]!.participantId;
  state.kernel.close();
  try {
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`DROP TABLE runtime_cleanup_states;
      ALTER TABLE runtime_process_cleanups DROP COLUMN unknown_count;
      ALTER TABLE runtime_process_cleanups DROP COLUMN ports_observed;
      ALTER TABLE runtime_process_cleanups DROP COLUMN notice_accepted_at;
      PRAGMA user_version = 65;`);
    const insert = legacy.prepare(
      `INSERT INTO runtime_process_cleanups(cleanup_id, host_id, participant_id,
         runtime_run_id, trigger, found_count, killed_count, remaining_count,
         released_ports_json, remaining_ports_json, cap_exceeded_json, error,
         blocking, notice_run_attempt_id, observed_at, recorded_at)
       VALUES(?, 'usage-host', ?, ?, ?, 1, ?, ?, '[]', '[]', '[]', NULL, ?, ?, ?, ?)`,
    );
    // The v64 bug: a later anonymous janitor row hid runtime-a's leftover.
    insert.run(
      "old-a",
      participantId,
      "runtime-a",
      "run_end",
      0,
      1,
      1,
      null,
      "2026-09-24T01:00:01.000Z",
      "2026-09-24T01:00:01.000Z",
    );
    insert.run(
      "old-janitor",
      participantId,
      null,
      "janitor",
      0,
      0,
      0,
      null,
      "2026-09-24T01:00:02.000Z",
      "2026-09-24T01:00:02.000Z",
    );
    insert.run(
      "old-claimed",
      participantId,
      "runtime-b",
      "run_end",
      1,
      0,
      0,
      "run-old",
      "2026-09-24T01:00:03.000Z",
      "2026-09-24T01:00:03.000Z",
    );
    legacy.close();
    const upgraded = new RoomKernel({ databasePath });
    upgraded.initialize();
    try {
      const admission = upgraded.runtimeProcessCleanup.admission(state.host, {
        participantId,
      });
      assert.equal(admission.blocked, true);
      assert.match(admission.blocked ? admission.reason : "", /runtime-a/u);
      // A notice claimed before the upgrade counts as delivered.
      assert.equal(
        upgraded.runtimeProcessCleanup.reserveNotice(state.host, {
          participantId,
          runAttemptId: "run-new",
        }),
        null,
      );
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(join(databasePath, ".."), { force: true, recursive: true });
  }
});

test("final-reply interrupt evidence: null without a final post, unknown until the Host reports, then the report", () => {
  const state = fixture();
  try {
    assert.equal(read(state).finalInterrupt, null);
    state.kernel.markRunAttemptRunning(state.host, {
      recoveryDescriptor: {
        driver: "test-runtime",
        metadata: {},
        recoveryKey: state.runtimeRunId,
      },
      runAttemptId: state.runAttemptId,
      runtimeRunId: state.runtimeRunId,
    });
    const execution = state.kernel.authorizeWorkerExecution(state.host, {
      activationId: state.activation.activationId,
      consumerId: "worker",
      hostId: "usage-host",
      participantId: state.participantId,
      roomId: state.roomId,
      runAttemptId: state.runAttemptId,
      toSeq: state.activation.toSeq,
    });
    const posted = state.kernel.postWorkerMessage(execution, {
      body: "final answer",
      final: true,
    });
    assert.ok("event" in posted);
    assert.deepEqual(read(state).finalInterrupt, {
      committedRoomSeq: posted.event.roomSeq,
      requested: false,
      accepted: "unknown",
      terminal: "unknown",
      sent: false,
      preemptedFollowUp: "unknown",
    });
    state.kernel.finalReplies.recordInterrupt(state.host, {
      runAttemptId: state.runAttemptId,
      requested: true,
      accepted: "unknown",
      terminal: true,
      sent: true,
      preemptedFollowUp: true,
    });
    assert.deepEqual(read(state).finalInterrupt, {
      committedRoomSeq: posted.event.roomSeq,
      requested: true,
      accepted: "unknown",
      terminal: true,
      sent: true,
      preemptedFollowUp: true,
    });
  } finally {
    state.cleanup();
  }
});

test("S2-b: a per-turn (cold) run records its measured session resume once and the usage read shows it", () => {
  const state = fixture();
  try {
    const { kernel, host, otherHost } = state;
    assert.equal(read(state).sessionResumeMs, null, "unknown until measured");
    assert.equal(read(state).execution, null, "still a per-turn run");
    const input = {
      runAttemptId: state.runAttemptId,
      runtimeRunId: state.runtimeRunId,
      sessionResumeMs: 1_234,
    };
    kernel.runAttemptUsage.recordSessionResume(host, input);
    kernel.runAttemptUsage.recordSessionResume(host, input);
    assert.equal(read(state).sessionResumeMs, 1_234);
    assert.throws(
      () =>
        kernel.runAttemptUsage.recordSessionResume(host, {
          ...input,
          sessionResumeMs: 99,
        }),
      ConflictError,
      "a measurement is an immutable fact",
    );
    assert.throws(
      () => kernel.runAttemptUsage.recordSessionResume(otherHost, input),
      ForbiddenError,
    );
    assert.throws(() =>
      kernel.runAttemptUsage.recordSessionResume(host, {
        ...input,
        sessionResumeMs: -1,
      }),
    );
  } finally {
    state.cleanup();
  }
});
