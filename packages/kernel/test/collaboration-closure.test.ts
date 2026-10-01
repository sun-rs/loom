import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { afterEach } from "node:test";

import {
  AuthenticatedHostContext,
  ConflictError,
  ForbiddenError,
  IdempotencyConflictError,
  RoomKernel,
} from "../src/index.ts";
const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) rmSync(directory, { force: true, recursive: true });
  }
});

function createClock(initial = "2026-08-25T00:00:00.000Z") {
  let now = new Date(initial).getTime();
  return {
    now: () => new Date(now),
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-kernel-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "room.db");
  const clock = createClock();
  const kernel = new RoomKernel({ databasePath, now: clock.now });
  kernel.initialize();

  const humanProvisioning = kernel.provisionPrincipal({
    handle: "sun",
    kind: "human",
  });
  const agentProvisioning = kernel.provisionPrincipal({
    handle: "codex",
    kind: "agent",
  });
  const otherAgentProvisioning = kernel.provisionPrincipal({
    handle: "opencode",
    kind: "agent",
  });
  const human = humanProvisioning.principal;
  const agent = agentProvisioning.principal;
  const otherAgent = otherAgentProvisioning.principal;
  const humanActor = kernel.authenticateAccessToken(
    humanProvisioning.accessToken,
  );
  const agentActor = kernel.authenticateAccessToken(
    agentProvisioning.accessToken,
  );
  const otherAgentActor = kernel.authenticateAccessToken(
    otherAgentProvisioning.accessToken,
  );
  const room = kernel.createRoom(humanActor, {
    name: "Kernel test",
    slug: "kernel-test",
  });
  // These lifecycle fixtures explicitly exercise the autonomous Channel policy.
  const policyDb = new DatabaseSync(databasePath);
  policyDb
    .prepare("UPDATE rooms SET allow_instance_task_creation=1 WHERE room_id=?")
    .run(room.roomId);
  policyDb.close();
  kernel.addMember(humanActor, {
    principalId: agent.principalId,
    roomId: room.roomId,
  });
  kernel.addMember(humanActor, {
    principalId: otherAgent.principalId,
    roomId: room.roomId,
  });

  return {
    agent,
    agentActor,
    clock,
    databasePath,
    human,
    humanAccessToken: humanProvisioning.accessToken,
    humanActor,
    kernel,
    otherAgent,
    otherAgentActor,
    room,
  };
}

function authenticateHost(
  kernel: RoomKernel,
  hostId: string,
  participantIds: string[],
): AuthenticatedHostContext {
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({ hostId, participantIds }).accessToken,
  );
  kernel.heartbeatHost(host);
  return host;
}

function startWorkerExecution(
  kernel: RoomKernel,
  label: string,
  participantId: string,
  roomId: string,
) {
  const host = authenticateHost(kernel, `${label}-host`, [participantId]);
  const activation = kernel.leaseNextActivation(host, { leaseMs: 30_000 });
  assert.ok(activation);
  const run = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  prepareAndMarkRunAttemptRunning(kernel, host, {
    recoveryDescriptor: fakeRecovery(`${label}-runtime`),
    runAttemptId: run.runAttemptId,
    runtimeRunId: `${label}-runtime`,
  });
  const execution = kernel.authorizeWorkerExecution(host, {
    activationId: activation.activationId,
    consumerId: `${label}-consumer`,
    hostId: host.hostId,
    participantId,
    roomId,
    runAttemptId: run.runAttemptId,
    toSeq: activation.toSeq,
  });
  const delivery = kernel.syncWorker(execution, {});
  kernel.acknowledgeWorkerCursor(execution, {
    throughSeq: delivery.cursorAfter,
  });
  return { activation, execution, host };
}

function fakeRecovery(recoveryKey: string) {
  return {
    driver: "fake-runtime",
    metadata: {},
    recoveryKey,
  };
}

function prepareAndMarkRunAttemptRunning(
  kernel: RoomKernel,
  host: AuthenticatedHostContext,
  input: Parameters<RoomKernel["markRunAttemptRunning"]>[1],
): void {
  kernel.prepareRunAttemptRuntime(host, input);
  kernel.markRunAttemptRunning(host, input);
}

