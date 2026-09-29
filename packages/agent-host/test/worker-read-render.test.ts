import assert from "node:assert/strict";
import test from "node:test";

// Raft's `toLocalTime` renders in the process timezone; pin it so the ported
// line shapes are asserted, not the machine the suite runs on.
process.env.TZ = "UTC";

import {
  renderWorkerAttachmentDownload,
  renderWorkerAttachmentPublish,
  renderWorkerReadResult,
  renderWorkerTaskClaimResults,
  workerReadCommandOffersJson,
} from "../src/worker-read-render.ts";

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
      "[1/2 target=room-1 seq=4 msg=message-1 time=2026-09-09 01:02:03] @participant-a: first [task #3 status=in_progress]",
      "[2/2 target=room-1 seq=7 msg=message-2 time=2026-09-09 01:04:05 threadId=thread-1] @participant-b: second [1 attachment: log.txt (id:att-1) — use loom-worker attachment-download to download]",
      "",
      "End of window: 2/2 shown.",
    ].join("\n"),
  );
});

test("message-read shows a reference, not the body, for messages this run's wake already delivered", () => {
  const text = render("/v1/worker/messages/history", {
    frozenThroughRoomSeq: 9,
    deliveredInWakeSeqs: [7],
    messages: [
      {
        actorId: "participant-a",
        body: "older context the wake did not carry",
        createdAt: "2026-09-09T01:02:03.000Z",
        messageId: "message-1",
        roomId: "room-1",
        roomSeq: 4,
      },
      {
        actorId: "participant-b",
        body: "SECRET_ALREADY_IN_WAKE",
        createdAt: "2026-09-09T01:04:05.000Z",
        messageId: "message-2",
        roomId: "room-1",
        roomSeq: 7,
      },
    ],
  });
  assert.ok(text);
  assert.match(text, /older context the wake did not carry/u);
  assert.doesNotMatch(text, /SECRET_ALREADY_IN_WAKE/u);
  assert.match(text, /seq=7 .*\(delivered in this wake\)/u);
});

test("message-read with no messages renders Raft's empty-window sentence", () => {
  assert.equal(
    render("/v1/worker/messages/history", { messages: [] }),
    "No messages in this channel.",
  );
});

// ------------------------------------------------------------------ search --

const SEARCH_PATH = "/v1/worker/messages/search";

// One deterministic body long enough that Raft's 80/120-character preview
// window has to cut it, so a match at the start, in the middle and at the end
// each produce a different omission shape.
const LONG_BODY =
  "The deployment checklist starts here. " +
  "Then a long stretch of filler text about the migration, the rollout window, the freeze, and the owners who signed off on each stage of the plan. " +
  "Somewhere in the middle we mention the CANARY rollback decision that was taken on Tuesday. " +
  "More filler follows about dashboards, alert thresholds, paging rotations, and the runbook that nobody has read since the last incident review. " +
  "Finally the note closes with the OWNER handoff.";

const searchMessage = (overrides: Record<string, unknown> = {}) => ({
  actorId: "participant-a",
  body: LONG_BODY,
  createdAt: "2026-09-09T01:02:03.000Z",
  messageId: "message-1",
  roomId: "room-1",
  roomSeq: 4,
  ...overrides,
});

const previewOf = (text: string) =>
  text.slice(
    text.indexOf("<preview>\n") + "<preview>\n".length,
    text.indexOf("\n</preview>"),
  );

const searchPreview = (body: string, query: string) =>
  previewOf(
    render(
      SEARCH_PATH,
      { messages: [searchMessage({ body })] },
      query === "" ? {} : { query },
    ) as string,
  );

test("message-search renders Raft's formatSearchResults block for one result", () => {
  assert.equal(
    render(
      SEARCH_PATH,
      { messages: [searchMessage({ body: "Ship it now, @alice said." })] },
      { query: "ship" },
    ),
    [
      'Search results for: "ship" (1 result)',
      "",
      '<result ref="msg:message-1">',
      "Source: room:room-1",
      "Sender: @participant-a",
      "Time: 2026-09-09 01:02:03",
      "",
      "<preview>",
      "<match>Ship</match> it now, user:alice said.",
      "</preview>",
      "</result>",
      "",
      "If a result may be relevant but its preview is not enough, read the surrounding context for that result before answering.",
    ].join("\n"),
  );
});

test("message-search names a Thread target and pluralises the result count", () => {
  const text = render(
    SEARCH_PATH,
    {
      messages: [
        searchMessage({ body: "first hit" }),
        searchMessage({
          body: "second hit",
          messageId: "message-2",
          actorId: "participant-b",
          threadId: "thread-9",
          createdAt: "2026-09-09T02:00:00.000Z",
        }),
      ],
    },
    { query: "hit" },
  ) as string;
  assert.match(text, /^Search results for: "hit" \(2 results\)$/mu);
  assert.match(text, /^Source: room:room-1$/mu);
  assert.match(text, /^Source: thread:room-1:thread-9$/mu);
  assert.match(text, /^<result ref="msg:message-2">$/mu);
  assert.match(text, /^Sender: @participant-b$/mu);
  // Raft separates results with a blank line.
  assert.ok(text.includes("</result>\n\n<result "));
});

