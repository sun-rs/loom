import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync("frontends/raft/" + p, "utf8");
test("task sections and columns let current native recipes own width, surfaces and controls", () => {
  const s = read("packages/web/src/components/task/TasksPanel.tsx");
  const retained = s.slice(
    s.indexOf("function TaskSection("),
    s.indexOf("export default"),
  );
  assert.doesNotMatch(
    retained,
    /w-\[320px\]|bg-fill-muted\/30|border-2 border-dashed|shadow-raft-sm|text-xs font-mono/,
  );
  assert.match(retained, /rounded-container transition-colors/);
  assert.match(retained, /isOver \? "bg-fill-pressed" : ""/);
  for (const component of [
    "TaskSectionHeading",
    "TaskSectionCount",
    "TaskSectionEmpty",
    "TaskBoardColumnHeading",
    "TaskBoardColumnCount",
    "TaskBoardColumnItems",
    "TaskBoardColumnEmpty",
  ])
    assert.match(retained, new RegExp("<" + component + ">"));
});
test("task viewport and loading preserve native panel composition without stale overrides", () => {
  const s = read("loom/TasksPage.tsx");
  assert.doesNotMatch(s, /bg-layer-canvas-muted|box-border h-8 min-h-8/);
  assert.match(s, /py-4 safe-bottom/);
  assert.match(s, /channelTasks \? "" : " mobile-nav-clearance"/);
  assert.match(s, /<TaskLoading \/>/);
  const loading = read("loom/TaskLoading.tsx");
  assert.match(loading, /<TaskLoadingList/);
  assert.match(loading, /<TaskLoadingRow/);
  assert.doesNotMatch(loading, /border-2|bg-black|SkeletonRow/);
});
