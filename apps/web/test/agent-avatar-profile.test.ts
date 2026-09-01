import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Direct Room and Message avatars share the Agent inspector and profile picker", () => {
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
  assert.match(app, /field: "avatarKey"|action: "update_profile"/u);

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
