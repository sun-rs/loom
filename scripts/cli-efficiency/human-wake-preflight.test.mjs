import assert from "node:assert/strict";
import test from "node:test";
import { assertHumanWakeTargets } from "./human-wake-preflight.mjs";
const members = ["Report Builder-1", "Report Reviewer-1"];
test("rejects incidental peer mentions anywhere in Human task instructions", () => {
  assert.throws(
    () =>
      assertHumanWakeTargets(
        "@Report Builder-1 先写方案，然后@Report Reviewer-1 审查。",
        members,
        [members[0]],
      ),
    /Unexpected wake targets/,
  );
});
test("plain peer names and code examples follow canonical mention parsing", () => {
  assert.deepEqual(
    assertHumanWakeTargets(
      "@Report Builder-1 和 Report Reviewer-1 合作；示例 `@Report Reviewer-1`。",
      members,
      [members[0]],
    ),
    [members[0]],
  );
});
test("undirected messages and explicit broadcast require all enabled members", () => {
  for (const body of ["请开始", "@all 请开始", "@所有人 请开始"]) {
    assert.throws(() => assertHumanWakeTargets(body, members, [members[0]]));
    assert.deepEqual(assertHumanWakeTargets(body, members, members), members);
  }
});
