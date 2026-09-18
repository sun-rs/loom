import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RoomKernel, RuntimeTerminationProofError } from "../src/index.ts";

const digest = (c: string) => `sha256:${c.repeat(64)}`;

/**
 * R5: the durable deletion intent must stay readable while it is blocked.
 * The fixture mirrors `agent-deletion.test.ts` so the diagnostic is asserted
 * against the same durable rows the deletion fence itself reads.
 */
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-delete-diagnostics-"));
  const databasePath = join(directory, "room.db");
  let kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  const owner = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
  const agentPrincipal = kernel.provisionPrincipal({
    handle: "worker",
    kind: "agent",
  });
  const actor = kernel.authenticateAccessToken(owner.accessToken);
  const workspace = kernel.createWorkspace(actor, {
    idempotencyKey: "workspace",
    name: "Deletion diagnostics",
    slug: "deletion-diagnostics",
  });
  kernel.addMember(actor, {
    principalId: agentPrincipal.principal.principalId,
    roomId: workspace.controlRoom.roomId,
  });
  const currentSeq = () =>
    kernel.sync(actor, {
      afterSeq: 0,
      consumerId: "deletion-diagnostics-test",
      roomId: workspace.controlRoom.roomId,
    }).latestRoomSeq;
  const policy = kernel.createExecutionPolicy(actor, {
    basedOnRoomSeq: currentSeq(),
    controlRoomId: workspace.controlRoom.roomId,
    idempotencyKey: "policy",
    modelIntent: { fallback: "disabled" },
    preferred: [],
    required: {
      allowedProtocolFamilies: ["rah-worker-process/v1"],
      capabilities: [],
      minimumIsolation: "none",
      workspaceMode: "in_place",
    },
    retryPolicyRef: {
      artifactId: "retry-policy",
      contentDigest: digest("a"),
      versionId: "retry-policy-v1",
    },
    sessionPolicy: "fresh",
  });
  const definition = kernel.createAgentDefinition(actor, {
    basedOnRoomSeq: currentSeq(),
    controlRoomId: workspace.controlRoom.roomId,
    executionPolicyRevisionId: policy.policy.executionPolicyRevisionId,
    idempotencyKey: "definition",
    instructionRefs: [],
    memoryPolicyRef: {
      artifactId: "memory-policy",
      contentDigest: digest("b"),
      versionId: "memory-policy-v1",
    },
    participantId: agentPrincipal.principal.principalId,
    role: "Agent",
    skillRefs: [],
  });
  const agentId = definition.definition.agentDefinitionId;
  const participantId = agentPrincipal.principal.principalId;
  const db = new DatabaseSync(databasePath);
  return {
    get kernel() {
      return kernel;
    },
    reopen() {
      kernel.close();
      kernel = new RoomKernel({ databasePath });
      kernel.initialize();
    },
    actor,
    agentId,
    currentSeq,
    db,
    participantId,
    request: () => ({
      action: "set_state" as const,
      agentDefinitionId: agentId,
      basedOnRoomSeq: currentSeq(),
      idempotencyKey: "delete",
      state: "tombstoned" as const,
    }),
    roomId: workspace.controlRoom.roomId,
    cleanup() {
      db.close();
      kernel.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

/** Starts a real leased run with a registered runtime process on `hostId`. */
function startRun(f: ReturnType<typeof fixture>, hostId: string) {
  const host = f.kernel.authenticateHostAccessToken(
    f.kernel.provisionHostCredential({
      hostId,
      participantIds: [f.participantId],
    }).accessToken,
  );
  f.kernel.heartbeatHost(host);
  f.kernel.postMessage(f.actor, {
    roomId: f.roomId,
    body: "work",
    idempotencyKey: `work-${hostId}`,
    recipients: [{ participantId: f.participantId, reason: "mention" }],
  });
  const activation = f.kernel.leaseNextActivation(host, { leaseMs: 30000 })!;
  const run = f.kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  const runtime = {
    runAttemptId: run.runAttemptId,
    runtimeRunId: "runtime-run",
    recoveryDescriptor: {
      driver: "generic-process",
      metadata: { secretToken: "canary-secret-do-not-leak" },
      recoveryKey: "canary-secret-do-not-leak",
    },
  };
  f.kernel.prepareRunAttemptRuntime(host, runtime);
  f.kernel.markRunAttemptRunning(host, runtime);
  return { activation, host, run, runtime };
}

test("a blocked deletion exposes the blocking row, recovery identity and operator steps", () => {
  const f = fixture();
  try {
    const { activation, run } = startRun(f, "diagnostic-host");
    assert.throws(
      () => f.kernel.manageWorkspaceAgent(f.actor, f.request()),
      RuntimeTerminationProofError,
    );
    assert.equal(f.kernel.reconcileAgentDeletions(), 0);
    const diagnostics = f.kernel.getAgentDeletionDiagnostics(f.actor, {
      agentDefinitionId: f.agentId,
    });
    assert.equal(diagnostics.status, "blocked");
    assert.equal(diagnostics.reasonCode, "missing_runtime_termination_proof");
    assert.equal(diagnostics.blocker?.kind, "run_attempt");
    assert.equal(diagnostics.blocker?.runAttemptId, run.runAttemptId);
    assert.equal(diagnostics.blocker?.hostId, "diagnostic-host");
    assert.equal(diagnostics.blocker?.recoveryDriver, "generic-process");
    assert.equal(diagnostics.blocker?.activationId, activation.activationId);
    assert.ok(diagnostics.requestedAt);
    assert.ok(diagnostics.firstObservedAt);
    assert.ok(diagnostics.observedAt >= diagnostics.firstObservedAt!);
    assert.ok(diagnostics.recoverySteps.length > 0);
    assert.match(diagnostics.summary, /终止证明/);
    // No force delete: the durable intent is still the only way forward.
    const serialized = JSON.stringify(diagnostics);
    assert.ok(!/canary-secret-do-not-leak/.test(serialized));
    assert.ok(!/accessToken|token_hash/i.test(serialized));
  } finally {
    f.cleanup();
  }
});

test("an orphaned run keeps the deletion blocked and names the recovery driver that must return", () => {
  const f = fixture();
  try {
    const { activation, host, run, runtime } = startRun(f, "orphan-host");
    assert.throws(
      () => f.kernel.manageWorkspaceAgent(f.actor, f.request()),
      RuntimeTerminationProofError,
    );
    f.db
      .prepare(
        "UPDATE run_attempts SET state='orphaned' WHERE run_attempt_id=?",
      )
      .run(run.runAttemptId);
    f.db
      .prepare(
        "UPDATE runtime_processes SET state='orphaned' WHERE run_attempt_id=?",
      )
      .run(run.runAttemptId);
    assert.equal(f.kernel.reconcileAgentDeletions(), 0);
    const blocked = f.kernel.getAgentDeletionDiagnostics(f.actor, {
      agentDefinitionId: f.agentId,
    });
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.blocker?.runAttemptState, "orphaned");
    assert.equal(blocked.blocker?.recoveryDriver, "generic-process");
    assert.equal(blocked.blocker?.runtimeProcessState, "orphaned");
    // A receipt whose runtime identity does not match proves nothing.
    assert.throws(
      () =>
        f.kernel.recordRuntimeTermination(host, {
          runAttemptId: run.runAttemptId,
          runtimeRunId: "some-other-run",
          exit: { code: 0 },
        }),
      /match/,
    );
    assert.equal(f.kernel.reconcileAgentDeletions(), 0);
    assert.equal(
      f.kernel.getAgentDeletionDiagnostics(f.actor, {
        agentDefinitionId: f.agentId,
      }).status,
      "blocked",
    );
    // The recovery owner with the matching driver claims the orphaned process.
    // A driver that does not match cannot claim it and proves nothing.
    assert.equal(
      f.kernel.leaseNextRuntimeRecovery(host, {
        driverIds: ["some-other-driver"],
        leaseMs: 30000,
      }),
      null,
    );
    const claimed = f.kernel.leaseNextRuntimeRecovery(host, {
      driverIds: ["generic-process"],
      leaseMs: 30000,
    })!;
    assert.ok(claimed);
    f.kernel.recordRecoveredRuntimeTermination(host, {
      exit: { code: null, signal: "SIGKILL" },
      recoveryAttemptCount: claimed.recoveryAttemptCount,
      runtimeProcessId: claimed.runtimeProcessId,
    });
    f.kernel.retryActivation(host, {
      activationId: activation.activationId,
      error: "Agent disabled",
      retryAfterMs: 1000,
    });
    const finished = f.kernel.listRunAttempts()[0]!;
    assert.equal(finished.state, "failed");
    assert.equal(finished.exitSignal, "SIGKILL");
    assert.ok(finished.finishedAt);
    assert.equal(f.kernel.reconcileAgentDeletions(), 1);
    assert.equal(
      f.kernel.getAgentDeletionDiagnostics(f.actor, {
        agentDefinitionId: f.agentId,
      }).status,
      "completed",
    );
  } finally {
    f.cleanup();
  }
});

test("startup repairs a proven orphan once but never fabricates a termination proof", () => {
  const f = fixture();
  try {
    const { host, run, runtime } = startRun(f, "historical-host");
    f.db
      .prepare(
        "UPDATE run_attempts SET state='orphaned', error='Host disappeared' WHERE run_attempt_id=?",
      )
      .run(run.runAttemptId);
    f.reopen();
    assert.equal(f.kernel.listRunAttempts()[0]?.state, "orphaned");
    f.kernel.recordRuntimeTermination(host, {
      runAttemptId: run.runAttemptId,
      runtimeRunId: runtime.runtimeRunId,
      exit: { code: 0 },
    });
    // Reproduce the historical projection left by a pre-fix Kernel.
    f.db
      .prepare(
        "DELETE FROM room_events WHERE type='run.finished' AND aggregate_id=?",
      )
      .run(run.runAttemptId);
    f.db
      .prepare(
        "UPDATE run_attempts SET state='orphaned', exit_code=NULL, finished_at=NULL WHERE run_attempt_id=?",
      )
      .run(run.runAttemptId);
    f.reopen();
    const repaired = f.kernel.listRunAttempts()[0]!;
    assert.equal(repaired.state, "exited");
    assert.equal(repaired.exitCode, 0);
    assert.equal(repaired.error, "Host disappeared");
    assert.ok(repaired.finishedAt);
    const proofTime = f.db
      .prepare(
        "SELECT terminated_at FROM runtime_processes WHERE run_attempt_id=?",
      )
      .get(run.runAttemptId)!.terminated_at;
    assert.equal(repaired.finishedAt, proofTime);
    f.reopen();
    assert.deepEqual(f.kernel.listRunAttempts()[0], repaired);
    assert.equal(
      f.db
        .prepare(
          "SELECT count(*) AS n FROM room_events WHERE type='run.finished' AND aggregate_id=?",
        )
        .get(run.runAttemptId)!.n,
      1,
    );
    assert.ok(
      !f.kernel
        .listActivations()
        .some((activation) => activation.state === "completed"),
    );
  } finally {
    f.cleanup();
  }
});

test("a returning Host that proves termination lets the existing reconciler finish the deletion", () => {
  const f = fixture();
  try {
    const { activation, host, run, runtime } = startRun(f, "returning-host");
    assert.throws(
      () => f.kernel.manageWorkspaceAgent(f.actor, f.request()),
      RuntimeTerminationProofError,
    );
    const changes: Array<{ kind: string }> = [];
    assert.equal(
      f.kernel.reconcileAgentDeletions((change) => changes.push(change)),
      0,
    );
    assert.deepEqual(
      changes.map(({ kind }) => kind),
      ["blocked"],
    );
    // A receipt from a different Host identity proves nothing.
    const other = f.kernel.authenticateHostAccessToken(
      f.kernel.provisionHostCredential({
        hostId: "impostor-host",
        participantIds: [f.participantId],
      }).accessToken,
    );
    f.kernel.heartbeatHost(other);
    assert.throws(
      () =>
        f.kernel.recordRuntimeTermination(other, {
          ...runtime,
          exit: { code: 0 },
        }),
      /match|generation|fenc/i,
    );
    assert.equal(f.kernel.reconcileAgentDeletions(), 0);
    // The launching Host returns with the matching runtime identity.
    f.kernel.recordRuntimeTermination(host, {
      ...runtime,
      exit: { code: null, signal: "SIGTERM" },
    });
    f.kernel.finishRunAttempt(host, {
      runAttemptId: run.runAttemptId,
      state: "cancelled",
      exitSignal: "SIGTERM",
    });
    f.kernel.retryActivation(host, {
      activationId: activation.activationId,
      error: "Agent disabled",
      retryAfterMs: 1000,
    });
    assert.equal(
      f.kernel.reconcileAgentDeletions((change) => changes.push(change)),
      1,
    );
    assert.deepEqual(
      changes.map(({ kind }) => kind),
      ["blocked", "cleared"],
    );
    const done = f.kernel.getAgentDeletionDiagnostics(f.actor, {
      agentDefinitionId: f.agentId,
    });
    assert.equal(done.status, "completed");
    assert.equal(done.blocker, undefined);
    assert.equal(
      f.db.prepare("SELECT COUNT(*) AS n FROM agent_deletion_blocks").get()!.n,
      0,
    );
  } finally {
    f.cleanup();
  }
});

test("the block diagnostic survives restart and reports one state change per change", () => {
  const f = fixture();
  try {
    const { run } = startRun(f, "restart-host");
    assert.throws(
      () => f.kernel.manageWorkspaceAgent(f.actor, f.request()),
      RuntimeTerminationProofError,
    );
    const changes: string[] = [];
    const record = (change: { agentDefinitionId: string; kind: string }) =>
      changes.push(`${change.kind}:${change.agentDefinitionId}`);
    assert.equal(f.kernel.reconcileAgentDeletions(record), 0);
    assert.equal(f.kernel.reconcileAgentDeletions(record), 0);
    assert.equal(f.kernel.reconcileAgentDeletions(record), 0);
    assert.deepEqual(changes, [`blocked:${f.agentId}`]);
    const before = f.kernel.getAgentDeletionDiagnostics(f.actor, {
      agentDefinitionId: f.agentId,
    });
    f.reopen();
    const after = f.kernel.getAgentDeletionDiagnostics(f.actor, {
      agentDefinitionId: f.agentId,
    });
    assert.equal(after.status, "blocked");
    assert.equal(after.firstObservedAt, before.firstObservedAt);
    assert.equal(after.blocker?.runAttemptId, run.runAttemptId);
    // A blocker change is reported once, not once per tick.
    f.db
      .prepare(
        "UPDATE run_attempts SET state='orphaned' WHERE run_attempt_id=?",
      )
      .run(run.runAttemptId);
    const later: string[] = [];
    const recordLater = (change: { agentDefinitionId: string; kind: string }) =>
      later.push(change.kind);
    assert.equal(f.kernel.reconcileAgentDeletions(recordLater), 0);
    assert.equal(f.kernel.reconcileAgentDeletions(recordLater), 0);
    assert.deepEqual(later, ["blocked"]);
    assert.equal(
      f.kernel.getAgentDeletionDiagnostics(f.actor, {
        agentDefinitionId: f.agentId,
      }).firstObservedAt,
      before.firstObservedAt,
    );
  } finally {
    f.cleanup();
  }
});

test("a blocked deletion keeps fencing new execution, history and the duplicate request idempotent", () => {
  const f = fixture();
  try {
    const { activation, host, run } = startRun(f, "fence-host");
    const message = f.kernel.postMessage(f.actor, {
      roomId: f.roomId,
      body: "history must stay",
      idempotencyKey: "history",
      recipients: [{ participantId: f.participantId, reason: "mention" }],
    });
    const command = f.request();
    assert.throws(
      () => f.kernel.manageWorkspaceAgent(f.actor, command),
      RuntimeTerminationProofError,
    );
    // Duplicate request: same durable intent, still blocked, no second event.
    assert.throws(
      () => f.kernel.manageWorkspaceAgent(f.actor, command),
      RuntimeTerminationProofError,
    );
    assert.equal(
      f.db
        .prepare(
          "SELECT COUNT(*) AS n FROM room_events WHERE type='agent.deletion_requested' AND aggregate_id=?",
        )
        .get(f.agentId)!.n,
      1,
    );
    // No new execution may start behind the block.
    assert.throws(
      () =>
        f.kernel.authorizeWorkerExecution(host, {
          activationId: activation.activationId,
          consumerId: "fence-test",
          hostId: host.hostId,
          participantId: f.participantId,
          roomId: f.roomId,
          runAttemptId: run.runAttemptId,
          toSeq: activation.toSeq,
        }),
      /deletion/,
    );
    assert.equal(f.kernel.leaseNextActivation(host, { leaseMs: 1000 }), null);
    // History and the Agent's durable identity survive the block.
    assert.ok(
      f.db
        .prepare("SELECT 1 FROM messages WHERE message_id=?")
        .get(message.event.aggregateId),
    );
    assert.equal(
      f.db
        .prepare(
          "SELECT state FROM agent_definitions WHERE agent_definition_id=?",
        )
        .get(f.agentId)!.state,
      "disabled",
    );
    const diagnostics = f.kernel.getAgentDeletionDiagnostics(f.actor, {
      agentDefinitionId: f.agentId,
    });
    assert.equal(diagnostics.status, "blocked");
    assert.equal(diagnostics.participantId, f.participantId);
  } finally {
    f.cleanup();
  }
});

test("the diagnostic is manager-only and reports a not-requested Agent without inventing a block", () => {
  const f = fixture();
  try {
    const stranger = f.kernel.authenticateAccessToken(
      f.kernel.provisionPrincipal({ handle: "stranger", kind: "human" })
        .accessToken,
    );
    assert.throws(
      () =>
        f.kernel.getAgentDeletionDiagnostics(stranger, {
          agentDefinitionId: f.agentId,
        }),
      /member|manager|owner/,
    );
    const idle = f.kernel.getAgentDeletionDiagnostics(f.actor, {
      agentDefinitionId: f.agentId,
    });
    assert.equal(idle.status, "not_requested");
    assert.equal(idle.blocker, undefined);
    assert.equal(idle.requestedAt, undefined);
    assert.equal(idle.recoverySteps.length, 0);
  } finally {
    f.cleanup();
  }
});