function threads(f: ReturnType<typeof createFixture>) {
  const { kernel, humanActor, room, agent } = f;
  const rootA = kernel.postMessage(humanActor, {
    body: "A",
    roomId: room.roomId,
    recipients: [],
    idempotencyKey: "root-a",
  });
  const rootB = kernel.postMessage(humanActor, {
    body: "B",
    roomId: room.roomId,
    recipients: [],
    idempotencyKey: "root-b",
  });
  const a = kernel.createThread(humanActor, {
    roomId: room.roomId,
    rootMessageId: rootA.event.aggregateId,
    recipientIds: [agent.principalId],
    basedOnRoomSeq: rootB.event.roomSeq,
    idempotencyKey: "thread-a",
  });
  const b = kernel.createThread(humanActor, {
    roomId: room.roomId,
    rootMessageId: rootB.event.aggregateId,
    recipientIds: [agent.principalId],
    basedOnRoomSeq: a.event.roomSeq,
    idempotencyKey: "thread-b",
  });
  return { a, b };
}

test("coalesced Threads require an explicit target and replies retain the selected Thread", () => {
  const f = createFixture();
  try {
    const { a, b } = threads(f);
    const { activation, execution } = startWorkerExecution(
      f.kernel,
      "threads",
      f.agent.principalId,
      f.room.roomId,
    );
    assert.throws(
      () =>
        f.kernel.postWorkerMessage(execution, {
          body: "ambiguous",
          basedOnRoomSeq: activation.toSeq,
          idempotencyKey: "ambiguous",
        }),
      /explicit.*Thread|explicit.*target/i,
    );
    const first = f.kernel.postWorkerMessage(execution, {
      body: "Answer A",
      threadId: a.thread.threadId,
      basedOnRoomSeq: activation.toSeq,
      idempotencyKey: "answer-a",
    });
    const second = f.kernel.postWorkerMessage(execution, {
      body: "Answer B",
      threadId: b.thread.threadId,
      basedOnRoomSeq: activation.toSeq,
      idempotencyKey: "answer-b",
    });
    assert.ok("event" in first && "event" in second);
    assert.equal(first.event.payload.threadId, a.thread.threadId);
    assert.equal(second.event.payload.threadId, b.thread.threadId);
  } finally {
    f.kernel.close();
  }
});

test("an explicit old Task Thread is addressable without Task delivery in this Activation", () => {
  const f = createFixture();
  try {
    const task = f.kernel.createTask(f.humanActor, {
      roomId: f.room.roomId,
      title: "Old work",
      assigneeId: f.otherAgent.principalId,
      idempotencyKey: "old-task",
    });
    f.kernel.postMessage(f.humanActor, {
      roomId: f.room.roomId,
      body: "Please audit the old task",
      recipients: [{ participantId: f.agent.principalId, reason: "mention" }],
      idempotencyKey: "audit",
    });
    const { activation, execution } = startWorkerExecution(
      f.kernel,
      "old-thread",
      f.agent.principalId,
      f.room.roomId,
    );
    const read = f.kernel.getWorkerTask(execution, {
      taskId: task.task.taskId,
    });
    assert.equal(read.threadId, task.task.threadId);
    const reply = f.kernel.postWorkerMessage(execution, {
      body: "Audit evidence",
      threadId: read.threadId,
      basedOnRoomSeq: activation.toSeq,
      idempotencyKey: "audit-reply",
    });
    assert.ok("event" in reply);
    assert.equal(reply.event.payload.threadId, read.threadId);
    assert.throws(
      () =>
        f.kernel.claimTask(execution, {
          taskId: read.taskId,
          basedOnRoomSeq: activation.toSeq,
          leaseMs: 30000,
          idempotencyKey: "steal",
        }),
      ForbiddenError,
    );
  } finally {
    f.kernel.close();
  }
});

