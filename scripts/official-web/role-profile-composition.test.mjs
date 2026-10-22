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
  assert.match(s, /<OfficialAvatarListRow/);
  assert.match(s, /actionContent=\{/);
  assert.match(s, /<SectionHeader[\s\S]*?label="实例"/);
  assert.match(s, /新建实例/);
  assert.doesNotMatch(s, /ChannelMemberListShell|ChannelMemberRow/);
});
