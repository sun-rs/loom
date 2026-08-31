import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  insertMention,
  workspaceInitial,
  activityPresentation,
} from "../src/identity-presentation.ts";

test("Agent tabs use the observed Raft icons, not placeholder code or attachment glyphs", () => {
  const source = readFileSync(
    new URL("../src/components/agent-directory-pane.tsx", import.meta.url),
    "utf8",
  );
  for (const icon of ["bot", "folder-open", "link-2", "blocks"])
    assert.ok(source.includes(`icon: "${icon}"`));
});
test("activity color overrides are specific enough to beat legacy success and active rows", () => {
  const css = readFileSync(
    new URL("../src/identity-interactions.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /\.rah-agent-activity-list article\.is-text > i,/u);
  assert.match(css, /\.rah-agent-activity-list article\.is-active > i,/u);
});

test("workspace mark follows its name, not an unrelated client computer", () => {
  assert.equal(workspaceInitial(" hakase Lab"), "H");
  assert.equal(workspaceInitial("团队"), "团");
  assert.equal(workspaceInitial(""), "?");
});
test("workspace fields wait for the canonical edit baseline before accepting changes", () => {
  const source = readFileSync(
    new URL("../src/components/workspace-identity.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(
    source.match(
      /disabled=\{!canManage \|\| pending \|\| baseline === undefined\}/gu,
    )?.length,
    2,
  );
});
test("workspace identity counts spaces, never Rooms, and uses workspace write authority", () => {
  const navigation = readFileSync(
    new URL("../src/components/workspace-navigation.tsx", import.meta.url),
    "utf8",
  );
  assert.match(navigation, /label="Workspace" count=\{workspace \? 1 : 0\}/u);
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const identity = app.slice(
    app.indexOf("<WorkspaceIdentity"),
    app.indexOf("onUpdated=", app.indexOf("<WorkspaceIdentity")),
  );
  assert.doesNotMatch(identity, /canManageCurrentWorkspaceAgent/u);
});
test("sidebar sections share a keyboard-accessible disclosure instead of decorative arrows", () => {
  const source = readFileSync(
    new URL("../src/components/sidebar-section.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /aria-expanded=\{open\}/u);
  assert.match(source, /aria-controls=\{id\}/u);
  assert.match(source, /hidden=\{!open\}/u);
  const navigation = readFileSync(
    new URL("../src/components/workspace-navigation.tsx", import.meta.url),
    "utf8",
  );
  for (const label of ["Workspace", "频道", "私信"])
    assert.match(
      navigation,
      new RegExp(`<SidebarSection\\s+label="${label}"`, "u"),
    );
});
test("sidebar disclosure SVG has Raft's explicit 12px box, not the browser's 300x150 default", () => {
  const css = readFileSync(
    new URL("../src/identity-interactions.css", import.meta.url),
    "utf8",
  );
  assert.match(
    css,
    /\.rah-sidebar-disclosure > svg \{\s*width: 12px;\s*height: 12px;/u,
  );
  assert.match(css, /\.rah-sidebar-disclosure\[aria-expanded="true"\] > svg/u);
  assert.doesNotMatch(css, /\.rah-sidebar-disclosure:hover \{\s*background:/u);
});
test("channel entry matches Raft settings intent and creation focuses its name", () => {
  const navigation = readFileSync(
    new URL("../src/components/workspace-navigation.tsx", import.meta.url),
    "utf8",
  );
  assert.match(navigation, /aria-label="频道详情与设置"/u);
  const dialogs = readFileSync(
    new URL("../src/components/room-dialogs.tsx", import.meta.url),
    "utf8",
  );
  const create = dialogs.slice(
    0,
    dialogs.indexOf("export function RoomMembersDialog"),
  );
  assert.match(create, /data-dialog-initial-focus/u);
});
test("mention edits the active selection, preserves draft and sets a caret", () => {
  assert.deepEqual(insertMention("", "Alice", 0, 0), {
    text: "@Alice ",
    caret: 7,
  });
  assert.deepEqual(insertMention("你好世界", "Alice", 2, 2), {
    text: "你好 @Alice 世界",
    caret: 10,
  });
  assert.deepEqual(insertMention("old tail", "kimi", 0, 3), {
    text: "@kimi tail",
    caret: 6,
  });
});
test("short status and tool detail are inline, narrative is a separate expandable body", () => {
  assert.deepEqual(
    activityPresentation({
      kind: "status",
      activity: "working",
      detailKind: "tool_end",
      detail: "Tool finished",
    }),
    { label: "工作中", detail: "Tool finished", block: false },
  );
  assert.deepEqual(
    activityPresentation({
      kind: "tool_start",
      toolName: "bash",
      toolInput: '{"command":"pwd"}',
    }),
    { label: "Running command", detail: "pwd", block: false },
  );
  assert.deepEqual(
    activityPresentation({
      kind: "tool_start",
      toolName: "read",
      toolInput: '{"filePath":"/tmp/example.txt"}',
    }),
    { label: "Reading file", detail: "/tmp/example.txt", block: false },
  );
  assert.deepEqual(
    activityPresentation({ kind: "text", text: "Long answer" }),
    { label: "输出", detail: "Long answer", block: true },
  );
});