test("a committed Worker reply replays unchanged after Room membership changes", () => {
  const f = createFixture();
  try {
    f.kernel.postMessage(f.humanActor, {
      body: "Please reply",
      roomId: f.room.roomId,
      recipients: [{ participantId: f.agent.principalId, reason: "mention" }],
      idempotencyKey: "request",
    });
    const { activation, execution } = startWorkerExecution(
      f.kernel,
      "replay",
      f.agent.principalId,
      f.room.roomId,
    );
    const command = {
      body: "Done",
      basedOnRoomSeq: activation.toSeq,
      idempotencyKey: "reply",
    };
    const posted = f.kernel.postWorkerMessage(execution, command);
    const added = f.kernel.provisionPrincipal({
      handle: "third",
      kind: "agent",
    });
    f.kernel.addMember(f.humanActor, {
      roomId: f.room.roomId,
      principalId: added.principal.principalId,
    });
    const replay = f.kernel.postWorkerMessage(execution, command);
    assert.ok("event" in posted && "event" in replay);
    assert.equal(replay.deduplicated, true);
    assert.deepEqual(replay.event, posted.event);
    assert.throws(
      () =>
        f.kernel.postWorkerMessage(execution, {
          ...command,
          body: "Different",
        }),
      IdempotencyConflictError,
    );
  } finally {
    f.kernel.close();
  }
});

// An Agent-authored Task asks the Room, not its own creator: any current Human
// membership yields a deterministic responder and only an empty one fails.
for (const humanCount of [0, 1, 2])
  test(`Agent-authored Task input resolves the Room's Human responder (${humanCount})`, () => {
    const f = createFixture();
    try {
      const seq = f.kernel.sync(f.otherAgentActor, {
        consumerId: "author",
        roomId: f.room.roomId,
      }).latestRoomSeq;
      const msg = f.kernel.postMessage(f.otherAgentActor, {
        basedOnRoomSeq: seq,
        // evo §38: an agent's mention must be a canonical body @mention.
        body: "@codex Implement a file",
        roomId: f.room.roomId,
        recipients: [{ participantId: f.agent.principalId, reason: "mention" }],
        idempotencyKey: "agent-work",
      });
      if (humanCount === 2) {
        const human = f.kernel.provisionPrincipal({
          handle: "second-human",
          kind: "human",
        });
        f.kernel.addMember(f.humanActor, {
          roomId: f.room.roomId,
          principalId: human.principal.principalId,
        });
      }
      // Simulates persisted membership loss without conflating this test with
      // the Human management policy that protects a Room's sole manager.
      if (humanCount === 0) {
        const db = new DatabaseSync(f.databasePath);
        db.prepare(
          "DELETE FROM memberships WHERE room_id=? AND principal_id=?",
        ).run(f.room.roomId, f.human.principalId);
        db.close();
      }
      const { activation, execution } = startWorkerExecution(
        f.kernel,
        "input",
        f.agent.principalId,
        f.room.roomId,
      );
      const task = f.kernel.claimMessageAsTask(execution, {
        messageId: msg.event.aggregateId,
        rationale: "persistent file work",
        basedOnRoomSeq: activation.toSeq,
        leaseMs: 30000,
        idempotencyKey: "promote",
      });
      const started = f.kernel.startTask(execution, {
        taskId: task.task.taskId,
        basedOnRoomSeq: task.event.roomSeq,
        leaseMs: 30000,
        idempotencyKey: "start",
      });
      const command = {
        taskId: task.task.taskId,
        basedOnRoomSeq: started.event.roomSeq,
        question: "Which requirement?",
        idempotencyKey: "ask",
      };
      if (humanCount === 0)
        assert.throws(
          () => f.kernel.requestTaskInput(execution, command),
          ConflictError,
        );
      else {
        const result = f.kernel.requestTaskInput(execution, command);
        assert.equal(result.inputRequest.responderId, f.human.principalId);
        assert.equal(result.task.state, "waiting_input");
        const laterHuman = f.kernel.provisionPrincipal({
          handle: "later-human",
          kind: "human",
        });
        f.kernel.addMember(f.humanActor, {
          roomId: f.room.roomId,
          principalId: laterHuman.principal.principalId,
        });
        assert.equal(
          f.kernel.requestTaskInput(execution, command).deduplicated,
          true,
        );
      }
    } finally {
      f.kernel.close();
    }
  });

