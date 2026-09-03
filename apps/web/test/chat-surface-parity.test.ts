import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { agentAvatarPixels } from "../src/agent-avatar-presentation.ts";
import {
  previewActivityText,
  previewActivityKind,
} from "../src/agent-preview-presentation.ts";
import {
  readRoomSidebarWidth,
  writeRoomSidebarWidth,
} from "../src/room-sidebar-resize.ts";

test("sidebar persists a bounded layout number and tolerates blocked storage", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
  };
  assert.equal(readRoomSidebarWidth(storage), 240);
  writeRoomSidebarWidth(storage, 304);
  assert.equal(readRoomSidebarWidth(storage), 304);
  writeRoomSidebarWidth(storage, 999);
  assert.equal(readRoomSidebarWidth(storage), 320);
  values.set("rah:room-sidebar-width", "NaN");
  assert.equal(readRoomSidebarWidth(storage), 240);
  const denied = {
    getItem: () => {
      throw Error("denied");
    },
    setItem: () => {
      throw Error("denied");
    },
  };
  assert.equal(readRoomSidebarWidth(denied), 240);
  assert.doesNotThrow(() => writeRoomSidebarWidth(denied, 260));
});
test("only legacy provider placeholders map to Raft presets; explicit identities remain stable", () => {
  assert.deepEqual(agentAvatarPixels("codex"), agentAvatarPixels("ghost"));
  assert.deepEqual(agentAvatarPixels("kimi"), agentAvatarPixels("skull"));
  assert.deepEqual(agentAvatarPixels("claude"), agentAvatarPixels("cat"));
  assert.deepEqual(agentAvatarPixels("opencode"), agentAvatarPixels("alien"));
  assert.notDeepEqual(
    agentAvatarPixels("random:codex"),
    agentAvatarPixels("codex"),
  );
  assert.deepEqual(
    agentAvatarPixels("custom-seed"),
    agentAvatarPixels("custom-seed"),
  );
});
test("preview summarizes tool activity without dumping inputs or duplicating status titles", () => {
  assert.equal(
    previewActivityKind({ kind: "status", activity: "offline" }),
    "offline",
  );
  assert.equal(
    previewActivityKind({ kind: "thinking", text: "thinking" }),
    "thinking",
  );
  assert.equal(
    previewActivityKind({ kind: "text", text: "output" }),
    "working",
  );
  assert.equal(
    previewActivityText({
      kind: "tool_start",
      toolName: "bash",
      toolInput: '{"command":"pwd"}',
    }),
    "Running command",
  );
  assert.equal(
    previewActivityText({
      kind: "status",
      activity: "working",
      detail: "Tool finished",
    }),
    "Tool finished",
  );
  assert.equal(previewActivityText({ kind: "text", text: "Hello" }), "Hello");
  assert.equal(
    previewActivityText({
      kind: "slock_action",
      title: "Claimed 1 task",
      text: "target: #test",
    }),
    "Claimed 1 task",
  );
});
test("chat sidebar does not promote persona prompt to description or force every Agent name bold", () => {
  const css = readFileSync(
    new URL("../src/chat-surface.css", import.meta.url),
    "utf8",
  );
  assert.match(
    css,
    /\.rah-room-sidebar \.channel-row\.is-selected\s*\{\s*font-weight: 500;/u,
  );
  const s = readFileSync(
    new URL("../src/components/workspace-navigation.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(s, /<b>\{entry\.label\}<\/b>/u);
  assert.doesNotMatch(s, /<small>\{peer\.role\}<\/small>/u);
  assert.match(s, /peer\.description/u);
  assert.match(s, /onEditRoom/u);
});

test("Direct Room and profile avatars share the Agent detail and canonical avatar-edit path", () => {
  const navigation = readFileSync(
    new URL("../src/components/workspace-navigation.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    navigation,
    /onOpenDirectPeer:\s*\(agentDefinitionId: string\) => void/u,
  );
  assert.match(
    navigation,
    /aria-label=\{`打开 \$\{directPeer\.displayName\} Agent 资料`\}/u,
  );
  assert.match(
    navigation,
    /onOpenDirectPeer\(directPeer\.agentDefinitionId\)/u,
  );

  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /onOpenDirectPeer=\{\(id\) => openAgentPeek\(id\)\}/u);

  const profile = readFileSync(
    new URL("../src/components/agent-directory-pane.tsx", import.meta.url),
    "utf8",
  );
  assert.match(profile, /aria-label=\{`更换 \$\{agent\.displayName\} 头像`\}/u);
  assert.match(profile, /OFFICIAL_AGENT_AVATAR_KEYS\.map/u);
  assert.match(profile, /field: "avatarKey"/u);
  assert.match(profile, /role="group"/u);
  assert.match(
    profile,
    /document\.addEventListener\("keydown", closeAvatarPickerOnEscape, \{\s*capture: true/u,
  );
  assert.match(profile, /event\.stopPropagation\(\)/u);
});

test("Raft focus, message toolbar and channel drawer interactions share the measured contract", () => {
  const tokens = readFileSync(
    new URL(
      "../../../packages/ui-tokens/generated/styles.css",
      import.meta.url,
    ),
    "utf8",
  );
  const social = readFileSync(
    new URL("../src/message-social.css", import.meta.url),
    "utf8",
  );
  const product = readFileSync(
    new URL("../src/product.css", import.meta.url),
    "utf8",
  );
  const discovery = readFileSync(
    new URL("../src/components/global-discovery.tsx", import.meta.url),
    "utf8",
  );
  const navigation = readFileSync(
    new URL("../src/components/workspace-navigation.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    product,
    /\.composer-box textarea:focus-visible\s*\{\s*box-shadow:\s*none;\s*outline:\s*none;/u,
  );
  assert.match(social, /\.msg-actions\s*\{[^}]*opacity:\s*0;/su);
  assert.match(
    social,
    /transition:\s*opacity\s+var\(--rah-interaction-transition\)/u,
  );
  assert.match(
    social,
    /\.msg:hover \.msg-actions,[\s\S]*\.msg:focus-within \.msg-actions\s*\{[^}]*opacity:\s*1;/u,
  );
  assert.match(
    product,
    /\.rah-channel-settings-header\s*\{[^}]*height:\s*54px;[^}]*min-height:\s*54px;/su,
  );
  assert.doesNotMatch(discovery, /<button className="search-kbd"/u);
  assert.match(discovery, /<span className="search-kbd" aria-hidden="true">/u);
  assert.match(
    navigation,
    /active=\{active === "activity"\}[\s\S]*?keepDotWhileActive[\s\S]*?icon="pulse"/u,
  );
});

test("the Workspace sidebar exposes Raft's transient Agent activity footer", () => {
  const navigation = readFileSync(
    new URL("../src/components/workspace-navigation.tsx", import.meta.url),
    "utf8",
  );
  assert.match(navigation, /WorkspaceActivityFooter agents=\{agents\}/u);
  const footer = readFileSync(
    new URL("../src/components/workspace-activity-footer.tsx", import.meta.url),
    "utf8",
  );
  assert.match(footer, /rah-live-agent-activity-footer/u);
  assert.match(footer, /latestWorkspaceActivity\(agents\)/u);
  assert.match(footer, /AgentStatusDot/u);
});

test("uploaded Human profile images project into Room messages", () => {
  const conversation = readFileSync(
    new URL("../src/components/conversation-panes.tsx", import.meta.url),
    "utf8",
  );
  assert.match(conversation, /messagePrincipal = roomMembers\.find/u);
  assert.match(conversation, /messagePrincipal\?\.avatarKey/u);
  assert.match(conversation, /<ProfileImageAvatar/u);
});
