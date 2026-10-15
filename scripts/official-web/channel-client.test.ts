import assert from "node:assert/strict";
import test from "node:test";
import { FakeRahClient } from "@rah-os/client-sdk";
import {
  LoomChannelClient,
  toOfficialMessage,
} from "../../frontends/raft/loom/channel-client.ts";
const at = "2026-10-14T00:00:00.000Z";
const room = {
  roomId: "room-a",
  workspaceId: "workspace-a",
  kind: "channel",
  name: "A",
  slug: "a",
  createdAt: at,
};
const message = {
  messageId: "message-a",
  roomId: "room-a",
  roomSeq: 1,
  actorId: "human-a",
  body: "hello",
  createdAt: at,
};

test("official projection preserves message identity and separates same-role instances", () => {
  const members = [
    { principalId: "instance-a", kind: "agent" as const, handle: "Tom-1" },
    { principalId: "instance-b", kind: "agent" as const, handle: "Tom-2" },
  ];
  const a = toOfficialMessage({ ...message, actorId: "instance-a" }, members);
  const b = toOfficialMessage({ ...message, actorId: "instance-b" }, members);
  assert.equal(a.id, message.messageId);
  assert.equal(a.senderName, "Tom-1");
  assert.equal(b.senderName, "Tom-2");
  assert.notEqual(a.senderId, b.senderId);
});

test("channel read uses client-core bounded pages and rejects cross-channel projection", async () => {
  let bad = false;
  const calls: unknown[] = [];
  const client = new FakeRahClient(async (op, input) => {
    calls.push({ op, input });
    if (op === "room.sync")
      return {
        cursorBefore: 1,
        cursorAfter: 1,
        latestRoomSeq: 1,
        eventFloorSeq: 1,
        snapshotSeq: 1,
        events: [],
        snapshot: {
          room,
          members: [{ principalId: "human-a", kind: "human", handle: "Human" }],
        },
      };
    if (op === "room.acknowledge") return { acknowledgedThrough: 1 };
    if (op === "thread.list") return { threads: [] };
    if (op === "room.timeline")
      return {
        items: [
          {
            kind: "message",
            message: { ...message, roomId: bad ? "other" : "room-a" },
          },
        ],
        cursorBefore: 1,
        cursorAfter: 1,
        hasMoreBefore: false,
        hasMoreAfter: false,
      };
    throw new Error(op);
  });
  const channel = new LoomChannelClient(client, "room-a", "test-consumer");
  const view = await channel.refresh();
  assert.equal(view.messages[0]?.id, "message-a");
  assert.ok(
    calls.some((c: any) => c.op === "room.timeline" && c.input.limit === 50),
  );
  bad = true;
  await assert.rejects(
    new LoomChannelClient(client, "room-a", "test-consumer-2").refresh(),
    /room/i,
  );
});

test("unsupported attachment content remains explicit instead of becoming an empty message", () => {
  const projected = toOfficialMessage(
    {
      ...message,
      body: "",
      attachments: [
        {
          attachmentId: "file-a",
          filename: "report.pdf",
          mimeType: "application/pdf",
          size: 1,
          sha256: "a".repeat(64),
        },
      ],
    },
    [],
  );
  assert.match(projected.content, /附件/);
  assert.match(projected.content, /尚未接入/);
});