test("held draft retries preserve the original Thread across a multi-Thread Activation and rehold", () => {
  const f = createFixture();
  try {
    const { a } = threads(f);
    const { activation, execution } = startWorkerExecution(
      f.kernel,
      "held",
      f.agent.principalId,
      f.room.roomId,
    );
    f.kernel.replyThread(f.humanActor, {
      roomId: f.room.roomId,
      threadId: a.thread.threadId,
      body: "New A context",
      recipientIds: [f.agent.principalId],
      basedOnRoomSeq: f.kernel.sync(f.humanActor, {
        consumerId: "head",
        roomId: f.room.roomId,
      }).latestRoomSeq,
      idempotencyKey: "new-a",
    });
    const held = f.kernel.postWorkerMessage(execution, {
      body: "A draft",
      threadId: a.thread.threadId,
      basedOnRoomSeq: activation.toSeq,
      idempotencyKey: "draft",
    });
    assert.ok("state" in held && held.state === "held");
    assert.equal(held.recoveryTarget, `#${f.room.slug}:${a.thread.threadId}`);
    const command = {
      sendDraft: true as const,
      heldDraftId: held.heldDraftId,
      basedOnRoomSeq: activation.toSeq,
      idempotencyKey: "rehold",
    };
    const reheld = f.kernel.postWorkerMessage(execution, command);
    assert.ok("state" in reheld && reheld.state === "held");
    assert.equal(reheld.reholdCount, 2);
    assert.deepEqual(f.kernel.postWorkerMessage(execution, command), reheld);
    assert.throws(
      () => f.kernel.postWorkerMessage(execution, { ...command, anyway: true }),
      IdempotencyConflictError,
    );
  } finally {
    f.kernel.close();
  }
});

test("explicit Thread addressing rejects foreign Rooms and Threads newer than delivered context", () => {
  const f = createFixture();
  try {
    f.kernel.postMessage(f.humanActor, {
      roomId: f.room.roomId,
      body: "Wake",
      recipients: [{ participantId: f.agent.principalId, reason: "mention" }],
      idempotencyKey: "wake",
    });
    const { activation, execution } = startWorkerExecution(
      f.kernel,
      "target-boundary",
      f.agent.principalId,
      f.room.roomId,
    );
    const room = f.kernel.createRoom(f.humanActor, {
      name: "Foreign",
      slug: "foreign",
    });
    const foreign = f.kernel.createTask(f.humanActor, {
      roomId: room.roomId,
      title: "Foreign",
      idempotencyKey: "foreign",
    });
    assert.throws(
      () =>
        f.kernel.postWorkerMessage(execution, {
          threadId: foreign.task.threadId,
          body: "Forbidden",
          basedOnRoomSeq: activation.toSeq,
          idempotencyKey: "foreign-reply",
        }),
      ForbiddenError,
    );
    const future = f.kernel.createTask(f.humanActor, {
      roomId: f.room.roomId,
      title: "Future",
      assigneeId: f.otherAgent.principalId,
      idempotencyKey: "future",
    });
    assert.throws(
      () =>
        f.kernel.postWorkerMessage(execution, {
          threadId: future.task.threadId,
          body: "Unread",
          basedOnRoomSeq: activation.toSeq,
          idempotencyKey: "future-reply",
        }),
      /stale/i,
    );
  } finally {
    f.kernel.close();
  }
});

test("Room membership allows published ordinary attachments but never pending or foreign files", async () => {
  const f = createFixture();
  try {
    const upload = f.kernel.files.prepare(f.humanActor, {
      roomId: f.room.roomId,
      filename: "evidence.txt",
      mimeType: "text/plain",
      size: 5,
      idempotencyKey: "upload",
    });
    await f.kernel.files.upload(
      f.humanActor,
      upload.attachmentId,
      (async function* () {
        yield Buffer.from("hello");
      })(),
    );
    f.kernel.postMessage(f.humanActor, {
      roomId: f.room.roomId,
      body: "Wake",
      recipients: [{ participantId: f.agent.principalId, reason: "mention" }],
      idempotencyKey: "wake",
    });
    const { execution } = startWorkerExecution(
      f.kernel,
      "attachment",
      f.agent.principalId,
      f.room.roomId,
    );
    await assert.rejects(
      f.kernel.files.downloadWorkerTaskArtifact(execution, upload.attachmentId),
      /not attached/,
    );
    f.kernel.postRoomMessage(f.humanActor, {
      roomId: f.room.roomId,
      body: "Read the evidence",
      attachmentIds: [upload.attachmentId],
      idempotencyKey: "send-file",
    });
    const downloaded = await f.kernel.files.downloadWorkerTaskArtifact(
      execution,
      upload.attachmentId,
    );
    const chunks = [];
    for await (const chunk of downloaded.stream)
      chunks.push(Buffer.from(chunk));
    assert.equal(Buffer.concat(chunks).toString(), "hello");
    const foreign = f.kernel.createRoom(f.humanActor, {
      name: "Private",
      slug: "private",
    });
    const secret = f.kernel.files.prepare(f.humanActor, {
      roomId: foreign.roomId,
      filename: "secret.txt",
      mimeType: "text/plain",
      size: 5,
      idempotencyKey: "secret",
    });
    await assert.rejects(
      f.kernel.files.downloadWorkerTaskArtifact(execution, secret.attachmentId),
      ForbiddenError,
    );
  } finally {
    f.kernel.close();
  }
});

