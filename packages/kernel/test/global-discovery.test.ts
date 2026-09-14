import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RoomKernel } from "../src/index.ts";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-global-discovery-"));
  const databasePath = join(directory, "test.db");
  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  const human = kernel.provisionPrincipal({ handle: "human", kind: "human" });
  const peer = kernel.provisionPrincipal({ handle: "peer", kind: "human" });
  const outsider = kernel.provisionPrincipal({
    handle: "outsider",
    kind: "human",
  });
  const actor = kernel.authenticateAccessToken(human.accessToken);
  const peerActor = kernel.authenticateAccessToken(peer.accessToken);
  const stranger = kernel.authenticateAccessToken(outsider.accessToken);
  const workspace = kernel.createWorkspace(actor, {
    name: "Discovery",
    slug: "discovery",
    idempotencyKey: "workspace",
  });
  kernel.addMember(actor, {
    roomId: workspace.controlRoom.roomId,
    principalId: peer.principal.principalId,
  });
  const head = (roomId: string) =>
    kernel.sync(actor, { roomId, consumerId: "test-head" }).latestRoomSeq;
  const channel = kernel.createWorkspaceRoom(actor, {
    kind: "channel",
    name: "Design",
    slug: "design",
    workspaceId: workspace.workspace.workspaceId,
    basedOnControlRoomSeq: head(workspace.controlRoom.roomId),
    idempotencyKey: "create-design",
  }).room;
  const second = kernel.createWorkspaceRoom(actor, {
    kind: "channel",
    name: "Build",
    slug: "build",
    workspaceId: workspace.workspace.workspaceId,
    basedOnControlRoomSeq: head(workspace.controlRoom.roomId),
    idempotencyKey: "create-build",
  }).room;
  for (const room of [channel, second])
    kernel.addMember(actor, {
      roomId: room.roomId,
      principalId: peer.principal.principalId,
    });
  const direct = kernel.openDirectRoom(actor, {
    workspaceId: workspace.workspace.workspaceId,
    peerPrincipalId: peer.principal.principalId,
    basedOnControlRoomSeq: head(workspace.controlRoom.roomId),
    idempotencyKey: "dm",
  });
  let serial = 0;
  const post = (roomId: string, body: string, asPeer = false) =>
    kernel.postRoomMessage(asPeer ? peerActor : actor, {
      roomId,
      body,
      basedOnRoomSeq: head(roomId),
      idempotencyKey: `post-${++serial}`,
    });
  const task = (roomId: string, title: string) =>
    kernel.createTask(actor, {
      roomId,
      title,
      basedOnRoomSeq: head(roomId),
      idempotencyKey: `task-${++serial}`,
    }).task;
  return {
    kernel,
    actor,
    peerActor,
    stranger,
    human,
    peer,
    head,
    post,
    task,
    channel,
    second,
    direct,
    workspaceId: workspace.workspace.workspaceId,
    control: workspace.controlRoom,
    databasePath,
    close() {
      kernel.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("Activity summary stays current while the list cursor retains its frozen ceiling", () => {
  const f = fixture();
  try {
    f.post(f.channel.roomId, "before one", true);
    f.post(f.second.roomId, "before two", true);
    const first = f.kernel.listHumanActivity(f.actor, {
      workspaceId: f.workspaceId,
      limit: 1,
    });
    assert.ok(first.nextCursor);
    f.post(f.direct.roomId, "after cursor", true);
    const next = f.kernel.listHumanActivity(f.actor, {
      workspaceId: f.workspaceId,
      limit: 1,
      cursor: first.nextCursor,
    });
    assert.equal(next.total, 2, "the paged list remains frozen");
    assert.equal(
      next.summary?.unreadActivityCount,
      3,
      "attention is not restricted by an old cursor",
    );
    assert.ok(
      next.summary?.rooms.some((room) => room.roomId === f.direct.roomId),
    );
  } finally {
    f.close();
  }
});

test("Activity summary is independent of page size/filter and respects read frontiers and ACL", () => {
  const f = fixture();
  try {
    f.post(f.channel.roomId, "one", true);
    f.post(f.channel.roomId, "two", true);
    f.post(f.second.roomId, "@human three", true);
    const summary = f.kernel.listHumanActivity(f.actor, {
      workspaceId: f.workspaceId,
      limit: 1,
      filter: "mentions",
    }).summary!;
    assert.equal(summary.unreadActivityCount, 2);
    assert.equal(
      summary.rooms.find((r) => r.roomId === f.channel.roomId)?.unreadCount,
      2,
    );
    assert.equal(
      summary.rooms.find((r) => r.roomId === f.second.roomId)?.hasMention,
      true,
    );
    assert.equal(
      f.kernel.listHumanActivity(f.stranger, { workspaceId: f.workspaceId })
        .summary?.unreadActivityCount,
      0,
    );
    f.kernel.markHumanActivity(f.actor, {
      roomId: f.channel.roomId,
      action: "read",
      throughSeq: f.head(f.channel.roomId),
    });
    assert.equal(
      f.kernel.listHumanActivity(f.actor, {
        workspaceId: f.workspaceId,
        limit: 1,
      }).summary?.unreadActivityCount,
      1,
    );
  } finally {
    f.close();
  }
});

test("muting a Room suppresses ordinary Activity but preserves exact mentions", () => {
  const f = fixture();
  try {
    f.post(f.channel.roomId, "ordinary update", true);
    f.post(f.second.roomId, "visible elsewhere", true);
    const key = `room:${f.channel.roomId}`;
    f.kernel.humanSidebar.patch(f.actor, {
      workspaceId: f.workspaceId,
      expectedVersion: 0,
      idempotencyKey: "mute-channel",
      patch: { mutedActivity: [key] },
    });
    let activity = f.kernel.listHumanActivity(f.actor, {
      workspaceId: f.workspaceId,
    });
    assert.equal(
      activity.items.some((item) => item.roomId === f.channel.roomId),
      false,
    );
    assert.equal(
      activity.summary?.rooms.some((room) => room.roomId === f.channel.roomId),
      true,
      "sidebar keeps a muted channel's quiet unread count",
    );
    f.post(f.channel.roomId, "@human please review", true);
    activity = f.kernel.listHumanActivity(f.actor, {
      workspaceId: f.workspaceId,
    });
    assert.equal(
      activity.items.find((item) => item.roomId === f.channel.roomId)
        ?.hasMention,
      true,
    );
    assert.equal(
      activity.summary?.rooms.find((room) => room.roomId === f.channel.roomId)
        ?.hasMention,
      true,
    );
  } finally {
    f.close();
  }
});

test("diagnostic short references require an authorized Room and resolve to exact context", () => {
  const f = fixture();
  try {
    const created = f.post(f.channel.roomId, "target message", true);
    const id = created.event.aggregateId;
    assert.equal(
      f.kernel.getMessageContext(f.actor, {
        roomId: f.channel.roomId,
        messageId: id.slice(0, 12),
      }).message.messageId,
      id,
    );
    assert.throws(
      () =>
        f.kernel.getMessageContext(f.stranger, {
          roomId: f.channel.roomId,
          messageId: id.slice(0, 12),
        }),
      /member|unavailable/,
    );
    assert.throws(
      () =>
        f.kernel.getMessageContext(f.actor, {
          roomId: f.second.roomId,
          messageId: id,
        }),
      /unavailable/,
    );
    assert.throws(
      () =>
        f.kernel.getMessageContext(f.actor, {
          roomId: f.channel.roomId,
          messageId: "msg_",
        }),
      /unavailable/,
    );
  } finally {
    f.close();
  }
});

test("Raft Search scopes filter authors and exact self mentions even without keywords", () => {
  const f = fixture();
  try {
    f.post(f.channel.roomId, "@human scope needle", true);
    f.post(f.channel.roomId, "@human-neighbor scope needle", true);
    f.post(f.channel.roomId, "`@human` is code", true);
    f.post(
      f.channel.roomId,
      "[@human](https://example.com/profile) is an authored link",
      true,
    );
    f.post(f.second.roomId, "other author");
    const input = {
      workspaceId: f.workspaceId,
      query: "",
      senderKind: "human" as const,
      mentionSelf: true,
    };
    const result = f.kernel.searchWorkspace(f.actor, input);
    assert.equal(result.total, 1);
    assert.equal(result.hits[0]?.message.body, "@human scope needle");
    assert.equal(
      f.kernel.searchWorkspace(f.actor, { ...input, senderKind: "agent" })
        .total,
      0,
    );
    assert.equal(
      f.kernel.searchWorkspace(f.actor, { ...input, mentionSelf: false }).total,
      5,
    );
  } finally {
    f.close();
  }
});

test("Web Push projection defaults to DM/mention and supports a muted-aware all-message Room opt-in", () => {
  const f = fixture();
  try {
    const ordinary = f.post(f.channel.roomId, "ordinary channel update", true);
    assert.deepEqual(
      f.kernel.humanNotifications.webPush.project({
        roomId: f.channel.roomId,
        roomSeq: ordinary.event.roomSeq,
      }),
      [],
    );
    const codeMention = f.post(
      f.channel.roomId,
      "`@human` remains a code example",
      true,
    );
    assert.deepEqual(
      f.kernel.humanNotifications.webPush.project({
        roomId: f.channel.roomId,
        roomSeq: codeMention.event.roomSeq,
      }),
      [],
    );
    f.kernel.humanSidebar.patch(f.actor, {
      workspaceId: f.workspaceId,
      expectedVersion: 0,
      idempotencyKey: "notify-all-channel",
      patch: { notifyAllMessages: [`room:${f.channel.roomId}`] },
    });
    const optedIn = f.post(f.channel.roomId, "opted-in channel update", true);
    assert.equal(
      f.kernel.humanNotifications.webPush.project({
        roomId: f.channel.roomId,
        roomSeq: optedIn.event.roomSeq,
      }).length,
      1,
    );
    f.kernel.humanSidebar.patch(f.actor, {
      workspaceId: f.workspaceId,
      expectedVersion: 1,
      idempotencyKey: "mute-notify-all-channel",
      patch: { mutedActivity: [`room:${f.channel.roomId}`] },
    });
    const mutedOrdinary = f.post(
      f.channel.roomId,
      "muted opted-in update",
      true,
    );
    assert.deepEqual(
      f.kernel.humanNotifications.webPush.project({
        roomId: f.channel.roomId,
        roomSeq: mutedOrdinary.event.roomSeq,
      }),
      [],
    );
    const mention = f.post(f.channel.roomId, "@human please review", true);
    const mentionPush = f.kernel.humanNotifications.webPush.project({
      roomId: f.channel.roomId,
      roomSeq: mention.event.roomSeq,
    });
    assert.equal(mentionPush.length, 1);
    assert.equal(mentionPush[0]?.principalId, f.human.principal.principalId);
    assert.equal(mentionPush[0]?.payload.target.kind, "message");
    const direct = f.post(f.direct.roomId, "private update", true);
    const directPush = f.kernel.humanNotifications.webPush.project({
      roomId: f.direct.roomId,
      roomSeq: direct.event.roomSeq,
    });
    assert.equal(directPush.length, 1);
    assert.equal(directPush[0]?.payload.tag, `room:${f.direct.roomId}`);
    assert.equal(
      f.kernel.humanNotifications.webPush.project({
        roomId: f.direct.roomId,
        roomSeq: direct.event.roomSeq + 99,
      }).length,
      0,
    );
  } finally {
    f.close();
  }
});

test("Web Push follows Raft Thread follow state while exact mentions override an unfollow", () => {
  const f = fixture();
  try {
    const task = f.task(f.channel.roomId, "Push follow transitions");
    const reply = (body: string, key: string) =>
      f.kernel.replyThread(f.peerActor, {
        roomId: f.channel.roomId,
        threadId: task.threadId,
        body,
        basedOnRoomSeq: f.head(f.channel.roomId),
        idempotencyKey: key,
        recipientIds: [],
      });
    const project = (roomSeq: number) =>
      f.kernel.humanNotifications.webPush.project({
        roomId: f.channel.roomId,
        roomSeq,
      });

    const implicitFollow = reply(
      "implicit participant update",
      "push-follow-1",
    );
    assert.deepEqual(
      project(implicitFollow.event.roomSeq).map(
        ({ principalId }) => principalId,
      ),
      [f.human.principal.principalId],
    );

    f.kernel.followHumanThread(f.actor, {
      roomId: f.channel.roomId,
      threadId: task.threadId,
      following: false,
    });
    const unfollowed = reply("ordinary update after unfollow", "push-follow-2");
    assert.deepEqual(project(unfollowed.event.roomSeq), []);

    const mentioned = reply("@human direct review", "push-follow-3");
    assert.equal(project(mentioned.event.roomSeq).length, 1);

    f.kernel.followHumanThread(f.actor, {
      roomId: f.channel.roomId,
      threadId: task.threadId,
      following: true,
    });
    const refollowed = reply("ordinary update after refollow", "push-follow-4");
    assert.equal(project(refollowed.event.roomSeq).length, 1);
  } finally {
    f.close();
  }
});

test("Raft server mute suppresses Web Push for the whole Workspace without muting Activity", () => {
  const f = fixture();
  try {
    f.kernel.humanSidebar.patch(f.actor, {
      workspaceId: f.workspaceId,
      expectedVersion: 0,
      idempotencyKey: "mute-workspace-push",
      patch: { mutedWorkspace: true },
    });
    const direct = f.post(f.direct.roomId, "private update", true);
    const mention = f.post(f.channel.roomId, "@human please review", true);
    assert.deepEqual(
      f.kernel.humanNotifications.webPush.project({
        roomId: f.direct.roomId,
        roomSeq: direct.event.roomSeq,
      }),
      [],
    );
    assert.deepEqual(
      f.kernel.humanNotifications.webPush.project({
        roomId: f.channel.roomId,
        roomSeq: mention.event.roomSeq,
      }),
      [],
    );
    assert.equal(
      f.kernel.listHumanActivity(f.actor, {
        workspaceId: f.workspaceId,
      }).total > 0,
      true,
    );
  } finally {
    f.close();
  }
});

test("default relevance and recent are distinct, stable across pages, and bound to scope", () => {
  const f = fixture();
  try {
    const exact = f.post(f.channel.roomId, "needle");
    f.post(f.channel.roomId, "needle prefix");
    const recent = f.post(f.channel.roomId, "a substring needle");
    const input = { workspaceId: f.workspaceId, query: "needle", limit: 1 };
    const first = f.kernel.searchWorkspace(f.actor, input);
    assert.equal(first.hits[0]?.message.messageId, exact.event.aggregateId);
    assert.equal(
      f.kernel.searchWorkspace(f.actor, { ...input, sort: "recent" }).hits[0]
        ?.message.messageId,
      recent.event.aggregateId,
    );
    assert.equal(
      f.kernel.searchWorkspace(f.actor, { ...input, cursor: first.nextCursor })
        .hits[0]?.message.body,
      "needle prefix",
    );
    assert.throws(() =>
      f.kernel.searchWorkspace(f.actor, {
        ...input,
        sort: "recent",
        cursor: first.nextCursor,
      }),
    );
  } finally {
    f.close();
  }
});

test("Search uses the maintained FTS index for long literals and preserves short CJK substring fallback", () => {
  const f = fixture();
  try {
    f.post(f.channel.roomId, "architecture memory architecture durable");
    f.post(f.channel.roomId, "内存 索引");
    assert.equal(
      f.kernel.searchWorkspace(f.actor, {
        workspaceId: f.workspaceId,
        query: "architecture memory",
      }).total,
      1,
    );
    assert.equal(
      f.kernel.searchWorkspace(f.actor, {
        workspaceId: f.workspaceId,
        query: "内存",
      }).total,
      1,
    );
  } finally {
    f.close();
  }
});

test("Raft multi-term Search matches any literal term, ranks fuller matches first, and freezes rank semantics in cursors", () => {
  const f = fixture();
  try {
    const both = f.post(
      f.channel.roomId,
      "任务已经进入队列，等待其他 Agent 认领",
    );
    const onlyTask = f.post(f.channel.roomId, "只有任务这个词");
    const onlyClaim = f.post(f.channel.roomId, "这里只有认领这个词");
    f.post(f.channel.roomId, "完全无关");
    const input = {
      workspaceId: f.workspaceId,
      query: "任务 认领",
      limit: 1,
    };
    const first = f.kernel.searchWorkspace(f.actor, input);
    assert.equal(first.total, 3);
    assert.equal(first.hits[0]?.message.messageId, both.event.aggregateId);
    const second = f.kernel.searchWorkspace(f.actor, {
      ...input,
      cursor: first.nextCursor,
    });
    const third = f.kernel.searchWorkspace(f.actor, {
      ...input,
      cursor: second.nextCursor,
    });
    assert.deepEqual(
      [second.hits[0]?.message.messageId, third.hits[0]?.message.messageId],
      [onlyClaim.event.aggregateId, onlyTask.event.aggregateId],
    );
    assert.equal(third.nextCursor, undefined);
    assert.equal(
      f.kernel.searchWorkspace(f.actor, { ...input, sort: "recent" }).hits[0]
        ?.message.messageId,
      onlyClaim.event.aggregateId,
    );
    assert.throws(() =>
      f.kernel.searchWorkspace(f.actor, {
        ...input,
        query: "任务",
        cursor: first.nextCursor,
      }),
    );
  } finally {
    f.close();
  }
});

test("threadIds constrain indexed search to one authorized Thread", () => {
  const f = fixture();
  try {
    const first = f.task(f.channel.roomId, "first searchable thread");
    const second = f.task(f.channel.roomId, "second searchable thread");
    f.kernel.replyThread(f.actor, {
      basedOnRoomSeq: f.head(f.channel.roomId),
      body: "thread-local needle first",
      idempotencyKey: "thread-search-first",
      recipientIds: [],
      roomId: f.channel.roomId,
      threadId: first.threadId,
    });
    f.kernel.replyThread(f.actor, {
      basedOnRoomSeq: f.head(f.channel.roomId),
      body: "thread-local needle second",
      idempotencyKey: "thread-search-second",
      recipientIds: [],
      roomId: f.channel.roomId,
      threadId: second.threadId,
    });
    const result = f.kernel.searchWorkspace(f.actor, {
      workspaceId: f.workspaceId,
      query: "thread-local needle",
      scope: "thread",
      threadIds: [first.threadId],
    });
    assert.equal(result.total, 1);
    assert.equal(result.hits[0]?.message.threadId, first.threadId);
    assert.equal(result.hits[0]?.message.body, "thread-local needle first");
    assert.equal(result.hits[0]?.rootMessagePreview, "first searchable thread");
  } finally {
    f.close();
  }
});

test("global Tasks are ACL-filtered Workspace channel tasks, never DM/control tasks, with frozen pagination", () => {
  const f = fixture();
  try {
    const a = f.task(f.channel.roomId, "Design task");
    const b = f.task(f.second.roomId, "Build task");
    f.task(f.direct.roomId, "Private task");
    const first = f.kernel.listGlobalTasks(f.actor, {
      workspaceId: f.workspaceId,
      limit: 1,
    });
    assert.equal(first.total, 2);
    assert.equal(first.tasks[0]?.task.taskId, b.taskId);
    assert.equal(first.tasks[0]?.canManageAnyTask, true);
    assert.equal(
      f.kernel.listGlobalTasks(f.peerActor, {
        workspaceId: f.workspaceId,
        limit: 1,
      }).tasks[0]?.canManageAnyTask,
      false,
    );
    f.task(f.channel.roomId, "New after snapshot");
    const next = f.kernel.listGlobalTasks(f.actor, {
      workspaceId: f.workspaceId,
      cursor: first.nextCursor,
      limit: 1,
    });
    assert.deepEqual(
      next.tasks.map((item) => item.task.taskId),
      [a.taskId],
    );
    assert.equal(next.nextCursor, undefined);
    assert.equal(
      f.kernel.listGlobalTasks(f.actor, {
        workspaceId: f.workspaceId,
        roomIds: [f.direct.roomId],
      }).total,
      0,
    );
    assert.equal(
      f.kernel.listGlobalTasks(f.stranger, { workspaceId: f.workspaceId })
        .total,
      0,
    );
    assert.throws(
      () =>
        f.kernel.listGlobalTasks(f.actor, {
          workspaceId: f.workspaceId,
          roomIds: [f.second.roomId],
          cursor: first.nextCursor,
        }),
      /cursor/i,
    );
  } finally {
    f.close();
  }
});

test("every global page reapplies membership, and Workspace boundaries survive cursors", () => {
  const f = fixture();
  try {
    const old = f.post(f.channel.roomId, "bounded search old");
    f.post(f.second.roomId, "bounded search newest");
    f.task(f.channel.roomId, "first task");
    f.task(f.second.roomId, "newest task");
    const tasks = f.kernel.listGlobalTasks(f.peerActor, {
      workspaceId: f.workspaceId,
      limit: 1,
    });
    const search = f.kernel.searchWorkspace(f.peerActor, {
      workspaceId: f.workspaceId,
      query: "bounded search",
      limit: 1,
    });
    const other = f.kernel.createWorkspace(f.actor, {
      name: "Other",
      slug: "other",
      idempotencyKey: "other-workspace",
    });
    const room = f.kernel.createWorkspaceRoom(f.actor, {
      kind: "channel",
      name: "Other Room",
      slug: "other-room",
      workspaceId: other.workspace.workspaceId,
      basedOnControlRoomSeq: f.head(other.controlRoom.roomId),
      idempotencyKey: "other-room",
    }).room;
    f.post(room.roomId, "bounded search other workspace");
    f.task(room.roomId, "other task");
    assert.equal(
      f.kernel.listGlobalTasks(f.actor, { workspaceId: f.workspaceId }).total,
      2,
    );
    assert.equal(
      f.kernel.searchWorkspace(f.actor, {
        workspaceId: f.workspaceId,
        query: "bounded search",
      }).total,
      2,
    );
    f.kernel.removeRoomMember(f.actor, {
      roomId: f.channel.roomId,
      principalId: f.peer.principal.principalId,
      basedOnRoomSeq: f.head(f.channel.roomId),
      idempotencyKey: "revoke-design",
    });
    assert.equal(
      f.kernel.listGlobalTasks(f.peerActor, {
        workspaceId: f.workspaceId,
        limit: 1,
        cursor: tasks.nextCursor,
      }).tasks.length,
      0,
    );
    assert.equal(
      f.kernel.searchWorkspace(f.peerActor, {
        workspaceId: f.workspaceId,
        query: "bounded search",
        limit: 1,
        cursor: search.nextCursor,
      }).hits.length,
      0,
    );
    assert.equal(
      f.kernel
        .listHumanActivity(f.peerActor, { workspaceId: f.workspaceId })
        .items.some((item) => item.roomId === f.channel.roomId),
      false,
    );
    assert.throws(
      () =>
        f.kernel.getMessageContext(f.peerActor, {
          messageId: old.event.aggregateId,
        }),
      /member/i,
    );
    assert.throws(
      () =>
        f.kernel.searchWorkspace(f.stranger, {
          workspaceId: f.workspaceId,
          query: "bounded search",
          cursor: search.nextCursor,
        }),
      /cursor/i,
    );
  } finally {
    f.close();
  }
});

test("Search handles literal text, DMs, sender/date/scope filters, hidden rooms and old exact message context", () => {
  const f = fixture();
  try {
    const old = f.post(f.channel.roomId, "独特记忆 100%_ literal");
    f.post(f.direct.roomId, "独特记忆 direct", true);
    f.post(f.control.roomId, "独特记忆 control");
    f.post(f.channel.roomId, "ÉCOLE non-ASCII casefold");
    assert.equal(
      f.kernel.searchWorkspace(f.actor, {
        workspaceId: f.workspaceId,
        query: "école",
      }).total,
      1,
    );
    for (let i = 0; i < 105; i++) f.post(f.channel.roomId, `filler ${i}`);
    const hits = f.kernel.searchWorkspace(f.actor, {
      workspaceId: f.workspaceId,
      query: "独特记忆",
    });
    const directory = f.kernel.searchWorkspace(f.actor, {
      workspaceId: f.workspaceId,
      query: "",
    });
    assert.equal(directory.hits.length, 0);
    assert.ok(
      directory.principals.some(
        (p) => p.principalId === f.peer.principal.principalId,
      ),
    );
    assert.equal(hits.total, 2);
    assert.equal(
      f.kernel.searchWorkspace(f.stranger, {
        workspaceId: f.workspaceId,
        query: "独特记忆",
      }).total,
      0,
    );
    assert.equal(
      f.kernel.searchWorkspace(f.actor, {
        workspaceId: f.workspaceId,
        query: "%_",
      }).total,
      1,
    );
    assert.equal(
      f.kernel.searchWorkspace(f.actor, {
        workspaceId: f.workspaceId,
        query: "独特记忆",
        scope: "direct",
        senderIds: [f.peer.principal.principalId],
      }).total,
      1,
    );
    assert.equal(
      f.kernel.searchWorkspace(f.actor, {
        workspaceId: f.workspaceId,
        query: "独特记忆",
        before: "2000-01-01T00:00:00.000Z",
      }).total,
      0,
    );
    const context = f.kernel.getMessageContext(f.actor, {
      messageId: old.event.aggregateId,
    });
    assert.equal(context.message.messageId, old.event.aggregateId);
    assert.ok(context.messages.length <= 41);
    assert.ok(
      context.messages.some((m) => m.messageId === old.event.aggregateId),
    );
    assert.throws(
      () =>
        f.kernel.getMessageContext(f.stranger, {
          messageId: old.event.aggregateId,
        }),
      /unavailable|member/i,
    );
    assert.ok(
      f.kernel
        .searchWorkspace(f.actor, {
          workspaceId: f.workspaceId,
          query: "Design",
        })
        .rooms.some((r) => r.roomId === f.channel.roomId),
    );
  } finally {
    f.close();
  }
});

test("Activity copies Raft conversation/thread identity and seen frontier; done does not complete Task or swallow new arrivals", () => {
  const f = fixture();
  try {
    const task = f.task(f.channel.roomId, "Tracked task");
    f.kernel.replyThread(f.peerActor, {
      roomId: f.channel.roomId,
      threadId: task.threadId,
      body: "@human please review",
      basedOnRoomSeq: f.head(f.channel.roomId),
      idempotencyKey: "reply",
      recipientIds: [],
    });
    const initial = f.kernel.listHumanActivity(f.actor, {
      workspaceId: f.workspaceId,
    });
    assert.equal(
      initial.items.length,
      2,
      "channel and followed task thread are distinct cards",
    );
    const thread = initial.items.find(
      (item) => item.threadId === task.threadId,
    )!;
    assert.equal(thread.unreadCount, 1);
    assert.equal(thread.hasMention, true);
    f.kernel.markHumanActivity(f.actor, {
      roomId: thread.roomId,
      threadId: thread.threadId,
      throughSeq: thread.latestSeq,
      action: "read",
    });
    assert.equal(
      f.kernel.listHumanActivity(f.actor, {
        workspaceId: f.workspaceId,
        filter: "unread",
      }).items.length,
      0,
    );
    assert.equal(
      f.kernel.listHumanActivity(f.actor, { workspaceId: f.workspaceId }).items
        .length,
      2,
      "read is not done",
    );
    f.kernel.replyThread(f.peerActor, {
      roomId: f.channel.roomId,
      threadId: task.threadId,
      body: "new after observed frontier",
      basedOnRoomSeq: f.head(f.channel.roomId),
      idempotencyKey: "reply-2",
      recipientIds: [],
    });
    f.kernel.markHumanActivity(f.actor, {
      roomId: thread.roomId,
      threadId: thread.threadId,
      throughSeq: thread.latestSeq,
      action: "done",
    });
    const reopened = f.kernel
      .listHumanActivity(f.actor, { workspaceId: f.workspaceId })
      .items.find((item) => item.threadId === task.threadId)!;
    assert.equal(reopened.unreadCount, 1);
    assert.equal(
      f.kernel.listTasks(f.actor, { roomId: f.channel.roomId })[0]?.state,
      "todo",
    );
    f.kernel.markHumanActivity(f.actor, {
      roomId: thread.roomId,
      threadId: thread.threadId,
      throughSeq: reopened.latestSeq,
      action: "done",
    });
    assert.equal(
      f.kernel
        .listHumanActivity(f.actor, { workspaceId: f.workspaceId })
        .items.some((item) => item.threadId === task.threadId),
      false,
    );
    assert.throws(
      () =>
        f.kernel.markHumanActivity(f.stranger, {
          roomId: thread.roomId,
          throughSeq: 1,
          action: "done",
        }),
      /member/i,
    );
    assert.throws(
      () =>
        f.kernel.markHumanActivity(f.actor, {
          roomId: thread.roomId,
          throughSeq: 999999,
          action: "done",
        }),
      /frontier|sequence/i,
    );
    const reopenedKernel = new RoomKernel({ databasePath: f.databasePath });
    try {
      reopenedKernel.initialize();
      const actor = reopenedKernel.authenticateAccessToken(f.human.accessToken);
      assert.equal(
        reopenedKernel
          .listHumanActivity(actor, { workspaceId: f.workspaceId })
          .items.some((item) => item.threadId === task.threadId),
        false,
      );
    } finally {
      reopenedKernel.close();
    }
  } finally {
    f.close();
  }
});
test("explicit unfollow overrides participation, but a new exact mention still reaches the Human", () => {
  const f = fixture();
  try {
    const task = f.task(f.channel.roomId, "Follow transitions");
    const reply = (body: string, key: string) =>
      f.kernel.replyThread(f.peerActor, {
        roomId: f.channel.roomId,
        threadId: task.threadId,
        body,
        basedOnRoomSeq: f.head(f.channel.roomId),
        idempotencyKey: key,
        recipientIds: [],
      });
    const thread = () =>
      f.kernel
        .listHumanActivity(f.actor, { workspaceId: f.workspaceId })
        .items.find((item) => item.threadId === task.threadId);
    reply("@human old mention", "mention-1");
    f.kernel.markHumanActivity(f.actor, {
      roomId: f.channel.roomId,
      threadId: task.threadId,
      throughSeq: thread()!.latestSeq,
      action: "read",
    });
    f.kernel.followHumanThread(f.actor, {
      roomId: f.channel.roomId,
      threadId: task.threadId,
      following: false,
    });
    assert.equal(
      thread(),
      undefined,
      "an old read mention must not undo explicit unfollow",
    );
    reply("@humanity is not @human's handle suffix", "mention-2");
    // This message contains an exact @human, so it must reach the recipient.
    assert.equal(thread()?.hasMention, true);
    f.kernel.markHumanActivity(f.actor, {
      roomId: f.channel.roomId,
      threadId: task.threadId,
      throughSeq: thread()!.latestSeq,
      action: "read",
    });
    reply(
      "@humanity and mail@human.example are not direct mentions",
      "mention-3",
    );
    assert.equal(thread(), undefined);
    f.kernel.followHumanThread(f.actor, {
      roomId: f.channel.roomId,
      threadId: task.threadId,
      following: true,
    });
    assert.ok(thread(), "explicit refollow restores the thread feed");
    assert.throws(
      () =>
        f.kernel.followHumanThread(f.stranger, {
          roomId: f.channel.roomId,
          threadId: task.threadId,
          following: true,
        }),
      /member/i,
    );
    assert.throws(
      () =>
        f.kernel.followHumanThread(f.actor, {
          roomId: f.second.roomId,
          threadId: task.threadId,
          following: true,
        }),
      /unavailable/i,
    );
  } finally {
    f.close();
  }
});
test("global read queries keep a bounded response over 2,000 canonical history messages", (t) => {
  const f = fixture();
  try {
    for (let i = 0; i < 2000; i++)
      f.post(f.channel.roomId, `history-scale-${i}`);
    const start = performance.now();
    const activity = f.kernel.listHumanActivity(f.actor, {
      workspaceId: f.workspaceId,
    });
    const search = f.kernel.searchWorkspace(f.actor, {
      workspaceId: f.workspaceId,
      query: "history-scale-",
    });
    const elapsed = performance.now() - start;
    t.diagnostic(`2,000-message Activity + Search: ${elapsed.toFixed(1)}ms`);
    assert.equal(activity.items.length, 1);
    assert.equal(search.total, 2000);
    assert.equal(search.hits.length, 50);
    assert.ok(
      elapsed < 2000,
      "global reads must not perform quadratic per-message event scans",
    );
  } finally {
    f.close();
  }
});
test("unfollowed long threads do not re-scan all replies once per message", (t) => {
  const f = fixture();
  try {
    const task = f.task(f.channel.roomId, "long unfollowed thread");
    for (let i = 0; i < 1200; i++)
      f.kernel.replyThread(f.peerActor, {
        roomId: f.channel.roomId,
        threadId: task.threadId,
        body: `no mention ${i}`,
        basedOnRoomSeq: f.head(f.channel.roomId),
        idempotencyKey: `long-${i}`,
        recipientIds: [],
      });
    f.kernel.followHumanThread(f.actor, {
      roomId: f.channel.roomId,
      threadId: task.threadId,
      following: false,
    });
    const start = performance.now();
    const result = f.kernel.listHumanActivity(f.actor, {
      workspaceId: f.workspaceId,
    });
    const elapsed = performance.now() - start;
    t.diagnostic(`1,200-reply unfollowed Activity: ${elapsed.toFixed(1)}ms`);
    assert.equal(result.items.length, 1);
    assert.ok(
      elapsed < 1000,
      "thread eligibility must be computed per thread, not per message",
    );
  } finally {
    f.close();
  }
});

test("Search directory preserves canonical DM participants for identity cards", () => {
  const f = fixture();
  try {
    const result = f.kernel.searchWorkspace(f.actor, {
      workspaceId: f.workspaceId,
      query: "",
    });
    assert.equal(
      result.rooms.find((room) => room.roomId === f.direct.roomId)
        ?.directParticipantIds?.length,
      2,
    );
  } finally {
    f.close();
  }
});

test("explicit mark unread restores durable activity and refuses an obsolete message head", () => {
  const f = fixture();
  try {
    f.post(f.channel.roomId, "hello", true);
    const throughSeq = f.head(f.channel.roomId);
    f.kernel.markHumanActivity(f.actor, {
      roomId: f.channel.roomId,
      throughSeq,
      action: "done",
    });
    f.kernel.markHumanActivity(f.actor, {
      roomId: f.channel.roomId,
      throughSeq,
      action: "unread",
    });
    assert.equal(
      f.kernel.listHumanActivity(f.actor, { workspaceId: f.workspaceId })
        .summary?.unreadActivityCount,
      1,
    );
    f.post(f.channel.roomId, "newer", true);
    assert.throws(
      () =>
        f.kernel.markHumanActivity(f.actor, {
          roomId: f.channel.roomId,
          throughSeq,
          action: "unread",
        }),
      /changed|stale/,
    );
  } finally {
    f.close();
  }
});
