import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { format } from "prettier";

export const registryPath = "docs/product/ui-behavior-registry.json";
export const indexPath = "docs/product/raft-behavior-inventory.zh-CN.md";
export const digest = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

// Offline validation only. A pinned artifact proves provenance, never browser parity.
export function validateRegistry(registry, read) {
  const errors = [];
  const safeRead = (path, label) => {
    if (
      typeof path !== "string" ||
      !path ||
      path.startsWith("/") ||
      path.split(/[\\/]/).includes("..")
    ) {
      errors.push(`${label}: invalid path`);
      return undefined;
    }
    try {
      return read(path);
    } catch {
      errors.push(`${label}: missing ${path}`);
    }
  };
  const unique = (rows, label) => {
    const result = new Map();
    for (const row of rows) {
      if (!row.id || result.has(row.id))
        errors.push(`${label}: duplicate or empty ID ${row.id}`);
      result.set(row.id, row);
    }
    return result;
  };
  if (registry.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  const sources = unique(registry.sources, "source");
  const adoptions = unique(registry.adoptions, "adoption");
  const scenarios = unique(registry.scenarios, "scenario");
  const behaviors = unique(registry.behaviors, "behavior");
  const delivery = unique(registry.delivery ?? [], "delivery");
  for (const source of sources.values()) {
    const bytes = safeRead(source.path, "source");
    if (bytes && digest(bytes) !== source.sha256)
      errors.push(`${source.id}: hash mismatch`);
    if (
      ![
        "official-published",
        "official-observation",
        "reference-reconstruction",
      ].includes(source.kind)
    )
      errors.push(`${source.id}: source kind`);
    if (
      source.kind === "official-published" &&
      !/^https:\/\//.test(source.url ?? "")
    )
      errors.push(`${source.id}: official URL required`);
  }
  for (const adoption of adoptions.values()) {
    if (
      ![
        "official-original",
        "extracted-port",
        "reference-reconstruction",
        "rah-local",
      ].includes(adoption.kind)
    )
      errors.push(`${adoption.id}: adoption kind`);
    const source = sources.get(adoption.source);
    if (adoption.kind !== "rah-local" && !source)
      errors.push(`${adoption.id}: missing source`);
    const bytes = safeRead(adoption.owner, "owner");
    if (
      ["official-original", "extracted-port"].includes(adoption.kind) &&
      source?.kind !== "official-published"
    )
      errors.push(`${adoption.id}: not official provenance`);
    if (
      adoption.kind === "official-original" &&
      bytes &&
      digest(bytes) !== source?.sha256
    )
      errors.push(`${adoption.id}: official original differs`);
    if (adoption.kind === "extracted-port" && !adoption.locator)
      errors.push(`${adoption.id}: extraction locator required`);
    if (adoption.kind === "extracted-port") {
      const upstream = source && safeRead(source.path, "source");
      if (
        !adoption.needles?.length ||
        adoption.needles.some((text) => !upstream?.toString().includes(text))
      )
        errors.push(`${adoption.id}: extraction landmark missing`);
    }
    if (!adoption.differences)
      errors.push(`${adoption.id}: differences required`);
  }
  for (const scenario of scenarios.values()) {
    const bytes = safeRead(scenario.runner, "scenario");
    if (bytes && !bytes.toString().includes(`scenario("${scenario.id}"`))
      errors.push(`${scenario.id}: scenario not implemented in runner`);
    if (!scenario.coverage?.length)
      errors.push(`${scenario.id}: coverage required`);
  }
  for (const behavior of registry.behaviors) {
    if (
      !["historical-unreviewed", "registered", "migrated"].includes(
        behavior.status,
      )
    )
      errors.push(
        `${behavior.id}: invalid status (passing evidence belongs to run receipts)`,
      );
    if (behavior.status !== "historical-unreviewed" && !behavior.owners.length)
      errors.push(`${behavior.id}: owner required`);
    for (const path of behavior.owners) safeRead(path, "owner");
    for (const id of behavior.adoptions)
      if (!adoptions.has(id))
        errors.push(`${behavior.id}: unknown adoption ${id}`);
    for (const id of behavior.evidenceSources ?? [])
      if (!sources.has(id))
        errors.push(`${behavior.id}: unknown evidence source ${id}`);
    for (const id of behavior.scenarios)
      if (!scenarios.has(id))
        errors.push(`${behavior.id}: unknown scenario ${id}`);
    if (
      behavior.status === "migrated" &&
      (!behavior.adoptions.length ||
        !behavior.scenarios.length ||
        !behavior.currentScope)
    )
      errors.push(`${behavior.id}: migrated scope/adoption/scenario required`);
  }
  for (const item of delivery.values()) {
    if (!behaviors.has(item.id)) errors.push(`${item.id}: unknown delivery ID`);
    if (!["applicable", "excluded", "pending"].includes(item.applicability))
      errors.push(`${item.id}: invalid applicability`);
    if (
      ![
        "needs-decision",
        "needs-feature",
        "needs-fix",
        "needs-verification",
        "not-applicable",
        "verified",
      ].includes(item.state)
    )
      errors.push(`${item.id}: invalid delivery state`);
    if (typeof item.reason !== "string" || item.reason.trim() === "")
      errors.push(`${item.id}: delivery reason required`);
    if (item.applicability === "excluded" && item.state !== "not-applicable")
      errors.push(`${item.id}: excluded delivery must be not-applicable`);
    if (item.applicability === "pending" && item.state !== "needs-decision")
      errors.push(`${item.id}: pending delivery must need a decision`);
    if (
      item.applicability === "applicable" &&
      ["needs-decision", "not-applicable"].includes(item.state)
    )
      errors.push(`${item.id}: applicable delivery state is inconsistent`);
  }
  if (
    JSON.stringify([...behaviors.keys()].sort()) !==
    JSON.stringify([...delivery.keys()].sort())
  )
    errors.push("delivery coverage mismatch");
  const legacyBytes = safeRead(registry.legacyInventory, "legacy");
  if (legacyBytes) {
    const entries = JSON.parse(legacyBytes.toString()).entries;
    const expected = entries.map((entry) => entry.intent).sort();
    const actual = registry.behaviors
      .filter((row) => /^B\d{3}$/.test(row.id))
      .map((row) => row.intent)
      .sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual))
      errors.push("legacy intent coverage mismatch");
  }
  return errors;
}