test("a Human-invited ordinary Room Agent reads frozen submission bytes and replies without a reviewer role", async () => {
  const f = createFixture();
  try {
    const task = f.kernel.createTask(f.humanActor, {
      roomId: f.room.roomId,
      title: "Frozen evidence",
      assigneeId: f.otherAgent.principalId,
      idempotencyKey: "task",
    });
    const owner = startWorkerExecution(
      f.kernel,
      "submitter",
      f.otherAgent.principalId,
      f.room.roomId,
    );
    const claimed = f.kernel.claimTask(owner.execution, {
      taskId: task.task.taskId,
      basedOnRoomSeq: owner.activation.toSeq,
      leaseMs: 30000,
      idempotencyKey: "claim",
    });
    const started = f.kernel.startTask(owner.execution, {
      taskId: task.task.taskId,
      basedOnRoomSeq: claimed.event.roomSeq,
      leaseMs: 30000,
      idempotencyKey: "start",
    });
    const artifact = f.kernel.files.prepareWorker(owner.execution, {
      taskId: task.task.taskId,
      filename: "frozen.txt",
      mimeType: "text/plain",
      size: 5,
      idempotencyKey: "artifact",
    });
    await f.kernel.files.uploadWorker(
      owner.execution,
      artifact.attachmentId,
      (async function* () {
        yield Buffer.from("proof");
      })(),
    );
    const submitted = f.kernel.submitTask(owner.execution, {
      taskId: task.task.taskId,
      basedOnRoomSeq: started.event.roomSeq,
      summary: "Delivered",
      idempotencyKey: "submit",
    });
    f.kernel.postMessage(f.humanActor, {
      roomId: f.room.roomId,
      body: "Audit the existing task",
      recipients: [{ participantId: f.agent.principalId, reason: "mention" }],
      idempotencyKey: "invite",
    });
    const auditor = startWorkerExecution(
      f.kernel,
      "auditor",
      f.agent.principalId,
      f.room.roomId,
    );
    const read = f.kernel.getWorkerTask(auditor.execution, {
      taskId: task.task.taskId,
    });
    assert.deepEqual(read.reviewerIds, []);
    const frozen = f.kernel.taskReviews.getWorkerTaskSubmission(
      auditor.execution,
      { taskId: task.task.taskId },
    );
    assert.equal(frozen.artifacts[0]?.attachmentId, artifact.attachmentId);
    const download = await f.kernel.files.downloadWorkerTaskArtifact(
      auditor.execution,
      artifact.attachmentId,
    );
    const chunks = [];
    for await (const chunk of download.stream) chunks.push(Buffer.from(chunk));
    assert.equal(Buffer.concat(chunks).toString(), "proof");
    const reply = f.kernel.postWorkerMessage(auditor.execution, {
      threadId: read.threadId,
      body: `Verified artifact ${frozen.artifacts[0]!.sha256}`,
      basedOnRoomSeq: auditor.activation.toSeq,
      idempotencyKey: "audit-reply",
    });
    assert.ok("event" in reply);
    assert.equal(reply.event.payload.threadId, read.threadId);
    assert.equal(submitted.task.state, "submitted");
    assert.equal(
      f.kernel.listTasks(f.humanActor, { roomId: f.room.roomId })[0]?.state,
      "submitted",
    );
    assert.throws(
      () =>
        f.kernel.submitTask(auditor.execution, {
          taskId: read.taskId,
          basedOnRoomSeq: auditor.activation.toSeq,
          summary: "steal",
          idempotencyKey: "steal-submit",
        }),
      ForbiddenError,
    );
  } finally {
    f.kernel.close();
  }
});

