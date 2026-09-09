import assert from "node:assert/strict";
import test from "node:test";

// Raft's `toLocalTime` renders in the process timezone; pin it so the ported
// line shapes are asserted, not the machine the suite runs on.
process.env.TZ = "UTC";

import { renderWorkerReadResult } from "../src/worker-read-render.ts";

const render = (path: string, result: unknown, body: unknown = {}) =>
  renderWorkerReadResult(path, body, result);

test("message-read renders Raft's formatHistory window, header and cursors", () => {
  const text = render(
    "/v1/worker/messages/history",
    {
      frozenThroughRoomSeq: 9,
      messages: [
        {
          actorId: "participant-a",
          body: "first [task #3 status=in_progress]",
          createdAt: "2026-09-09T01:02:03.000Z",
          messageId: "message-1",
          roomId: "room-1",
          roomSeq: 4,
        },
        {
          actorId: "participant-b",
          attachments: [{ attachmentId: "att-1", filename: "log.txt" }],
          body: "second",
          createdAt: "2026-09-09T01:04:05.000Z",
          messageId: "message-2",
          roomId: "room-1",
          roomSeq: 7,
          threadId: "thread-1",
        },
      ],
      olderCursor: "older",
    },
    {},
  );
  assert.equal(
    text,
    [
      "Read window: 2 returned, seq 4-7, oldest to newest. Older exist: --before message-1. No newer.",
      "",
      "[1/2 seq=4 msg=message-1 time=2026-09-09 01:02:03] @participant-a: first [task #3 status=in_progress]",
      "[2/2 seq=7 msg=message-2 time=2026-09-09 01:04:05 threadId=thread-1] @participant-b: second [1 attachment: log.txt (id:att-1) — use rah worker attachment-download to download]",
      "",
      "End of window: 2/2 shown.",
    ].join("\n"),
  );
});

test("message-read with no messages renders Raft's empty-window sentence", () => {
  assert.equal(
    render("/v1/worker/messages/history", { messages: [] }),
    "No messages in this channel.",
  );
});

test("message-resolve renders the Raft message line and its thread root", () => {
  const text = render("/v1/worker/messages/resolve", {
    message: {
      actorId: "participant-a",
      body: "reply",
      createdAt: "2026-09-09T01:02:03.000Z",
      messageId: "message-2",
      roomId: "room-1",
      roomSeq: 8,
      threadId: "thread-1",
    },
    rootMessage: {
      actorId: "participant-b",
      body: "root",
      createdAt: "2026-09-09T01:00:00.000Z",
      messageId: "message-1",
      roomId: "room-1",
      roomSeq: 3,
    },
    threadId: "thread-1",
  });
  assert.equal(
    text,
    [
      "[target=room-1:thread-1 msg=message-2 time=2026-09-09 01:02:03] @participant-a: reply",
      "",
      "Thread root:",
      "[target=room-1 msg=message-1 time=2026-09-09 01:00:00] @participant-b: root",
    ].join("\n"),
  );
});

test("sync renders the delivered window and Raft's drain terminator", () => {
  const text = render("/v1/worker/sync", {
    cursorAfter: 7,
    cursorBefore: 3,
    events: [
      {
        actorId: "participant-a",
        aggregateId: "message-1",
        aggregateType: "message",
        createdAt: "2026-09-09T01:02:03.000Z",
        eventId: "event-1",
        idempotencyKey: "key-1",
        payload: {
          body: "hello",
          messageId: "message-1",
          recipients: [{ participantId: "participant-b", reason: "mention" }],
        },
        roomId: "room-1",
        roomSeq: 5,
        schemaVersion: 1,
        type: "message.posted",
      },
      {
        actorId: "participant-a",
        aggregateId: "task-1",
        aggregateType: "task",
        createdAt: "2026-09-09T01:03:03.000Z",
        eventId: "event-2",
        idempotencyKey: "key-2",
        payload: { taskId: "task-1" },
        roomId: "room-1",
        roomSeq: 7,
        schemaVersion: 1,
        type: "task.created",
      },
    ],
    latestRoomSeq: 9,
    snapshot: null,
  });
  assert.equal(
    text,
    [
      "Sync window: 2 delivered, seq 5-7, cursor 3 to 7 of 9, oldest to newest.",
      "",
      "[seq=5 msg=message-1 time=2026-09-09 01:02:03 type=message.posted] @participant-a: hello",
      "  mentions: @participant-b",
      "seq=7 time=2026-09-09T01:03:03.000Z actor=@participant-a type=task.created",
      '  {"taskId":"task-1"}',
      "",
      "More messages are pending. Run `rah worker sync` again.",
    ].join("\n"),
  );
});

test("sync says the inbox is drained when the cursor reaches the latest sequence", () => {
  const text = render("/v1/worker/sync", {
    cursorAfter: 9,
    cursorBefore: 9,
    events: [],
    latestRoomSeq: 9,
    snapshot: null,
  });
  assert.equal(
    text,
    [
      "Sync window: 0 delivered, cursor 9 to 9 of 9.",
      "",
      "No new inbox messages.",
      "",
      "No more new inbox messages.",
    ].join("\n"),
  );
});

