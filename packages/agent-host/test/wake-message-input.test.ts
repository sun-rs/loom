import assert from "node:assert/strict";
import test from "node:test";

import {
  formatWakeIncomingMessage,
  formatWakeInboxNotice,
  formatWakeMessagesInput,
  formatWakeNoticeOnlyInput,
  RESPONSE_TARGET_HINT,
  WAKE_CLOSING_LINE,
  type WakeEvent,
} from "../src/wake-message-input.ts";

const message: WakeEvent = {
  roomSeq: 12,
  type: "message.posted",
  createdAt: "2026-09-18T09:30:00Z",
  target: "#general",
  actor: "richard",
  messageId: "message_11111111-2222-3333-4444-555555555555",
  senderType: "human",
  body: "can you take the migration?",
};

test("the closing line is Raft's, verbatim", () => {
  assert.equal(
    WAKE_CLOSING_LINE,
    "Respond as appropriate. Complete all your work before stopping.",
  );
});

test("one message renders the singular header and the Raft line shape", () => {
  assert.equal(
    formatWakeMessagesInput({ events: [message] }),
    [
      "New message received:",
      "",
      "[target=#general msg=message_11111111-2222-3333-4444-555555555555 time=2026-09-18T09:30:00Z<human>] @richard: can you take the migration?",
      "",
      WAKE_CLOSING_LINE,
      RESPONSE_TARGET_HINT,
    ].join("\n"),
  );
});

test("several messages render the plural header", () => {
  const rendered = formatWakeMessagesInput({
    events: [
      message,
      { ...message, roomSeq: 13, messageId: "message_b", body: "and this one" },
    ],
  });
  assert.ok(rendered.startsWith("New messages received:\n\n"));
  assert.ok(rendered.includes("@richard: and this one"));
  assert.ok(rendered.endsWith(RESPONSE_TARGET_HINT));
});

test("the three RAH target shapes render as written", () => {
  const dm = formatWakeIncomingMessage({ ...message, target: "@richard" });
  const thread = formatWakeIncomingMessage({
    ...message,
    target: "#general:thread_9999",
  });
  assert.ok(dm.startsWith("[target=@richard msg="));
  assert.ok(thread.startsWith("[target=#general:thread_9999 msg="));
  assert.ok(
    formatWakeIncomingMessage(message).startsWith("[target=#general msg="),
  );
});

test("attachment, task and thread-context affordances ride the Raft suffixes", () => {
  const rendered = formatWakeIncomingMessage({
    ...message,
    attachments: [{ filename: "spec.md", sizeBytes: 12_345 }],
    task: { number: 42, status: "in_progress", assignee: "agent:agent-1" },
    threadContext: {
      parentTarget: "#general",
      threadTarget: "#general:thread_9999",
      parentMessage: "- richard: let's discuss the rollout plan",
      recentMessages: [],
      historyTruncated: true,
    },
  });
  assert.ok(
    rendered.startsWith(
      "[RAH thread context: you were mentioned in a thread without model-visible context.]",
    ),
  );
  assert.ok(rendered.includes("- (no earlier thread replies)"));
  assert.ok(rendered.includes("Recent thread context (truncated):"));
  assert.ok(rendered.includes("[attachments: spec.md (12345 bytes)]"));
  assert.ok(
    rendered.includes("[task #42 status=in_progress assignee=agent:agent-1]"),
  );
});

test("a non-message event renders in the Worker read renderer's own shape", () => {
  assert.equal(
    formatWakeIncomingMessage({
      roomSeq: 14,
      type: "task.updated",
      createdAt: "2026-09-18T09:31:00Z",
      target: "#general",
      actor: "richard",
      payload: { taskId: "task_1", assigneeId: null },
    }),
    'seq=14 time=2026-09-18T09:31:00Z actor=@richard type=task.updated\n  {"taskId":"task_1","assigneeId":null}',
  );
});

test("the notice is a bounded summary and never a list", () => {
  const notice = formatWakeInboxNotice({ count: 40, fromSeq: 30, toSeq: 90 });
  assert.ok(notice.startsWith("[RAH inbox notice:"));
  assert.ok(notice.includes("40 further Room events in sequence range 30-90"));
  assert.ok(
    notice.includes("deferring them does not establish that there is no work"),
  );
  assert.ok(!/\b31\b/u.test(notice), "sequences are summarised, not listed");
  assert.equal(formatWakeInboxNotice({ count: 0 }), "");
});

test("a wake with bodies carries the notice between the bodies and the closing line", () => {
  const rendered = formatWakeMessagesInput({
    events: [message],
    notice: { count: 2, fromSeq: 13, toSeq: 15 },
    activationInput: "STANDING",
  });
  const bodyIndex = rendered.indexOf("@richard:");
  const noticeIndex = rendered.indexOf("[RAH inbox notice:");
  const closingIndex = rendered.indexOf(WAKE_CLOSING_LINE);
  assert.ok(bodyIndex < noticeIndex);
  assert.ok(noticeIndex < closingIndex);
  assert.ok(rendered.endsWith("STANDING"));
});

test("a fully degraded range renders the notice alone", () => {
  const rendered = formatWakeNoticeOnlyInput({
    notice: { count: 3, fromSeq: 10, toSeq: 12 },
    activationInput: "STANDING",
  });
  assert.ok(rendered.startsWith("[RAH inbox notice:"));
  assert.ok(!rendered.includes(WAKE_CLOSING_LINE));
  assert.ok(rendered.endsWith("STANDING"));
});
