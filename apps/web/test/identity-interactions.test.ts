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
  assert.match(css, /\.rah-agent-activity-list article\.is-text > i\s*\{/u);
  assert.match(css, /\.rah-agent-activity-list article\.is-active > i\s*\{/u);
  assert.doesNotMatch(css, /\.rah-preview-event > i\[data-activity=/u);
});

test("the shared initial presentation accepts the selected Computer name", () => {
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
test("Workspace mark opens Raft's anchored menu before the separate edit dialog", () => {
  const source = readFileSync(
    new URL("../src/components/workspace-identity.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /aria-haspopup="menu"/u);
  assert.match(source, /role="menu"/u);
  assert.match(source, /className="rah-space-switcher/u);
  assert.match(source, /document\.addEventListener\("mousedown"/u);
  assert.match(source, /event\.key === "Escape"/u);
  assert.match(source, /triggerRef\.current\?\.focus\(\)/u);
  assert.match(source, /<WorkspaceSwitcherRow/u);
  assert.match(source, /editOpen && workspace/u);
  assert.doesNotMatch(
    source,
    /open && workspace \? \(\s*<WorkspaceIdentityDialog/u,
  );
  const productCss = readFileSync(
    new URL("../src/product.css", import.meta.url),
    "utf8",
  );
  assert.match(
    productCss,
    /@media \(max-width: 767px\)[\s\S]*?\.rah-product-shell > \.rail \{[\s\S]*?display: none/u,
  );
  assert.doesNotMatch(
    productCss,
    /\.rah-product-shell > \.rail > :not\(\.rail-head\)/u,
  );
});
test("workspace identity counts spaces, never Rooms, and uses workspace write authority", () => {
  const navigation = readFileSync(
    new URL("../src/components/workspace-navigation.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(navigation, /label="Workspace"/u);
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const identity = app.slice(
    app.indexOf("const workspaceIdentityProps ="),
    app.indexOf("onUpdated:", app.indexOf("const workspaceIdentityProps =")),
  );
  assert.match(identity, /capabilities\.roomWrite === true/u);
  assert.match(identity, /workspaceMembershipRole === "owner"/u);
  assert.match(identity, /workspaceMembershipRole === "admin"/u);
  assert.doesNotMatch(identity, /canManageCurrentWorkspaceAgent/u);
});
test("mobile Home reuses the canonical workspace switcher instead of a static label", () => {
  const identity = readFileSync(
    new URL("../src/components/workspace-identity.tsx", import.meta.url),
    "utf8",
  );
  const navigation = readFileSync(
    new URL("../src/components/workspace-navigation.tsx", import.meta.url),
    "utf8",
  );
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(identity, /mobile = false/u);
  assert.match(identity, /rah-mobile-space-mark/u);
  assert.match(identity, /rah-mobile-workspace-switcher/u);
  assert.match(identity, /"replace-with-home"/u);
  assert.match(navigation, /mobileWorkspaceIdentity\?: ReactNode/u);
  assert.match(navigation, /\{mobileWorkspaceIdentity \?\?/u);
  assert.match(
    app,
    /mobileWorkspaceIdentity=\{\s*<WorkspaceIdentity \{\.\.\.workspaceIdentityProps\} mobile/u,
  );
  assert.match(app, /openMobileHome/u);
  assert.match(app, /navigationMode === "replace-with-home"/u);
  assert.doesNotMatch(
    navigation,
    /<span className="rah-mobile-home-workspace rah-mobile-only">/u,
  );
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
  assert.match(navigation, /\["pinned", "channels", "dms"\]/u);
  assert.match(navigation, /<SidebarSection\s+label=\{label\}/u);
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

test("selecting any Room or DM closes the chat-scoped Agent inspector", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const roomSidebarStart = app.indexOf("<RoomSidebar");
  const roomSidebarEnd = app.indexOf("{mobileRoomsOpen ?", roomSidebarStart);
  assert.notEqual(roomSidebarStart, -1);
  assert.notEqual(roomSidebarEnd, -1);
  const roomSidebar = app.slice(roomSidebarStart, roomSidebarEnd);
  const selectionStart = roomSidebar.indexOf("onSelect={(roomId) => {");
  assert.notEqual(selectionStart, -1);
  const selection = roomSidebar.slice(
    selectionStart,
    roomSidebar.indexOf("rooms={rooms}", selectionStart),
  );
  assert.match(selection, /setPeekAgentId\(undefined\)/u);
});

test("chat-scoped Agent inspector reuses the canonical detail header geometry", () => {
  const css = readFileSync(
    new URL("../src/identity-interactions.css", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(css, /\.rah-agent-peek \.rah-agent-detail-head\s*\{/u);
});

test("conversation and Agent inspector tab frames end on the same divider", () => {
  const css = readFileSync(
    new URL(
      "../../../packages/ui-tokens/src/neo-brutalist/panel-layout.css",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(css, /\.rah-panel-tabs\s*\{[^}]*border-bottom: var\(--bd\);/u);
  assert.match(css, /\.rah-panel-tabs-list\s*\{[^}]*height: var\(--tabs-h\);/u);
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
