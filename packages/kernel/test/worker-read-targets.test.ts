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
  const dir = mkdtempSync(join(tmpdir(), "rah-worker-target-"));
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
    databasePath: path,
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

/** The managed Workspace both the Agent and the Human belong to. */
function managed(f: ReturnType<typeof fixture>) {
  const workspace = f.kernel.createWorkspace(f.actor, {
    name: "Managed",
    slug: "managed",
    idempotencyKey: "workspace",
  });
  f.kernel.addMember(f.actor, {
    roomId: workspace.controlRoom.roomId,
    principalId: f.agent.principal.principalId,
  });
  f.kernel.addMember(f.actor, {
    roomId: workspace.controlRoom.roomId,
    principalId: f.outsider.principal.principalId,
  });
  return {
    workspace,
    head: () =>
      f.kernel.sync(f.actor, {
        roomId: workspace.controlRoom.roomId,
        consumerId: "open-dm-head",
      }).latestRoomSeq,
  };
}

test("an Agent opens a Direct Room with a peer it already shares a Room with", () => {
  const f = fixture();
  try {
    const { workspace, head } = managed(f);
    const agentActor = f.kernel.authenticateAccessToken(f.agent.accessToken);
    const dm = f.kernel.openDirectRoom(agentActor, {
      workspaceId: workspace.workspace.workspaceId,
      peerPrincipalId: f.human.principal.principalId,
      basedOnControlRoomSeq: head(),
      idempotencyKey: "agent-opened-dm",
    });
    assert.equal(dm.kind, "direct");
    // The Room the Agent made is an ordinary DM: the same `dm:@handle` target
    // the prompt teaches resolves to it and both principals are members.
    assert.equal(
      f.reads.room(f.execution, { channel: "dm:@human" }).room.roomId,
      dm.roomId,
    );
    assert.equal(
      f.reads.members(f.execution, { channel: dm.roomId }).members.length,
      2,
    );
    assert.equal(
      f.database
        .prepare("SELECT count(*) AS n FROM direct_room_pairs WHERE room_id=?")
        .get(dm.roomId)!.n,
      1,
    );
  } finally {
    f.close();
  }
});

test("an Agent cannot open a Direct Room with a principal it shares no Room with", () => {
  const f = fixture();
  try {
    const { workspace, head } = managed(f);
    const agentActor = f.kernel.authenticateAccessToken(f.agent.accessToken);
    // `foreign` is a Workspace member but shares no visible Room with `reader`,
    // so it is outside the directory `profile-show`/`@mention` already resolve.
    assert.throws(
      () =>
        f.kernel.openDirectRoom(agentActor, {
          workspaceId: workspace.workspace.workspaceId,
          peerPrincipalId: f.outsider.principal.principalId,
          basedOnControlRoomSeq: head(),
          idempotencyKey: "agent-opened-foreign-dm",
        }),
      (error: unknown) =>
        error instanceof Error &&
        error.name === "ForbiddenError" &&
        /shares no visible Room/u.test(error.message),
    );
    // And the Agent-facing target keeps today's error class.
    assert.throws(
      () => f.reads.room(f.execution, { channel: "dm:@foreign" }),
      (error: unknown) =>
        error instanceof Error &&
        error.name === "NotFoundError" &&
        /unavailable/u.test(error.message),
    );
  } finally {
    f.close();
  }
});

