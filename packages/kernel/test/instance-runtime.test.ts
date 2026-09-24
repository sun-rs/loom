import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  ConflictError,
  DeliveryProofError,
  ExecutionFencedError,
  KERNEL_SCHEMA_VERSION,
  RoomKernel,
} from "../src/index.ts";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

/**
 * S2-a (S2 spec §1/§2): one `instance_runtimes` row per warm process
 * lifetime; each Activation is one RunAttempt whose per-turn execution
 * record closes with `turn_quiesced` while the process stays alive.
 */
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-instance-runtime-"));
  let nowMs = Date.parse("2026-09-24T01:00:00.000Z");
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath, now: () => new Date(nowMs) });
  kernel.initialize();
  const advance = (ms = 1_000) => {
    nowMs += ms;
  };
  const owner = kernel.provisionPrincipal({
    handle: "irt-owner",
    kind: "human",
  });
  const agent = kernel.provisionPrincipal({
    handle: "irt-agent",
    kind: "agent",
  });
  const ownerActor = kernel.authenticateAccessToken(owner.accessToken);
  const workspace = kernel.createWorkspace(ownerActor, {
    idempotencyKey: "irt-workspace",
    name: "IRT Workspace",
    slug: "irt-workspace",
  });
  const controlRoomId = workspace.controlRoom.roomId;
  const seq = (roomId: string) =>
    kernel.sync(ownerActor, {
      afterSeq: 0,
      consumerId: `irt-seq-${nowMs}-${roomId}`,
      roomId,
    }).latestRoomSeq;
  kernel.addMember(ownerActor, {
    principalId: agent.principal.principalId,
    roomId: controlRoomId,
  });
  advance();
  const policy = kernel.createExecutionPolicy(ownerActor, {
    basedOnRoomSeq: seq(controlRoomId),
    controlRoomId,
    idempotencyKey: "irt-policy",
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
      artifactId: "irt-retry-policy",
      contentDigest: digest("f"),
      versionId: "irt-retry-policy-v1",
    },
    sessionPolicy: "prefer_resume",
  });
  advance();
  const definition = kernel.createAgentDefinition(ownerActor, {
    basedOnRoomSeq: policy.event.roomSeq,
    controlRoomId,
    executionPolicyRevisionId: policy.policy.executionPolicyRevisionId,
    idempotencyKey: "irt-agent-created",
    instructionRefs: [],
    memoryPolicyRef: {
      artifactId: "irt-memory-policy",
      contentDigest: digest("e"),
      versionId: "irt-memory-policy-v1",
    },
    participantId: agent.principal.principalId,
    role: "IRT Agent",
    skillRefs: [],
  });
  advance();
  const room = kernel.createWorkspaceRoom(ownerActor, {
    basedOnControlRoomSeq: definition.event.roomSeq,
    idempotencyKey: "irt-room",
    kind: "channel",
    name: "IRT Lab",
    slug: "irt-lab",
    workspaceId: workspace.workspace.workspaceId,
  }).room;
  kernel.onboardAgentToRoom(ownerActor, {
    agentId: definition.definition.agentId,
    basedOnRoomSeq: seq(room.roomId),
    idempotencyKey: "irt-onboarded",
    roomId: room.roomId,
  });
  advance();
  const hostToken = kernel.provisionHostCredential({
    hostId: "irt-host",
    participantIds: [agent.principal.principalId],
  }).accessToken;
  let host = kernel.authenticateHostAccessToken(hostToken);
  kernel.heartbeatHost(host);
  const participantId = agent.principal.principalId;
  let messageCount = 0;
  const post = () => {
    messageCount += 1;
    return kernel.postRoomMessage(ownerActor, {
      body: `Question ${messageCount}`,
      idempotencyKey: `irt-message-${messageCount}`,
      recipients: [],
      roomId: room.roomId,
    });
  };
  /** Lease the next Activation and prepare one turn on the given runtime. */
  const openTurn = (instanceRuntimeId: string, label: string) => {
    advance();
    const activation = kernel.leaseNextActivation(host, { leaseMs: 30_000 });
    assert.ok(activation, `an Activation is leased for ${label}`);
    const runAttempt = kernel.createRunAttempt(host, {
      activationId: activation.activationId,
    });
    kernel.instanceRuntimes.beginTurn(host, {
      executionMode: label.startsWith("cold") ? "cold" : "warm",
      instanceRuntimeId,
      runAttemptId: runAttempt.runAttemptId,
    });
    const runtimeRunId = `turn:${label}`;
    const recoveryDescriptor = {
      driver: "loom-instance-runtime-v1",
      metadata: {},
      recoveryKey: instanceRuntimeId,
    };
    kernel.prepareRunAttemptRuntime(host, {
      recoveryDescriptor,
      runAttemptId: runAttempt.runAttemptId,
      runtimeRunId,
    });
    kernel.markRunAttemptRunning(host, {
      recoveryDescriptor,
      runAttemptId: runAttempt.runAttemptId,
      runtimeRunId,
    });
    return { activation, runAttemptId: runAttempt.runAttemptId, runtimeRunId };
  };
  const startRuntime = (instanceRuntimeId = "instrt_a") => {
    kernel.instanceRuntimes.register(host, {
      driver: "codex-app-server-warm/v1",
      instanceRuntimeId,
      participantId,
    });
    return kernel.instanceRuntimes.markReady(host, {
      instanceRuntimeId,
      nativeSessionId: "thread-1",
      pgid: 4242,
      pid: 4242,
      processStartedAt: "Thu Sep 24 01:00:00 2026",
      sessionResumeMs: 850,
    });
  };
  const acknowledge = (toSeq: number) => {
    // Raw cursor write stands in for the Worker's delivery ACK.
    const database = new DatabaseSync(databasePath);
    try {
      database
        .prepare(
          `INSERT INTO subscription_cursors(room_id, participant_id, consumer_id, last_seq, updated_at)
           VALUES(?, ?, ?, ?, ?)
           ON CONFLICT(room_id, participant_id, consumer_id) DO UPDATE SET last_seq = excluded.last_seq`,
        )
        .run(
          room.roomId,
          participantId,
          "irt-host:runtime",
          toSeq,
          new Date(nowMs).toISOString(),
        );
    } finally {
      database.close();
    }
  };
  return {
    acknowledge,
    advance,
    get host() {
      return host;
    },
    cleanup() {
      kernel.close();
      rmSync(directory, { force: true, recursive: true });
    },
    agentId: definition.definition.agentId,
    databasePath,
    kernel,
    openTurn,
    ownerActor,
    participantId,
    post,
    restartHost() {
      kernel.heartbeatHost(host, { state: "offline" });
      host = kernel.authenticateHostAccessToken(hostToken);
      kernel.heartbeatHost(host);
      return host;
    },
    roomId: room.roomId,
    startRuntime,
  };
}