test("a Worker starts its explicitly self-created Task in the same Run without widening other Task authority", () => {
  const f = createFixture();
  try {
    f.kernel.postMessage(f.humanActor, {
      roomId: f.room.roomId,
      body: "Create durable subwork",
      recipients: [
        { participantId: f.agent.principalId, reason: "mention" },
        { participantId: f.otherAgent.principalId, reason: "mention" },
      ],
      idempotencyKey: "wake-own-task",
    });
    const run = startWorkerExecution(
      f.kernel,
      "own-task",
      f.agent.principalId,
      f.room.roomId,
    );
    const otherRun = startWorkerExecution(
      f.kernel,
      "other-before-created",
      f.otherAgent.principalId,
      f.room.roomId,
    );
    const created = f.kernel.createWorkerTask(run.execution, {
      title: "Self-created durable work",
      assigneeId: f.agent.principalId,
      basedOnRoomSeq: run.activation.toSeq,
      leaseMs: 30000,
      idempotencyKey: "own-created",
    });
    assert.ok(created.event.roomSeq > run.activation.toSeq);
    assert.equal(created.task.state, "claimed");
    const started = f.kernel.startTask(run.execution, {
      taskId: created.task.taskId,
      basedOnRoomSeq: created.event.roomSeq,
      leaseMs: 30000,
      idempotencyKey: "own-start",
    });
    assert.equal(started.task.state, "in_progress");
    const discussion = f.kernel.postWorkerMessage(run.execution, {
      body: "Implementation started",
      threadId: created.task.threadId,
      basedOnRoomSeq: run.activation.toSeq,
      idempotencyKey: "own-task-discussion",
    });
    assert.ok("event" in discussion);
    assert.equal(discussion.event.payload.threadId, created.task.threadId);
    assert.throws(
      () =>
        f.kernel.postWorkerMessage(otherRun.execution, {
          body: "Not my created Thread",
          threadId: created.task.threadId,
          basedOnRoomSeq: otherRun.activation.toSeq,
          idempotencyKey: "other-thread",
        }),
      /stale/i,
    );
    f.kernel.replyThread(f.humanActor, {
      roomId: f.room.roomId,
      threadId: created.task.threadId,
      body: "New requirements",
      recipientIds: [],
      basedOnRoomSeq: discussion.event.roomSeq,
      idempotencyKey: "new-own-thread-context",
    });
    assert.ok(
      "heldDraftId" in
        f.kernel.postWorkerMessage(run.execution, {
          body: "Old draft",
          threadId: created.task.threadId,
          basedOnRoomSeq: run.activation.toSeq,
          idempotencyKey: "own-thread-stale",
        }),
    );
    const unrelated = f.kernel.createTask(f.humanActor, {
      title: "Not delivered",
      roomId: f.room.roomId,
      assigneeId: f.agent.principalId,
      idempotencyKey: "undelivered",
    });
    f.kernel.syncWorker(run.execution, {});
    assert.throws(
      () =>
        f.kernel.postWorkerMessage(run.execution, {
          body: "Read did not grant this target",
          threadId: unrelated.task.threadId,
          basedOnRoomSeq: run.activation.toSeq,
          idempotencyKey: "foreign-new-thread",
        }),
      /stale/i,
    );
    assert.throws(
      () =>
        f.kernel.claimTask(run.execution, {
          taskId: unrelated.task.taskId,
          basedOnRoomSeq: run.activation.toSeq,
          leaseMs: 30000,
          idempotencyKey: "undelivered-claim",
        }),
      ForbiddenError,
    );
  } finally {
    f.kernel.close();
  }
});

