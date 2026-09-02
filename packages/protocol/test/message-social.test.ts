import assert from "node:assert/strict";
import test from "node:test";

import {
  SidebarPatchRequestSchema,
  SidebarPreferencesSchema,
} from "../src/message-social.ts";

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