function quiesce(
  state: ReturnType<typeof fixture>,
  turn: { runAttemptId: string; runtimeRunId: string },
  overrides: Record<string, unknown> = {},
) {
  return state.kernel.instanceRuntimes.recordTurnQuiesced(state.host, {
    closeSeq: 7,
    inFlightToolCount: 0,
    instanceRuntimeId: "instrt_a",
    nativeTurnId: `native-${turn.runtimeRunId}`,
    processGroupAlive: true,
    result: "success",
    runAttemptId: turn.runAttemptId,
    runtimeRunId: turn.runtimeRunId,
    ...overrides,
  } as Parameters<RoomKernel["instanceRuntimes"]["recordTurnQuiesced"]>[1]);
}

function rawRow(databasePath: string, sql: string, ...args: string[]) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return database.prepare(sql).get(...args) as Record<string, unknown>;
  } finally {
    database.close();
  }
}

test("schema 65 owns one live instance runtime per participant", () => {
  const state = fixture();
  try {
    assert.equal(KERNEL_SCHEMA_VERSION, 67);
    const ready = state.startRuntime();
    assert.equal(ready.state, "idle");
    assert.throws(
      () =>
        state.kernel.instanceRuntimes.register(state.host, {
          driver: "codex-app-server-warm/v1",
          instanceRuntimeId: "instrt_b",
          participantId: state.participantId,
        }),
      ConflictError,
      "the partial unique index allows at most one live row per participant",
    );
    // Idempotent replay of the same registration is not a second runtime.
    assert.equal(
      state.kernel.instanceRuntimes.register(state.host, {
        driver: "codex-app-server-warm/v1",
        instanceRuntimeId: "instrt_a",
        participantId: state.participantId,
      }).instanceRuntimeId,
      "instrt_a",
    );
  } finally {
    state.cleanup();
  }
});