test("message-search renders Raft's filter-only header when no query was sent", () => {
  const text = render(
    SEARCH_PATH,
    { messages: [searchMessage({ body: "Filter only result body." })] },
    { sender: "@human", sort: "recent" },
  ) as string;
  assert.match(text, /^Filtered message results \(1 result\)$/mu);
  assert.equal(previewOf(text), "Filter only result body.");
});

test("message-search renders Raft's empty sentence for an empty result set", () => {
  assert.equal(
    render(SEARCH_PATH, { messages: [] }, { query: "nothing" }),
    "No search results.",
  );
});

test("message-search follows the RAH paging cursor the read family already prints", () => {
  const text = render(
    SEARCH_PATH,
    { messages: [searchMessage({ body: "page one" })], nextCursor: "c-2" },
    { query: "page" },
  ) as string;
  assert.ok(
    text.endsWith(
      'before answering.\nMore: loom-worker message-search --cursor "c-2"',
    ),
    text,
  );
});

test("renderSearchPreview trims the window around a match at the start, middle and end", () => {
  assert.equal(
    searchPreview(LONG_BODY, "deployment"),
    "The <match>deployment</match> checklist starts here. Then a long stretch of filler text about the migration, the rollout window, the freeze, and the<omit />",
  );
  assert.equal(
    searchPreview(LONG_BODY, "CANARY"),
    "<omit />ho signed off on each stage of the plan. Somewhere in the middle we mention the <match>CANARY</match> rollback decision that was taken on Tuesday. More filler follows about dashboards, alert thresholds, paging rotations,<omit />",
  );
  assert.equal(
    searchPreview(LONG_BODY, "handoff"),
    "<omit />has read since the last incident review. Finally the note closes with the OWNER <match>handoff</match>.",
  );
});

test("renderSearchPreview falls back to the leading window when nothing matches", () => {
  assert.equal(
    searchPreview(LONG_BODY, "zzz nowhere"),
    "The deployment checklist starts here. Then a long stretch of filler text about the migration, the rollout window, the freeze, and the owners who signed off on each stage of the plan. Somewhere in the<omit />",
  );
});

test("findSearchMatch prefers the exact phrase, then the first term, and the first occurrence", () => {
  assert.equal(
    searchPreview(LONG_BODY, '"rollback decision" freeze'),
    "<omit />ed off on each stage of the plan. Somewhere in the middle we mention the CANARY <match>rollback decision</match> that was taken on Tuesday. More filler follows about dashboards, alert thresholds, paging rotations, and the runbook th<omit />",
  );
  assert.equal(
    searchPreview("needle one, then needle two, then needle three.", "needle"),
    "<match>needle</match> one, then needle two, then needle three.",
  );
});

test("a body shorter than the preview window is shown whole, with no omission marks", () => {
  const preview = searchPreview("Ship it now, @alice said.", "now");
  assert.equal(preview, "Ship it <match>now</match>, user:alice said.");
  assert.ok(!preview.includes("<omit />"));
});

test("expandSearchMatchToRefLiteral widens a partial hit to the whole reference literal", () => {
  assert.equal(
    searchPreview("Please ask @alice-b about the rollout.", "alice"),
    "Please ask <match>user:alice-b</match> about the rollout.",
  );
  assert.equal(
    searchPreview("That is tracked as task #7 already.", "7"),
    "That is tracked as <match>task:7</match> already.",
  );
  assert.equal(
    searchPreview("Continue in dm:@alice for the details.", "alice"),
    "Continue in <match>dm:user:alice</match> for the details.",
  );
  assert.equal(
    searchPreview("Posted in #ops-room earlier today.", "ops"),
    "Posted in <match>channel:ops-room</match> earlier today.",
  );
});

test("a body that contains the preview markup itself is escaped, not obeyed", () => {
  assert.equal(
    searchPreview(
      "The <match> tag and <omit /> marker are literal here.",
      "tag",
    ),
    "The &lt;match&gt; <match>tag</match> and &lt;omit /&gt; marker are literal here.",
  );
});