test("every creation of the same Direct pair converges on one Room", () => {
  const f = fixture();
  try {
    const { workspace, head } = managed(f);
    const agentActor = f.kernel.authenticateAccessToken(f.agent.accessToken);
    const open = (
      kernel: typeof f.kernel,
      actor: typeof f.actor,
      key: string,
    ) =>
      kernel.openDirectRoom(actor, {
        workspaceId: workspace.workspace.workspaceId,
        peerPrincipalId:
          actor === f.actor
            ? f.agent.principal.principalId
            : f.human.principal.principalId,
        basedOnControlRoomSeq: head(),
        idempotencyKey: key,
      });
    const first = open(f.kernel, agentActor, "agent-open");
    // The same Agent twice, with the same key and with a different one.
    assert.equal(open(f.kernel, agentActor, "agent-open").roomId, first.roomId);
    assert.equal(
      open(f.kernel, agentActor, "agent-open-2").roomId,
      first.roomId,
    );
    // The other side of the pair, opening from the Human path.
    assert.equal(open(f.kernel, f.actor, "human-open").roomId, first.roomId);
    // A second Kernel on the same database file — the concurrent case a
    // single-machine daemon actually has — converges through the table.
    const other = new RoomKernel({ databasePath: f.databasePath });
    try {
      assert.equal(
        other.openDirectRoom(
          other.authenticateAccessToken(f.agent.accessToken),
          {
            workspaceId: workspace.workspace.workspaceId,
            peerPrincipalId: f.human.principal.principalId,
            basedOnControlRoomSeq: head(),
            idempotencyKey: "concurrent-open",
          },
        ).roomId,
        first.roomId,
      );
    } finally {
      other.close();
    }
    assert.equal(
      f.database
        .prepare(
          "SELECT count(*) AS n FROM direct_room_pairs WHERE workspace_id=?",
        )
        .get(workspace.workspace.workspaceId)!.n,
      1,
    );
    // The table, not the caller, is what makes a second Room impossible.
    assert.throws(
      () =>
        f.database
          .prepare(
            "INSERT INTO direct_room_pairs(workspace_id, left_principal_id, right_principal_id, room_id) VALUES(?, ?, ?, ?)",
          )
          .run(
            workspace.workspace.workspaceId,
            ...(f.agent.principal.principalId < f.human.principal.principalId
              ? [f.agent.principal.principalId, f.human.principal.principalId]
              : [f.human.principal.principalId, f.agent.principal.principalId]),
            f.room.roomId,
          ),
      /UNIQUE|constraint/iu,
    );
  } finally {
    f.close();
  }
});

test("joined Room and canonical DM targets are independently authorized read scopes", () => {
  const f = fixture();
  try {
    f.kernel.addMember(f.actor, {
      roomId: f.hidden.roomId,
      principalId: f.agent.principal.principalId,
    });
    const original = f.post("Original");
    const root = f.post("Elsewhere", undefined, f.hidden.roomId);
    const thread = f.kernel.createThread(f.actor, {
      roomId: f.hidden.roomId,
      rootMessageId: root.event.aggregateId,
      recipientIds: [],
      idempotencyKey: "thread",
      basedOnRoomSeq: root.event.roomSeq,
    }).thread;
    const reply = f.post("Thread reply", thread.threadId, f.hidden.roomId);
    const task = f.task("Other room task", f.hidden.roomId).task;
    const workspace = f.kernel.createWorkspace(f.actor, {
      name: "Managed",
      slug: "managed",
      idempotencyKey: "workspace",
    });
    f.kernel.addMember(f.actor, {
      roomId: workspace.controlRoom.roomId,
      principalId: f.agent.principal.principalId,
    });
    const dm = f.kernel.openDirectRoom(f.actor, {
      workspaceId: workspace.workspace.workspaceId,
      peerPrincipalId: f.agent.principal.principalId,
      basedOnControlRoomSeq: f.kernel.sync(f.actor, {
        roomId: workspace.controlRoom.roomId,
        consumerId: "head",
      }).latestRoomSeq,
      idempotencyKey: "dm",
    });
    f.post("Private conversation", undefined, dm.roomId);
    const eventsBefore = f.database
      .prepare("SELECT count(*) AS n FROM room_events")
      .get()!.n;
    const rooms = f.reads.rooms(f.execution, { limit: 100 });
    assert.ok(rooms.rooms.some(({ room }) => room.roomId === dm.roomId));
    assert.equal(
      rooms.rooms.some(({ room }) => room.kind === "control"),
      false,
    );
    assert.equal(
      f.reads.room(f.execution, { channel: "dm:@human" }).room.roomId,
      dm.roomId,
    );
    assert.equal(
      f.reads.room(f.execution, { channel: "#hidden" }).room.roomId,
      f.hidden.roomId,
    );
    assert.equal(
      f.reads.room(f.execution, { channel: `#hidden:${thread.threadId}` })
        .threadId,
      thread.threadId,
    );
    assert.deepEqual(
      f.reads
        .history(f.execution, { channel: `#hidden:${thread.threadId}` })
        .messages.map((m) => m.messageId),
      [reply.event.aggregateId],
    );
    assert.equal(
      f.reads.resolve(f.execution, { messageId: root.event.aggregateId })
        .message.roomId,
      f.hidden.roomId,
    );
    assert.equal(
      f.reads.members(f.execution, { channel: dm.roomId }).members.length,
      2,
    );
    assert.equal(
      f.reads.tasks(f.execution, { channel: "#hidden" }).tasks[0]?.taskId,
      task.taskId,
    );
    assert.equal(
      f.reads.taskHistory(f.execution, {
        channel: "#hidden",
        taskId: task.taskId,
      }).events[0]?.type,
      "task.created",
    );
    assert.equal(
      f.reads.history(f.execution, {}).messages[0]?.messageId,
      original.event.aggregateId,
    );
    assert.equal(f.execution.scope.roomId, f.room.roomId);
    assert.equal(f.execution.scope.toSeq, 0);
    assert.equal(
      f.database.prepare("SELECT count(*) AS n FROM room_events").get()!.n,
      eventsBefore,
    );
  } finally {
    f.close();
  }
});