test("a quiesced turn is terminal without faking an exit; ACK below toSeq does not complete", () => {
  const state = fixture();
  try {
    state.startRuntime();
    state.post();
    const turn = state.openTurn("instrt_a", "cold-1");
    state.kernel.instanceRuntimes.recordTurnAccepted(state.host, {
      instanceRuntimeId: "instrt_a",
      nativeTurnId: "native-turn:cold-1",
      runAttemptId: turn.runAttemptId,
    });
    assert.throws(
      () => quiesce(state, turn, { nativeTurnId: "native-other" }),
      ConflictError,
      "the closing native turn id must match the accepted one",
    );
    assert.throws(
      () => quiesce(state, turn, { inFlightToolCount: 1 }),
      ConflictError,
    );
    assert.throws(
      () => quiesce(state, turn, { processGroupAlive: false }),
      ConflictError,
    );
    const proof = quiesce(state, turn);
    assert.equal(proof.state, "terminated");
    assert.equal(proof.proofKind, "turn_quiesced");
    assert.equal(proof.quiesceResult, "success");
    assert.equal(proof.exitCode, undefined, "no exit code is invented");
    assert.equal(proof.exitSignal, undefined);
    // Replay is idempotent.
    assert.equal(quiesce(state, turn).proofKind, "turn_quiesced");
    const runtime = state.kernel.instanceRuntimes.get(state.host, "instrt_a");
    assert.equal(runtime.state, "busy", "the lane is held until release");
    assert.equal(runtime.currentRunAttemptId, turn.runAttemptId);

    const finished = state.kernel.finishRunAttempt(state.host, {
      runAttemptId: turn.runAttemptId,
      state: "exited",
    });
    assert.equal(finished.state, "exited");
    assert.equal(finished.exitCode, undefined);
    assert.equal(finished.instanceRuntimeId, "instrt_a");
    assert.equal(finished.nativeTurnId, "native-turn:cold-1");

    assert.throws(
      () =>
        state.kernel.instanceRuntimes.releaseTurn(state.host, {
          instanceRuntimeId: "instrt_a",
          runAttemptId: turn.runAttemptId,
        }),
      ConflictError,
      "the lane stays held while the Activation is leased",
    );
    state.acknowledge(turn.activation.toSeq - 1);
    assert.throws(
      () =>
        state.kernel.completeActivation(state.host, {
          activationId: turn.activation.activationId,
          consumerId: "irt-host:runtime",
        }),
      DeliveryProofError,
      "quiescence never acknowledges delivery",
    );
    state.acknowledge(turn.activation.toSeq);
    assert.equal(
      state.kernel.completeActivation(state.host, {
        activationId: turn.activation.activationId,
        consumerId: "irt-host:runtime",
      }).state,
      "completed",
    );
    const idle = state.kernel.instanceRuntimes.releaseTurn(state.host, {
      instanceRuntimeId: "instrt_a",
      runAttemptId: turn.runAttemptId,
    });
    assert.equal(idle.state, "idle");
    assert.equal(idle.currentRunAttemptId, undefined);
  } finally {
    state.cleanup();
  }
});

