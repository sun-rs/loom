import assert from "node:assert/strict";
import test from "node:test";

import {
  SavedMessagesResponseSchema,
  SavedMessagesRequestSchema,
  SidebarPatchRequestSchema,
  SidebarPreferencesSchema,
} from "../src/message-social.ts";

test("saved-message timestamps are canonical timestamps", () => {
  assert.throws(() =>
    SavedMessagesResponseSchema.parse({
      globalTotal: 1,
      items: [
        {
          message: {
            actorId: "principal-a",
            body: "saved",
            createdAt: "2026-09-02T00:00:00.000Z",
            messageId: "message-a",
            roomId: "room-a",
            roomSeq: 1,
          },
          roomKind: "channel",
          roomName: "general",
          savedAt: "not-a-timestamp",
          sender: {
            handle: "alice",
            kind: "human",
            principalId: "principal-a",
          },
          senderName: "alice",
          target: {
            kind: "message",
            messageId: "message-a",
            roomId: "room-a",
          },
        },
      ],
      total: 1,
    }),
  );
});

test("saved-message discovery accepts Raft's observed query, Room, and ordering scope", () => {
  assert.deepEqual(
    SavedMessagesRequestSchema.parse({
      workspaceId: "workspace-a",
      query: "needle",
      channelId: "room-a",
      sortDirection: "asc",
      limit: 20,
    }),
    {
      workspaceId: "workspace-a",
      query: "needle",
      channelId: "room-a",
      sortDirection: "asc",
      limit: 20,
    },
  );
  assert.equal(
    SavedMessagesRequestSchema.parse({ workspaceId: "workspace-a" })
      .sortDirection,
    "desc",
  );
});

test("a partial sidebar patch never resets omitted personal preferences", () => {
  assert.deepEqual(
    SidebarPatchRequestSchema.parse({
      workspaceId: "workspace-a",
      expectedVersion: 1,
      idempotencyKey: "patch-a",
      patch: { expandedLongMessages: ["room:room-a"] },
    }).patch,
    { expandedLongMessages: ["room:room-a"] },
  );
});

test("legacy sidebar preferences default ordinary Room push to disabled", () => {
  const preferences = SidebarPreferencesSchema.parse({
    version: 3,
    pinned: [],
    channelOrder: [],
    dmOrder: [],
    mutedActivity: [],
    expandedLongMessages: [],
    channelSortMode: "manual",
    dmSortMode: "manual",
    pinnedSortMode: "manual",
  });
  assert.deepEqual(preferences.notifyAllMessages, []);
  assert.deepEqual(
    SidebarPatchRequestSchema.parse({
      workspaceId: "workspace-a",
      expectedVersion: 3,
      idempotencyKey: "notify-all-a",
      patch: { notifyAllMessages: ["room:room-a"] },
    }).patch,
    { notifyAllMessages: ["room:room-a"] },
  );
});

test("custom section emoji is optional, survives validation, and is bounded", () => {
  const input = {
    workspaceId: "w",
    expectedVersion: 0,
    idempotencyKey: "emoji",
    patch: {
      customSections: [{ id: "work", name: "工作", emoji: "🚀", items: [] }],
    },
  };
  assert.equal(
    SidebarPatchRequestSchema.parse(input).patch.customSections?.[0]?.emoji,
    "🚀",
  );
  assert.throws(() =>
    SidebarPatchRequestSchema.parse({
      ...input,
      patch: {
        customSections: [
          { ...input.patch.customSections[0], emoji: "x".repeat(65) },
        ],
      },
    }),
  );
});

test("sidebar group order migrates old preferences and rejects duplicate groups", () => {
  const old = {
    version: 0,
    pinned: [],
    channelOrder: [],
    dmOrder: [],
    channelSortMode: "manual",
    dmSortMode: "manual",
    pinnedSortMode: "manual",
  };
  assert.deepEqual(SidebarPreferencesSchema.parse(old).sectionOrder, []);
  assert.deepEqual(
    SidebarPreferencesSchema.parse(old).channelPanelTabOrder,
    [],
  );
  const input = {
    workspaceId: "workspace-a",
    expectedVersion: 0,
    idempotencyKey: "groups",
    patch: { sectionOrder: ["custom:one", "dms", "channels", "pinned"] },
  };
  assert.deepEqual(SidebarPatchRequestSchema.parse(input).patch, input.patch);
  assert.throws(() =>
    SidebarPatchRequestSchema.parse({
      ...input,
      patch: { sectionOrder: ["dms", "dms"] },
    }),
  );
});
