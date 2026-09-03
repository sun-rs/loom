import assert from "node:assert/strict";
import test from "node:test";
import { sidebarRoomAttention } from "../src/attention-presentation.ts";

test("channel mentions and unread counts remain independent Raft signals", () => {
  assert.deepEqual(
    sidebarRoomAttention("channel", {
      unreadCount: 3,
      hasMention: true,
    }),
    {
      showMention: true,
      showMuted: false,
      unreadCount: 3,
      unreadTone: "loud",
    },
  );
  assert.deepEqual(
    sidebarRoomAttention("channel", {
      unreadCount: 2,
      hasMention: false,
    }),
    {
      showMention: false,
      showMuted: false,
      unreadCount: 2,
      unreadTone: "loud",
    },
  );
  assert.deepEqual(
    sidebarRoomAttention("channel", {
      unreadCount: 0,
      hasMention: true,
    }),
    {
      showMention: true,
      showMuted: false,
      unreadCount: 0,
      unreadTone: "loud",
    },
  );
});

test("muted channels retain Raft's quiet unread count without suppressing mentions", () => {
  assert.deepEqual(
    sidebarRoomAttention(
      "channel",
      { unreadCount: 7, hasMention: false },
      true,
    ),
    {
      showMention: false,
      showMuted: true,
      unreadCount: 7,
      unreadTone: "quiet",
    },
  );
  assert.deepEqual(
    sidebarRoomAttention("channel", { unreadCount: 2, hasMention: true }, true),
    {
      showMention: true,
      showMuted: true,
      unreadCount: 2,
      unreadTone: "quiet",
    },
  );
  assert.deepEqual(sidebarRoomAttention("channel", undefined, true), {
    showMention: false,
    showMuted: true,
    unreadCount: 0,
    unreadTone: "quiet",
  });
});

test("Direct Rooms show a pink unread count but never a channel mention marker", () => {
  assert.deepEqual(
    sidebarRoomAttention("direct", {
      unreadCount: 4,
      hasMention: true,
    }),
    {
      showMention: false,
      showMuted: false,
      unreadCount: 4,
      unreadTone: "loud",
    },
  );
  assert.deepEqual(sidebarRoomAttention("direct", undefined), {
    showMention: false,
    showMuted: false,
    unreadCount: 0,
    unreadTone: "loud",
  });
  assert.deepEqual(
    sidebarRoomAttention("direct", { unreadCount: 1, hasMention: true }, true),
    {
      showMention: false,
      showMuted: false,
      unreadCount: 1,
      unreadTone: "loud",
    },
  );
});
