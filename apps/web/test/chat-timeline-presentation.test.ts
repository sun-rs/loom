import assert from "node:assert/strict";
import test from "node:test";

import type { Principal, RoomEvent } from "@rah-os/protocol";
import {
  buildChatTimeline,
  buildThreadReceiptTimeline,
  chatDateLabel,
  chatLocalDateKey,
  threadReminderReceipts,
} from "../src/chat-timeline-presentation.ts";

const members: Principal[] = [
  { principalId: "human", handle: "Hakase", kind: "human" },
  { principalId: "agent", handle: "Cindy", kind: "agent" },
];

const event = (
  roomSeq: number,
  type: string,
  payload: Record<string, unknown>,
  createdAt = "2026-08-23T11:20:00.000Z",
): RoomEvent => ({
  actorId: "human",
  aggregateId: `aggregate-${roomSeq}`,
  aggregateType: "membership",
  createdAt,
  eventId: `event-${roomSeq}`,
  idempotencyKey: `key-${roomSeq}`,
  payload,
  roomId: "room",
  roomSeq,
  schemaVersion: 1,
  type,
});

test("chat timeline interleaves canonical membership notices by Room sequence", () => {
  const timeline = buildChatTimeline({
    events: [
      event(2, "message.posted", { messageId: "message-2" }),
      event(3, "membership.added", { participantId: "agent" }),
    ],
    members,
    messages: [
      {
        actorId: "human",
        author: "Hakase",
        body: "hello",
        createdAt: "2026-08-23T11:19:00.000Z",
        messageId: "message-2",
        roomSeq: 2,
      },
    ],
  });

  assert.deepEqual(
    timeline.map((item) => [item.kind, item.roomSeq]),
    [
      ["message", 2],
      ["membership-added", 3],
    ],
  );
  const notice = timeline[1];
  assert.equal(notice?.kind, "membership-added");
  if (notice?.kind === "membership-added") {
    assert.equal(notice.text, "@Cindy was added to this channel.");
  }
});

test("archive lifecycle notices come from durable Room events in sequence", () => {
  const items = buildChatTimeline({
    events: [event(5, "room.unarchived", {}), event(4, "room.archived", {})],
    members,
    messages: [],
  });
  assert.deepEqual(
    items.map((item) => [item.roomSeq, "text" in item && item.text]),
    [
      [4, "📦 Hakase archived this channel"],
      [5, "📤 Hakase unarchived this channel"],
    ],
  );
});

test("chat date labels use the Raft today/yesterday and Chinese calendar forms", () => {
  const now = new Date("2026-09-02T12:00:00+08:00");
  assert.equal(
    chatDateLabel("2026-09-02T00:00:03+08:00", now, "Asia/Shanghai"),
    "今天",
  );
  assert.equal(
    chatDateLabel("2026-09-01T23:57:00+08:00", now, "Asia/Shanghai"),
    "昨天",
  );
  assert.match(
    chatDateLabel("2026-08-27T21:37:00+08:00", now, "Asia/Shanghai"),
    /^8月27日星期四$/u,
  );
  assert.notEqual(
    chatLocalDateKey("2026-09-01T23:59:59+08:00", "Asia/Shanghai"),
    chatLocalDateKey("2026-09-02T00:00:00+08:00", "Asia/Shanghai"),
  );
});

test("Reminder receipts keep anchor permalinks and route same-Room Thread receipts only into that Thread", () => {
  const crossRoom = {
    ...event(4, "reminder.fired", {
      anchorRoomId: "anchor-room",
      messageId: "anchor-message",
      reminderId: "reminder-cross-room",
      targetRoomId: "room",
      threadId: "thread-anchor",
      rootMessageId: "anchor-root",
      title: "Cross-room receipt",
    }),
    aggregateId: "reminder-cross-room",
    aggregateType: "reminder",
  };
  const sameRoomThread = {
    ...event(5, "reminder.fired", {
      anchorRoomId: "room",
      messageId: "root-message",
      reminderId: "reminder-thread",
      targetRoomId: "room",
      threadId: "thread-local",
      rootMessageId: "root-message",
      title: "Thread receipt",
    }),
    aggregateId: "reminder-thread",
    aggregateType: "reminder",
  };
  const timeline = buildChatTimeline({
    events: [crossRoom, sameRoomThread],
    members,
    messages: [],
  });
  assert.deepEqual(
    timeline.map(({ kind }) => kind),
    ["reminder-fired"],
  );
  const receipt = timeline[0];
  assert.equal(receipt?.kind, "reminder-fired");
  if (receipt?.kind === "reminder-fired") {
    assert.deepEqual(receipt.target, {
      kind: "message",
      messageId: "anchor-message",
      roomId: "anchor-room",
      rootMessageId: "anchor-root",
      threadId: "thread-anchor",
    });
  }
  assert.deepEqual(threadReminderReceipts([sameRoomThread], "thread-local"), [
    {
      createdAt: sameRoomThread.createdAt,
      eventId: sameRoomThread.eventId,
      roomSeq: 5,
      target: {
        kind: "message",
        messageId: "root-message",
        roomId: "room",
        rootMessageId: "root-message",
        threadId: "thread-local",
      },
      text: "提醒已触发：Thread receipt",
    },
  ]);
});

test("Thread Reminder receipts retain canonical Room-sequence placement among replies", () => {
  const receipts = [
    {
      createdAt: "2026-08-23T11:20:05.000Z",
      eventId: "event-5",
      roomSeq: 5,
      target: {
        kind: "message" as const,
        messageId: "root-message",
        roomId: "room",
        rootMessageId: "root-message",
        threadId: "thread-local",
      },
      text: "提醒已触发：Thread receipt",
    },
  ];
  const replies = [
    {
      actorId: "agent",
      author: "Cindy",
      body: "before",
      createdAt: "2026-08-23T11:20:04.000Z",
      messageId: "reply-4",
      roomSeq: 4,
    },
    {
      actorId: "agent",
      author: "Cindy",
      body: "after",
      createdAt: "2026-08-23T11:20:06.000Z",
      messageId: "reply-6",
      roomSeq: 6,
    },
  ];

  assert.deepEqual(
    buildThreadReceiptTimeline(replies, receipts).map((item) => [
      item.kind,
      item.roomSeq,
    ]),
    [
      ["message", 4],
      ["reminder-fired", 5],
      ["message", 6],
    ],
  );
});
