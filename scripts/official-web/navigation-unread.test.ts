import test from "node:test";
import assert from "node:assert/strict";
import { navigationUnread } from "../../frontends/raft/loom/navigation-unread.ts";
test("navigation derives independent flags from complete server summary, never page length", () => {
  assert.equal(navigationUnread("w", undefined), undefined);
  assert.deepEqual(
    navigationUnread("w", {
      unreadActivityCount: 0,
      rooms: [{ roomId: "r", unreadCount: 4, hasMention: false }],
    }),
    { workspaceId: "w", channels: true, activity: false },
  );
  assert.deepEqual(
    navigationUnread("w", { unreadActivityCount: 3, rooms: [] }),
    { workspaceId: "w", channels: false, activity: true },
  );
  assert.deepEqual(
    navigationUnread("other", { unreadActivityCount: 0, rooms: [] }),
    { workspaceId: "other", channels: false, activity: false },
  );
});
