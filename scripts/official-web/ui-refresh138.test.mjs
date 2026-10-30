import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const read = (p) => readFileSync("frontends/raft/" + p, "utf8");
test("the reviewed 1.21.38 intake uses the exact tree-shakable UI release", () => {
  const requireUi = createRequire(
    new URL("../../frontends/raft/package.json", import.meta.url),
  );
  const pkg = requireUi("raft-ui/package.json");
  assert.equal(pkg.version, "0.52.2");
  assert.ok(pkg.sideEffects.includes("**/*.css"));
});
test("Chat, DM and follow controls use the official semantic icons", () => {
  assert.match(
    read("loom/Navigation.tsx"),
    /id: "channels", label: "聊天", icon: ChatIcon/,
  );
  assert.match(read("loom/ChannelTabs.tsx"), /\? ChatIcon/);
  for (const path of [
    "loom/SenderActions.tsx",
    "loom/InstanceInspector.tsx",
    "loom/ChannelMembers.tsx",
  ])
    assert.match(read(path), /<DirectMessageIcon/);
  assert.match(read("loom/ThreadFollowMenu.tsx"), /<UnfollowThreadIcon/);
  assert.match(read("loom/ThreadFollowMenu.tsx"), /<FollowThreadIcon/);
});
test("search list cells do not retain a competing wrapper divider", () => {
  assert.doesNotMatch(
    read("loom/OfficialSearchEntityRow.generated.tsx"),
    /not-first:before:border-t/,
  );
});
test("touch message text selection uses the acquired native Drawer, copy and quote composition", () => {
  const item = read("loom/OfficialMessageItem.generated.tsx");
  assert.match(item, /<OfficialMessageSelectText/);
  assert.match(item, /选择文本/);
  assert.match(
    read("loom/OfficialMessageSelectText.generated.js"),
    /data-message-select-text-body/,
  );
  assert.match(
    read("loom/OfficialMessageSelectText.generated.js"),
    /beforeinput/,
  );
});
test("task header disclosure follows observed visibility and reuses the acquired overlay", () => {
  const task = read("loom/TaskDetail.tsx");
  assert.match(task, /OfficialTaskHeadObserver/);
  assert.match(task, /OfficialCompactTaskSummary/);
  assert.match(task, /OfficialTaskHeadPullDown/);
  assert.match(
    read("loom/OfficialTaskHead138.generated.js"),
    /task-head-pull-down/,
  );
  assert.match(
    read("loom/OfficialTaskHead138.generated.js"),
    /IntersectionObserver/,
  );
});
test("official Chat icon retains its own geometry rather than a locally drawn replacement", async () => {
  const requireUi = createRequire(
    new URL("../../frontends/raft/package.json", import.meta.url),
  );
  const React = requireUi("react");
  const { renderToStaticMarkup } = requireUi("react-dom/server");
  const { ChatIcon } = await import(requireUi.resolve("raft-ui"));
  const html = renderToStaticMarkup(React.createElement(ChatIcon));
  assert.match(html, /viewBox="0 0 18 18"/);
  assert.equal((html.match(/<circle /g) ?? []).length, 3);
});

test("acquired declarations and generated type surfaces reproduce exactly", async () => {
  const g = await import("./generate-refresh138.mjs");
  for (const [file, source] of [
    ["OfficialMessageSelectText.generated.js", g.generateRefresh138()],
    ["OfficialTaskHead138.generated.js", g.generateTaskHead138()],
    ["OfficialMessageSelectText.generated.d.ts", g.selectionDeclarations()],
    ["OfficialTaskHead138.generated.d.ts", g.taskDeclarations()],
  ])
    assert.equal(read("loom/" + file), source);
});

test("touch text uses the new menu path while external links retain browser ownership", () => {
  const item = read("loom/OfficialMessageItem.generated.tsx");
  const start = item.slice(
    item.indexOf("const handleTouchStart"),
    item.indexOf("const handleTouchEnd"),
  );
  assert.doesNotMatch(start, /target.closest\("\[data-message-selectable/);
  assert.match(start, /a\[target=/);
  assert.match(item, /loomTouchPoint.current/);
});

test("task channel reference adopts the new native mono metadata recipe", () => {
  const source = read("loom/OfficialTaskSurfaces.generated.tsx");
  assert.match(
    source,
    /truncate font-mono text-mono-meta text-foreground-muted/,
  );
  assert.match(source, /data-testid="task-modal-bar-ref"/);
});

test("native context event and timeout share one shielded touch-menu opener", () => {
  const item = read("loom/OfficialMessageItem.generated.tsx");
  assert.match(
    item,
    /if \(loomTouchPoint.current\) \{ if \(!longPressFired.current\) openTouchMessageMenu/,
  );
  assert.match(
    item,
    /setTimeout\(\(\) => openTouchMessageMenu\(\{x,y\}\), 500\)/,
  );
});
