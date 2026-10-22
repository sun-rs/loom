import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync("frontends/raft/loom/" + p, "utf8");
test("runtime modal and action controls regenerate from locked AgentDetailPanel", async () => {
  const { generateRoleControls } = await import("./generate-role-controls.mjs");
  assert.equal(
    read("OfficialRoleControls.generated.tsx"),
    generateRoleControls(),
  );
  assert.match(read("RoleProfile.tsx"), /OfficialRuntimeDialog/);
  assert.doesNotMatch(read("RoleProfile.tsx"), /基本信息|>运行配置</);
  assert.match(read("AgentPage.tsx"), /RoleBatchDialog/);
});
test("role instance section shares computer list frame and section header with explicit create-instance action", () => {
  const s = read("AgentPage.tsx");
  assert.match(s, /<OfficialListRowGroup>/);
  assert.match(s, /<InstanceListRow/);
  assert.match(s, /actions=\{/);
  assert.match(s, /<SectionHeader[\s\S]*?label="实例"/);
  assert.match(s, /aria-label="新建实例"/);
  assert.doesNotMatch(s, /ChannelMemberListShell|ChannelMemberRow/);
});

test("grouped instance row never enters official independent card action branch", () => {
  const s = read("InstanceListRow.tsx");
  assert.match(s, /<ListRow/);
  assert.match(s, /<ListRowBody/);
  assert.doesNotMatch(
    s,
    /<(?:SurfaceListItem|AvatarCardRow|OfficialAvatarListRow)\b|className="[^"]*(?:rounded-|border-)/,
  );
  assert.match(read("InstancePresence.tsx"), /<Status/);
  assert.match(read("AgentPage.tsx"), /useInstancePresence/);
});
test("computer exposes separate compact instance and role entry points", () => {
  const s = read("ComputersPage.tsx");
  assert.match(s, /<CreateInstanceDialog/);
  assert.match(s, /aria-label="新建实例"/);
  assert.match(s, /aria-label="新建角色"/);
});
