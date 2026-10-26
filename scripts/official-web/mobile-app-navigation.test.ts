import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  mobilePrimaryDestinations,
  showMobileRootNavigation,
} from "../../frontends/raft/loom/mobile-app-navigation.ts";
test("mobile app roots are home, activity, tasks and search; secondary destinations stay available", () => {
  assert.deepEqual(mobilePrimaryDestinations, [
    "channels",
    "activity",
    "tasks",
    "search",
  ]);
  for (const view of [
    "activity",
    "search",
    "tasks",
    "agents",
    "computers",
    "settings",
    "memory",
  ])
    assert.equal(
      showMobileRootNavigation(view, new URLSearchParams(), true),
      true,
    );
  for (const [view, key] of [
    ["activity", "room"],
    ["search", "channelId"],
    ["tasks", "task"],
    ["agents", "role"],
    ["computers", "computer"],
    ["settings", "settings"],
    ["memory", "memory"],
  ])
    assert.equal(
      showMobileRootNavigation(view, new URLSearchParams(`${key}=x`), true),
      false,
    );
  assert.equal(
    showMobileRootNavigation("channels", new URLSearchParams(), false),
    false,
  );
});
test("home no longer duplicates tabs; completion button stays direct while swipe can undo", () => {
  const sidebar = readFileSync(
    "frontends/raft/loom/ChannelSidebar.tsx",
    "utf8",
  );
  assert.doesNotMatch(sidebar, /<MobileHomeEntries/);
  const page = readFileSync("frontends/raft/loom/DiscoveryPage.tsx", "utf8");
  assert.match(page, /onSwipeDone=\{swipeUndo.done\}/);
  assert.match(page, /void markActivity\(target, action\)/);
  const nav = readFileSync("frontends/raft/loom/Navigation.tsx", "utf8");
  assert.match(nav, /MobileWorkspaceMenu/);
});

test("workspace popup uses dedicated official mobile scenario, not generic dialog styling", () => {
  const source = readFileSync(
    "frontends/raft/loom/MobileWorkspaceMenu.tsx",
    "utf8",
  );
  for (const name of [
    "MobileNavServerItem",
    "MobileNavServerPopoverContent",
    "MobileNavServerPopoverDestinations",
  ])
    assert.ok(source.includes(name));
  assert.doesNotMatch(source, /<PopoverContent/);
});

test("mobile unread remains sourced from server summary and workspace trigger keeps compact touch target", () => {
  const nav = readFileSync("frontends/raft/loom/Navigation.tsx", "utf8");
  assert.match(nav, /unread\?\.activity/);
  assert.match(nav, /unread\?\.channels/);
  const css = readFileSync("frontends/raft/loom/mobile.css", "utf8");
  assert.match(
    css,
    /\[data-slot="mobile-nav-server-item"\] \{[\s\S]*?min-height: 44px/,
  );
});

test("one bottom capsule includes More; four secondary destinations share native cells", () => {
  const nav = readFileSync("frontends/raft/loom/Navigation.tsx", "utf8");
  assert.match(nav, /<MobileWorkspaceMenu[\s\S]*?<\/MobileNavRoot>/);
  const menu = readFileSync(
    "frontends/raft/loom/MobileWorkspaceMenu.tsx",
    "utf8",
  );
  assert.doesNotMatch(menu, /<MobileNavRoot/);
  assert.match(menu, /aria-label="更多"/);
  assert.match(menu, /label: "记忆"/);
  assert.doesNotMatch(menu, /<MobileNavServerPopoverGroup/);
});
test("touch rows wire native focus-only completion rather than a second visible action", () => {
  const row = readFileSync(
    "frontends/raft/loom/ActivityMessageRow.tsx",
    "utf8",
  );
  assert.match(
    row,
    /className=\{\s*swipe\?\.enabled \? swipeAccessibleActionClass : undefined\s*\}/,
  );
  assert.match(row, /reveal=\{swipe\?\.enabled \? undefined : "hover"\}/);
});
