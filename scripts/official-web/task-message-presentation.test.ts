import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TaskSchema } from "@rah-os/protocol";
import { FakeRahClient } from "@rah-os/client-sdk";
import { activityPage } from "../../frontends/raft/loom/discovery-client.ts";
import { adaptTaskMessage } from "../../frontends/raft/loom/channel-task-adaptation.ts";

test("activity keeps canonical task identity/status and parent identity rather than reparsing preview text", async () => {
  const at = "2026-11-04T00:00:00Z";
  const task = TaskSchema.parse({
    taskId: "task-a",
    taskNumber: 7,
    state: "submitted",
    roomId: "room-a",
    creatorId: "h",
    sourceMessageId: "root",
    threadId: "t",
    title: "Work",
    createdAt: at,
    updatedAt: at,
  });
  const client = new FakeRahClient(async () => ({
    items: [
      {
        key: "thread:t",
        roomId: "room-a",
        senderName: "Human",
        hasMention: false,
        target: {
          kind: "task",
          roomId: "room-a",
          taskId: "task-a",
          threadId: "t",
          rootMessageId: "root",
        },
        kind: "thread",
        roomName: "A",
        rootMessageId: "root",
        title: "Work",
        latestSeq: 9,
        unreadCount: 0,
        replyCount: 1,
        task,
        latestMessage: {
          messageId: "reply",
          roomId: "room-a",
          roomSeq: 9,
          actorId: "h",
          createdAt: at,
          body: "not a task number",
        },
      },
    ],
    total: 1,
  }));
  const page = await activityPage(client, { workspaceId: "w" } as any);
  assert.deepEqual((page.rows[0] as any).task, task);
  assert.equal(page.rows[0]?.rootMessageId, "root");
});
test("controlled message supplies native task refs from its own Room projection", () => {
  const source = readFileSync(
    "frontends/raft/upstream/raft-web-source/packages/web/src/components/message/MessageItem.tsx",
    "utf8",
  );
  const code = adaptTaskMessage(source);
  assert.match(code, /useLoomTaskReferences/);
  assert.match(
    code,
    /onOpenTask=\{readOnlyProjection \? loomTaskReferences\?\.openNumber : handleOpenTaskRef\}/,
  );
  assert.match(code, /readOnlyProjection \? loomTaskReferences\?\.tasks/);
});
test("channel and activity use native preview and task anatomy without guessing a task from text", () => {
  const timeline = readFileSync(
    "frontends/raft/loom/ChannelTimeline.tsx",
    "utf8",
  );
  assert.match(timeline, /readOnlyReplyScope=/);
  const activity = readFileSync(
    "frontends/raft/loom/ActivityMessageRow.tsx",
    "utf8",
  );
  assert.match(activity, /InboxItemLeadingBadge/);
  assert.match(activity, /conversation-card-task-badge/);
  assert.match(activity, /taskWorkflowStatus/);
});
