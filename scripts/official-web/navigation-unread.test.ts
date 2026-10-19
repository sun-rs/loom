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
test("mobile Home adopts official SidebarItem/count composition from the same summary", async () => {
  const { readFileSync } = await import("node:fs");
  const entry = readFileSync(
    "frontends/raft/loom/MobileHomeEntries.tsx",
    "utf8",
  );
  assert.match(entry, /<SidebarItem/);
  assert.match(entry, /<SidebarItemCount/);
  assert.match(entry, /min-h-11 gap-3 py-2.5 text-body font-semibold/);
  assert.match(entry, /unreadCount > 99 \? "99\+" : unreadCount/);
  const sidebar = readFileSync(
    "frontends/raft/loom/ChannelSidebar.tsx",
    "utf8",
  );
  assert.match(
    sidebar,
    /setActivityUnreadCount\(activity.summary\?\.unreadActivityCount\)/,
  );
  assert.match(sidebar, /setActivityUnreadCount\(undefined\)/);
  assert.match(sidebar, /unreadCount=\{activityUnreadCount\}/);
});
test("mobile saved entry shares official Home row sizing while desktop remains compact", async () => {
  const { readFileSync } = await import("node:fs");
  const s = readFileSync("frontends/raft/loom/SavedNav.tsx", "utf8");
  assert.match(
    s,
    /max-md:min-h-11 max-md:gap-3 max-md:py-2.5 max-md:text-body max-md:font-semibold/,
  );
  assert.match(s, /max-md:size-5 max-md:text-foreground-hint/);
});
