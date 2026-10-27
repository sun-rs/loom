#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Plain text in Markdown: never pass user HTML or table/control syntax through.
const escapeText = (value) =>
  String(value ?? "未知")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/[\r\n\u2028\u2029]+/g, " ⏎ ")
    .replace(/[\\\[\]*_#!]/g, "\\$&")
    .replaceAll("|", "&#124;")
    .replaceAll("`", "&#96;");
const outcome = (value) =>
  ({ passed: "通过", failed: "失败", unknown: "未知" })[value] ?? "未知";
const count = (n) => Number.isSafeInteger(n) && n >= 0;
function usage(value) {
  if (value == null) return "未知";
  assert.ok(
    count(value.known) && typeof value.complete === "boolean",
    "Invalid usage metric",
  );
  if (value.complete) {
    assert.ok(
      count(value.total) && value.total === value.known,
      "Invalid complete total",
    );
    return `${value.total}（完整）`;
  }
  assert.ok(value.total == null, "Incomplete usage must have unknown total");
  return `已知 ${value.known}；总量未知`;
}
const ratio = (n) =>
  typeof n === "number" && Number.isFinite(n) && n >= 0
    ? String(Number(n.toFixed(6)))
    : "未知";
function bindings(items) {
  if (!Array.isArray(items) || !items.length) return "未知";
  return [
    ...new Set(
      items.map((item) => {
        const m = item.resolvedModel ?? item;
        const cli =
          m.cli ??
          m.modelBindingId?.match(/^local:([^:]+)-cli\/v1:/)?.[1] ??
          m.provider ??
          "未知";
        return `${cli} / ${m.actualModel ?? m.modelId ?? m.binding ?? m.modelBindingId ?? "未知"} / ${m.effort ?? m.reasoning ?? "未知"}`;
      }),
    ),
  ].join("；");
}
export function renderTaskOutcomeMarkdown(report) {
  assert.equal(
    report?.kind,
    "loom-task-outcome-report/v1",
    "Unsupported report kind",
  );
  assert.ok(Array.isArray(report.cases), "Report cases required");
  const lines = [
    "# 任务验收报告",
    "",
    "本页呈现来源报告的判定，不是新的独立验收；token 是消耗记录，不是账单。",
    "",
  ];
  if (report.source)
    lines.push(
      `来源：${escapeText(report.source.path)}`,
      `SHA-256：${escapeText(report.source.sha256)}`,
      "",
    );
  if (!report.cases.length)
    lines.push("没有任务记录；不代表零成本或验收通过。", "");
  for (const c of report.cases) {
    assert.ok(c && typeof c.id === "string" && c.id.length, "Case ID required");
    const human =
      c.humanIntervention === "recorded"
        ? "已记录人工介入"
        : "未知（不推定无人介入）";
    lines.push(
      `## ${escapeText(c.id)}`,
      "",
      `完整任务：${outcome(c.outcome)}；执行结束：${c.executionFinished === true ? "是" : c.executionFinished === false ? "否" : "未知"}`,
      ...(c.boundedReview === undefined
        ? []
        : [`有限审查：${outcome(c.boundedReview)}（不替代完整任务判定）`]),
      "",
      "| 项目 | 记录 |",
      "| --- | --- |",
      `| CLI / 模型 / effort | ${escapeText(bindings(c.bindings))} |`,
      `| 源码版本 | ${escapeText(c.sourceRevision)} |`,
      `| 人工介入 | ${human} |`,
      `| 来源中的人工介入声明 | ${escapeText(c.humanDeclaration)} |`,
      `| token | 输入：${usage(c.usage?.input)}；输出：${usage(c.usage?.output)} |`,
      `| 耗时（毫秒） | ${count(c.wallMs) ? c.wallMs : "未知"} |`,
      `| 耗时范围 | ${escapeText(c.wallScope)} |`,
      `| 后代计量覆盖 | ${escapeText(c.descendantCoverage)} |`,
      `| 交接证据 | ${escapeText(c.handoff?.proof)} |`,
      `| 交接限制 | ${escapeText(c.handoff?.limitation)} |`,
      "",
    );
    if (c.sourceScope) lines.push(`范围：${escapeText(c.sourceScope)}`, "");
    if (c.limitations?.length) {
      lines.push(
        "限制：",
        "",
        ...c.limitations.map((s) => `- ${escapeText(s)}`),
        "",
      );
    }
  }
  if (report.arms) {
    lines.push(
      "## 固定批次汇总",
      "",
      "失败和结果未知的样本不得从总消耗中扣除。",
      "",
    );
    for (const [name, a] of Object.entries(report.arms)) {
      lines.push(
        `- ${escapeText(name)}：计划 ${escapeText(a.planned)}；通过 ${escapeText(a.passed)}；失败 ${escapeText(a.failed)}；未知 ${escapeText(a.unknown)}。输入 ${usage(a.input)}；输出 ${usage(a.output)}；失败组输入 ${usage(a.failedInput)}。`,
      );
    }
    lines.push("");
  }
  if (report.comparison) {
    const comp = report.comparison;
    lines.push(
      "## 比较边界",
      "",
      ...["full", "late", "prefix"].map(
        (window) =>
          `${window}：描述性输入比率：${ratio(comp.arithmetic?.[window]?.ratios?.input)}；描述性输出比率：${ratio(comp.arithmetic?.[window]?.ratios?.output)}。`,
      ),
      `同质量输入比率：${ratio(comp.equalQualityRatio?.input)}；同质量输出比率：${ratio(comp.equalQualityRatio?.output)}。`,
      escapeText(comp.limitation),
      ...(comp.arithmetic?.comparisonIssues ?? []).map(
        (s) => `- ${escapeText(s)}`,
      ),
      "",
    );
  } else lines.push("没有可用对照，不计算效率倍率。", "");
  if (report.sourceFailure)
    lines.push(
      "来源记录的失败：",
      escapeText(JSON.stringify(report.sourceFailure)),
      "",
    );
  if (report.sourceLimitations?.length)
    lines.push(
      "来源限制：",
      "",
      ...report.sourceLimitations.map((s) => `- ${escapeText(s)}`),
      "",
    );
  return lines.join("\n").trimEnd() + "\n";
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    assert.equal(
      process.argv.length,
      3,
      "Usage: node scripts/cli-efficiency/task-outcome-markdown.mjs <report.json>",
    );
    process.stdout.write(
      renderTaskOutcomeMarkdown(
        JSON.parse(readFileSync(process.argv[2], "utf8")),
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
