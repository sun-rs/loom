import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderTaskOutcomeMarkdown } from "./task-outcome-markdown.mjs";
const load = (name) =>
  JSON.parse(
    readFileSync(
      `docs/evo/evidence/2026-10-27-task-outcome-report/${name}.json`,
      "utf8",
    ),
  );

test("team report preserves every attempt, failed expense and descriptive-only ratio", () => {
  const report = load("team-v8");
  const text = renderTaskOutcomeMarkdown(report);
  for (const c of report.cases) assert.ok(text.includes(c.id));
  assert.match(text, /100935/);
  assert.match(text, /失败/);
  assert.match(text, /描述性/);
  assert.match(text, /同质量.*未知/);
  assert.ok(text.includes(report.source.sha256));
  assert.match(text, /gpt|sonnet/);
  assert.match(text, /aggregate-only/);
  assert.match(text, /账单/);
});
test("AGY bounded review is distinct from whole-task unknown and human recovery remains visible", () => {
  const text = renderTaskOutcomeMarkdown(load("agy-review"));
  assert.match(text, /完整任务：未知/);
  assert.match(text, /有限审查：通过/);
  assert.match(text, /已记录人工介入/);
  assert.match(text, /145018/);
  assert.match(text, /总量未知/);
  assert.match(text, /Human resumed/);
  assert.match(text, /linked-summary-without-inbox/);
  assert.match(text, /gemini-3.8-flash-low/);
  assert.match(text, /low/);
});
test("unknown usage is not displayed as complete zero and observed zero remains distinguishable", () => {
  const report = load("team-v8");
  const c = report.cases[0];
  delete c.usage.input;
  c.usage.output = { known: 0, complete: false, total: null };
  const text = renderTaskOutcomeMarkdown(report);
  assert.match(text, /输入：未知/);
  assert.match(text, /输出：已知 0；总量未知/);
});
test("user text cannot create extra table cells, new headings, code fences or raw HTML", () => {
  const report = load("agy-review");
  report.cases[0].id = "x|y\n# title <script> ```";
  const text = renderTaskOutcomeMarkdown(report);
  assert.ok(!text.includes("<script>"));
  assert.ok(!text.includes("```"));
  assert.ok(!text.includes("\n# title"));
  assert.match(text, /x&#124;y/);
  assert.match(text, /&lt;script&gt;/);
});
test("unsupported shapes and malformed counts are rejected; input is not mutated", () => {
  assert.throws(() => renderTaskOutcomeMarkdown({ kind: "other", cases: [] }));
  assert.throws(() =>
    renderTaskOutcomeMarkdown({ kind: "loom-task-outcome-report/v1" }),
  );
  const report = load("team-v8"),
    before = structuredClone(report);
  renderTaskOutcomeMarkdown(report);
  assert.deepEqual(report, before);
  report.cases[0].usage.input.known = -1;
  assert.throws(() => renderTaskOutcomeMarkdown(report));
});
test("CLI renders the same report without changing the source", async () => {
  const { spawnSync } = await import("node:child_process");
  const file =
    "docs/evo/evidence/2026-10-27-task-outcome-report/agy-review.json";
  const before = readFileSync(file);
  const result = spawnSync(
    process.execPath,
    ["scripts/cli-efficiency/task-outcome-markdown.mjs", file],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, renderTaskOutcomeMarkdown(JSON.parse(before)));
  assert.deepEqual(readFileSync(file), before);
});
test("comparison windows and elapsed-time scope survive readable rendering", () => {
  const report = load("team-v8");
  report.cases[0].wallMs = 131318;
  report.cases[0].wallScope = "first-start to last-finish";
  report.comparison.arithmetic.late.ratios.input = null;
  report.comparison.arithmetic.prefix.ratios.input = 1.234567;
  const text = renderTaskOutcomeMarkdown(report);
  assert.match(text, /full：描述性输入比率：1.034842/);
  assert.match(text, /late：描述性输入比率：未知/);
  assert.match(text, /prefix：描述性输入比率：1.234567/);
  assert.match(text, /131318/);
  assert.match(text, /first-start to last-finish/);
  assert.match(text, /同质量输入比率：未知/);
});
