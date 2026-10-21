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
  assert.match(entry, /loom-mobile-home-action/);
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
  assert.match(s, /loom-mobile-home-action/);
  assert.match(
    s,
    /size=\{14\} className="shrink-0 max-md:text-foreground-hint"/,
  );
});

test("mobile Home sizing follows the recorded native compact exception, not old Web row defaults", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync("frontends/raft/loom/mobile.css", "utf8");
  assert.match(
    css,
    /\.loom-mobile-home-action,[\s\S]*?height: 32px;[\s\S]*?font-size: 14px;/,
  );
  assert.match(
    css,
    /\.loom-mobile-home-action > svg,[\s\S]*?width: 14px;[\s\S]*?height: 14px;/,
  );
  assert.match(
    readFileSync("docs/evo/mobile-component-metrics.zh-CN.md", "utf8"),
    /655975433b8492a8f4eef7bbce1b913140bc7485/,
  );
});
