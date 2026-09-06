import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { roomTaskWorkflowStatus, toRoomEventDto } from "@rah/runtime-protocol";

import { RoomLedger } from "./room-ledger";
import { RoomActivationLedger } from "./room-activation-ledger";

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "rah-room-task-"));
  let next = 0;
  let now = new Date("2026-09-06T10:00:00.000Z");
  let readsBeforeAdvance: number | undefined;
  let pendingAdvanceMs = 0;
  const currentTime = () => {
    if (readsBeforeAdvance === 0) {
      now = new Date(now.getTime() + pendingAdvanceMs);
      readsBeforeAdvance = undefined;
      pendingAdvanceMs = 0;
    } else if (readsBeforeAdvance !== undefined) {
      readsBeforeAdvance -= 1;
    }
    return now;
  };
  const ledger = new RoomLedger(path.join(root, "room.db"), {
    now: currentTime,
    createId: (prefix) => `${prefix}-${++next}`,
  });
  for (const principal of [
    { principalId: "human-owner", handle: "owner", kind: "human" as const },
    { principalId: "agent-worker", handle: "worker", kind: "agent" as const },
    {
      principalId: "agent-reviewer",
      handle: "reviewer",
      kind: "agent" as const,
    },
  ])
    ledger.provisionPrincipal(principal);
  const created = ledger.createRoom("human-owner", {
    roomId: "room-one",
    workspaceKey: "workspace-one",
    kind: "channel",
    slug: "one",
    name: "One",
    idempotencyKey: "create-room",
  });
  const worker = ledger.addMember("human-owner", {
    roomId: "room-one",
    principalId: "agent-worker",
    role: "member",
    basedOnRoomSeq: created.event.roomSeq,
    idempotencyKey: "add-worker",
  });
  const reviewer = ledger.addMember("human-owner", {
    roomId: "room-one",
    principalId: "agent-reviewer",
    role: "member",
    basedOnRoomSeq: worker.event.roomSeq,
    idempotencyKey: "add-reviewer",
  });
  const activations = new RoomActivationLedger(path.join(root, "room.db"), {
    now: currentTime,
    createId: (prefix) => `${prefix}-${++next}`,
  });
  return {
    activations,
    ledger,
    root,
    head: reviewer.event.roomSeq,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
    advanceAfterReads(reads: number, ms: number) {
      readsBeforeAdvance = reads;
      pendingAdvanceMs = ms;
    },
    dispose() {
      activations.close();
      ledger.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function executionFor(
  context: ReturnType<typeof fixture>,
  participantId: string,
  event: { eventId: string; roomId: string; roomSeq: number },
  label: string,
) {
  context.activations.enqueue({
    schema: "rah.room-wake.v1",
    hintId: `${label}-hint`,
    topic: "inbox.available",
    eventId: event.eventId,
    participantId,
    reason: "task_assignment",
    disposition: "activation",
    roomId: event.roomId,
    roomSeq: event.roomSeq,
  });
  const activation = context.activations.leaseNext(`${label}-host`, {
    participantId,
    leaseMs: 30_000,
  });
  assert.ok(activation?.leaseToken);
  context.activations.acknowledgePull(
    `${label}-host`,
    activation!.activationId,
    activation!.leaseToken!,
    activation!.toSeq,
  );
  const prepared = context.activations.createRunAttempt(
    `${label}-host`,
    activation!.activationId,
    activation!.leaseToken!,
    {
      runtimeProfileId: `${label}-profile`,
      provider: "fake",
      workspace: "/tmp/fake",
    },
  );
  const run = context.activations.startRunAttempt(
    `${label}-host`,
    activation!.activationId,
    activation!.leaseToken!,
    prepared.runAttemptId,
  );
  return {
    activation: activation!,
    execution: {
      ...context.activations.workerExecution(
        `${label}-host`,
        activation!.activationId,
        activation!.leaseToken!,
        run.runAttemptId,
      ),
      hostEvidence: {
        schemaVersion: 1 as const,
        workspaceRoot: "/tmp/fake",
        baseRevision: "base-revision",
        headRevision: "head-revision",
        patchDigest: `sha256:${"a".repeat(64)}`,
        verificationDigest: `sha256:${"b".repeat(64)}`,
        observedAt: "2026-09-06T10:00:00.000Z",
      },
    },
    hostId: `${label}-host`,
    run,
  };
}

function finishExecution(
  context: ReturnType<typeof fixture>,
  running: ReturnType<typeof executionFor>,
) {
  context.activations.finishRunAttempt(
    running.hostId,
    running.activation.activationId,
    running.activation.leaseToken!,
    running.run.runAttemptId,
    { state: "exited", exitCode: 0 },
  );
  return context.activations.complete(
    running.hostId,
    running.activation.activationId,
    running.activation.leaseToken!,
  );
}

test("Task lifecycle is anchored to a thread and completes only after Review and Human acceptance", () => {
  const context = fixture();
  try {
    const source = context.ledger.postMessage("human-owner", {
      roomId: "room-one",
      body: "Implement the durable Room workflow",
      idempotencyKey: "source-message",
    });
    const created = context.ledger.createTask("human-owner", {
      roomId: "room-one",
      sourceMessageId: source.value.messageId,
      title: "Implement workflow",
      assigneeId: "agent-worker",
      reviewerIds: ["agent-reviewer"],
      basedOnRoomSeq: source.event.roomSeq,
      idempotencyKey: "create-task",
    });
    assert.equal(created.value.state, "todo");
    assert.equal(roomTaskWorkflowStatus(created.value.state), "todo");
    assert.ok(created.value.threadId);
    assert.equal(
      context.ledger.listInbox("agent-worker").at(-1)?.reason,
      "task_assignment",
    );
    assert.equal(
      context.ledger.listInbox("agent-worker").at(-1)?.disposition,
      "activation",
    );

    const workerExecution = executionFor(
      context,
      "agent-worker",
      created.event,
      "worker-one",
    );
    const claimed = context.ledger.claimTask(workerExecution.execution, {
      taskId: created.value.taskId,
      basedOnRoomSeq: created.event.roomSeq,
      leaseMs: 30_000,
      idempotencyKey: "claim-task",
    });
    const started = context.ledger.startTask(workerExecution.execution, {
      taskId: created.value.taskId,
      basedOnRoomSeq: claimed.event.roomSeq,
      idempotencyKey: "start-task",
    });
    const submitted = context.ledger.submitTask(workerExecution.execution, {
      taskId: created.value.taskId,
      basedOnRoomSeq: started.event.roomSeq,
      summary: "Implemented and verified the workflow.",
      idempotencyKey: "submit-task",
    });
    assert.equal(submitted.value.state, "submitted");
    assert.equal(submitted.submission.evidence.headRevision, "head-revision");
    assert.match(submitted.submission.evidenceDigest, /^sha256:/u);
    assert.throws(
      () =>
        context.ledger.submitTask(
          {
            ...workerExecution.execution,
            hostEvidence: {
              ...workerExecution.execution.hostEvidence!,
              headRevision: "different-head",
            },
          },
          {
            taskId: created.value.taskId,
            basedOnRoomSeq: started.event.roomSeq,
            summary: "Frozen delivery",
            idempotencyKey: "submit-task",
          },
        ),
      /idempotency/u,
    );
    assert.equal(roomTaskWorkflowStatus(submitted.value.state), "in_review");
    assert.match(
      submitted.submission.submissionDigest,
      /^sha256:[a-f0-9]{64}$/,
    );
    assert.equal(submitted.message.threadId, created.value.threadId);
    assert.equal(
      context.ledger.listInbox("agent-reviewer").at(-1)?.reason,
      "task_assignment",
    );
    assert.equal(finishExecution(context, workerExecution).state, "completed");
    const replayedClaim = context.ledger.claimTask(workerExecution.execution, {
      taskId: created.value.taskId,
      basedOnRoomSeq: created.event.roomSeq,
      leaseMs: 30_000,
      idempotencyKey: "claim-task",
    });
    assert.equal(replayedClaim.deduplicated, true);
    assert.equal(replayedClaim.event.eventId, claimed.event.eventId);
    assert.throws(
      () =>
        context.ledger.claimTask(
          {
            ...workerExecution.execution,
            workerId: "forged-host",
          },
          {
            taskId: created.value.taskId,
            basedOnRoomSeq: created.event.roomSeq,
            leaseMs: 30_000,
            idempotencyKey: "claim-task",
          },
        ),
      /execution fence/u,
    );
    assert.throws(
      () =>
        context.ledger.acceptTask("human-owner", {
          roomId: "room-one",
          taskId: created.value.taskId,
          basedOnRoomSeq: submitted.event.roomSeq,
          summary: "Cannot bypass review.",
          idempotencyKey: "premature-accept",
        }),
      /reviewer approval/u,
    );

    const reviewExecution = executionFor(
      context,
      "agent-reviewer",
      submitted.event,
      "reviewer-one",
    );
    const reviewed = context.ledger.reviewTask(reviewExecution.execution, {
      taskId: created.value.taskId,
      basedOnRoomSeq: submitted.event.roomSeq,
      disposition: "approved",
      summary: "Independently verified.",
      idempotencyKey: "review-task",
    });
    assert.equal(
      reviewed.review.submissionDigest,
      submitted.submission.submissionDigest,
    );
    assert.equal(reviewed.value.state, "submitted");
    assert.equal(roomTaskWorkflowStatus(reviewed.value.state), "in_review");
    const approvalNotice = context.ledger.listInbox("agent-worker").at(-1);
    assert.equal(approvalNotice?.eventId, reviewed.event.eventId);
    assert.equal(approvalNotice?.disposition, "notification");
    const humanAttention = context.ledger.listInbox("human-owner").at(-1);
    assert.equal(humanAttention?.eventId, reviewed.event.eventId);
    assert.equal(humanAttention?.eventType, "review.submitted");
    assert.equal(humanAttention?.reason, "input_resolved");
    assert.equal(humanAttention?.disposition, "notification");
    assert.equal(finishExecution(context, reviewExecution).state, "completed");
    const accepted = context.ledger.acceptTask("human-owner", {
      roomId: "room-one",
      taskId: created.value.taskId,
      basedOnRoomSeq: reviewed.event.roomSeq,
      summary: "Human acceptance after independent review.",
      idempotencyKey: "accept-task",
    });
    assert.equal(accepted.value.state, "completed");
    assert.equal(roomTaskWorkflowStatus(accepted.value.state), "done");
    assert.ok(accepted.value.completedAt);
    assert.equal(
      context.ledger.listTasks("human-owner", "room-one")[0]?.state,
      "completed",
    );
    const completionAttention = context.ledger.listInbox("agent-worker").at(-1);
    assert.equal(completionAttention?.eventType, "task.completed");
    assert.equal(completionAttention?.disposition, "notification");
    const transport = context.ledger.syncRoom("human-owner", {
      roomId: "room-one",
      afterSeq: context.head,
      limit: 100,
    });
    assert.equal(transport.mode, "event_page");
    assert.ok(
      transport.events
        .map(toRoomEventDto)
        .some((event) => event.type === "task.completed"),
    );
    assert.throws(
      () =>
        context.ledger.cancelTask("human-owner", {
          roomId: "room-one",
          taskId: created.value.taskId,
          basedOnRoomSeq: reviewed.event.roomSeq,
          reason: "A different terminal intent",
          idempotencyKey: "accept-task",
        }),
      /idempotency/u,
    );
  } finally {
    context.dispose();
  }
});

test("Task mutation revalidates the Worker lease inside its write transaction", () => {
  const context = fixture();
  try {
    const source = context.ledger.postMessage("human-owner", {
      roomId: "room-one",
      body: "Fence the transaction",
      idempotencyKey: "transaction-fence-source",
    });
    const created = context.ledger.createTask("human-owner", {
      roomId: "room-one",
      sourceMessageId: source.value.messageId,
      title: "Fence transaction",
      assigneeId: "agent-worker",
      reviewerIds: ["agent-reviewer"],
      basedOnRoomSeq: source.event.roomSeq,
      idempotencyKey: "transaction-fence-task",
    });
    const worker = executionFor(
      context,
      "agent-worker",
      created.event,
      "transaction-fence",
    );
    context.advanceAfterReads(1, 31_000);
    assert.throws(
      () =>
        context.ledger.claimTask(worker.execution, {
          taskId: created.value.taskId,
          basedOnRoomSeq: created.event.roomSeq,
          leaseMs: 30_000,
          idempotencyKey: "transaction-fence-claim",
        }),
      /active Worker execution/,
    );
    assert.equal(
      context.ledger
        .listTasks("human-owner", "room-one")
        .find((task) => task.taskId === created.value.taskId)?.state,
      "todo",
    );
  } finally {
    context.dispose();
  }
});

test("Task creation rejects dead-end Human or missing execution principals", () => {
  const context = fixture();
  try {
    const source = context.ledger.postMessage("human-owner", {
      roomId: "room-one",
      body: "This Task must have runnable Agent owners",
      idempotencyKey: "principal-source",
    });
    assert.throws(
      () =>
        context.ledger.createTask("human-owner", {
          roomId: "room-one",
          sourceMessageId: source.value.messageId,
          title: "Missing assignee",
          reviewerIds: ["agent-reviewer"],
          basedOnRoomSeq: source.event.roomSeq,
          idempotencyKey: "missing-assignee",
        } as never),
      /requires an Agent assignee/u,
    );
    assert.throws(
      () =>
        context.ledger.createTask("human-owner", {
          roomId: "room-one",
          sourceMessageId: source.value.messageId,
          title: "Human assignee",
          assigneeId: "human-owner",
          reviewerIds: ["agent-reviewer"],
          basedOnRoomSeq: source.event.roomSeq,
          idempotencyKey: "human-assignee",
        }),
      /assignee must be an Agent/u,
    );
    assert.throws(
      () =>
        context.ledger.createTask("human-owner", {
          roomId: "room-one",
          sourceMessageId: source.value.messageId,
          title: "Human reviewer",
          assigneeId: "agent-worker",
          reviewerIds: ["human-owner"],
          basedOnRoomSeq: source.event.roomSeq,
          idempotencyKey: "human-reviewer",
        }),
      /reviewer must be an Agent/u,
    );
  } finally {
    context.dispose();
  }
});

test("expired Worker and Task claims are fenced and recoverable by a new RunAttempt", () => {
  const context = fixture();
  try {
    const source = context.ledger.postMessage("human-owner", {
      roomId: "room-one",
      body: "Recover this work after a host crash",
      idempotencyKey: "recovery-source",
    });
    const task = context.ledger.createTask("human-owner", {
      roomId: "room-one",
      sourceMessageId: source.value.messageId,
      title: "Recoverable delivery",
      assigneeId: "agent-worker",
      reviewerIds: ["agent-reviewer"],
      basedOnRoomSeq: source.event.roomSeq,
      idempotencyKey: "recovery-task",
    });
    const first = executionFor(
      context,
      "agent-worker",
      task.event,
      "recovery-first",
    );
    const claimed = context.ledger.claimTask(first.execution, {
      taskId: task.value.taskId,
      basedOnRoomSeq: task.event.roomSeq,
      leaseMs: 30_000,
      idempotencyKey: "recovery-claim-first",
    });

    context.advance(30_001);
    const second = executionFor(
      context,
      "agent-worker",
      task.event,
      "recovery-second",
    );
    assert.throws(
      () =>
        context.ledger.startTask(first.execution, {
          taskId: task.value.taskId,
          basedOnRoomSeq: claimed.event.roomSeq,
          idempotencyKey: "stale-start",
        }),
      /active Worker execution/u,
    );
    const reclaimed = context.ledger.claimTask(second.execution, {
      taskId: task.value.taskId,
      basedOnRoomSeq: claimed.event.roomSeq,
      leaseMs: 30_000,
      idempotencyKey: "recovery-claim-second",
    });
    assert.equal(reclaimed.value.state, "claimed");
    assert.equal(second.run.attemptNumber, 2);
  } finally {
    context.dispose();
  }
});

test("canonical Task and Review outcomes survive a crash before Activation completion", () => {
  const context = fixture();
  try {
    const source = context.ledger.postMessage("human-owner", {
      roomId: "room-one",
      body: "Commit the result before the host crashes",
      idempotencyKey: "crash-source",
    });
    const task = context.ledger.createTask("human-owner", {
      roomId: "room-one",
      sourceMessageId: source.value.messageId,
      title: "Crash-safe delivery",
      assigneeId: "agent-worker",
      reviewerIds: ["agent-reviewer"],
      basedOnRoomSeq: source.event.roomSeq,
      idempotencyKey: "crash-task",
    });
    const worker = executionFor(
      context,
      "agent-worker",
      task.event,
      "crash-worker",
    );
    const claim = context.ledger.claimTask(worker.execution, {
      taskId: task.value.taskId,
      basedOnRoomSeq: task.event.roomSeq,
      leaseMs: 30_000,
      idempotencyKey: "crash-claim",
    });
    const submitted = context.ledger.submitTask(worker.execution, {
      taskId: task.value.taskId,
      basedOnRoomSeq: claim.event.roomSeq,
      summary: "Canonical submission committed.",
      idempotencyKey: "crash-submit",
    });
    context.advance(30_001);
    assert.equal(
      context.activations.leaseNext("replacement-worker", {
        participantId: "agent-worker",
        leaseMs: 30_000,
      }),
      undefined,
    );
    assert.equal(context.activations.listPending("agent-worker").length, 0);
    assert.equal(
      context.ledger.listInbox("agent-worker")[0]?.state,
      "acknowledged",
    );

    const reviewer = executionFor(
      context,
      "agent-reviewer",
      submitted.event,
      "crash-reviewer",
    );
    context.ledger.reviewTask(reviewer.execution, {
      taskId: task.value.taskId,
      basedOnRoomSeq: submitted.event.roomSeq,
      disposition: "approved",
      summary: "Canonical approval committed.",
      idempotencyKey: "crash-review",
    });
    context.advance(30_001);
    assert.equal(
      context.activations.leaseNext("replacement-reviewer", {
        participantId: "agent-reviewer",
        leaseMs: 30_000,
      }),
      undefined,
    );
    assert.equal(context.activations.listPending("agent-reviewer").length, 0);
    assert.equal(
      context.ledger.listInbox("agent-reviewer")[0]?.state,
      "acknowledged",
    );
  } finally {
    context.dispose();
  }
});

test("Human close is canonical cancelled state and idempotency binds the exact intent", () => {
  const context = fixture();
  try {
    const source = context.ledger.postMessage("human-owner", {
      roomId: "room-one",
      body: "Close this work explicitly",
      idempotencyKey: "close-source",
    });
    const created = context.ledger.createTask("human-owner", {
      roomId: "room-one",
      sourceMessageId: source.value.messageId,
      title: "Disposable task",
      assigneeId: "agent-worker",
      reviewerIds: ["agent-reviewer"],
      basedOnRoomSeq: source.event.roomSeq,
      idempotencyKey: "close-create",
    });
    const cancelled = context.ledger.cancelTask("human-owner", {
      roomId: "room-one",
      taskId: created.value.taskId,
      basedOnRoomSeq: created.event.roomSeq,
      reason: "No longer required",
      idempotencyKey: "close-task",
    });
    assert.equal(cancelled.value.state, "cancelled");
    assert.equal(roomTaskWorkflowStatus(cancelled.value.state), "closed");
    assert.equal(
      context.ledger.listInbox("agent-worker").at(-1)?.disposition,
      "notification",
    );
    const replay = context.ledger.cancelTask("human-owner", {
      roomId: "room-one",
      taskId: created.value.taskId,
      basedOnRoomSeq: created.event.roomSeq,
      reason: "No longer required",
      idempotencyKey: "close-task",
    });
    assert.equal(replay.deduplicated, true);
    assert.throws(
      () =>
        context.ledger.cancelTask("human-owner", {
          roomId: "room-one",
          taskId: created.value.taskId,
          basedOnRoomSeq: created.event.roomSeq,
          reason: "Different intent",
          idempotencyKey: "close-task",
        }),
      /idempotency/u,
    );
  } finally {
    context.dispose();
  }
});

test("Changes requested reopens canonical Task state without a parallel workflow column", () => {
  const context = fixture();
  try {
    const source = context.ledger.postMessage("human-owner", {
      roomId: "room-one",
      body: "Needs revision",
      idempotencyKey: "revision-source",
    });
    const created = context.ledger.createTask("human-owner", {
      roomId: "room-one",
      sourceMessageId: source.value.messageId,
      title: "Revise work",
      assigneeId: "agent-worker",
      reviewerIds: ["agent-reviewer"],
      basedOnRoomSeq: source.event.roomSeq,
      idempotencyKey: "revision-create",
    });
    const workerExecution = executionFor(
      context,
      "agent-worker",
      created.event,
      "worker-two",
    );
    const claimed = context.ledger.claimTask(workerExecution.execution, {
      taskId: created.value.taskId,
      basedOnRoomSeq: created.event.roomSeq,
      leaseMs: 30_000,
      idempotencyKey: "revision-claim",
    });
    const submitted = context.ledger.submitTask(workerExecution.execution, {
      taskId: created.value.taskId,
      basedOnRoomSeq: claimed.event.roomSeq,
      summary: "First delivery",
      idempotencyKey: "revision-submit",
    });
    assert.equal(finishExecution(context, workerExecution).state, "completed");
    const reviewExecution = executionFor(
      context,
      "agent-reviewer",
      submitted.event,
      "reviewer-two",
    );
    const review = context.ledger.reviewTask(reviewExecution.execution, {
      taskId: created.value.taskId,
      basedOnRoomSeq: submitted.event.roomSeq,
      disposition: "changes_requested",
      summary: "Add the missing recovery assertion.",
      idempotencyKey: "revision-review",
    });
    assert.equal(review.value.state, "todo");
    assert.equal(review.value.submissionSummary, undefined);
    assert.equal(roomTaskWorkflowStatus(review.value.state), "todo");
    const reopened = context.ledger.listTaskPage("human-owner", "room-one");
    assert.equal(reopened.items[0]?.currentSubmission, undefined);
    assert.equal(reopened.items[0]?.currentReviewStatuses, undefined);
    assert.equal(
      context.ledger.listInbox("agent-worker").at(-1)?.eventId,
      review.event.eventId,
    );
    assert.equal(
      context.ledger.listInbox("agent-worker").at(-1)?.disposition,
      "activation",
    );
    assert.equal(finishExecution(context, reviewExecution).state, "completed");
  } finally {
    context.dispose();
  }
});

test("Task pages remain bounded by projecting Review states without Review prose", () => {
  const context = fixture();
  try {
    const tasks: Array<{ taskId: string; messageId: string }> = [];
    for (let index = 0; index < 100; index += 1) {
      const source = context.ledger.postMessage("human-owner", {
        roomId: "room-one",
        body: `bounded evidence ${index}`,
        idempotencyKey: `budget-source-${index}`,
      });
      const created = context.ledger.createTask("human-owner", {
        roomId: "room-one",
        sourceMessageId: source.value.messageId,
        title: `Bounded Task ${index}`,
        assigneeId: "agent-worker",
        reviewerIds: ["agent-reviewer"],
        basedOnRoomSeq: source.event.roomSeq,
        idempotencyKey: `budget-task-${index}`,
      });
      tasks.push({
        taskId: created.value.taskId,
        messageId: source.value.messageId,
      });
    }
    const database = new DatabaseSync(path.join(context.root, "room.db"));
    const digest = `sha256:${"a".repeat(64)}`;
    const evidenceDigest = `sha256:${"b".repeat(64)}`;
    const createdAt = "2026-09-06T10:00:00.000Z";
    const evidence = JSON.stringify({
      schemaVersion: 1,
      workspaceRoot: "/tmp/rah-bounded-task",
      baseRevision: "base",
      headRevision: "head",
      patchDigest: digest,
      verificationDigest: evidenceDigest,
      observedAt: createdAt,
    });
    const updateTask = database.prepare(
      `UPDATE room_tasks SET state = 'submitted', submission_summary = ?,
       submitted_at = ?, updated_at = ? WHERE task_id = ?`,
    );
    const insertSubmission = database.prepare(
      `INSERT INTO room_task_submissions(
        submission_id, task_id, room_id, submission_number, submission_digest,
        producer_id, message_id, summary, evidence_json, evidence_digest, created_at
      ) VALUES (?, ?, 'room-one', 1, ?, 'agent-worker', ?, ?, ?, ?, ?)`,
    );
    const insertReview = database.prepare(
      `INSERT INTO room_task_reviews(
        review_id, task_id, room_id, submission_id, submission_digest,
        reviewer_id, disposition, summary, message_id, created_at
      ) VALUES (?, ?, 'room-one', ?, ?, 'agent-reviewer', 'approved', ?, ?, ?)`,
    );
    database.exec("BEGIN IMMEDIATE");
    for (const [index, task] of tasks.entries()) {
      const submissionId = `budget-submission-${index}`;
      updateTask.run("frozen delivery", createdAt, createdAt, task.taskId);
      insertSubmission.run(
        submissionId,
        task.taskId,
        digest,
        task.messageId,
        "frozen delivery",
        evidence,
        evidenceDigest,
        createdAt,
      );
      insertReview.run(
        `budget-review-${index}`,
        task.taskId,
        submissionId,
        digest,
        "复".repeat(8_192),
        task.messageId,
        createdAt,
      );
    }
    database.exec("COMMIT");
    database.close();

    const page = context.ledger.listTaskPage("human-owner", "room-one", {
      limit: 100,
    });
    assert.equal(page.items.length, 100);
    assert.equal(page.hasMore, false);
    assert.ok(
      Buffer.byteLength(JSON.stringify(page.items), "utf8") < 1_048_576,
    );
    assert.equal(
      page.items.at(-1)?.currentReviewStatuses?.[0]?.reviewerId,
      "agent-reviewer",
    );
    assert.equal(
      Object.hasOwn(
        page.items.at(-1)?.currentReviewStatuses?.[0] ?? {},
        "summary",
      ),
      false,
    );
  } finally {
    context.dispose();
  }
});

test("rework freezes a new delivery and only Human acceptance releases dependent execution", () => {
  const context = fixture();
  try {
    const source = context.ledger.postMessage("human-owner", {
      roomId: "room-one",
      body: "Implement the reviewed foundation",
      idempotencyKey: "flow-source",
    });
    const foundation = context.ledger.createTask("human-owner", {
      roomId: "room-one",
      sourceMessageId: source.value.messageId,
      title: "Reviewed foundation",
      assigneeId: "agent-worker",
      reviewerIds: ["agent-reviewer"],
      basedOnRoomSeq: source.event.roomSeq,
      idempotencyKey: "flow-foundation",
    });
    const dependentSource = context.ledger.postMessage("human-owner", {
      roomId: "room-one",
      body: "Continue only after the foundation is accepted",
      idempotencyKey: "flow-dependent-source",
    });
    const dependent = context.ledger.createTask("human-owner", {
      roomId: "room-one",
      sourceMessageId: dependentSource.value.messageId,
      title: "Dependent delivery",
      assigneeId: "agent-worker",
      reviewerIds: ["agent-reviewer"],
      dependencyTaskIds: [foundation.value.taskId],
      basedOnRoomSeq: dependentSource.event.roomSeq,
      idempotencyKey: "flow-dependent",
    });
    assert.equal(
      context.ledger
        .listInbox("agent-worker")
        .some((item) => item.eventId === dependent.event.eventId),
      false,
    );

    const firstWorker = executionFor(
      context,
      "agent-worker",
      foundation.event,
      "flow-worker-one",
    );
    const firstClaim = context.ledger.claimTask(firstWorker.execution, {
      taskId: foundation.value.taskId,
      basedOnRoomSeq: dependent.event.roomSeq,
      leaseMs: 30_000,
      idempotencyKey: "flow-claim-one",
    });
    const firstSubmission = context.ledger.submitTask(firstWorker.execution, {
      taskId: foundation.value.taskId,
      basedOnRoomSeq: firstClaim.event.roomSeq,
      summary: "First frozen delivery",
      idempotencyKey: "flow-submit-one",
    });
    assert.equal(finishExecution(context, firstWorker).state, "completed");

    const firstReviewer = executionFor(
      context,
      "agent-reviewer",
      firstSubmission.event,
      "flow-reviewer-one",
    );
    const rejected = context.ledger.reviewTask(firstReviewer.execution, {
      taskId: foundation.value.taskId,
      basedOnRoomSeq: firstSubmission.event.roomSeq,
      disposition: "changes_requested",
      summary: "Add the missing recovery evidence",
      idempotencyKey: "flow-review-one",
    });
    assert.equal(rejected.value.state, "todo");
    assert.equal(finishExecution(context, firstReviewer).state, "completed");

    const secondWorker = executionFor(
      context,
      "agent-worker",
      rejected.event,
      "flow-worker-two",
    );
    const secondClaim = context.ledger.claimTask(secondWorker.execution, {
      taskId: foundation.value.taskId,
      basedOnRoomSeq: rejected.event.roomSeq,
      leaseMs: 30_000,
      idempotencyKey: "flow-claim-two",
    });
    const secondSubmission = context.ledger.submitTask(secondWorker.execution, {
      taskId: foundation.value.taskId,
      basedOnRoomSeq: secondClaim.event.roomSeq,
      summary: "Second frozen delivery with recovery evidence",
      idempotencyKey: "flow-submit-two",
    });
    assert.notEqual(
      secondSubmission.submission.submissionDigest,
      firstSubmission.submission.submissionDigest,
    );
    assert.equal(secondSubmission.submission.submissionNumber, 2);
    assert.equal(finishExecution(context, secondWorker).state, "completed");

    const secondReviewer = executionFor(
      context,
      "agent-reviewer",
      secondSubmission.event,
      "flow-reviewer-two",
    );
    const approved = context.ledger.reviewTask(secondReviewer.execution, {
      taskId: foundation.value.taskId,
      basedOnRoomSeq: secondSubmission.event.roomSeq,
      disposition: "approved",
      summary: "Recovery evidence independently verified",
      idempotencyKey: "flow-review-two",
    });
    assert.equal(approved.value.state, "submitted");
    assert.equal(finishExecution(context, secondReviewer).state, "completed");
    assert.equal(
      context.ledger
        .listInbox("agent-worker")
        .some((item) => item.eventId === dependent.event.eventId),
      false,
    );

    const accepted = context.ledger.acceptTask("human-owner", {
      roomId: "room-one",
      taskId: foundation.value.taskId,
      basedOnRoomSeq: approved.event.roomSeq,
      summary: "Accepted after rework and independent review",
      idempotencyKey: "flow-accept",
    });
    assert.equal(accepted.value.state, "completed");
    const released = context.ledger.listInbox("agent-worker").at(-1);
    assert.equal(released?.eventType, "task.dependency_resolved");
    assert.equal(released?.reason, "dependency_resolved");
    assert.equal(
      context.ledger
        .listTasks("human-owner", "room-one")
        .find((task) => task.taskId === dependent.value.taskId)?.state,
      "todo",
    );
  } finally {
    context.dispose();
  }
});

test("cancelling a prerequisite canonically cancels its unfulfillable dependents", () => {
  const context = fixture();
  try {
    const source = context.ledger.postMessage("human-owner", {
      roomId: "room-one",
      body: "Foundation that may be cancelled",
      idempotencyKey: "cancel-tree-source",
    });
    const foundation = context.ledger.createTask("human-owner", {
      roomId: "room-one",
      sourceMessageId: source.value.messageId,
      title: "Foundation",
      assigneeId: "agent-worker",
      reviewerIds: ["agent-reviewer"],
      basedOnRoomSeq: source.event.roomSeq,
      idempotencyKey: "cancel-tree-foundation",
    });
    const dependentSource = context.ledger.postMessage("human-owner", {
      roomId: "room-one",
      body: "Depends on foundation",
      idempotencyKey: "cancel-tree-dependent-source",
    });
    const dependent = context.ledger.createTask("human-owner", {
      roomId: "room-one",
      sourceMessageId: dependentSource.value.messageId,
      title: "Dependent",
      assigneeId: "agent-worker",
      reviewerIds: ["agent-reviewer"],
      dependencyTaskIds: [foundation.value.taskId],
      basedOnRoomSeq: dependentSource.event.roomSeq,
      idempotencyKey: "cancel-tree-dependent",
    });
    const cancelled = context.ledger.cancelTask("human-owner", {
      roomId: "room-one",
      taskId: foundation.value.taskId,
      basedOnRoomSeq: dependent.event.roomSeq,
      reason: "Foundation is no longer required",
      idempotencyKey: "cancel-tree-root",
    });
    assert.equal(cancelled.value.state, "cancelled");
    const tasks = context.ledger.listTasks("human-owner", "room-one");
    const dependentAfter = tasks.find(
      (task) => task.taskId === dependent.value.taskId,
    );
    assert.equal(dependentAfter?.state, "cancelled");
    assert.equal(
      dependentAfter?.cancellationReason,
      `Dependency ${foundation.value.taskId} was cancelled`,
    );
    const events = context.ledger.syncRoom("human-owner", {
      roomId: "room-one",
      afterSeq: dependent.event.roomSeq,
    });
    assert.equal(events.mode, "event_page");
    if (events.mode !== "event_page") throw new Error("expected event page");
    assert.equal(
      events.events.filter((event) => event.type === "task.cancelled").length,
      2,
    );
  } finally {
    context.dispose();
  }
});
