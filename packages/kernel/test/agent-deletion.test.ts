import { bindRoleDefinitionFixture } from "./role-definition-fixture.ts";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RoomKernel, RuntimeTerminationProofError } from "../src/index.ts";
const digest = (c: string) => `sha256:${c.repeat(64)}`;
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-agent-delete-"));
  const databasePath = join(directory, "room.db");
  let kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  const owner = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
  const parent = kernel.provisionPrincipal({
    handle: "parent",
    kind: "agent",
  });
  const child = kernel.provisionPrincipal({ handle: "child", kind: "agent" });
  let actor = kernel.authenticateAccessToken(owner.accessToken);
  const workspace = kernel.createWorkspace(actor, {
    idempotencyKey: "workspace",
    name: "Created Agents",
    slug: "created-agents",
  });
  kernel.addMember(actor, {
    principalId: parent.principal.principalId,
    roomId: workspace.controlRoom.roomId,
  });
  kernel.addMember(actor, {
    principalId: child.principal.principalId,
    roomId: workspace.controlRoom.roomId,
  });
  const currentSeq = () =>
    kernel.sync(actor, {
      afterSeq: 0,
      consumerId: "created-agent-test",
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
  const create = (participantId: string, idempotencyKey: string) =>
    kernel.createAgentDefinition(actor, {
      basedOnRoomSeq: currentSeq(),
      controlRoomId: workspace.controlRoom.roomId,
      executionPolicyRevisionId: policy.policy.executionPolicyRevisionId,
      idempotencyKey,
      instructionRefs: [],
      memoryPolicyRef: {
        artifactId: "memory-policy",
        contentDigest: digest("b"),
        versionId: "memory-policy-v1",
      },
      participantId,
      role: "Agent",
      skillRefs: [],
    });

  const definition = create(parent.principal.principalId, "definition");
  const agentId = definition.definition.agentId;
  const participantId = parent.principal.principalId;
  const workRoom = kernel.createWorkspaceRoom(actor, {
    workspaceId: workspace.workspace.workspaceId,
    basedOnControlRoomSeq: currentSeq(),
    name: "Work",
    slug: "work",
    kind: "channel",
    idempotencyKey: "work-channel",
  }).room;
  kernel.addMember(actor, {
    roomId: workRoom.roomId,
    principalId: participantId,
  });
  bindRoleDefinitionFixture(
    kernel,
    actor,
    databasePath,
    agentId,
    workRoom.roomId,
    "fixture-offer",
  );
  const db = new DatabaseSync(databasePath);
  const request = () => ({
    action: "set_state" as const,
    state: "tombstoned" as const,
    agentId: agentId,
    basedOnRoomSeq: currentSeq(),
    idempotencyKey: "delete",
  });
  return {
    get kernel() {
      return kernel;
    },
    reopen() {
      kernel.close();
      kernel = new RoomKernel({ databasePath });
      kernel.initialize();
    },
    db,
    actor,
    agentId,
    participantId,
    agentActor: kernel.authenticateAccessToken(parent.accessToken),
    workspaceId: workspace.workspace.workspaceId,
    request,
    currentSeq,
    roomId: workRoom.roomId,
    cleanup() {
      db.close();
      kernel.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
test("one delete removes an enabled Agent, cancels queued delivery without acknowledging it, and replays once", () => {
  const f = fixture();
  try {
    f.kernel.postMessage(f.actor, {
      roomId: f.roomId,
      body: "pending",
      idempotencyKey: "message",
      recipients: [{ participantId: f.participantId, reason: "mention" }],
    });
    const command = f.request();
    const result = f.kernel.manageWorkspaceAgent(f.actor, command);
    assert.equal(result.agent.definition.state, "tombstoned");
    assert.equal(
      f.db
        .prepare("SELECT count(*) n FROM memberships WHERE principal_id=?")
        .get(f.participantId)!.n,
      0,
    );
    assert.equal(
      f.db
        .prepare("SELECT state FROM activations WHERE participant_id=?")
        .get(f.participantId)!.state,
      "cancelled",
    );
    assert.equal(
      f.db
        .prepare("SELECT state FROM inbox_items WHERE participant_id=?")
        .get(f.participantId)!.state,
      "pending",
    );
    assert.equal(
      f.kernel.manageWorkspaceAgent(f.actor, command).deduplicated,
      true,
    );
    assert.equal(
      f.kernel.manageWorkspaceAgent(f.actor, {
        ...command,
        basedOnRoomSeq: f.currentSeq(),
      }).deduplicated,
      true,
    );
    assert.throws(
      () =>
        f.kernel.manageWorkspaceAgent(f.actor, {
          ...command,
          idempotencyKey: "other-delete",
        }),
      /tombstoned/,
    );
  } finally {
    f.cleanup();
  }
});
test("deletion persists its stop request, blocks resurrection, and resumes only after the active lane terminates", () => {
  const f = fixture();
  try {
    const host = f.kernel.authenticateHostAccessToken(
      f.kernel.provisionHostCredential({
        hostId: "delete-host",
        participantIds: [f.participantId],
      }).accessToken,
    );
    f.kernel.heartbeatHost(host);
    f.kernel.postMessage(f.actor, {
      roomId: f.roomId,
      body: "running",
      idempotencyKey: "running",
      recipients: [{ participantId: f.participantId, reason: "mention" }],
    });
    const activation = f.kernel.leaseNextActivation(host, { leaseMs: 30000 })!;
    assert.ok(activation);
    const command = f.request();
    assert.throws(
      () => f.kernel.manageWorkspaceAgent(f.actor, command),
      RuntimeTerminationProofError,
    );
    assert.equal(
      f.kernel.getWorkspaceAgentManagementView(f.actor, f.agentId).agent
        .definition.state,
      "disabled",
    );
    assert.throws(
      () =>
        f.kernel.manageWorkspaceAgent(f.actor, {
          ...command,
          state: "enabled",
          idempotencyKey: "resurrect",
          basedOnRoomSeq: f.currentSeq(),
        }),
      /deletion/,
    );
    assert.throws(
      () =>
        f.kernel.renewActivationLease(host, {
          activationId: activation.activationId,
          leaseMs: 30000,
        }),
      /disabled/,
    );
    // Terminal Host/recovery projection: a stopped run's work remains queued for retry.
    f.db
      .prepare(
        "UPDATE activations SET state='queued',lease_owner=NULL,lease_until=NULL,lease_until_ms=NULL WHERE activation_id=?",
      )
      .run(activation.activationId);
    f.reopen();
    assert.equal(f.kernel.reconcileAgentDeletions(), 1);
    assert.equal(
      f.kernel.manageWorkspaceAgent(f.actor, command).agent.definition.state,
      "tombstoned",
    );
  } finally {
    f.cleanup();
  }
});

test("deletion rejects stale/unauthorized requests before stopping and preserves tasks while releasing their owner", () => {
  const f = fixture();
  try {
    const stranger = f.kernel.authenticateAccessToken(
      f.kernel.provisionPrincipal({ handle: "stranger", kind: "human" })
        .accessToken,
    );
    assert.throws(
      () => f.kernel.manageWorkspaceAgent(stranger, f.request()),
      /member|manager|owner/,
    );
    assert.throws(
      () =>
        f.kernel.manageWorkspaceAgent(f.actor, {
          ...f.request(),
          basedOnRoomSeq: 0,
        }),
      /stale|context/i,
    );
    assert.equal(
      f.kernel.getWorkspaceAgentManagementView(f.actor, f.agentId).agent
        .definition.state,
      "enabled",
    );
    const task = f.kernel.createTask(f.actor, {
      roomId: f.roomId,
      title: "Keep this task",
      idempotencyKey: "task",
      assigneeId: f.participantId,
    });
    f.kernel.manageWorkspaceAgent(f.actor, f.request());
    const row = f.db
      .prepare("SELECT * FROM tasks WHERE task_id=?")
      .get(task.task.taskId)!;
    assert.equal(row.assignee_id, null);
    assert.equal(row.workflow_status, "todo");
    assert.equal(row.title, "Keep this task");
    assert.ok(
      f.db
        .prepare("SELECT 1 FROM messages WHERE message_id=?")
        .get(task.task.sourceMessageId),
    );
  } finally {
    f.cleanup();
  }
});
test("deletion unassigns terminal tasks and preserves workflow history", () => {
  const f = fixture();
  try {
    const tasks = (["in_progress", "in_review", "done", "closed"] as const).map(
      (status) => {
        const task = f.kernel.createTask(f.actor, {
          roomId: f.roomId,
          title: `Keep ${status}`,
          idempotencyKey: `task-${status}`,
          assigneeId: f.participantId,
        }).task;
        // Seed each existing canonical status, independent of runtime/review machinery.
        const state = {
          in_progress: "in_progress",
          in_review: "submitted",
          done: "completed",
          closed: "cancelled",
        }[status];
        f.db
          .prepare("UPDATE tasks SET state=?,workflow_status=? WHERE task_id=?")
          .run(state, status, task.taskId);
        return { task, status };
      },
    );
    f.kernel.manageWorkspaceAgent(f.actor, f.request());
    for (const { task, status } of tasks) {
      const row = f.db
        .prepare("SELECT * FROM tasks WHERE task_id=?")
        .get(task.taskId)!;
      assert.equal(row.assignee_id, null, status);
      assert.equal(row.claimed_by, null, status);
      assert.equal(
        row.workflow_status,
        status,
        "deletion must not close, complete or reopen a task",
      );
    }
    // Simulate a pre-fix closed-task assignment surviving deletion in an older DB.
    const closed = tasks.at(-1)!.task;
    f.db
      .prepare("UPDATE tasks SET assignee_id=? WHERE task_id=?")
      .run(f.participantId, closed.taskId);
    f.reopen();
    assert.equal(
      f.db
        .prepare("SELECT assignee_id FROM tasks WHERE task_id=?")
        .get(closed.taskId)!.assignee_id,
      null,
    );
    const count = f.db
      .prepare(
        "SELECT count(*) n FROM room_events WHERE aggregate_id=? AND type='task.unassigned'",
      )
      .get(closed.taskId)!.n;
    f.reopen();
    assert.equal(
      f.db
        .prepare(
          "SELECT count(*) n FROM room_events WHERE aggregate_id=? AND type='task.unassigned'",
        )
        .get(closed.taskId)!.n,
      count,
    );
  } finally {
    f.cleanup();
  }
});

test("a live runtime, forged exit identity, and late worker calls cannot cross the deletion fence", () => {
  const f = fixture();
  try {
    const host = f.kernel.authenticateHostAccessToken(
      f.kernel.provisionHostCredential({
        hostId: "runtime-host",
        participantIds: [f.participantId],
      }).accessToken,
    );
    f.kernel.heartbeatHost(host);
    f.kernel.postMessage(f.actor, {
      roomId: f.roomId,
      body: "work",
      idempotencyKey: "work",
      recipients: [{ participantId: f.participantId, reason: "mention" }],
    });
    const activation = f.kernel.leaseNextActivation(host, { leaseMs: 30000 })!;
    const run = f.kernel.createRunAttempt(host, {
      activationId: activation.activationId,
    });
    const runtime = {
      runAttemptId: run.runAttemptId,
      runtimeRunId: "fake-runtime",
      recoveryDescriptor: { driver: "fake", metadata: {}, recoveryKey: "key" },
    };
    f.kernel.prepareRunAttemptRuntime(host, runtime);
    f.kernel.markRunAttemptRunning(host, runtime);
    const scope = {
      activationId: activation.activationId,
      consumerId: "delete-test",
      hostId: host.hostId,
      participantId: f.participantId,
      roomId: f.roomId,
      runAttemptId: run.runAttemptId,
      toSeq: activation.toSeq,
    };
    const execution = f.kernel.authorizeWorkerExecution(host, scope);
    const command = f.request();
    assert.throws(
      () => f.kernel.manageWorkspaceAgent(f.actor, command),
      RuntimeTerminationProofError,
    );
    assert.throws(() => f.kernel.syncWorker(execution, {}), /deletion/);
    assert.throws(
      () => f.kernel.authorizeWorkerExecution(host, scope),
      /deletion/,
    );
    assert.throws(
      () =>
        f.kernel.recordRuntimeTermination(host, {
          runAttemptId: run.runAttemptId,
          runtimeRunId: "wrong",
          exit: { code: 0 },
        }),
      /match/,
    );
    assert.equal(f.kernel.reconcileAgentDeletions(), 0);
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
    assert.equal(f.kernel.reconcileAgentDeletions(), 1);
    assert.equal(
      f.kernel.manageWorkspaceAgent(f.actor, command).deduplicated,
      true,
    );
    assert.equal(
      f.db
        .prepare("SELECT state FROM runtime_processes WHERE run_attempt_id=?")
        .get(run.runAttemptId)!.state,
      "terminated",
    );
  } finally {
    f.cleanup();
  }
});

test("an archived channel remains read-only while Agent deletion cleans its membership and queued work", () => {
  const f = fixture();
  try {
    const room = { roomId: f.roomId };
    f.kernel.postMessage(f.actor, {
      roomId: room.roomId,
      body: "retained history",
      idempotencyKey: "archive-message",
      recipients: [{ participantId: f.participantId, reason: "mention" }],
    });
    f.db
      .prepare("UPDATE rooms SET archived_at=? WHERE room_id=?")
      .run(new Date().toISOString(), room.roomId);
    f.kernel.manageWorkspaceAgent(f.actor, f.request());
    assert.equal(
      f.db
        .prepare(
          "SELECT count(*) n FROM memberships WHERE room_id=? AND principal_id=?",
        )
        .get(room.roomId, f.participantId)!.n,
      0,
    );
    assert.throws(
      () =>
        f.kernel.postMessage(f.actor, {
          roomId: room.roomId,
          body: "not allowed",
          idempotencyKey: "forbidden",
          recipients: [],
        }),
      /archived/,
    );
    assert.equal(
      f.db
        .prepare("SELECT body FROM messages WHERE room_id=?")
        .get(room.roomId)!.body,
      "retained history",
    );
  } finally {
    f.cleanup();
  }
});

test("deletion cancels the Agent's scheduled reminder instead of leaving a future wake", () => {
  const f = fixture();
  try {
    const task = f.kernel.createTask(f.actor, {
      roomId: f.roomId,
      title: "Reminder anchor",
      idempotencyKey: "anchor",
    });
    const now = new Date().toISOString();
    f.db
      .prepare(
        `INSERT INTO reminders(reminder_id,owner_agent_id,owner_participant_id,room_id,target_room_id,title,fire_at,fire_at_ms,status,message_id,version,created_at,updated_at) VALUES('delete-reminder',?,?,?,?,?,?,?,'scheduled',?,1,?,?)`,
      )
      .run(
        f.agentId,
        f.participantId,
        f.roomId,
        f.roomId,
        "Future wake",
        now,
        Date.now() + 100000,
        task.task.sourceMessageId,
        now,
        now,
      );
    f.kernel.manageWorkspaceAgent(f.actor, f.request());
    assert.equal(
      f.db
        .prepare(
          "SELECT status FROM reminders WHERE reminder_id='delete-reminder'",
        )
        .get()!.status,
      "canceled",
    );
    assert.equal(
      f.db
        .prepare(
          "SELECT event_type FROM reminder_events WHERE reminder_id='delete-reminder'",
        )
        .get()!.event_type,
      "canceled",
    );
  } finally {
    f.cleanup();
  }
});

test("deletion cancels stale input and reassignment operations without completing the task", () => {
  const f = fixture();
  try {
    const task = f.kernel.createTask(f.actor, {
      roomId: f.roomId,
      title: "Pending input",
      idempotencyKey: "pending-input",
      assigneeId: f.participantId,
    });
    const now = new Date().toISOString();
    const other = String(
      f.db
        .prepare("SELECT principal_id FROM principals WHERE handle='child'")
        .get()!.principal_id,
    );
    const human = String(
      f.db
        .prepare("SELECT principal_id FROM principals WHERE handle='owner'")
        .get()!.principal_id,
    );
    f.db
      .prepare(
        `INSERT INTO input_requests(input_request_id,room_id,task_id,requester_id,responder_id,question,state,created_at,updated_at) VALUES('delete-input',?,?,?,?,?,'pending',?,?)`,
      )
      .run(
        f.roomId,
        task.task.taskId,
        f.participantId,
        human,
        "Question",
        now,
        now,
      );
    f.db
      .prepare(
        `INSERT INTO task_reassignment_operations(operation_id,room_id,task_id,requested_by,previous_assignee_id,next_assignee_id,idempotency_key,reason,state,created_at,updated_at) VALUES('delete-reassignment',?,?,?,?,?,'reassignment','test','cancellation_requested',?,?)`,
      )
      .run(f.roomId, task.task.taskId, human, f.participantId, other, now, now);
    f.kernel.manageWorkspaceAgent(f.actor, f.request());
    assert.equal(
      f.db
        .prepare(
          "SELECT state FROM input_requests WHERE input_request_id='delete-input'",
        )
        .get()!.state,
      "cancelled",
    );
    assert.equal(
      f.db
        .prepare(
          "SELECT state FROM task_reassignment_operations WHERE operation_id='delete-reassignment'",
        )
        .get()!.state,
      "failed_closed",
    );
    assert.equal(
      f.db
        .prepare("SELECT workflow_status FROM tasks WHERE task_id=?")
        .get(task.task.taskId)!.workflow_status,
      "todo",
    );
  } finally {
    f.cleanup();
  }
});

test("Activity DM titles and sender labels use the renamed identity after deletion", () => {
  const f = fixture();
  try {
    const dm = f.kernel.openDirectRoom(f.actor, {
      workspaceId: f.workspaceId,
      peerPrincipalId: f.participantId,
      basedOnControlRoomSeq: f.currentSeq(),
      idempotencyKey: "activity-dm",
    });
    f.db
      .prepare(
        "UPDATE rooms SET name = 'OpenCode · native local server' WHERE room_id = ?",
      )
      .run(dm.roomId);
    f.kernel.postMessage(f.agentActor, {
      roomId: dm.roomId,
      basedOnRoomSeq: 1,
      body: "original text",
      recipients: [],
      idempotencyKey: "activity-message",
    });
    f.db
      .prepare(
        "UPDATE agent_definition_revisions SET definition_json = json_set(definition_json, '$.displayName', 'Gemini') WHERE agent_definition_id = ?",
      )
      .run(f.agentId);
    const card = () =>
      f.kernel
        .listHumanActivity(f.actor, { workspaceId: f.workspaceId })
        .items.find((item) => item.roomId === dm.roomId)!;
    assert.equal(card().title, "Gemini");
    assert.equal(card().roomName, "Gemini");
    assert.equal(card().senderName, "Gemini");
    f.kernel.manageWorkspaceAgent(f.actor, f.request());
    f.kernel.provisionPrincipal({ handle: "Gemini", kind: "agent" });
    assert.equal(card().title, "Gemini");
    assert.equal(card().senderName, "Gemini");
    assert.equal(card().latestMessage.body, "original text");
  } finally {
    f.cleanup();
  }
});