test("cross-target cursors remain frozen and bound to target and current membership", () => {
  const f = fixture();
  try {
    const secret = f.post("Secret", undefined, f.hidden.roomId);
    assert.throws(
      () => f.reads.history(f.execution, { channel: "#hidden" }),
      /unavailable|member/u,
    );
    assert.throws(
      () =>
        f.reads.resolve(f.execution, { messageId: secret.event.aggregateId }),
      /unavailable/u,
    );
    assert.throws(
      () => f.reads.room(f.execution, { channel: "dm:@foreign" }),
      /unavailable/u,
    );
    f.kernel.addMember(f.actor, {
      roomId: f.hidden.roomId,
      principalId: f.agent.principal.principalId,
    });
    f.post("Newer", undefined, f.hidden.roomId);
    const first = f.reads.history(f.execution, {
      channel: "#hidden",
      limit: 1,
    });
    assert.ok(first.nextCursor);
    f.post("After freeze", undefined, f.hidden.roomId);
    const next = f.reads.history(f.execution, {
      channel: "#hidden",
      limit: 1,
      cursor: first.nextCursor,
    });
    assert.equal(next.messages[0]?.body, "Secret");
    assert.equal(next.frozenThroughRoomSeq, first.frozenThroughRoomSeq);
    assert.throws(
      () =>
        f.reads.history(f.execution, {
          channel: "#reads",
          limit: 1,
          cursor: first.nextCursor,
        }),
      /cursor/u,
    );
    f.kernel.removeRoomMember(f.actor, {
      roomId: f.hidden.roomId,
      principalId: f.agent.principal.principalId,
      basedOnRoomSeq: f.kernel.sync(f.actor, {
        roomId: f.hidden.roomId,
        consumerId: "remove",
      }).latestRoomSeq,
      idempotencyKey: "remove",
    });
    assert.throws(
      () =>
        f.reads.history(f.execution, {
          channel: "#hidden",
          limit: 1,
          cursor: first.nextCursor,
        }),
      /unavailable|member/u,
    );
    assert.equal(
      f.reads
        .rooms(f.execution, { limit: 100 })
        .rooms.some(({ room }) => room.roomId === f.hidden.roomId),
      false,
    );
  } finally {
    f.close();
  }
});