test("message-search has no --json, because Raft's message search has none", () => {
  assert.equal(workerReadCommandOffersJson(SEARCH_PATH), false);
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
      "[target=room-1 threadId=thread-1 msg=message-2 time=2026-09-09 01:02:03] @participant-a: reply",
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
      "[target=room-1 seq=5 msg=message-1 time=2026-09-09 01:02:03 type=message.posted] @participant-a: hello",
      "  mentions: @participant-b",
      "seq=7 time=2026-09-09T01:03:03.000Z actor=@participant-a type=task.created",
      '  {"taskId":"task-1"}',
      "",
      "More messages are pending. Run `loom-worker sync` again.",
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
  assert.match(
    text ?? "",
    /Presentation high-water: target room-1 seq 5; not a contiguous read frontier\./u,
  );
  assert.match(
    text ?? "",
    /seq 5 \(msg=message-1\) was already presented; you posted 2 message\(s\) at that target afterwards \(message-2\)\./u,
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
      "Role labels describe recorded Room membership, not server-wide authority; an absent label means the role was not provided.",
      "  - @ada (enabled) id=participant-a — reviewer",
      "",
      "### Humans",
      "Role labels describe recorded Room membership, not server-wide authority; an absent label means the role was not provided.",
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
      'More: loom-worker room-list --cursor "next"',
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
      "[target=room-1 seq=5 msg=message-1 time=2026-09-09 01:02:03 type=message.posted] @participant-a: hello",
      "",
      "End of window: 1/1 shown.",
    ].join("\n"),
  );
});

test("a command with no ported renderer keeps its JSON response", () => {
  assert.equal(
    render("/v1/worker/attachments/prepare", { attachmentId: "a" }),
    undefined,
  );
});

// ------------------------------------------------------- task mutations --

const TASK = {
  assigneeId: undefined,
  claimUntil: undefined,
  description: undefined,
  roomId: "room-1",
  sourceMessageId: "message-9",
  state: "todo",
  taskId: "task-1",
  taskNumber: 4,
  threadId: "thread-9",
  title: "Ship the port",
  workflowStatus: "todo",
};

test("task-create renders Raft's formatTasksCreated block and thread hint", () => {
  assert.equal(
    render("/v1/worker/tasks/create", { task: TASK }),
    [
      "Created 1 task(s) in room-1:",
      '#4 [todo] assignee=unassigned claimUntil=null msg=message-9 "Ship the port"',
      "",
      "To follow up in each task's thread:",
      "#4 → loom-worker message-post --thread-id thread-9",
    ].join("\n"),
  );
});

test("task-create names the assignee and the lease bound when the Task is claimed", () => {
  assert.match(
    render("/v1/worker/tasks/create", {
      task: {
        ...TASK,
        assigneeId: "participant-b",
        claimUntil: "2026-09-09T02:00:00.000Z",
        state: "claimed",
        workflowStatus: "in_progress",
      },
    })!,
    /^#4 \[in_progress\] assignee=@participant-b claimUntil=2026-09-09T02:00:00\.000Z msg=message-9 "Ship the port"$/mu,
  );
});

test("task-claim and task-claim-message render Raft's formatClaimResults block", () => {
  for (const path of [
    "/v1/worker/tasks/claim",
    "/v1/worker/tasks/claim-message",
  ]) {
    assert.equal(
      render(path, { task: TASK }),
      [
        "Claim results (1 claimed):",
        "#4 (msg:message-9): claimed",
        "",
        "Follow up in each task's thread:",
        "#4 → loom-worker message-post --thread-id thread-9",
      ].join("\n"),
    );
  }
});

test("a repeated --number claim renders one block covering every Task", () => {
  assert.equal(
    renderWorkerTaskClaimResults([
      { task: TASK },
      { task: { ...TASK, sourceMessageId: "message-10", taskNumber: 5 } },
    ]),
    [
      "Claim results (2 claimed):",
      "#4 (msg:message-9): claimed",
      "#5 (msg:message-10): claimed",
      "",
      "Follow up in each task's thread:",
      "#4 → loom-worker message-post --thread-id thread-9",
      "#5 → loom-worker message-post --thread-id thread-9",
    ].join("\n"),
  );
});

test("task-assign renders formatTaskAssigned in both directions", () => {
  assert.equal(
    render("/v1/worker/tasks/assign", {
      task: { ...TASK, assigneeId: "participant-b" },
    }),
    "#4 assigned to @participant-b.",
  );
  assert.equal(
    render("/v1/worker/tasks/assign", { task: TASK }),
    "#4 unassigned — now open.",
  );
});

test("task-release renders Raft's unclaim line", () => {
  assert.equal(
    render("/v1/worker/tasks/release", { task: TASK }),
    "#4 unclaimed — now open.",
  );
});

test("every status-moving Task command renders formatTaskStatusUpdated", () => {
  for (const [path, workflowStatus] of [
    ["/v1/worker/tasks/start", "in_progress"],
    ["/v1/worker/tasks/progress", "in_progress"],
    ["/v1/worker/tasks/block", "blocked"],
    ["/v1/worker/tasks/request-input", "waiting_input"],
    ["/v1/worker/tasks/submit", "in_review"],
    ["/v1/worker/tasks/review", "done"],
    ["/v1/worker/tasks/unblock", "todo"],
  ] as const) {
    assert.equal(
      render(path, { task: { ...TASK, workflowStatus } }),
      `#4 moved to ${workflowStatus}.`,
    );
  }
});

