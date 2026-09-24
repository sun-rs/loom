// Opt-in paid long-session drift gate. Never included in npm run check.
// See docs/design/long-session-drift-gate.zh-CN.md.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { probeLocalModelCatalog } from "../packages/agent-host/src/model-catalog-probe.ts";
import { parseDriftEnv } from "./cli-efficiency/drift-config.mjs";
import { buildDriftScenario } from "./cli-efficiency/drift-scenario.mjs";
import {
  DRIFT_CRITERIA,
  exitCodeFor,
  formatDriftTable,
  summarizeDrift,
} from "./cli-efficiency/drift-checks.mjs";
import { runDriftArm } from "./cli-efficiency/drift-runner.mjs";

assert.ok(
  process.argv.includes("--paid"),
  "Requires explicit --paid and user authorization",
);
const config = parseDriftEnv(process.env);
const scenario = buildDriftScenario(config);
const root = mkdtempSync(join(tmpdir(), "rah-cli-drift-"));
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const files = [
  "scripts/workbench-launch-receipt.mjs",
  "scripts/workbench-launch-receipt.test.mjs",
];
const hash = (b) => createHash("sha256").update(b).digest("hex");
const snapshot = Object.fromEntries(
  files.map((f) => [f, execFileSync("git", ["show", `${commit}:${f}`])]),
);
const cliVersion = execFileSync(config.provider, ["--version"], {
  encoding: "utf8",
}).trim();
const result = {
  schemaVersion: 1,
  gate: "long-session-drift",
  root,
  startedAt: new Date().toISOString(),
  config,
  cliVersion,
  commit,
  workingTreeDiffSha256: hash(execFileSync("git", ["diff", "HEAD"])),
  sourceHashes: Object.fromEntries(files.map((f) => [f, hash(snapshot[f])])),
  criteria: DRIFT_CRITERIA,
  scenario: scenario.map((r) => ({
    round: r.round,
    template: r.template,
    kinds: r.kinds,
    messages: r.messages,
    expect: r.expect,
  })),
  arm: { status: "running" },
  processes: [],
  rounds: [],
  compactions: [],
  status: "running",
};
const save = () =>
  writeFileSync(
    join(root, "result.json"),
    JSON.stringify(result, null, 2) + "\n",
    { mode: 0o600 },
  );
save();
console.log("EVIDENCE " + join(root, "result.json"));
try {
  const catalog = await probeLocalModelCatalog({
    kind: config.catalogKind,
    executablePath: execFileSync("which", [config.provider], {
      encoding: "utf8",
    }).trim(),
    cwd: root,
  });
  const binding = catalog.find((b) => b.modelBindingId === config.bindingId);
  assert.equal(binding?.modelId, config.model, "Binding not in CLI catalog");
  assert.ok(
    binding.supportedReasoning.includes(config.effort),
    "Effort not supported by binding",
  );
  result.catalogVerifiedAt = new Date().toISOString();
  save();
  const cwd = join(root, "workspace");
  mkdirSync(join(cwd, "scripts"), { recursive: true });
  for (const f of files) writeFileSync(join(cwd, f), snapshot[f]);
  try {
    await runDriftArm({ config, root, cwd, scenario, result, save });
  } catch (error) {
    result.arm.status = "failed";
    result.arm.error = String(error);
    console.error(error);
  }
  const evaluated = result.rounds
    .filter((r) => r.evaluation)
    .map((r) => r.evaluation);
  result.summary = summarizeDrift(evaluated, {
    compactAt: config.compactAt,
    compactions: result.compactions,
    extras: result.rounds,
  });
  console.log(formatDriftTable(evaluated, result.rounds));
  for (const c of result.compactions)
    console.log(
      `compaction after round ${c.afterRound}: ${c.mechanism} forced=${c.forced} observed=${c.observed}` +
        (c.error ? ` error=${c.error}` : ""),
    );
  for (const w of result.summary.windows)
    console.log(
      `window after ${w.afterRound}: before format ${w.before.formatRate} final ${w.before.finalRate}` +
        ` → after format ${w.after.formatRate} final ${w.after.finalRate}` +
        ` gen ${w.before.meanGenerations}→${w.after.meanGenerations}` +
        ` input ${w.before.meanInput}→${w.after.meanInput}` +
        (w.degraded ? ` DEGRADED(${w.reasons.join(",")})` : ""),
    );
  console.log("criteria " + JSON.stringify(result.summary.criteria));
  if (result.summary.evidenceGaps.length)
    console.log("evidence gaps " + result.summary.evidenceGaps.join(", "));
  const incomplete =
    result.arm.status !== "complete" || evaluated.length !== scenario.length;
  result.status = incomplete ? "failed" : result.summary.status;
  process.exitCode = incomplete ? 1 : exitCodeFor(result.summary.status);
} catch (e) {
  result.status = "failed";
  result.error = String(e);
  process.exitCode = 1;
  console.error(e);
} finally {
  result.finishedAt = new Date().toISOString();
  save();
  console.log("GATE " + result.status + " " + join(root, "result.json"));
}