test("sync states the already-presented ledger facts as text", () => {
  const text = render("/v1/worker/sync", {
    cursorAfter: 9,
    cursorBefore: 9,
    events: [],
    latestRoomSeq: 9,
    presentedContext: {
      events: [
        {
          alreadyPresented: true,
          messageId: "message-1",
          presentedThroughSeq: 5,
          respondedAfter: { count: 2, messageIds: ["message-2"] },
          roomSeq: 5,
        },
      ],
      targets: [{ presentedThroughSeq: 5, roomId: "room-1" }],
    },
    snapshot: null,
  });
  assert.match(text ?? "", /Already presented: target room-1 through seq 5\./u);
  assert.match(
    text ?? "",
    /seq 5 \(msg=message-1\) was already presented through seq 5; you posted 2 message\(s\) at that target afterwards \(message-2\)\./u,
  );
});

test("room-members renders Raft's channel member sections and keeps participant ids", () => {
  const text = render("/v1/worker/room/members", {
    members: [
      {
        agentState: "enabled",
        displayName: "Ada",
        description: "reviewer",
        isSelf: false,
        principal: {
          handle: "ada",
          kind: "agent",
          principalId: "participant-a",
        },
      },
      {
        displayName: "Sun",
        isSelf: true,
        principal: {
          handle: "sun",
          kind: "human",
          principalId: "participant-h",
        },
      },
    ],
    roomId: "room-1",
  });
  assert.equal(
    text,
    [
      "## Channel Members",
      "",
      "Channel: room-1",
      "Members means join/post authority for this surface.",
      "",
      "### Agents",
      "Role labels show server-level owner/admin authority; no role label means ordinary member.",
      "  - @ada (enabled) id=participant-a — reviewer",
      "",
      "### Humans",
      "Role labels show server-level owner/admin authority; no role label means ordinary member.",
      "  - @sun id=participant-h",
      "",
    ].join("\n"),
  );
});