const cell = (value) =>
  String(value ?? "—")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
export async function renderRegistry(registry) {
  const deliveryCounts = Object.fromEntries(
    [
      "verified",
      "needs-fix",
      "needs-feature",
      "needs-verification",
      "needs-decision",
      "not-applicable",
    ].map((state) => [
      state,
      registry.delivery.filter((item) => item.state === state).length,
    ]),
  );
  const lines = [
    "# UI 行为登记（自动生成）",
    "",
    "<!-- Generated by scripts/ui-behavior-registry.mjs. Edit ui-behavior-registry.json, not this file. -->",
    "",
    "唯一当前登记：[机器登记](./ui-behavior-registry.json)。计划与边界：[共享 UI 收口计划](../architecture/ui-consolidation-plan.zh-CN.md)。",
    "",
    "`historical-unreviewed` = 旧声明未重新核验；`registered` = 已定位当前 owner；`migrated` = 限定组件已迁移且挂接测试，不等于本轮测试通过，更不等于官网双边一致。实际通过证据来自运行回执。",
    "",
    `旧指南及全部历史注记保留在 Git 里程碑 \`${registry.milestone}\` 和 [历史审计目录](../audits/)。它们不再作为当前通过率。74 项只是旧 intent 覆盖，不是全部产品分母。`,
    "",
    "## 当前交付队列",
    "",
    `机器分类共 ${registry.delivery.length} 项：限定范围已验证 ${deliveryCounts.verified}；需修复 ${deliveryCounts["needs-fix"]}；需补功能 ${deliveryCounts["needs-feature"]}；需补验证 ${deliveryCounts["needs-verification"]}；待裁决 ${deliveryCounts["needs-decision"]}；明确不适用 ${deliveryCounts["not-applicable"]}。这是队列分类，不是全产品完成率。`,
    "",
    "| ID | 适用性 | 当前状态 | 依据 / 下一出口 |",
    "| --- | --- | --- | --- |",
    ...registry.delivery.map(
      (item) =>
        `| ${item.id} | ${item.applicability} | ${item.state} | ${cell(item.reason)} |`,
    ),
    "",
    "## 来源及采用方式",
    "",
    "| 来源 | 类型 | 固定材料 | SHA-256 |",
    "| --- | --- | --- | --- |",
    ...registry.sources.map(
      (s) =>
        `| ${s.id} | ${s.kind} | [${s.path}](../../${s.path}) | \`${s.sha256}\` |`,
    ),
    "",
    "| 采用 | 方式 | owner | 明确差异 |",
    "| --- | --- | --- | --- |",
    ...registry.adoptions.map(
      (a) =>
        `| ${a.id} | ${a.kind} | [${a.owner}](../../${a.owner}) | ${cell(a.differences)} |`,
    ),
    "",
    "## 当前登记与历史声明",
    "",
    "| ID | intent | 状态 | 当前限定范围 | 旧接线声明（仅历史） | 场景 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...registry.behaviors.map(
      (b) =>
        `| ${b.id} | ${b.intent} | ${b.status} | ${cell(b.currentScope)} | ${cell(b.historical ? `前端 ${b.historical.frontend} / 后端 ${b.historical.backend}；${b.historical.note}` : undefined)} | ${b.scenarios.join(", ") || "—"} |`,
    ),
    "",
    "## 验证协议",
    "",
    "`npm run check:ui-contract` 校验来源摘要、ID、owner、场景和本文件生成一致性；`npm run test:web:foundations` 实际运行生产组件矩阵并输出隔离目录中的 JSON 回执与截图。无网络依赖的登记检查不能替代浏览器、授权边界或正式部署验收。",
    "",
  ];
  return format(lines.join("\n"), {
    parser: "markdown",
    proseWrap: "preserve",
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  const errors = validateRegistry(registry, (path) => readFileSync(path));
  const rendered = await renderRegistry(registry);
  if (process.argv.includes("--write") && errors.length === 0)
    writeFileSync(indexPath, rendered);
  else if (readFileSync(indexPath, "utf8") !== rendered)
    errors.push("generated index drift; run npm run ui:contract:generate");
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else
    console.log(
      `UI registry valid: ${registry.behaviors.length} records; no current-pass claim inferred.`,
    );
}
