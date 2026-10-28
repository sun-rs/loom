import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = (p) => readFileSync(`frontends/raft/${p}`, "utf8");
test("activity uses the current published Filter toolbar, not a form field", () => {
  const local = read("loom/OfficialActivityFilters.generated.tsx");
  for (const name of [
    "DropdownMenuRadioGroup",
    "PickerTriggerButton",
    "inbox-filter-button",
    "inbox-filter-clear",
    "inbox-toolbar",
    "h-[54px]",
  ])
    assert.ok(local.includes(name), name);
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
  assert.match(
    read("loom/ActivityMessageRow.tsx"),
    /<InboxItemLeading>[\s\S]*<OfficialConversationAvatar/,
  );
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
  assert.match(
    row,
    /<InboxItemActions[\s\S]*reveal=\{swipe\?\.enabled \? undefined : "hover"\}/,
  );
  assert.doesNotMatch(row, /hover:none.*hidden/);
});
test("bulk-read uses the native toolbar action slot and unread-only visibility", () => {
  const header = read("loom/ActivityHeader.tsx");
  assert.match(header, /renderToolbar\(/);
  assert.match(header, /counts\?\.unread.*> 0/);
  assert.match(header, /<OfficialActivityMarkAll/);
  assert.match(
    read("loom/OfficialActivityHeader.generated.tsx"),
    /inbox-mark-all-read/,
  );
  assert.match(
    read("loom/OfficialActivityHeader.generated.tsx"),
    /thread.markAllRead.label/,
  );
  const filters = read("loom/OfficialActivityFilters.generated.tsx");
  assert.match(filters, /border-line-seam/);
  assert.match(filters, /\{actions\}/);
});
