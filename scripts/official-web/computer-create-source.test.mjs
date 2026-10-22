import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (n) => readFileSync("frontends/raft/loom/" + n, "utf8");
test("computer selection cancellation has an outline and detail reserves scrollbar space", () => {
  assert.match(
    read("ComputerSelection.tsx"),
    /variant="outline" onClick=\{\(\) => onSelect\(null\)\}/,
  );
  assert.match(read("ComputersPage.tsx"), /scrollbarGutter: "stable"/);
  assert.doesNotMatch(read("ComputersPage.tsx"), /runtime.available \? "可用"/);
});
test("both entry points use the same role creation flow without implicit DM creation", () => {
  for (const file of ["AgentPage.tsx", "ComputersPage.tsx"])
    assert.match(read(file), /<CreateRoleDialog/);
  const s = read("CreateRoleDialog.tsx");
  assert.match(s, /@loom\/raft-web-source\/DialogCard/);
  assert.doesNotMatch(s, /standalone\.create|private\.create/);
  assert.match(s, /savedRole/);
  assert.match(s, /保存后添加到频道/);
});
