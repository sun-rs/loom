import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync("frontends/raft/" + p, "utf8");
test("activity adopts native separator rows and semantic typography", () => {
  const s = read("loom/ActivityMessageRow.tsx");
  assert.doesNotMatch(s, /<Card|shadow-raft-sm/);
  for (const c of [
    "before:border-t",
    "text-subhead",
    "text-callout",
    "bg-info-soft",
    "hover:bg-fill-pressed",
  ])
    assert.ok(s.includes(c), c);
  assert.doesNotMatch(
    read("loom/DiscoveryPage.tsx"),
    /icon=\{<Activity|flex flex-col gap-2/,
  );
});
test("task card uses official footer placement and keyboard focus treatment", () => {
  const s = read("packages/web/src/components/task/TaskCard.tsx");
  assert.match(s, /dropdownAlign="left"/);
  assert.match(s, /focus-visible:shadow-raft-focus/);
  assert.doesNotMatch(s, /mt-2 flex justify-end/);
});
test("navigation consumes separate canonical unread projections", () => {
  const s = read("loom/Navigation.tsx");
  assert.match(s, /showDot=/);
  assert.match(s, /dotInactiveOnly/);
  assert.match(read("loom/ChannelSidebar.tsx"), /onUnreadChanged/);
});
test("located message retains native soft highlight on hover without old ring", () => {
  const s = read("packages/web/src/components/message/MessageItem.tsx");
  assert.ok(s.includes("bg-info-soft hover:bg-info-soft"));
  assert.ok(!s.includes("bg-info/10 ring-1 ring-inset ring-info/50"));
});