test("Worker search accepts optional query, sender/time/sort and reads current joined-Room facts with frozen query-bound pages", () => {
  const f = fixture();
  f.database.function("rah_casefold", { deterministic: true }, (value) =>
    typeof value === "string" ? value.toLowerCase() : "",
  );
  try {
    f.kernel.addMember(f.actor, {
      roomId: f.hidden.roomId,
      principalId: f.agent.principal.principalId,
    });
    const exact = f.post("alpha beta", undefined, f.hidden.roomId);
    const partial = f.post("alpha", undefined, f.hidden.roomId);
    const otherActor = f.kernel.authenticateAccessToken(f.outsider.accessToken);
    const outsider = f.kernel.postMessage(otherActor, {
      roomId: f.hidden.roomId,
      body: "alpha outsider",
      basedOnRoomSeq: partial.event.roomSeq,
      recipients: [],
      idempotencyKey: "outsider",
    });
    const ranked = f.reads.search(f.execution, {
      channel: "#hidden",
      query: "alpha beta",
      sort: "relevance",
      limit: 1,
    });
    assert.equal(ranked.messages[0]?.messageId, exact.event.aggregateId);
    assert.ok(ranked.nextCursor);
    f.post("alpha beta", undefined, f.hidden.roomId);
    const second = f.reads.search(f.execution, {
      channel: "#hidden",
      query: "alpha beta",
      sort: "relevance",
      limit: 10,
      cursor: ranked.nextCursor,
    });
    assert.deepEqual(
      second.messages.map((m) => m.messageId),
      [outsider.event.aggregateId, partial.event.aggregateId],
    );
    assert.equal(second.frozenThroughRoomSeq, ranked.frozenThroughRoomSeq);
    const filtered = f.reads.search(f.execution, {
      channel: "#hidden",
      sender: "@human",
      after: "2000-01-01T00:00:00.000Z",
      before: "2099-01-01T00:00:00.000Z",
      sort: "recent",
    });
    assert.equal(filtered.messages.length, 3);
    assert.ok(
      filtered.messages.every(
        (m) => m.actorId === f.human.principal.principalId,
      ),
    );
    assert.equal(
      f.reads.search(f.execution, {
        channel: "#hidden",
        senderId: f.outsider.principal.principalId,
      }).messages[0]?.messageId,
      outsider.event.aggregateId,
    );
    assert.deepEqual(
      f.reads.search(f.execution, {
        channel: "#hidden",
        after: "2099-01-01T00:00:00.000Z",
      }).messages,
      [],
    );
    for (const extra of [
      { channel: "#reads" },
      { query: "beta" },
      { sender: "@human" },
      { sort: "recent" },
      { after: "2000-01-01T00:00:00.000Z" },
    ] as const)
      assert.throws(
        () =>
          f.reads.search(f.execution, {
            channel: "#hidden",
            query: "alpha beta",
            sort: "relevance",
            cursor: ranked.nextCursor,
            ...extra,
          }),
        /cursor/u,
      );
    f.database
      .prepare("DELETE FROM memberships WHERE room_id=? AND principal_id=?")
      .run(f.hidden.roomId, f.agent.principal.principalId);
    assert.throws(
      () =>
        f.reads.search(f.execution, {
          channel: "#hidden",
          query: "alpha beta",
          sort: "relevance",
          cursor: ranked.nextCursor,
        }),
      /unavailable|member/u,
    );
  } finally {
    f.close();
  }
});

test("Worker search preserves complete Unicode messages under its byte budget and never skips a page boundary", () => {
  const f = fixture();
  f.database.function("rah_casefold", { deterministic: true }, (value) =>
    String(value ?? "").toLowerCase(),
  );
  try {
    const ids = Array.from(
      { length: 7 },
      (_, index) => f.post(`${index} ${"汉".repeat(60000)}`).event.aggregateId,
    ).reverse();
    const actual: string[] = [];
    let cursor: string | undefined;
    do {
      const page = f.reads.search(f.execution, {
        query: "汉",
        sort: "recent",
        limit: 7,
        ...(cursor ? { cursor } : {}),
      });
      assert.ok(Buffer.byteLength(JSON.stringify(page)) < 512 * 1024);
      for (const m of page.messages) {
        actual.push(m.messageId);
        assert.equal(m.body.length, 60002);
      }
      cursor = page.nextCursor;
    } while (cursor);
    assert.deepEqual(actual, ids);
    f.post("汉".repeat(180000));
    assert.throws(
      () => f.reads.search(f.execution, { query: "汉", sort: "recent" }),
      /limit/u,
    );
  } finally {
    f.close();
  }
});