test("task-amend names the recorded event and renders the amended details", () => {
  assert.equal(
    render("/v1/worker/tasks/amend", {
      event: { roomSeq: 12 },
      task: { ...TASK, description: "one\ntwo", title: "Amended" },
    }),
    [
      "#4 amended — event seq 12.",
      "title: Amended",
      "details:",
      "  one",
      "  two",
    ].join("\n"),
  );
  assert.match(
    render("/v1/worker/tasks/amend", { event: { roomSeq: 12 }, task: TASK })!,
    /^details: <none>$/mu,
  );
});

test("task-convert and task-delete render Raft's acknowledgements", () => {
  assert.equal(
    render("/v1/worker/tasks/convert", { task: TASK }),
    [
      'Converted msg=message-9 to task #4 [todo] assignee=unassigned "Ship the port"',
      "",
      "To follow up in the task's thread:",
      "loom-worker message-post --thread-id thread-9",
    ].join("\n"),
  );
  assert.equal(
    render("/v1/worker/tasks/delete", { deleted: true, taskNumber: 4 }),
    "#4 deleted.",
  );
});

// ------------------------------------------------------------ reminders --

const REMINDER = {
  fireAt: "2126-09-09T03:00:00.000Z",
  msgId: "message-9",
  reminderId: "reminder-1",
  status: "scheduled",
  title: "Check the deploy",
};

test("reminder schedule, snooze and update render Raft's confirmation block", () => {
  for (const [path, headline] of [
    ["/v1/worker/reminders/schedule", "Reminder scheduled"],
    ["/v1/worker/reminders/snooze", "Reminder snoozed"],
    ["/v1/worker/reminders/update", "Reminder updated"],
  ] as const) {
    assert.equal(
      render(path, { deduplicated: false, reminder: REMINDER }),
      [
        `${headline}: #reminder-1 (one-time) "Check the deploy"`,
        "Next: 2126-09-09T03:00:00.000Z",
        "(to modify: snooze/update/cancel; loom-worker reminder --help)",
      ].join("\n"),
    );
  }
});

test("a recurring reminder states its cadence the way formatReminderType does", () => {
  assert.match(
    render("/v1/worker/reminders/schedule", {
      reminder: {
        ...REMINDER,
        recurrence: { description: "every weekday at 09:00", kind: "daily" },
      },
    })!,
    /^Reminder scheduled: #reminder-1 \(recurring · every weekday at 09:00\) "Check the deploy"$/mu,
  );
});

test("reminder list renders one formatReminder line each and flags an overdue one", () => {
  assert.equal(render("/v1/worker/reminders/list", {}), "No reminders.");
  const text = render("/v1/worker/reminders/list", {
    reminders: [
      REMINDER,
      { ...REMINDER, fireAt: "2020-01-01T00:00:00.000Z", reminderId: "old" },
      {
        ...REMINDER,
        firedAt: "2020-01-02T00:00:00.000Z",
        reminderId: "done",
        status: "fired",
      },
    ],
  })!;
  assert.deepEqual(text.split("\n"), [
    '#reminder-1 [scheduled] (one-time) next=2126-09-09T03:00:00.000Z "Check the deploy" ref=message-9',
    '#old [scheduled] (one-time) next=2020-01-01T00:00:00.000Z OVERDUE "Check the deploy" ref=message-9',
    '#done [fired] (one-time) fired_at=2020-01-02T00:00:00.000Z "Check the deploy" ref=message-9',
  ]);
});

test("reminder cancel and log render Raft's lines", () => {
  assert.equal(
    render("/v1/worker/reminders/cancel", {
      reminder: { ...REMINDER, status: "canceled" },
    }),
    'Reminder canceled: #reminder-1 [canceled] "Check the deploy"',
  );
  assert.equal(
    render("/v1/worker/reminders/log", { events: [] }),
    "No reminder events.",
  );
  assert.equal(
    render("/v1/worker/reminders/log", {
      events: [
        {
          actorId: "participant-a",
          actorType: "agent",
          eventType: "scheduled",
          nextFireAt: "2126-09-09T03:00:00.000Z",
          occurredAt: "2026-09-09T01:00:00.000Z",
        },
        {
          actorType: "system",
          eventType: "canceled",
          occurredAt: "2026-09-09T02:00:00.000Z",
        },
      ],
    }),
    [
      "2026-09-09T01:00:00.000Z SCHEDULED by agent:participant-a next=2126-09-09T03:00:00.000Z",
      "2026-09-09T02:00:00.000Z CANCELED by system next=none",
    ].join("\n"),
  );
});

// --------------------------------------------- attention and reactions --

