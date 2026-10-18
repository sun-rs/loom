import test from "node:test";
import assert from "node:assert/strict";
import {
  SidebarPreferencesSchema,
  DEFAULT_SIDEBAR_PREFERENCES,
  ChannelWorkspaceReadRequestSchema,
} from "../src/index.ts";
test("workspace tab preference accepts the new tab without invalidating old orders", () => {
  const prefs = {
    ...DEFAULT_SIDEBAR_PREFERENCES,
    dmOrder: [],
    pinned: [],
    channelOrder: [],
    channelPanelTabOrder: ["chat", "workspace", "tasks"],
  };
  assert.equal(SidebarPreferencesSchema.safeParse(prefs).success, true);
  assert.equal(
    SidebarPreferencesSchema.safeParse({
      ...prefs,
      channelPanelTabOrder: ["tasks", "chat"],
    }).success,
    true,
  );
  assert.equal(
    ChannelWorkspaceReadRequestSchema.safeParse({
      roomId: "r",
      operation: "read",
      path: "../escape",
    }).success,
    false,
  );
});
