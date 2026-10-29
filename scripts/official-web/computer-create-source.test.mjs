import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (n) => readFileSync("frontends/raft/loom/" + n, "utf8");
test("computer selection cancellation has an outline and detail retains native auto scrolling", () => {
  assert.match(
    read("ComputerSelection.tsx"),
    /variant="outline" onClick=\{\(\) => onSelect\(null\)\}/,
  );
  assert.doesNotMatch(read("ComputersPage.tsx"), /scrollbarGutter/);
  assert.doesNotMatch(read("ComputersPage.tsx"), /runtime.available \? "可用"/);
});
test("both entry points use the same role creation flow without implicit DM creation", () => {
  for (const file of ["AgentPage.tsx", "ComputersPage.tsx"])
    assert.match(read(file), /<CreateRoleDialog/);
  const s = read("CreateRoleDialog.tsx");
  assert.match(s, /<MobileFormDialog/);
  const frame = read("MobileFormDialog.tsx");
  assert.match(frame, /DialogSheetContent.*raft-ui\/wip/s);
  assert.doesNotMatch(frame, /className=|style=/);
  assert.doesNotMatch(s, /standalone\.create|private\.create/);
  assert.match(s, /savedRole/);
  assert.match(s, /保存后添加到频道/);
});