test("channel mute and unmute render Raft's three-line result", () => {
  assert.equal(
    render(
      "/v1/worker/channels/mute",
      { activityMuted: true, muteFromSeq: 12, roomId: "room-1" },
      { channel: "#build" },
    ),
    ["Muted #build.", "Activity muted: yes", "Mute from seq: 12"].join("\n"),
  );
  assert.equal(
    render("/v1/worker/channels/unmute", {
      activityMuted: false,
      muteFromSeq: null,
      roomId: "room-1",
    }),
    ["Unmuted room-1.", "Activity muted: no", "Mute from seq: none"].join("\n"),
  );
});

test("thread-unfollow renders Raft's three-line notice", () => {
  assert.equal(
    render(
      "/v1/worker/threads/unfollow",
      { following: false, threadId: "thread-9" },
      { channel: "#build:thread-9" },
    ),
    [
      "Unfollowed #build:thread-9. Ordinary delivery for this thread has stopped.",
      'A later personal @mention arrives and re-follows you; that delivery reminds you to run: loom-worker thread-unfollow --target "#build:thread-9"',
      "Posting in this thread re-follows you automatically.",
    ].join("\n"),
  );
});

test("message-react states the emoji, the direction and the canonical message id", () => {
  assert.equal(
    render(
      "/v1/worker/messages/react",
      { messageId: "message-9" },
      { active: true, emoji: "👍" },
    ),
    "Reaction 👍 added to message message-9.",
  );
  assert.equal(
    render(
      "/v1/worker/messages/react",
      { messageId: "message-9" },
      { active: false, emoji: "👍" },
    ),
    "Reaction 👍 removed from message message-9.",
  );
});

// ------------------------------------------------------------- profiles --

const AGENT_PROFILE = {
  actualRun: {
    computer: {
      displayName: "Studio",
      hostId: "host-1",
      hostname: "studio.local",
      reportedBuildVersion: "1.4.0",
    },
    model: {
      modelBindingId: "b1",
      modelId: "gpt-x",
      provider: "openai",
      source: "explicit_binding",
    },
    runAttemptId: "run-9",
    startedAt: "2026-09-09T02:00:00.000Z",
    state: "running",
  },
  agentId: "def-1",
  agentState: "enabled",
  availability: {
    activity: "busy",
    observedAt: "2026-09-09T02:05:00.000Z",
    reason: "running",
  },
  configured: {
    capabilityClass: undefined,
    modelBindingIds: ["b1"],
    modelBindingIdsTruncated: false,
    modelSelection: "binding_ids",
    reasoning: "low",
    runtimeTargets: [
      {
        computer: { hostId: "host-1" },
        models: [
          { modelBindingId: "b1", modelId: "gpt-x", provider: "openai" },
        ],
        modelsTruncated: false,
        registered: true,
        runtime: { displayName: "Codex CLI", executionMode: "byoc" },
        runtimeOfferId: "offer-1",
      },
    ],
    runtimeTargetsRestricted: true,
    runtimeTargetsTruncated: false,
    toolAccessMode: "full_access",
  },
  createdAgents: [],
  createdAgentsTruncated: false,
  createdAt: "2026-09-01T00:00:00.000Z",
  creator: {
    displayName: "Sun",
    handle: "sun",
    kind: "human",
    participantId: "participant-h",
  },
  deletedAt: null,
  description: "Ports the read family",
  displayName: "Alice",
  isSelf: true,
  membership: {
    joinedAt: "2026-09-02T00:00:00.000Z",
    role: "member",
    scope: "room",
  },
  principal: { handle: "alice", kind: "agent", principalId: "participant-a" },
};

test("profile-show renders Raft's formatAgentProfile lines over RAH's configuration and latest Run", () => {
  assert.equal(
    render("/v1/worker/profiles/get", AGENT_PROFILE),
    [
      "## Profile",
      "",
      "- Type: agent",
      "- Handle: @alice (you)",
      "- ID: participant-a",
      "- Display Name: Alice",
      "- Description: Ports the read family",
      "- Status: enabled",
      "- Membership: room",
      "- Role: member",
      "- Joined: 2026-09-02T00:00:00.000Z",
      "- Runtime: Codex CLI",
      "- Model: openai/gpt-x",
      "- Reasoning: low",
      "- Tools: full_access",
      "- Execution: byoc",
      "- Availability: busy (running) observed 2026-09-09T02:05:00.000Z",
      "- Latest Run: running run=run-9 started 2026-09-09T02:00:00.000Z",
      "- Computer: Studio (host-1)",
      "- Hostname: studio.local",
      "- Daemon: v1.4.0",
      "- Run Model: openai/gpt-x",
      "- Created: 2026-09-01T00:00:00.000Z",
      "- Creator: Sun (@sun) id=participant-h",
      "- Created Agents: none",
    ].join("\n"),
  );
});