test("worker grants require the runtime busy on this turn and die at quiescence", () => {
  const state = fixture();
  try {
    state.startRuntime();
    state.post();
    const turn = state.openTurn("instrt_a", "cold-1");
    const scope = {
      activationId: turn.activation.activationId,
      consumerId: "irt-host:runtime",
      hostId: "irt-host",
      participantId: state.participantId,
      roomId: state.roomId,
      runAttemptId: turn.runAttemptId,
      toSeq: turn.activation.toSeq,
    };
    const execution = state.kernel.authorizeWorkerExecution(state.host, scope);
    assert.ok(state.kernel.syncWorker(execution, { afterSeq: 0 }));
    state.kernel.instanceRuntimes.recordTurnAccepted(state.host, {
      instanceRuntimeId: "instrt_a",
      nativeTurnId: "native-turn:cold-1",
      runAttemptId: turn.runAttemptId,
    });
    quiesce(state, turn);
    assert.throws(
      () => state.kernel.syncWorker(execution, { afterSeq: 0 }),
      ExecutionFencedError,
      "a Worker call of a quiesced turn is fenced even if revocation failed",
    );
    assert.throws(
      () => state.kernel.authorizeWorkerExecution(state.host, scope),
      ExecutionFencedError,
    );
  } finally {
    state.cleanup();
  }
});

test("lease expiry after quiescence maps the proof result, never a fake failure", () => {
  const state = fixture();
  try {
    state.startRuntime();
    state.post();
    const turn = state.openTurn("instrt_a", "cold-1");
    state.kernel.instanceRuntimes.recordTurnAccepted(state.host, {
      instanceRuntimeId: "instrt_a",
      nativeTurnId: "native-turn:cold-1",
      runAttemptId: turn.runAttemptId,
    });
    quiesce(state, turn, { result: "cancelled" });
    state.advance(60_000);
    state.kernel.leaseNextActivation(state.host, { leaseMs: 30_000 });
    const run = rawRow(
      state.databasePath,
      "SELECT state, exit_code, exit_signal FROM run_attempts WHERE run_attempt_id = ?",
      turn.runAttemptId,
    );
    assert.equal(run.state, "cancelled");
    assert.equal(run.exit_code, null);
    assert.equal(run.exit_signal, null);
  } finally {
    state.cleanup();
  }
});

test("orphaning a busy warm turn marks the runtime suspect; exit proof releases it", () => {
  const state = fixture();
  try {
    state.startRuntime();
    state.post();
    const turn = state.openTurn("instrt_a", "cold-1");
    state.restartHost();
    state.advance(60_000);
    state.kernel.leaseNextActivation(state.host, { leaseMs: 30_000 });
    assert.equal(
      state.kernel.instanceRuntimes.get(state.host, "instrt_a").state,
      "suspect",
    );
    const live = state.kernel.instanceRuntimes.list(state.host);
    assert.equal(live.length, 1);
    assert.equal(live[0]!.hostGenerationCurrent, false);
    assert.throws(
      () =>
        state.kernel.instanceRuntimes.register(state.host, {
          driver: "codex-app-server-warm/v1",
          instanceRuntimeId: "instrt_b",
          participantId: state.participantId,
        }),
      ConflictError,
      "no new runtime before the old one is proven terminated",
    );
    const ended = state.kernel.instanceRuntimes.recordExit(state.host, {
      exit: { code: null, signal: "SIGKILL" },
      instanceRuntimeId: "instrt_a",
      reason: "host_shutdown",
    });
    assert.equal(ended.state, "terminated");
    assert.equal(ended.terminatedReason, "host_shutdown");
    const process = rawRow(
      state.databasePath,
      "SELECT state, proof_kind, exit_signal FROM runtime_processes WHERE run_attempt_id = ?",
      turn.runAttemptId,
    );
    assert.equal(process.state, "terminated");
    assert.equal(process.proof_kind, "process_exit");
    assert.equal(process.exit_signal, "SIGKILL");
    assert.equal(
      state.kernel.instanceRuntimes.register(state.host, {
        driver: "codex-app-server-warm/v1",
        instanceRuntimeId: "instrt_b",
        participantId: state.participantId,
      }).state,
      "starting",
    );
  } finally {
    state.cleanup();
  }
});

test("a runtime of an older Host generation cannot open or close turns", () => {
  const state = fixture();
  try {
    state.startRuntime();
    state.post();
    const oldHost = state.host;
    state.restartHost();
    state.advance();
    const activation = state.kernel.leaseNextActivation(state.host, {
      leaseMs: 30_000,
    });
    assert.ok(activation);
    const runAttempt = state.kernel.createRunAttempt(state.host, {
      activationId: activation.activationId,
    });
    assert.throws(
      () =>
        state.kernel.instanceRuntimes.beginTurn(state.host, {
          executionMode: "warm",
          instanceRuntimeId: "instrt_a",
          runAttemptId: runAttempt.runAttemptId,
        }),
      ExecutionFencedError,
    );
    assert.notEqual(oldHost.instanceId, state.host.instanceId);
  } finally {
    state.cleanup();
  }
});

