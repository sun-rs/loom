import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { RoomKernel } from "../src/index.ts";
import { issueAuthenticatedWorkerExecutionContext } from "../src/auth.ts";
import { WorkerReadService } from "../src/worker-read-tools.ts";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "rah-worker-read-"));
  const path = join(dir, "room.db");
  const kernel = new RoomKernel({ databasePath: path });
  kernel.initialize();
  const human = kernel.provisionPrincipal({ handle: "human", kind: "human" });
  const agent = kernel.provisionPrincipal({ handle: "reader", kind: "agent" });
  const outsider = kernel.provisionPrincipal({
    handle: "foreign",
    kind: "agent",
  });
  const actor = kernel.authenticateAccessToken(human.accessToken);
  const room = kernel.createRoom(actor, { name: "Reads", slug: "reads" });
  const hidden = kernel.createRoom(actor, { name: "Hidden", slug: "hidden" });
  kernel.addMember(actor, {
    roomId: room.roomId,
    principalId: agent.principal.principalId,
  });
  kernel.addMember(actor, {
    roomId: hidden.roomId,
    principalId: outsider.principal.principalId,
  });
  const database = new DatabaseSync(path);
  const execution = issueAuthenticatedWorkerExecutionContext(
    "credential",
    "instance",
    {
      activationId: "activation",
      consumerId: "consumer",
      hostId: "host",
      participantId: agent.principal.principalId,
      roomId: room.roomId,
      runAttemptId: "run",
      toSeq: 0,
    },
  );
  let authenticated = true;
  const reads = new WorkerReadService({
    database,
    requireWorker: (candidate) => {
      if (!authenticated || candidate !== execution)
        throw new Error("execution fenced");
      return candidate.scope;
    },
  });
  let sequence = 0;
  const post = (body: string, threadId?: string, roomId = room.roomId) =>
    threadId === undefined
      ? kernel.postMessage(actor, {
          body,
          roomId,
          recipients: [],
          idempotencyKey: `message-${++sequence}`,
        })
      : kernel.replyThread(actor, {
          body,
          roomId,
          threadId,
          recipientIds: [],
          idempotencyKey: `message-${++sequence}`,
          basedOnRoomSeq: Number(
            database
              .prepare("SELECT next_seq - 1 AS n FROM rooms WHERE room_id=?")
              .get(roomId)!.n,
          ),
        });
  const task = (title: string, roomId = room.roomId, assigneeId?: string) =>
    kernel.createTask(actor, {
      roomId,
      title,
      ...(assigneeId === undefined ? {} : { assigneeId }),
      collaboratorIds: [],
      reviewerIds: [],
      dependencyTaskIds: [],
      idempotencyKey: `task-${++sequence}`,
    });
  return {
    kernel,
    database,
    reads,
    execution,
    actor,
    agent,
    human,
    outsider,
    room,
    hidden,
    post,
    task,
    revoke() {
      authenticated = false;
    },
    close() {
      database.close();
      kernel.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("Human Task history uses the same frozen lifecycle projection with membership and cursor fences", () => {
  const f = fixture();
  try {
    const task = f.task("Visible lifecycle").task;
    const other = f.task("Other lifecycle").task;
    f.kernel.cancelTask(f.actor, {
      taskId: task.taskId,
      basedOnRoomSeq: f.kernel.sync(f.actor, {
        roomId: f.room.roomId,
        consumerId: "history-test",
      }).latestRoomSeq,
      idempotencyKey: "history-cancel",
      reason: "User cancelled",
    });
    const input = { roomId: f.room.roomId, taskId: task.taskId, limit: 1 };
    const nonmember = f.kernel.provisionPrincipal({
      handle: "history-outsider",
      kind: "human",
    });
    assert.throws(
      () =>
        f.kernel.humanTaskHistory.list(
          f.kernel.authenticateAccessToken(nonmember.accessToken),
          input,
        ),
      /member/u,
    );
    const first = f.kernel.humanTaskHistory.list(f.actor, input);
    assert.equal(first.events[0]?.type, "task.cancelled");
    assert.equal(first.events[0]?.previousWorkflowStatus, "todo");
    assert.equal(first.events[0]?.workflowStatus, "closed");
    assert.ok(first.nextCursor);
    f.kernel.reopenTask(f.actor, {
      taskId: task.taskId,
      basedOnRoomSeq: first.frozenThroughRoomSeq,
      idempotencyKey: "history-reopen",
    });
    const second = f.kernel.humanTaskHistory.list(f.actor, {
      ...input,
      cursor: first.nextCursor,
    });
    assert.deepEqual(
      second.events.map((event) => event.type),
      ["task.created"],
    );
    assert.equal(second.frozenThroughRoomSeq, first.frozenThroughRoomSeq);
    assert.equal(second.nextCursor, undefined);
    assert.throws(
      () =>
        f.kernel.humanTaskHistory.list(f.actor, {
          ...input,
          taskId: other.taskId,
          cursor: first.nextCursor,
        }),
      /cursor/u,
    );
    assert.throws(
      () =>
        f.kernel.humanTaskHistory.list(f.actor, {
          ...input,
          roomId: f.hidden.roomId,
        }),
      /Task|task/u,
    );
    assert.throws(
      () =>
        f.kernel.humanTaskHistory.list(
          f.kernel.authenticateAccessToken(f.outsider.accessToken),
          input,
        ),
      /Human|human/u,
    );
    assert.deepEqual(
      f.kernel.humanTaskHistory.list(f.actor, {
        roomId: f.room.roomId,
        taskId: task.taskId,
      }).events,
      f.reads.taskHistory(f.execution, { taskId: task.taskId }).events,
    );
  } finally {
    f.close();
  }
});

test("Worker history reads old and current facts with frozen before/after/around pages and no delivery side effects", () => {
  const f = fixture();
  try {
    const messages = [
      f.post("one"),
      f.post("two"),
      f.post("three"),
      f.post("four"),
    ];
    f.post("secret", undefined, f.hidden.roomId);
    const count = () =>
      f.database.prepare("SELECT COUNT(*) AS n FROM room_events").get()!.n;
    const initialCount = count();
    const page = f.reads.history(f.execution, { limit: 2 });
    assert.deepEqual(
      page.messages.map((message) => message.body),
      ["three", "four"],
    );
    assert.ok(page.olderCursor);
    assert.ok(page.frozenThroughRoomSeq > f.execution.scope.toSeq);
    assert.equal(count(), initialCount);
    assert.equal(
      f.database
        .prepare("SELECT COUNT(*) AS n FROM subscription_cursors")
        .get()!.n,
      0,
    );
    const late = f.post("five");
    const older = f.reads.history(f.execution, {
      limit: 2,
      cursor: page.olderCursor,
    });
    assert.deepEqual(
      older.messages.map((message) => message.body),
      ["one", "two"],
    );
    assert.equal(older.frozenThroughRoomSeq, page.frozenThroughRoomSeq);
    assert.ok(older.newerCursor);
    const newer = f.reads.history(f.execution, {
      limit: 2,
      cursor: older.newerCursor,
    });
    assert.deepEqual(
      newer.messages.map((message) => message.body),
      ["three", "four"],
    );
    assert.equal(newer.newerCursor, undefined);
    const around = f.reads.history(f.execution, {
      around: messages[1]!.event.aggregateId,
      limit: 3,
    });
    assert.deepEqual(
      around.messages.map((message) => message.body),
      ["one", "two", "three"],
    );
    const before = f.reads.history(f.execution, {
      before: messages[2]!.event.aggregateId,
    });
    assert.deepEqual(
      before.messages.map((message) => message.body),
      ["one", "two"],
    );
    const after = f.reads.history(f.execution, {
      after: messages[2]!.event.aggregateId,
    });
    assert.deepEqual(
      after.messages.map((message) => message.body),
      ["four", "five"],
    );
    assert.equal(
      f.reads.resolve(f.execution, { messageId: late.event.aggregateId })
        .message.body,
      "five",
    );
    assert.throws(
      () =>
        f.reads.history(f.execution, {
          limit: 2,
          cursor: page.olderCursor,
          threadId: null,
        }),
      /cursor/u,
    );
  } finally {
    f.close();
  }
});

test("exact message resolution and thread history never reveal a foreign Room or unrelated thread", () => {
  const f = fixture();
  try {
    const root = f.post("root");
    const created = f.kernel.createThread(f.actor, {
      roomId: f.room.roomId,
      rootMessageId: root.event.aggregateId,
      basedOnRoomSeq: root.event.roomSeq,
      recipientIds: [],
      idempotencyKey: "thread",
    });
    const reply = f.post("reply", created.thread.threadId);
    f.post("unrelated");
    const secret = f.post("secret", undefined, f.hidden.roomId);
    const result = f.reads.resolve(f.execution, {
      messageId: reply.event.aggregateId,
    });
    assert.equal(result.threadId, created.thread.threadId);
    assert.equal(result.rootMessage!.messageId, root.event.aggregateId);
    assert.equal(
      f.reads.resolve(f.execution, { messageId: root.event.aggregateId })
        .threadId,
      created.thread.threadId,
    );
    assert.deepEqual(
      f.reads
        .history(f.execution, { threadId: created.thread.threadId })
        .messages.map((m) => m.body),
      ["reply"],
    );
    assert.throws(
      () =>
        f.reads.resolve(f.execution, { messageId: secret.event.aggregateId }),
      /unavailable/u,
    );
    assert.throws(
      () => f.reads.history(f.execution, { around: secret.event.aggregateId }),
      /unavailable/u,
    );
    assert.throws(
      () => f.reads.history(f.execution, { threadId: "foreign-thread" }),
      /unavailable/u,
    );
  } finally {
    f.close();
  }
});

test("members, current Room info and profiles use canonical handles and reject revoked membership", () => {
  const f = fixture();
  try {
    const page = f.reads.members(f.execution, { limit: 1 });
    assert.equal(page.members.length, 1);
    assert.ok(page.nextCursor);
    const next = f.reads.members(f.execution, {
      limit: 1,
      cursor: page.nextCursor,
    });
    assert.deepEqual(
      new Set(
        [...page.members, ...next.members].map(
          (member) => member.principal.handle,
        ),
      ),
      new Set(["reader", "human"]),
    );
    assert.equal(
      f.reads.serverInfo(f.execution, {}).room.roomId,
      f.room.roomId,
    );
    assert.equal(f.reads.serverInfo(f.execution, {}).scope, "current_room");
    assert.equal(f.reads.profile(f.execution, {}).isSelf, true);
    const human = f.reads.profile(f.execution, { target: "@human" });
    assert.equal(human.principal.principalId, f.human.principal.principalId);
    assert.equal(JSON.stringify(human).includes("accessToken"), false);
    assert.throws(
      () => f.reads.profile(f.execution, { target: "@foreign" }),
      /unavailable/u,
    );
    f.database
      .prepare("DELETE FROM memberships WHERE room_id = ? AND principal_id = ?")
      .run(f.room.roomId, f.agent.principal.principalId);
    assert.throws(
      () => f.reads.members(f.execution, {}),
      /not an enabled Agent member/u,
    );
    assert.throws(
      () => f.reads.history(f.execution, {}),
      /not an enabled Agent member/u,
    );
  } finally {
    f.close();
  }
});

test("a role-free Worker lists current Task projections and exact lifecycle history without claiming", () => {
  const f = fixture();
  try {
    const a = f.task("Task A"),
      b = f.task("Task B", f.room.roomId, f.agent.principal.principalId);
    const hidden = f.task("Secret task", f.hidden.roomId);
    const page = f.reads.tasks(f.execution, { limit: 1 });
    assert.equal(page.tasks[0]!.taskId, b.task.taskId);
    assert.equal(page.projection, "current");
    assert.ok(page.nextCursor);
    f.task("Late task");
    assert.deepEqual(
      f.reads
        .tasks(f.execution, { limit: 1, cursor: page.nextCursor })
        .tasks.map((t) => t.taskId),
      [a.task.taskId],
    );
    assert.deepEqual(
      f.reads.tasks(f.execution, { mine: true }).tasks.map((t) => t.taskId),
      [b.task.taskId],
    );
    const history = f.reads.taskHistory(f.execution, {
      taskId: a.task.taskId,
      limit: 1,
    });
    assert.deepEqual(
      history.events.map((event) => event.type),
      ["task.created"],
    );
    assert.equal(history.events[0]!.title, "Task A");
    assert.equal(JSON.stringify(history).includes("Task B"), false);
    assert.equal(
      f.kernel.getTask(f.actor, {
        roomId: f.room.roomId,
        taskId: a.task.taskId,
      }).claimedBy,
      undefined,
    );
    assert.throws(
      () => f.reads.taskHistory(f.execution, { taskId: hidden.task.taskId }),
      /outside/u,
    );
    f.revoke();
    assert.throws(() => f.reads.tasks(f.execution, {}), /fenced/u);
  } finally {
    f.close();
  }
});

test("history pages stay below the Worker CLI response bound while preserving full message bodies", () => {
  const f = fixture();
  try {
    for (let i = 0; i < 9; i += 1) f.post(`${i}:` + "x".repeat(70_000));
    let cursor: string | undefined;
    const seen: string[] = [];
    do {
      const page = f.reads.history(f.execution, {
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      assert.ok(Buffer.byteLength(JSON.stringify(page)) < 512 * 1024);
      for (const message of page.messages) {
        assert.equal(message.body.length, 70_002);
        seen.push(message.messageId);
      }
      cursor = page.nextCursor;
    } while (cursor);
    assert.equal(seen.length, 9);
    assert.equal(new Set(seen).size, 9);
  } finally {
    f.close();
  }
});

test("Agent profile reads use the current definition's visible metadata without exposing instructions or memory policy", () => {
  const f = fixture();
  try {
    const workspace = f.kernel.createWorkspace(f.actor, {
      name: "Profiles",
      slug: "profiles",
      idempotencyKey: "profiles",
    });
    const roomId = workspace.controlRoom.roomId;
    f.kernel.addMember(f.actor, {
      roomId,
      principalId: f.agent.principal.principalId,
    });
    const head = () =>
      Number(
        f.database
          .prepare("SELECT next_seq-1 AS n FROM rooms WHERE room_id=?")
          .get(roomId)!.n,
      );
    const ref = {
      artifactId: "memory-private",
      versionId: "v1",
      contentDigest: `sha256:${"a".repeat(64)}`,
    };
    const policy = f.kernel.createExecutionPolicy(f.actor, {
      controlRoomId: roomId,
      basedOnRoomSeq: head(),
      idempotencyKey: "policy",
      modelIntent: {
        fallback: "disabled",
        reasoning: "default",
        serviceTier: "default",
      },
      preferred: [],
      required: {
        allowedOfferIds: ["profile-test-offer"],
        allowedProtocolFamilies: ["rah-worker-process/v1"],
        capabilities: [],
        minimumIsolation: "none",
        workspaceMode: "in_place",
      },
      retryPolicyRef: ref,
      sessionPolicy: "fresh",
      toolAccessMode: "full_access",
    });
    const displayName = "A".repeat(128);
    f.kernel.createAgentDefinition(f.actor, {
      controlRoomId: roomId,
      basedOnRoomSeq: head(),
      idempotencyKey: "definition",
      participantId: f.agent.principal.principalId,
      executionPolicyRevisionId: policy.policy.executionPolicyRevisionId,
      role: "PRIVATE_ROLE",
      instructions: "PRIVATE_INSTRUCTIONS",
      displayName,
      description: "Current visible description",
      instructionRefs: [],
      skillRefs: [],
      memoryPolicyRef: ref,
    });
    const reads = new WorkerReadService({
      database: f.database,
      requireWorker: () => ({ ...f.execution.scope, roomId }),
    });
    const profile = reads.profile(f.execution, {});
    assert.equal(profile.displayName, displayName);
    assert.equal(profile.description, "Current visible description");
    assert.equal(
      reads.members(f.execution, {}).members.find((m) => m.isSelf)!.displayName,
      displayName,
    );
    for (const secret of [
      "PRIVATE_ROLE",
      "PRIVATE_INSTRUCTIONS",
      "memory-private",
      "executionPolicyRevisionId",
    ])
      assert.equal(JSON.stringify(profile).includes(secret), false);
  } finally {
    f.close();
  }
});

test("frozen Worker history remains frozen after deleting another Room and posting a new message", () => {
  const f = fixture();
  try {
    f.post("one");
    f.post("two");
    f.post("hidden tail", undefined, f.hidden.roomId);
    const page = f.reads.history(f.execution, { limit: 1 });
    const before = f.database
      .prepare("SELECT MAX(rowid) AS n FROM room_events")
      .get();
    f.kernel.deleteWorkspaceRoom(f.actor, {
      roomId: f.hidden.roomId,
      basedOnRoomSeq: Number(
        f.database
          .prepare("SELECT next_seq-1 AS n FROM rooms WHERE room_id=?")
          .get(f.hidden.roomId)!.n,
      ),
      idempotencyKey: "delete-hidden",
    });
    const deleted = f.database
      .prepare("SELECT MAX(rowid) AS n FROM room_events")
      .get();
    f.post("late");
    const older = f.reads.history(f.execution, {
      limit: 1,
      cursor: page.olderCursor,
    });
    assert.ok(Number(before!.n) > Number(deleted!.n));
    assert.equal(older.frozenThroughRoomSeq, page.frozenThroughRoomSeq);
    const newer = f.reads.history(f.execution, {
      limit: 1,
      cursor: older.newerCursor,
    });
    assert.equal(newer.newerCursor, undefined);
  } finally {
    f.close();
  }
});

test("Unicode history pages account for full UTF-8 JSON and reject one oversized record without skipping it", () => {
  const f = fixture();
  try {
    for (let i = 0; i < 5; i += 1) f.post(`${i}:` + "汉🙂".repeat(30_000));
    const ids = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = f.reads.history(f.execution, {
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      assert.ok(Buffer.byteLength(JSON.stringify(page), "utf8") < 512 * 1024);
      assert.ok(page.messages.length > 0);
      for (const message of page.messages) {
        assert.equal(message.body.length, 90_002);
        ids.add(message.messageId);
      }
      cursor = page.nextCursor;
      assert.ok(++pages <= 5);
    } while (cursor);
    assert.equal(ids.size, 5);
    f.post("🙂".repeat(100_000));
    assert.throws(
      () => f.reads.history(f.execution, { limit: 1 }),
      /one record exceeds/u,
    );
  } finally {
    f.close();
  }
});

test("exact resolution rejects a response larger than the full UTF-8 envelope limit", () => {
  const f = fixture();
  try {
    const root = f.post("汉".repeat(90_000));
    const thread = f.kernel.createThread(f.actor, {
      roomId: f.room.roomId,
      rootMessageId: root.event.aggregateId,
      basedOnRoomSeq: root.event.roomSeq,
      recipientIds: [],
      idempotencyKey: "large-thread",
    });
    const reply = f.post("🙂".repeat(70_000), thread.thread.threadId);
    assert.throws(
      () =>
        f.reads.resolve(f.execution, { messageId: reply.event.aggregateId }),
      /Worker read response exceeds/u,
    );
  } finally {
    f.close();
  }
});

test("around history pagination never skips complete UTF8 records when following older cursors", () => {
  const f = fixture();
  try {
    const messages = Array.from({ length: 7 }, (_, i) =>
      f.post(`${i}:` + "界".repeat(60000)),
    );
    const base = { around: messages[4]!.event.aggregateId, limit: 3 };
    const first = f.reads.history(f.execution, base);
    assert.ok(first.olderCursor);
    const pages = [first];
    let cursor: string | undefined = first.olderCursor;
    for (let i = 0; cursor !== undefined && i < 10; i++) {
      const next = f.reads.history(f.execution, { ...base, cursor });
      pages.push(next);
      cursor = next.olderCursor;
    }
    const found = pages.flatMap((p) => p.messages).map((m) => m.messageId);
    const anchorIndex = messages.findIndex(
      (m) => m.event.aggregateId === first.messages.at(-1)!.messageId,
    );
    const expected = messages
      .slice(0, anchorIndex + 1)
      .map((m) => m.event.aggregateId);
    for (const page of pages)
      assert.ok(Buffer.byteLength(JSON.stringify(page), "utf8") < 512 * 1024);
    assert.equal(
      found.length,
      new Set(found).size,
      "pagination must not duplicate records",
    );
    assert.deepEqual(new Set(found), new Set(expected));
  } finally {
    f.close();
  }
});