test("self-created Task authority expires with its Run and never transfers to another Agent or unrelated Run", () => {
  const f = createFixture();
  try {
    f.kernel.postMessage(f.humanActor, {
      roomId: f.room.roomId,
      body: "Create subwork",
      recipients: [{ participantId: f.agent.principalId, reason: "mention" }],
      idempotencyKey: "wake-a",
    });
    const first = startWorkerExecution(
      f.kernel,
      "first-own",
      f.agent.principalId,
      f.room.roomId,
    );
    const created = f.kernel.createWorkerTask(first.execution, {
      title: "Owned durable work",
      assigneeId: f.agent.principalId,
      basedOnRoomSeq: first.activation.toSeq,
      leaseMs: 30000,
      idempotencyKey: "created-own",
    });
    const started = f.kernel.startTask(first.execution, {
      taskId: created.task.taskId,
      basedOnRoomSeq: created.event.roomSeq,
      leaseMs: 30000,
      idempotencyKey: "started-own",
    });
    f.kernel.blockTask(first.execution, {
      taskId: created.task.taskId,
      basedOnRoomSeq: started.event.roomSeq,
      reason: "Await requested external evidence",
      idempotencyKey: "blocked-own",
    });
    f.kernel.recordRuntimeTermination(first.host, {
      runAttemptId: first.execution.scope.runAttemptId,
      runtimeRunId: "first-own-runtime",
      exit: { code: 0 },
    });
    f.kernel.finishRunAttempt(first.host, {
      runAttemptId: first.execution.scope.runAttemptId,
      exitCode: 0,
      state: "exited",
    });
    f.kernel.completeActivation(first.host, {
      activationId: first.activation.activationId,
      consumerId: "first-own-consumer",
    });
    assert.throws(
      () =>
        f.kernel.claimTask(first.execution, {
          taskId: created.task.taskId,
          basedOnRoomSeq: first.activation.toSeq,
          leaseMs: 30000,
          idempotencyKey: "dead-claim",
        }),
      /fenced|execution/i,
    );
    assert.throws(
      () =>
        f.kernel.postWorkerMessage(first.execution, {
          body: "Dead run reply",
          threadId: created.task.threadId,
          basedOnRoomSeq: first.activation.toSeq,
          idempotencyKey: "dead-thread",
        }),
      /fenced|execution/i,
    );
    f.kernel.postMessage(f.humanActor, {
      roomId: f.room.roomId,
      body: "Unrelated conversation",
      recipients: [
        { participantId: f.agent.principalId, reason: "mention" },
        { participantId: f.otherAgent.principalId, reason: "mention" },
      ],
      idempotencyKey: "wake-new",
    });
    const second = startWorkerExecution(
      f.kernel,
      "second-own",
      f.agent.principalId,
      f.room.roomId,
    );
    assert.throws(
      () =>
        f.kernel.claimTask(second.execution, {
          taskId: created.task.taskId,
          basedOnRoomSeq: second.activation.toSeq,
          leaseMs: 30000,
          idempotencyKey: "different-run-claim",
        }),
      ForbiddenError,
    );
    const other = startWorkerExecution(
      f.kernel,
      "other-own",
      f.otherAgent.principalId,
      f.room.roomId,
    );
    assert.throws(
      () =>
        f.kernel.claimTask(other.execution, {
          taskId: created.task.taskId,
          basedOnRoomSeq: other.activation.toSeq,
          leaseMs: 30000,
          idempotencyKey: "different-agent-claim",
        }),
      ForbiddenError,
    );
  } finally {
    f.kernel.close();
  }
});

test("an Agent-created Task asks the Room's Human even when the Room has several Humans", () => {
  const f = createFixture();
  try {
    const second = f.kernel.provisionPrincipal({
      handle: "second-human",
      kind: "human",
    });
    f.kernel.addMember(f.humanActor, {
      principalId: second.principal.principalId,
      roomId: f.room.roomId,
    });
    f.kernel.postMessage(f.humanActor, {
      body: "Start the file work",
      roomId: f.room.roomId,
      recipients: [{ participantId: f.agent.principalId, reason: "mention" }],
      idempotencyKey: "wake-own-task",
    });
    const { activation, execution } = startWorkerExecution(
      f.kernel,
      "own-task-input",
      f.agent.principalId,
      f.room.roomId,
    );
    const created = f.kernel.createWorkerTask(execution, {
      assigneeId: f.agent.principalId,
      basedOnRoomSeq: activation.toSeq,
      idempotencyKey: "own-task",
      leaseMs: 30_000,
      title: "Persistent file work",
    });
    assert.equal(created.task.creatorId, f.agent.principalId);
    const started = f.kernel.startTask(execution, {
      basedOnRoomSeq: created.event.roomSeq,
      idempotencyKey: "own-start",
      leaseMs: 30_000,
      taskId: created.task.taskId,
    });
    const requested = f.kernel.requestTaskInput(execution, {
      basedOnRoomSeq: started.event.roomSeq,
      idempotencyKey: "own-ask",
      question: "Which requirement?",
      taskId: created.task.taskId,
    });
    // The Room's owner Human is the deterministic responder: highest Room role
    // first, then earliest joined_at, then lowest principal_id.
    assert.equal(requested.inputRequest.responderId, f.human.principalId);
    assert.equal(requested.task.state, "waiting_input");
    const resolved = f.kernel.resolveInputRequest(f.humanActor, {
      answer: "Use the persistent path",
      basedOnRoomSeq: f.kernel.sync(f.humanActor, {
        consumerId: "resolver",
        roomId: f.room.roomId,
      }).latestRoomSeq,
      idempotencyKey: "own-answer",
      inputRequestId: requested.inputRequest.inputRequestId,
    });
    assert.equal(resolved.inputRequest.state, "resolved");
  } finally {
    f.kernel.close();
  }
});