test("profile-show names an unrestricted runtime policy, a capability class and a tombstone", () => {
  assert.equal(
    render("/v1/worker/profiles/get", {
      ...AGENT_PROFILE,
      actualRun: null,
      availability: null,
      configured: {
        ...AGENT_PROFILE.configured,
        capabilityClass: "frontier",
        modelSelection: "capability_class",
        runtimeTargets: [],
        runtimeTargetsRestricted: false,
      },
      creator: null,
      deletedAt: "2026-09-08T00:00:00.000Z",
      isSelf: false,
    }),
    [
      "## Profile",
      "",
      "- Type: agent",
      "- Handle: @alice",
      "- ID: participant-a",
      "- Display Name: Alice",
      "- Description: Ports the read family",
      "- Status: enabled",
      "- Membership: room",
      "- Role: member",
      "- Joined: 2026-09-02T00:00:00.000Z",
      "- Runtime: any registered runtime",
      "- Model: capability class frontier",
      "- Reasoning: low",
      "- Tools: full_access",
      "- Created: 2026-09-01T00:00:00.000Z",
      "- Deleted At: 2026-09-08T00:00:00.000Z",
      "- Created Agents: none",
    ].join("\n"),
  );
});

test("profile-show renders formatHumanProfile and the created-Agent list with its cursor", () => {
  assert.equal(
    render("/v1/worker/profiles/get", {
      availability: null,
      configured: null,
      createdAgents: [
        {
          agentId: "def-1",
          displayName: "Alice",
          handle: "alice",
          kind: "agent",
          participantId: "participant-a",
          runtimes: [
            {
              registered: true,
              runtime: { displayName: "Codex CLI" },
              runtimeOfferId: "offer-1",
            },
          ],
          runtimesTruncated: false,
          state: "enabled",
        },
        {
          agentId: "def-2",
          displayName: "Bob",
          handle: "bob",
          kind: "agent",
          participantId: "participant-b",
          runtimes: [{ registered: false, runtimeOfferId: "offer-2" }],
          runtimesTruncated: false,
          state: "tombstoned",
        },
      ],
      createdAgentsNextCursor: "cursor-1",
      createdAgentsTruncated: true,
      createdAt: "2026-08-01T00:00:00.000Z",
      creator: null,
      deletedAt: null,
      displayName: "Sun",
      isSelf: false,
      membership: {
        joinedAt: "2026-08-02T00:00:00.000Z",
        role: "owner",
        scope: "room",
      },
      principal: { handle: "sun", kind: "human", principalId: "participant-h" },
    }),
    [
      "## Profile",
      "",
      "- Type: human",
      "- Handle: @sun",
      "- ID: participant-h",
      "- Display Name: Sun",
      "- Description: (none)",
      "- Membership: room",
      "- Role: owner",
      "- Joined: 2026-08-02T00:00:00.000Z",
      "- Created Agents (2):",
      "  - @alice (Codex CLI, enabled) id=participant-a",
      "  - @bob (no runtime, tombstoned) id=participant-b",
      'More created agents: loom-worker profile-show --target participant-h --created-agents-cursor "cursor-1"',
    ].join("\n"),
  );
});

test("profile-self-get and profile-update render the writable metadata and the write context", () => {
  const self = {
    profile: {
      agentId: "def-1",
      displayName: "Alice",
      participantId: "participant-a",
    },
    writeContext: {
      controlRoomId: "room-control",
      controlRoomSeq: 12,
      expectedRevisionId: "revision-3",
    },
  };
  assert.equal(
    render("/v1/worker/profile/self/get", self),
    [
      "## Profile",
      "",
      "- Display Name: Alice",
      "- Description: (none)",
      "- Avatar: (none)",
      "- ID: participant-a",
      "- Agent Definition: def-1",
      "- Control Room: room-control",
      "- Control Room Seq: 12",
      "- Expected Revision: revision-3",
    ].join("\n"),
  );
  assert.equal(
    render("/v1/worker/profile/self/update", {
      ...self,
      deduplicated: true,
      profile: { ...self.profile, avatarKey: "avatar-1", description: "Ports" },
    }),
    [
      "## Profile",
      "",
      "- Display Name: Alice",
      "- Description: Ports",
      "- Avatar: avatar-1",
      "- ID: participant-a",
      "- Agent Definition: def-1",
      "- Control Room: room-control",
      "- Control Room Seq: 12",
      "- Expected Revision: revision-3",
      "- Deduplicated: yes",
    ].join("\n"),
  );
});

test("--json exists where Raft has it: profile show and update, never profile-self-get", () => {
  assert.equal(workerReadCommandOffersJson("/v1/worker/profiles/get"), true);
  assert.equal(
    workerReadCommandOffersJson("/v1/worker/profile/self/update"),
    true,
  );
  assert.equal(
    workerReadCommandOffersJson("/v1/worker/profile/self/get"),
    false,
  );
  assert.equal(workerReadCommandOffersJson("/v1/worker/room/members"), false);
});

// ---------------------------------------------------- attachments --