test("server-info renders the runtime, the current agent and the room roster", () => {
  const text = render("/v1/worker/server/info", {
    members: [
      {
        agentState: "enabled",
        displayName: "Ada",
        isSelf: true,
        principal: {
          handle: "ada",
          kind: "agent",
          principalId: "participant-a",
        },
      },
    ],
    room: {
      createdAt: "2026-09-01T00:00:00.000Z",
      description: "the build room",
      kind: "channel",
      name: "build",
      roomId: "room-1",
      slug: "build",
      visibility: "public",
      workspaceId: "workspace-1",
    },
    roomId: "room-1",
    scope: "current_room",
    selfParticipantId: "participant-a",
  });
  assert.match(text ?? "", /^## Server\n/u);
  assert.match(text ?? "", /### Current Agent\n- Participant: participant-a/u);
  assert.match(text ?? "", /### Rooms\n/u);
  assert.match(
    text ?? "",
    /- #build \[public, joined\] id=room-1 — the build room/u,
  );
  assert.match(
    text ?? "",
    /### Agents\n.*\n {2}- @ada \(enabled\) id=participant-a/u,
  );
});

test("room-list renders the Raft channel-line shape and its page footer", () => {
  const text = render("/v1/worker/rooms/list", {
    nextCursor: "next",
    projection: "current",
    rooms: [
      {
        attention: { activityMuted: true, muteFromSeq: 4 },
        channel: "#build",
        room: {
          createdAt: "2026-09-01T00:00:00.000Z",
          kind: "channel",
          name: "build",
          roomId: "room-1",
          slug: "build",
          visibility: "public",
          workspaceId: "workspace-1",
        },
      },
    ],
  });
  assert.equal(
    text,
    [
      "## Rooms",
      "",
      "  - #build [public, joined, muted] id=room-1",
      "",
      'More: rah worker room-list --cursor "next"',
    ].join("\n"),
  );
});

test("task-list renders Raft's task board and keeps the canonical Task id", () => {
  const text = render(
    "/v1/worker/tasks/list",
    {
      projection: "current",
      tasks: [
        {
          assigneeId: "participant-b",
          collaboratorIds: [],
          createdAt: "2026-09-09T01:00:00.000Z",
          creatorId: "participant-a",
          dependencyTaskIds: [],
          description: "line one\nline two",
          reviewerIds: [],
          roomId: "room-1",
          sourceMessageId: "message-1",
          state: "todo",
          taskId: "task-1",
          taskNumber: 3,
          threadId: "thread-1",
          title: "Fix the login bug",
          updatedAt: "2026-09-09T01:00:00.000Z",
          workflowStatus: "todo",
        },
      ],
    },
    { channel: "#build" },
  );
  assert.equal(
    text,
    [
      "## Task Board for #build (1 tasks)",
      "",
      "#3 [todo] Fix the login bug → @participant-b (by @participant-a) msg=message-1 id=task-1",
      "  details: line one",
      "           line two",
    ].join("\n"),
  );
});

test("task-list says which filter found nothing", () => {
  assert.equal(
    render(
      "/v1/worker/tasks/list",
      { projection: "current", tasks: [] },
      { channel: "#build", status: "done" },
    ),
    "No done tasks in #build.",
  );
});

test("task-history renders Raft's event lines", () => {
  const text = render("/v1/worker/tasks/history", {
    events: [
      {
        actorId: "participant-a",
        createdAt: "2026-09-09T01:00:00.000Z",
        eventId: "event-1",
        roomSeq: 4,
        title: "Fix the login bug",
        type: "task.created",
      },
    ],
    frozenThroughRoomSeq: 9,
    taskId: "task-1",
  });
  assert.equal(
    text,
    [
      "## Task task-1 history",
      "",
      "seq=4 time=2026-09-09T01:00:00.000Z actor=@participant-a type=task.created",
      '  {"title":"Fix the login bug"}',
    ].join("\n"),
  );
});

test("task-get renders the Task as key lines and keeps its canonical ids", () => {
  const text = render("/v1/worker/tasks/get", {
    task: {
      assigneeId: "participant-b",
      collaboratorIds: [],
      createdAt: "2026-09-09T01:00:00.000Z",
      creatorId: "participant-a",
      dependencyTaskIds: [],
      reviewerIds: [],
      roomId: "room-1",
      sourceMessageId: "message-1",
      state: "in_progress",
      taskId: "task-1",
      taskNumber: 3,
      threadId: "thread-1",
      title: "Fix the login bug",
      updatedAt: "2026-09-09T01:05:00.000Z",
      workflowStatus: "in_progress",
    },
  });
  assert.match(text ?? "", /^## Task #3\n/u);
  assert.match(text ?? "", /\nTitle: Fix the login bug\n/u);
  assert.match(text ?? "", /\nID: task-1\n/u);
  assert.match(text ?? "", /\nStatus: in_progress\n/u);
  assert.match(text ?? "", /\nAssignee: @participant-b\n/u);
  assert.match(text ?? "", /\nSource message: message-1\n/u);
});

test("task-submission and task-input-status render text, including the empty case", () => {
  assert.match(
    render("/v1/worker/tasks/submission", {
      submission: {
        artifacts: [],
        createdAt: "2026-09-09T01:00:00.000Z",
        messageId: "message-1",
        producerId: "participant-b",
        roomId: "room-1",
        submissionDigest: "sha256:abc",
        submissionId: "submission-1",
        submissionNumber: 1,
        summary: "done",
        taskId: "task-1",
      },
    }) ?? "",
    /^## Task submission #1\n[\S\s]*\nSummary:\n {2}done$/u,
  );
  assert.equal(
    render("/v1/worker/tasks/input-status", { inputRequest: null }),
    "No input request is open for this task.",
  );
  assert.equal(
    render("/v1/worker/tasks/input-status", {
      inputRequest: {
        inputRequestId: "input-1",
        state: "pending",
        taskId: "task-1",
      },
    }),
    "Input request input-1 for task task-1 is pending.",
  );
});

test("version renders the three-line Raft version block", () => {
  assert.equal(
    render("/v1/worker/version", {
      buildVersion: "1.2.3",
      cliCarrier: { name: "@rah-os/agent-host", version: "0.1.0" },
      protocolVersion: 4,
      source: "serving_daemon",
    }),
    [
      "RAH CLI: @rah-os/agent-host 0.1.0",
      "RAH daemon (live): 1.2.3",
      "Worker protocol (live): 4",
    ].join("\n"),
  );
});

test("whoami keeps Raft's unconditional JSON and has no renderer", () => {
  assert.equal(
    render("/v1/worker/auth/whoami", { authenticated: true }),
    undefined,
  );
});

test("room-read renders the delivered window and keeps the context receipt", () => {
  const text = render("/v1/worker/rooms/read", {
    complete: true,
    contextReceipt: "receipt-1",
    eventFloorSeq: 4,
    roomId: "room-1",
    throughRoomSeq: 7,
    window: {
      cursorAfter: 7,
      cursorBefore: 4,
      events: [
        {
          actorId: "participant-a",
          aggregateId: "message-1",
          aggregateType: "message",
          createdAt: "2026-09-09T01:02:03.000Z",
          eventId: "event-1",
          idempotencyKey: "key-1",
          payload: { body: "hello", messageId: "message-1" },
          roomId: "room-1",
          roomSeq: 5,
          schemaVersion: 1,
          type: "message.posted",
        },
      ],
      latestRoomSeq: 7,
      snapshot: null,
    },
  });
  assert.equal(
    text,
    [
      "Read window: 1 delivered at room-1, seq 4-7, complete, oldest to newest.",
      "Context receipt: receipt-1",
      "",
      "[seq=5 msg=message-1 time=2026-09-09 01:02:03 type=message.posted] @participant-a: hello",
      "",
      "End of window: 1/1 shown.",
    ].join("\n"),
  );
});

test("a command with no ported renderer keeps its JSON response", () => {
  assert.equal(
    render("/v1/worker/messages/search", { messages: [] }),
    undefined,
  );
  assert.equal(render("/v1/worker/profiles/get", { isSelf: true }), undefined);
});
