import assert from "node:assert/strict";
import test from "node:test";

import { MessageReferenceSchema } from "../src/index.ts";

test("message references preserve typed canonical identities instead of display-only hrefs", () => {
  const references = [
    {
      agentDefinitionId: "agent-alice",
      kind: "agent",
      principalId: "principal-alice",
      readState: "read",
      self: false,
      value: "@Alice",
    },
    {
      kind: "human",
      principalId: "principal-owner",
      self: true,
      value: "@Hakase",
    },
    {
      kind: "room",
      roomId: "room-design",
      roomKind: "channel",
      value: "#design",
    },
    {
      kind: "thread",
      roomId: "room-design",
      roomKind: "channel",
      rootMessageId: "message-root",
      threadId: "thread-abcdef",
      value: "#design:abcdef",
    },
    {
      kind: "task",
      roomId: "room-design",
      rootMessageId: "message-task",
      taskId: "task-5",
      taskNumber: 5,
      threadId: "thread-task",
      value: "#5",
    },
    {
      hostId: "host-mac",
      kind: "computer",
      value: "computer:host-mac",
    },
    {
      appId: "com.example.calendar",
      kind: "app",
      value: "app:com.example.calendar",
    },
    {
      kind: "message",
      messageId: "message-1",
      roomId: "room-design",
      roomKind: "channel",
      value: "#design msg=message-1",
    },
  ] as const;
  for (const reference of references)
    assert.deepEqual(MessageReferenceSchema.parse(reference), reference);
  assert.throws(() =>
    MessageReferenceSchema.parse({
      kind: "thread",
      roomId: "room-design",
      threadId: "thread-1",
      value: "#design:thread-1",
    }),
  );
  assert.throws(() =>
    MessageReferenceSchema.parse({
      href: "/?room=guessed",
      kind: "room",
      roomId: "room-design",
      roomKind: "channel",
      value: "#design",
    }),
  );
});
