import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = (p) => readFileSync(`frontends/raft/${p}`, "utf8");
test("activity uses the upstream compact segmented filter toolbar, not a form field", () => {
  const local = read("loom/ActivityFilters.tsx");
  const source = read("packages/web/src/components/thread/ThreadsInbox.tsx");
  for (const name of [
    "SegmentedControl",
    "SegmentedControlItem",
    "SegmentedControlLabel",
    "inbox-toolbar",
    "h-[54px]",
  ]) {
    assert.ok(source.includes(name));
    assert.ok(local.includes(name));
  }
  assert.ok(!local.includes("SelectField"));
  assert.ok(read("loom/DiscoveryPage.tsx").includes("<ActivityFilters"));
});
test("chat initial loading follows the upstream top centered text surface", () => {
  const local = read("loom/ChannelApp.tsx");
  const source = read("packages/web/src/components/message/ChatPanel.tsx");
  const chrome = "text-center text-foreground-muted font-mono text-sm";
  assert.ok(source.includes(chrome));
  assert.ok(local.includes(chrome));
  assert.ok(!local.includes('<Spinner aria-label="正在读取频道"'));
});
test("activity header exposes durable counts, all-read and icon refresh; rows use native leading context", () => {
  const header = read("loom/ActivityHeader.tsx");
  assert.match(header, /unreadActivityCount/);
  assert.match(header, /全部已读/);
  assert.match(header, /captureUnreadActivity/);
  assert.match(read("loom/ActivityMessageRow.tsx"), /conversation-card-avatar/);
  assert.match(read("loom/ActivityMessageRow.tsx"), /unreadCount > 0/);
  assert.doesNotMatch(read("loom/TasksPage.tsx"), /rows.length\} \/ \{total/);
});
test("activity adopts the complete official list branch, without mixed card metadata", () => {
  const row = read("loom/ActivityMessageRow.tsx");
  assert.match(row, /data-layout="list"/);
  assert.match(row, /<InboxItem[\s\S]*density="compact"/);
  assert.match(row, /SidebarItemCount/);
  assert.doesNotMatch(
    row,
    /conversation-card-metadata|line-clamp-2|conversation-card-title-icon/,
  );
  assert.match(row, /<InboxItemActions\s+reveal="hover"/);
  assert.doesNotMatch(row, /hover:none.*hidden/);
});
test("bulk-read uses the native toolbar action slot and unread-only visibility", () => {
  const header = read("loom/ActivityHeader.tsx");
  assert.match(header, /renderToolbar\(/);
  assert.match(header, /counts\?\.unread.*> 0/);
  assert.match(header, /inbox-mark-all-read/);
  assert.match(header, /全部标记为已读/);
  const filters = read("loom/ActivityFilters.tsx");
  assert.match(filters, /border-line-seam/);
  assert.match(filters, /\{actions\}/);
});