test("search without target covers all joined Rooms and freezes per-Room heads rather than the Activation", () => {
  const f = fixture();
  f.database.function("rah_casefold", { deterministic: true }, (value) =>
    String(value ?? "").toLowerCase(),
  );
  try {
    f.kernel.addMember(f.actor, {
      roomId: f.hidden.roomId,
      principalId: f.agent.principal.principalId,
    });
    const first = f.post("global needle origin");
    const second = f.post("global needle joined", undefined, f.hidden.roomId);
    const page = f.reads.search(f.execution, {
      query: "global needle",
      sort: "recent",
      limit: 1,
    });
    assert.equal(page.messages[0]?.messageId, second.event.aggregateId);
    assert.ok(page.nextCursor);
    f.post("global needle later", undefined, f.hidden.roomId);
    const next = f.reads.search(f.execution, {
      query: "global needle",
      sort: "recent",
      limit: 10,
      cursor: page.nextCursor,
    });
    assert.deepEqual(
      next.messages.map((m) => m.messageId),
      [first.event.aggregateId],
    );
    assert.throws(
      () =>
        f.reads.search(f.execution, {
          channel: "#reads",
          query: "global needle",
          sort: "recent",
          cursor: page.nextCursor,
        }),
      /cursor/u,
    );
    f.database
      .prepare("DELETE FROM memberships WHERE room_id=? AND principal_id=?")
      .run(f.hidden.roomId, f.agent.principal.principalId);
    assert.throws(
      () =>
        f.reads.search(f.execution, {
          query: "global needle",
          sort: "recent",
          cursor: page.nextCursor,
        }),
      /cursor/u,
    );
    assert.deepEqual(
      f.reads
        .search(f.execution, { query: "global needle", sort: "recent" })
        .messages.map((m) => m.messageId),
      [first.event.aggregateId],
    );
  } finally {
    f.close();
  }
});

test("global search frozen Room ceilings exclude a new message when an unrelated deletion reuses its rowid", () => {
  const f = fixture();
  f.database.function("rah_casefold", { deterministic: true }, (value) =>
    String(value ?? "").toLowerCase(),
  );
  try {
    const first = f.post("needle first"),
      second = f.post("needle second"),
      secret = f.post("needle hidden", undefined, f.hidden.roomId);
    const page = f.reads.search(f.execution, {
      query: "needle",
      sort: "recent",
      limit: 1,
    });
    assert.equal(page.messages[0]?.messageId, second.event.aggregateId);
    assert.ok(page.nextCursor);
    const previousOrder = f.database
      .prepare("SELECT rowid AS n FROM messages WHERE message_id=?")
      .get(secret.event.aggregateId)!.n;
    // Inject the same global rowid-reuse condition that Room deletion can cause.
    f.database
      .prepare("DELETE FROM messages WHERE message_id=?")
      .run(secret.event.aggregateId);
    const newest = f.post("needle after frozen window");
    assert.equal(
      f.database
        .prepare("SELECT rowid AS n FROM messages WHERE message_id=?")
        .get(newest.event.aggregateId)!.n,
      previousOrder,
    );
    const next = f.reads.search(f.execution, {
      query: "needle",
      sort: "recent",
      limit: 10,
      cursor: page.nextCursor,
    });
    assert.deepEqual(
      next.messages.map((m) => m.messageId),
      [first.event.aggregateId],
    );
  } finally {
    f.close();
  }
});