test("attachment-comments renders Raft's comment block, its anchors and check mark", () => {
  assert.equal(
    render(
      "/v1/worker/attachments/comments",
      {
        comments: [
          {
            anchor: null,
            content: "Looks right",
            createdAt: "2026-09-09T03:00:00.000Z",
            id: "message-11",
            reactions: [],
            roomId: "room-1",
            roomSeq: 12,
            senderId: "participant-h",
            senderName: "sun",
            senderType: "human",
          },
          {
            anchor: { data: { end: 20, start: 12 }, type: "lines" },
            content: "Fix this range",
            createdAt: "2026-09-09T03:01:00.000Z",
            id: "message-12",
            reactions: [
              {
                createdAt: "2026-09-09T03:02:00.000Z",
                emoji: "✅",
                reactorId: "participant-a",
                reactorType: "agent",
              },
            ],
            roomId: "room-1",
            roomSeq: 13,
            senderId: "participant-a",
            senderName: "alice",
            senderType: "agent",
          },
        ],
        messageId: "message-1",
        nextBeforeRoomSeq: 12,
        roomId: "room-1",
        threadId: "thread-1",
        viewer: { canComment: true },
      },
      { attachmentId: "att-1" },
    ),
    [
      "## Comments on attachment att-1 (2)",
      "[msg=message-11 time=2026-09-09T03:00:00.000Z type=human] @sun: Looks right",
      "[msg=message-12 time=2026-09-09T03:01:00.000Z type=agent] ✅ [anchor: L12–20] @alice: Fix this range",
      "(full conversation lives in thread thread-1)",
      'More: loom-worker attachment-comments --attachment-id "att-1" --before-room-seq 12',
    ].join("\n"),
  );
});

test("attachment-comments renders Raft's empty sentence and says when commenting is closed", () => {
  assert.equal(
    render(
      "/v1/worker/attachments/comments",
      {
        comments: [],
        messageId: "message-1",
        roomId: "room-1",
        viewer: { canComment: false },
      },
      { attachmentId: "att-1" },
    ),
    [
      "No comments on attachment att-1.",
      "You cannot comment on this attachment.",
    ].join("\n"),
  );
});

test("attachment-capabilities and attachment-cancel render text in the same house style", () => {
  assert.equal(
    render("/v1/worker/attachments/capabilities", {
      directUploadEnabled: false,
      directUploadThresholdBytes: null,
      maxBytes: 26214400,
      sessionExpiresInSeconds: 3600,
    }),
    [
      "Attachment uploads: at most 26214400 bytes per file.",
      "A reservation expires 3600 second(s) after it is created.",
      "Direct upload is disabled: bytes go to the local daemon upload path, and there is no direct-upload threshold.",
    ].join("\n"),
  );
  assert.equal(
    render("/v1/worker/attachments/cancel", {
      attachmentId: "att-1",
      expiresAt: "2026-09-09T04:00:00.000Z",
      filename: "evidence.txt",
      mimeType: "text/plain",
      roomId: "room-1",
      size: 12,
      state: "canceled",
    }),
    "Reservation canceled: evidence.txt (id:att-1) — state canceled.",
  );
});

test("attachment-publish renders Raft's upload block with the RAH command that consumes the id", () => {
  assert.equal(
    renderWorkerAttachmentPublish(true, {
      attachmentId: "att-1",
      expiresAt: "2026-09-09T04:00:00.000Z",
      filename: "evidence.txt",
      mimeType: "text/plain",
      roomId: "room-1",
      size: 2048,
      state: "completed",
    }),
    [
      "File uploaded: evidence.txt (2.0KB)",
      "Attachment ID: att-1",
      "",
      "Use this ID with loom-worker message-post --attachment-ids att-1 to include it in a message.",
    ].join("\n"),
  );
  assert.equal(
    renderWorkerAttachmentPublish(false, {
      attachmentId: "att-2",
      expiresAt: "2026-09-09T04:00:00.000Z",
      filename: "result.txt",
      mimeType: "text/plain",
      roomId: "room-1",
      size: 512,
      state: "completed",
      taskId: "task-1",
    }),
    [
      "File uploaded: result.txt (0.5KB)",
      "Attachment ID: att-2",
      "",
      "loom-worker task-submit binds this artifact to task task-1; it takes no attachment id.",
    ].join("\n"),
  );
});

test("attachment-download renders Raft's one-line save confirmation", () => {
  assert.equal(
    renderWorkerAttachmentDownload({
      attachmentId: "att-1",
      output: "/tmp/evidence.txt",
    }),
    "Downloaded to: /tmp/evidence.txt",
  );
});

