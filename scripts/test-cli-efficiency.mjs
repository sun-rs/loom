// Opt-in paid release gate. Never included in npm run check.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  model,
  effort,
  bindingId,
  instructions,
  questions,
} from "./cli-efficiency/common.mjs";
import { nativeRound } from "./cli-efficiency/native.mjs";
import { probeLocalModelCatalog } from "../packages/agent-host/src/model-catalog-probe.ts";
import { rahArm } from "./cli-efficiency/rah.mjs";
import { budgets, compareArm } from "./cli-efficiency/metrics.mjs";
assert.ok(
  process.argv.includes("--paid"),
  "Requires explicit --paid and user authorization",
);
const order = (process.env.RAH_EFFICIENCY_ORDER ?? "native,legacy,role").split(
  ",",
);
assert.deepEqual([...order].sort(), ["legacy", "native", "role"]);
const root = mkdtempSync(join(tmpdir(), "rah-cli-efficiency-"));
const commit = execFileSync(
  "git",
  ["rev-parse", process.env.RAH_EFFICIENCY_REF ?? "HEAD"],
  { encoding: "utf8" },
).trim();
const files = [
  "scripts/workbench-launch-receipt.mjs",
  "scripts/workbench-launch-receipt.test.mjs",
];
const snapshot = Object.fromEntries(
  files.map((f) => [f, execFileSync("git", ["show", `${commit}:${f}`])]),
);
const hash = (b) => createHash("sha256").update(b).digest("hex");
const result = {
  schemaVersion: 1,
  root,
  startedAt: new Date().toISOString(),
  model,
  effort,
  bindingId,
  cliVersion: execFileSync("codex", ["--version"], { encoding: "utf8" }).trim(),
  commit,
  workingTreeDiffSha256: hash(execFileSync("git", ["diff", "HEAD"])),
  order,
  questions,
  budgets,
  sourceHashes: Object.fromEntries(files.map((f) => [f, hash(snapshot[f])])),
  arms: {},
  qualityReview: "required",
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
    kind: "codex-cli/v1",
    executablePath: execFileSync("which", ["codex"], {
      encoding: "utf8",
    }).trim(),
    cwd: root,
  });
  const binding = catalog.find((b) => b.modelBindingId === bindingId);
  assert.equal(binding?.modelId, model);
  assert.ok(binding.supportedReasoning.includes(effort));
  result.catalogVerifiedAt = new Date().toISOString();
  save();
  for (const kind of order) {
    const armRoot = join(root, kind),
      cwd = join(armRoot, "workspace");
    mkdirSync(join(cwd, "scripts"), { recursive: true });
    for (const f of files) writeFileSync(join(cwd, f), snapshot[f]);
    writeFileSync(join(cwd, "AGENTS.md"), instructions + "\n");
    const arm = { kind, rounds: [], processes: [], status: "running" };
    result.arms[kind] = arm;
    save();
    try {
      if (kind === "native") {
        let sessionId;
        for (let i = 0; i < questions.length; i++) {
          const round = { round: i + 1 };
          arm.rounds.push(round);
          sessionId = await nativeRound({
            cwd,
            sessionId,
            prompt: questions[i],
            save,
            round,
          });
          console.log(`native round ${i + 1}: ${round.replySeconds}s`);
        }
        arm.status = "complete";
      } else await rahArm({ kind, root: armRoot, cwd, questions, arm, save });
      for (const f of files)
        assert.equal(
          hash(readFileSync(join(cwd, f))),
          result.sourceHashes[f],
          "Source changed",
        );
    } catch (error) {
      arm.status = "failed";
      arm.error = String(error);
      console.error(kind, arm.error);
    }
    save();
  }
  // Contract §6: fixed overhead is judged once per arm; residue and
  // work-path variance are reported, and every round carries the exact
  // total-input decomposition (printed below when that budget fails).
  result.comparisons = Object.fromEntries(
    ["legacy", "role"].map((kind) => {
      const nat = result.arms.native.rounds.map((r) => r.metrics);
      const rah = result.arms[kind].rounds.map((r) => r.metrics);
      const complete =
        rah.length === nat.length && [...nat, ...rah].every(Boolean);
      return [
        kind,
        complete
          ? compareArm(nat, rah)
          : { status: "missing-evidence", failures: ["metricsMissing"] },
      ];
    }),
  );
  for (const [kind, c] of Object.entries(result.comparisons))
    for (const [i, r] of (c.rounds ?? []).entries())
      if (r.failures.includes("input"))
        console.log(
          `${kind} round ${i + 1} input over budget: ` +
            JSON.stringify(r.inputDecomposition),
        );
  // Any missing evidence (arm or round) fails the gate, as before.
  const statuses = Object.values(result.comparisons).flatMap((c) => [
    c.status,
    ...(c.rounds ?? []).map((r) => r.status),
    ...(c.failures.some((f) => f.endsWith("Missing"))
      ? ["missing-evidence"]
      : []),
  ]);
  result.status =
    Object.values(result.arms).some((a) => a.status !== "complete") ||
    statuses.includes("missing-evidence")
      ? "failed"
      : statuses.includes("over-budget")
        ? "over-budget"
        : "needs-quality-review";
  if (result.status === "over-budget") process.exitCode = 2;
  if (result.status === "failed") process.exitCode = 1;
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
