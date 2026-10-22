import test from "node:test";
import assert from "node:assert/strict";
import { runRoleBatch } from "../../frontends/raft/loom/role-batch.ts";
import {
  editableRolePrompt,
  patchRoleText,
} from "../../frontends/raft/loom/role-profile-values.ts";
test("legacy prompt preamble is editable and saved once; renaming preserves it", () => {
  const c: any = {
    displayName: "Tom",
    role: "只读审查",
    instructions: "不要修改",
  };
  assert.equal(editableRolePrompt(c), "只读审查\n\n不要修改");
  assert.deepEqual(patchRoleText(c, "instructions", "新完整提示"), {
    ...c,
    role: "Tom",
    instructions: "新完整提示",
  });
  assert.equal(
    patchRoleText(c, "displayName", "Jack").instructions,
    "只读审查\n\n不要修改",
  );
});
test("batch uses fixed snapshot once and stops after uncertain or rejected result", async () => {
  const calls: string[] = [];
  const items = [{ instanceId: "a" }, { instanceId: "b" }, { instanceId: "c" }];
  for (const kind of ["rejected", "unknown"] as const) {
    calls.length = 0;
    const result = await runRoleBatch(items, async (item) => {
      calls.push(item.instanceId);
      return { kind: item.instanceId === "b" ? kind : "ok" };
    });
    assert.deepEqual(calls, ["a", "b"]);
    assert.deepEqual(
      result.map((r) => r.status),
      ["ok", kind, "not-run"],
    );
  }
});
test("successful batch processes every selected instance serially", async () => {
  let active = 0;
  const result = await runRoleBatch(
    [{ instanceId: "a" }, { instanceId: "b" }],
    async () => {
      assert.equal(active++, 0);
      await Promise.resolve();
      active--;
      return { kind: "ok" };
    },
  );
  assert.deepEqual(
    result.map((r) => r.status),
    ["ok", "ok"],
  );
});