test("warm/cold execution and session resume time are exposed per turn", () => {
  const state = fixture();
  try {
    state.startRuntime();
    state.post();
    const cold = state.openTurn("instrt_a", "cold-1");
    const database = new DatabaseSync(state.databasePath, { readOnly: true });
    try {
      const row = database
        .prepare(
          "SELECT execution_mode, session_resume_ms, instance_runtime_id FROM run_attempts WHERE run_attempt_id = ?",
        )
        .get(cold.runAttemptId) as Record<string, unknown>;
      assert.equal(row.execution_mode, "cold");
      assert.equal(row.session_resume_ms, 850);
      assert.equal(row.instance_runtime_id, "instrt_a");
    } finally {
      database.close();
    }
    const execution = state.kernel.instanceRuntimes.executionForRunAttempt(
      cold.runAttemptId,
    );
    assert.deepEqual(execution, {
      instanceRuntimeId: "instrt_a",
      lateFrameCount: 0,
      mode: "cold",
      sessionResumeMs: 850,
    });
  } finally {
    state.cleanup();
  }
});

test("the usage read exposes warm/cold execution; late frames make usage partial", () => {
  const state = fixture();
  try {
    state.startRuntime();
    state.post();
    const turn = state.openTurn("instrt_a", "cold-1");
    state.kernel.runAttemptUsage.record(state.host, {
      provider: "codex-app-server/v1",
      responseId: "turn-1:100",
      inputTokens: 100,
      cachedInputTokens: 0,
      outputTokens: 10,
      reasoningOutputTokens: 0,
      contextWindow: null,
      contextUsedTokens: null,
      observedAt: "2026-09-24T01:00:05.000Z",
      runAttemptId: turn.runAttemptId,
      runtimeRunId: turn.runtimeRunId,
    });
    state.kernel.instanceRuntimes.recordTurnAccepted(state.host, {
      instanceRuntimeId: "instrt_a",
      nativeTurnId: "native-turn:cold-1",
      runAttemptId: turn.runAttemptId,
    });
    quiesce(state, turn);
    const read = () =>
      state.kernel.runAttemptUsage.get(state.ownerActor, {
        agentId: state.agentId,
        runAttemptId: turn.runAttemptId,
      });
    assert.equal(read().completeness, "complete");
    assert.deepEqual(read().execution, {
      instanceRuntimeId: "instrt_a",
      lateFrameCount: 0,
      mode: "cold",
      sessionResumeMs: 850,
    });
    state.kernel.instanceRuntimes.recordLateTurnFrame(state.host, {
      runAttemptId: turn.runAttemptId,
    });
    assert.equal(read().completeness, "partial");
    assert.equal(read().execution?.lateFrameCount, 1);
  } finally {
    state.cleanup();
  }
});

test("S2-a review P2-2: an idempotent quiesce replay first verifies runtime, run, native turn and Host generation", () => {
  const state = fixture();
  try {
    state.startRuntime();
    state.post();
    const turn = state.openTurn("instrt_a", "cold-1");
    state.kernel.instanceRuntimes.recordTurnAccepted(state.host, {
      instanceRuntimeId: "instrt_a",
      nativeTurnId: "native-turn:cold-1",
      runAttemptId: turn.runAttemptId,
    });
    assert.equal(quiesce(state, turn).proofKind, "turn_quiesced");
    assert.throws(
      () => quiesce(state, turn, { runtimeRunId: "turn:someone-else" }),
      ExecutionFencedError,
      "a replay naming another runtime run is not the same proof",
    );
    assert.throws(
      () => quiesce(state, turn, { instanceRuntimeId: "instrt_other" }),
      "a replay naming another runtime is not the same proof",
    );
    assert.throws(
      () => quiesce(state, turn, { nativeTurnId: "native-other" }),
      ConflictError,
      "a replay naming another native turn is not the same proof",
    );
    // The same Host generation may replay its own completed request.
    assert.equal(quiesce(state, turn).quiesceResult, "success");
    state.restartHost();
    assert.throws(
      () => quiesce(state, turn),
      ExecutionFencedError,
      "a later Host generation never receives the older generation's proof",
    );
  } finally {
    state.cleanup();
  }
});

