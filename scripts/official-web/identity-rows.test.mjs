import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync("frontends/raft/loom/" + p, "utf8");
test("role and computer lists delegate row anatomy to generated official source", () => {
  assert.match(read("RoleWorkspace.tsx"), /<OfficialRoleRow/);
  assert.match(read("ComputersPage.tsx"), /<OfficialComputerRow/);
  assert.doesNotMatch(read("RoleWorkspace.tsx"), /mx-0 w-full items-center/);
});
test("row source reproduces with only explicit identity/action/status slots", async () => {
  const { generateIdentityRows } = await import("./generate-identity-rows.mjs");
  const source = generateIdentityRows();
  assert.equal(read("OfficialIdentityRows.generated.tsx"), source);
  assert.match(source, /className=\{sidebarItemClass\(selected, menuOpen\)\}/);
  assert.match(source, /max-md:min-h-11/);
  assert.doesNotMatch(
    source,
    /useMachineStore|useAgentStore|onDoubleClick=|makeLongPress|<SidebarAgentMeta/,
  );
});
