import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("role and instance diagnostics share one official-backed row, with independent data loaders", () => {
  for (const name of ["RoleActivity", "InstanceTrajectory"]) {
    const source = readFileSync(`frontends/raft/loom/${name}.tsx`, "utf8");
    assert.match(source, /from "\.\/TrajectoryRow/);
    assert.doesNotMatch(
      source,
      /e\.kind ===|function Entry|function ActivityRow/,
    );
  }
  const row = readFileSync("frontends/raft/loom/TrajectoryRow.tsx", "utf8");
  assert.match(row, /OfficialActivity.generated/);
  assert.match(row, /aria-expanded/);
  assert.match(row, /formatClockWithSeconds/);
});