test("S2-a review P1-3: the physical identity is recorded right after spawn, before native ready", () => {
  const state = fixture();
  try {
    state.kernel.instanceRuntimes.register(state.host, {
      driver: "codex-app-server-warm/v1",
      instanceRuntimeId: "instrt_a",
      participantId: state.participantId,
    });
    const spawned = state.kernel.instanceRuntimes.recordSpawned(state.host, {
      instanceRuntimeId: "instrt_a",
      pgid: 5151,
      pid: 5151,
      processStartedAt: "Thu Sep 24 01:00:00 2026",
    });
    assert.equal(spawned.state, "starting", "not ready: no native session yet");
    assert.equal(spawned.pid, 5151);
    assert.equal(spawned.processStartedAt, "Thu Sep 24 01:00:00 2026");
    assert.equal(spawned.nativeSessionId, undefined);
    // Replaying the same identity is idempotent; another identity is refused.
    assert.equal(
      state.kernel.instanceRuntimes.recordSpawned(state.host, {
        instanceRuntimeId: "instrt_a",
        pgid: 5151,
        pid: 5151,
        processStartedAt: "Thu Sep 24 01:00:00 2026",
      }).pid,
      5151,
    );
    assert.throws(
      () =>
        state.kernel.instanceRuntimes.recordSpawned(state.host, {
          instanceRuntimeId: "instrt_a",
          pgid: 6161,
          pid: 6161,
          processStartedAt: "Thu Sep 24 01:00:01 2026",
        }),
      ConflictError,
    );
    assert.throws(
      () =>
        state.kernel.instanceRuntimes.markReady(state.host, {
          instanceRuntimeId: "instrt_a",
          nativeSessionId: "thread-1",
          pgid: 6161,
          pid: 6161,
          processStartedAt: "Thu Sep 24 01:00:01 2026",
        }),
      ConflictError,
      "ready must name the process recorded at spawn",
    );
    const ready = state.kernel.instanceRuntimes.markReady(state.host, {
      instanceRuntimeId: "instrt_a",
      nativeSessionId: "thread-1",
      pgid: 5151,
      pid: 5151,
      processStartedAt: "Thu Sep 24 01:00:00 2026",
    });
    assert.equal(ready.state, "idle");
    assert.equal(ready.nativeSessionId, "thread-1");
  } finally {
    state.cleanup();
  }
});

test("S2-a review P1-1: an unproven termination leaves the runtime suspect and blocking", () => {
  const state = fixture();
  try {
    state.startRuntime();
    const suspect = state.kernel.instanceRuntimes.markSuspect(state.host, {
      instanceRuntimeId: "instrt_a",
    });
    assert.equal(suspect.state, "suspect");
    state.post();
    state.advance();
    const activation = state.kernel.leaseNextActivation(state.host, {
      leaseMs: 30_000,
    });
    assert.ok(activation);
    const runAttempt = state.kernel.createRunAttempt(state.host, {
      activationId: activation.activationId,
    });
    assert.throws(
      () =>
        state.kernel.instanceRuntimes.beginTurn(state.host, {
          executionMode: "warm",
          instanceRuntimeId: "instrt_a",
          runAttemptId: runAttempt.runAttemptId,
        }),
      ConflictError,
    );
    assert.throws(
      () =>
        state.kernel.instanceRuntimes.register(state.host, {
          driver: "codex-app-server-warm/v1",
          instanceRuntimeId: "instrt_b",
          participantId: state.participantId,
        }),
      ConflictError,
    );
    assert.equal(
      state.kernel.instanceRuntimes.recordExit(state.host, {
        exit: { code: 0 },
        instanceRuntimeId: "instrt_a",
        reason: "idle_ttl",
      }).state,
      "terminated",
      "only a later real exit proof ends the suspicion",
    );
  } finally {
    state.cleanup();
  }
});