test("sync renders each supplied Room or DM identity and its independent Thread IDs", () => {
  for (const roomId of ["room-a", "room-b", "direct-room"]) {
    const events = [null, "thread-a", "thread-b"].map((threadId, index) => ({
      roomId,
      roomSeq: index + 1,
      actorId: "human",
      type: "message.posted",
      payload: { messageId: `message-${index}`, threadId, body: "Reply here" },
    }));
    const result = {
      events,
      cursorBefore: 0,
      cursorAfter: 3,
      latestRoomSeq: 3,
    };
    const before = structuredClone(result);
    const text = render("/v1/worker/sync", result)!;
    assert.match(text, new RegExp(`\\[target=${roomId} seq=1`));
    for (const [index, threadId] of ["thread-a", "thread-b"].entries()) {
      const line = text
        .split("\n")
        .find((line) => line.includes(`msg=message-${index + 1} `))!;
      assert.ok(line.includes(`target=${roomId} `));
      assert.ok(line.includes(`threadId=${threadId}`));
      assert.ok(
        !line.includes(`target=${roomId}:`),
        "Room UUID plus colon is not a supported target",
      );
    }
    assert.deepEqual(
      result,
      before,
      "rendering must not change delivery or read positions",
    );
  }
});

test("rosters render canonical Room roles without inferring authority from handles", () => {
  const members = [
    {
      principal: { handle: "sun", kind: "human", principalId: "human" },
      membership: { scope: "room", role: "owner" },
    },
    {
      principal: { handle: "helper", kind: "agent", principalId: "admin" },
      membership: { scope: "room", role: "admin" },
    },
    {
      principal: { handle: "owner", kind: "agent", principalId: "member" },
      membership: { scope: "room", role: "member" },
    },
    { principal: { handle: "unknown", kind: "human", principalId: "unknown" } },
  ];
  for (const path of ["/v1/worker/room/members", "/v1/worker/server/info"]) {
    const text = render(path, { roomId: "room-1", members });
    assert.equal(typeof text, "string");
    assert.ok(text !== undefined);
    assert.match(text, /@sun \[room owner\] id=human/);
    assert.match(text, /@helper \[room admin\] id=admin/);
    assert.match(text, /@owner \[room member\] id=member/);
    assert.match(text, /@unknown id=unknown/);
    assert.doesNotMatch(text, /no role label means ordinary member/);
  }
});

test("channel attention conditionally renders upstream guidance and preserves legacy response", () => {
  const base = { activityMuted: true, muteFromSeq: 12 };
  const body = { channel: "#channel" };
  assert.equal(
    render("/v1/worker/channels/mute", base, body),
    "Muted #channel.\nActivity muted: yes\nMute from seq: 12",
  );
  const text = render(
    "/v1/worker/channels/mute",
    {
      ...base,
      attention: {
        state: "muted",
        ordinaryActivity: "Ordinary delivery is muted.",
        stillArrives: ["Personal mentions", "Followed Threads"],
        threadBoundary: "Thread controls are independent.",
        catchUp: "Read history to catch up.",
        unmuteCommand: 'loom-worker channel-unmute --target "#channel"',
      },
    },
    body,
  )!;
  assert.match(
    text,
    /Ordinary delivery is muted\.\nStill arrives:\n- Personal mentions\n- Followed Threads/,
  );
  assert.match(
    text,
    /Thread controls are independent\.\nRead history to catch up\.\nTo unmute: loom-worker channel-unmute/,
  );
  assert.ok(!text.includes("Agent API:"));
  const restored = render(
    "/v1/worker/channels/unmute",
    {
      activityMuted: false,
      attention: {
        muteCommand: "mute command",
        muteApi: "provided mute API",
        unmuteApi: "provided unmute API",
      },
    },
    body,
  )!;
  assert.match(restored, /To mute: mute command/);
  assert.match(restored, /Agent API: provided mute API/);
  assert.match(restored, /Agent API: provided unmute API/);
});

test("Agent message history retains the exact file reference independently of the comment body", () => {
  const text = render("/v1/worker/messages/history", {
    messages: [
      {
        messageId: "comment",
        roomId: "room",
        roomSeq: 2,
        actorId: "human",
        body: "What does this mean?",
        createdAt: "2026-09-14T00:00:00Z",
        attachmentComment: {
          attachmentId: "md-identity",
          filename: "report.md",
        },
      },
    ],
  });
  assert.ok(text);
  assert.match(
    text,
    /Comment on file: "report.md" \(attachmentId:md-identity\)/,
  );
  assert.match(text, /What does this mean\?/);
});

test("Agent sync includes the delivered comment file name and identity", () => {
  const text = render("/v1/worker/sync", {
    events: [
      {
        type: "message.posted",
        actorId: "human",
        roomId: "room",
        roomSeq: 2,
        createdAt: "2026-09-14T00:00:00Z",
        payload: {
          body: "Question",
          attachmentComment: {
            attachmentId: "html-id",
            filename: "index.html",
            anchor: null,
          },
        },
      },
    ],
  });
  assert.ok(text);
  assert.match(text, /Comment on file: "index.html" \(attachmentId:html-id\)/);
});
