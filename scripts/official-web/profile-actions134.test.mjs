import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync(p, "utf8");
test("instance header opts into container-responsive native actions without changing other runtime menus", () => {
  const control = read("frontends/raft/loom/RuntimeControl.tsx");
  assert.match(control, /responsive = false/);
  assert.match(control, /OfficialProfileInlineActions/);
  assert.match(control, /onClick=\{requestToggle\}/);
  assert.match(control, /onClick=\{item.run\}/);
  assert.match(
    control,
    /disabled=\{disabled \|\| state !== "idle" \|\| branches.busy/,
  );
  assert.match(
    read("frontends/raft/loom/InstanceInspector.tsx"),
    /<RuntimeControl\s+responsive/,
  );
});
test("responsive source uses profile container at 480px, not viewport; preserves extra menu access", () => {
  const css = read(
    "frontends/raft/upstream/published-2026-10-26/profile-actions.css",
  );
  assert.match(css, /@container \(width<=480px\)/);
  assert.match(css, /agent-profile-inline-actions\{display:none\}/);
  const g = read("scripts/official-web/generate-profile-actions134.mjs");
  assert.match(
    g,
    /agent-profile-inline-actions hidden items-center gap-0.5 md:gap-1/,
  );
  assert.match(
    read("frontends/raft/loom/RuntimeControl.tsx"),
    /\.\.\.branches.items/,
  );
});
test("task board announces only confirmed writes, with native polite live region", () => {
  const s = read("frontends/raft/loom/TaskBoardActions.tsx");
  assert.match(
    s,
    /result.kind === "ok"\) \{\s*changed\(result.result.task\);\s*setAnnouncement/,
  );
  assert.match(s, /data-testid="task-board-announcement"/);
  assert.match(s, /aria-live="polite"/);
  assert.match(s, /aria-atomic="true"/);
});
test("computer selection and normal rows retain native container status disclosure", () => {
  const row = read("frontends/raft/loom/ComputerInstanceRow.tsx");
  assert.match(row, /className="group @container"/);
  assert.match(row, /className="@container"/);
  assert.match(row, /OfficialComputerRowSubtitle/);
  assert.match(row, /OfficialComputerRowStatus/);
  const generator = read("scripts/official-web/generate-computer-row134.mjs");
  assert.match(generator, /@md:hidden/);
  assert.match(generator, /max-w-\[min\(32rem,42cqw\)\]/);
});