test("an ambiguous coalesced reply names the candidate Threads it refuses to guess", () => {
  const f = createFixture();
  try {
    const { a, b } = threads(f);
    const { activation, execution } = startWorkerExecution(
      f.kernel,
      "named-threads",
      f.agent.principalId,
      f.room.roomId,
    );
    assert.throws(
      () =>
        f.kernel.postWorkerMessage(execution, {
          body: "ambiguous",
          basedOnRoomSeq: activation.toSeq,
          idempotencyKey: "ambiguous-named",
        }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictError);
        assert.match(error.message, new RegExp(a.thread.threadId));
        assert.match(error.message, new RegExp(b.thread.threadId));
        return true;
      },
    );
  } finally {
    f.kernel.close();
  }
});

test("a single-Thread coalesced Activation still resolves its reply target implicitly", () => {
  const f = createFixture();
  try {
    const root = f.kernel.postMessage(f.humanActor, {
      body: "Only Thread",
      roomId: f.room.roomId,
      recipients: [],
      idempotencyKey: "single-root",
    });
    const only = f.kernel.createThread(f.humanActor, {
      basedOnRoomSeq: root.event.roomSeq,
      idempotencyKey: "single-thread",
      recipientIds: [f.agent.principalId],
      roomId: f.room.roomId,
      rootMessageId: root.event.aggregateId,
    });
    const { activation, execution } = startWorkerExecution(
      f.kernel,
      "single-thread",
      f.agent.principalId,
      f.room.roomId,
    );
    const reply = f.kernel.postWorkerMessage(execution, {
      body: "Implicit answer",
      basedOnRoomSeq: activation.toSeq,
      idempotencyKey: "single-reply",
    });
    assert.ok("event" in reply);
    assert.equal(reply.event.payload.threadId, only.thread.threadId);
  } finally {
    f.kernel.close();
  }
});

test("a membership change between a post and its retry replays instead of conflicting", () => {
  const f = createFixture();
  try {
    const command = {
      body: "Room announcement",
      idempotencyKey: "membership-retry",
      roomId: f.room.roomId,
    };
    const posted = f.kernel.postRoomMessage(f.humanActor, command);
    const added = f.kernel.provisionPrincipal({
      handle: "late-agent",
      kind: "agent",
    });
    f.kernel.addMember(f.humanActor, {
      principalId: added.principal.principalId,
      roomId: f.room.roomId,
    });
    const replay = f.kernel.postRoomMessage(f.humanActor, command);
    assert.equal(replay.deduplicated, true);
    assert.deepEqual(replay.event, posted.event);
    f.kernel.removeRoomMember(f.humanActor, {
      basedOnRoomSeq: f.kernel.sync(f.humanActor, {
        consumerId: "remover",
        roomId: f.room.roomId,
      }).latestRoomSeq,
      idempotencyKey: "remove-late-agent",
      principalId: added.principal.principalId,
      roomId: f.room.roomId,
    });
    const afterRemoval = f.kernel.postRoomMessage(f.humanActor, command);
    assert.equal(afterRemoval.deduplicated, true);
    assert.deepEqual(afterRemoval.event, posted.event);
    assert.throws(
      () =>
        f.kernel.postRoomMessage(f.humanActor, {
          ...command,
          body: "A different announcement",
        }),
      IdempotencyConflictError,
    );
  } finally {
    f.kernel.close();
  }
});
