// Opt-in paid release gate. Never included in npm run check.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { instructions, questions } from "./cli-efficiency/common.mjs";
import { nativeRound } from "./cli-efficiency/native.mjs";
import { nativeClaudeRound } from "./cli-efficiency/native-claude.mjs";
import { nativeKimiRound } from "./cli-efficiency/native-kimi.mjs";
import { nativeOpenCodeRound } from "./cli-efficiency/native-opencode.mjs";
import {
  codeProvenance,
  writeEvidence,
} from "./cli-efficiency/gate-evidence.mjs";
import { parseEfficiencyEnv } from "./cli-efficiency/efficiency-config.mjs";
import { probeLocalModelCatalog } from "../packages/agent-host/src/model-catalog-probe.ts";
import { rahArm } from "./cli-efficiency/rah.mjs";
import { budgets, compareArm, gateStatus } from "./cli-efficiency/metrics.mjs";
import { compareWarmCold } from "./cli-efficiency/warm.mjs";
assert.ok(
  process.argv.includes("--paid"),
  "Requires explicit --paid and user authorization",
);
// RAH_EFFICIENCY_PROVIDER=codex|claude|kimi|opencode (default codex): each
// runtime is compared with its own native CLI. Codex default
// native,legacy,role,role-warm; Claude and OpenCode native,role,role-warm;
// Kimi native,role. The model/effort must be in approved-models.mjs, checked
// here before any process starts. See efficiency-config.mjs.
const config = parseEfficiencyEnv(process.env);
const { provider, model, effort, bindingId, order } = config;
const nativeRounds = {
  codex: nativeRound,
  claude: nativeClaudeRound,
  kimi: nativeKimiRound,
  opencode: nativeOpenCodeRound,
}[provider];
const root = mkdtempSync(join(tmpdir(), "rah-cli-efficiency-"));
// codeCommit/workingTree: the code under test; sourceRef: the question
// snapshot (RAH_EFFICIENCY_REF, default HEAD) copied into each workspace.
const provenance = codeProvenance({
  sourceRef: process.env.RAH_EFFICIENCY_REF ?? "HEAD",
});
const files = [
  "scripts/workbench-launch-receipt.mjs",
  "scripts/workbench-launch-receipt.test.mjs",
];
const snapshot = Object.fromEntries(
  files.map((f) => [
    f,
    execFileSync("git", ["show", `${provenance.sourceRef}:${f}`]),
  ]),
);
const hash = (b) => createHash("sha256").update(b).digest("hex");
const result = {
  schemaVersion: 1,
  root,
  startedAt: new Date().toISOString(),
  provider,
  model,
  effort,
  bindingId,
  cliVersion: execFileSync(provider, ["--version"], {
    encoding: "utf8",
  }).trim(),
  ...provenance,
  order,
  questions,
  budgets,
  sourceHashes: Object.fromEntries(files.map((f) => [f, hash(snapshot[f])])),
  arms: {},
  qualityReview: "required",
  status: "running",
};
// Kimi: the product records no usage, and the session wire may be absent;
// what neither side can measure is reported as unmeasured, never invented.
// Codex/Claude: nothing is exempt, missing evidence fails the gate.
function unmeasuredFor({ productUsage }, metrics) {
  if (productUsage === "required") return [];
  const all = (key) =>
    metrics.every((m) => typeof m[key] === "number" && Number.isFinite(m[key]));
  return [
    "productUsage",
    ...(all("input") && all("firstInput") ? [] : ["tokens"]),
    ...(all("generationsTotal") && all("generationsBeforeReply")
      ? []
      : ["generations"]),
  ];
}
let written;
const save = () => {
  written = writeEvidence(root, result);
};
save();
console.log("EVIDENCE " + join(root, "result.json"));
try {
  const catalog = await probeLocalModelCatalog({
    kind: config.catalogKind,
    executablePath: execFileSync("which", [provider], {
      encoding: "utf8",
    }).trim(),
    cwd: root,
  });
  const binding = catalog.find((b) => b.modelBindingId === bindingId);
  assert.equal(binding?.modelId, model, "Binding not in CLI catalog");
  if (effort === null)
    // Effortless approval (Claude haiku): the binding publishes no levels.
    assert.deepEqual(
      binding.supportedReasoning,
      [],
      "Binding publishes effort levels; an explicit effort is required",
    );
  else
    assert.ok(
      binding.supportedReasoning.includes(effort),
      "Effort not supported by binding",
    );
  result.catalogVerifiedAt = new Date().toISOString();
  save();
  for (const kind of order) {
    const armRoot = join(root, kind),
      cwd = join(armRoot, "workspace");
    mkdirSync(join(cwd, "scripts"), { recursive: true });
    for (const f of files) writeFileSync(join(cwd, f), snapshot[f]);
    // The runtime's own instruction file (AGENTS.md; CLAUDE.md for Claude).
    writeFileSync(join(cwd, config.instructionFile), instructions + "\n");
    const arm = { kind, rounds: [], processes: [], status: "running" };
    result.arms[kind] = arm;
    save();
    try {
      if (kind === "native") {
        let sessionId;
        for (let i = 0; i < questions.length; i++) {
          const round = { round: i + 1 };
          arm.rounds.push(round);
          sessionId = await nativeRounds({
            cwd,
            sessionId,
            prompt: questions[i],
            save,
            round,
            config,
          });
          console.log(`native round ${i + 1}: ${round.replySeconds}s`);
        }
        arm.status = "complete";
      } else
        await rahArm({
          kind,
          root: armRoot,
          cwd,
          questions,
          arm,
          save,
          config,
        });
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
    order
      .filter((kind) => kind !== "native")
      .map((kind) => {
        const nat = result.arms.native.rounds.map((r) => r.metrics);
        const rah = result.arms[kind].rounds.map((r) => r.metrics);
        const complete =
          rah.length === nat.length && [...nat, ...rah].every(Boolean);
        return [
          kind,
          complete
            ? compareArm(nat, rah, {
                unmeasured: unmeasuredFor(config, [...nat, ...rah]),
              })
            : { status: "missing-evidence", failures: ["metricsMissing"] },
        ];
      }),
  );
  // S2-a: warm vs cold (per-turn) Role instance, reported only; the §6
  // budgets above apply to role and role-warm each against native.
  if (result.arms.role && result.arms["role-warm"]) {
    result.warmVsCold = compareWarmCold(
      result.arms.role.rounds,
      result.arms["role-warm"].rounds,
    );
    for (const r of result.warmVsCold.rounds)
      console.log(
        `warm-vs-cold round ${r.round} (${r.mode}): ` +
          `reply ${r.replySeconds.cold}s→${r.replySeconds.warm}s, ` +
          `input ${r.input.cold}→${r.input.warm}, ` +
          `generations ${r.generations.cold}→${r.generations.warm}, ` +
          `resume ${r.sessionResumeMs.warm ?? "-"}ms, ` +
          `lateFrames ${r.lateFrameCount}`,
      );
    console.log(
      "cold resume cost avoided " +
        JSON.stringify(result.warmVsCold.coldResumeCostAvoided),
    );
  }
  for (const [kind, c] of Object.entries(result.comparisons))
    for (const [i, r] of (c.rounds ?? []).entries())
      if (r.failures.includes("input"))
        console.log(
          `${kind} round ${i + 1} input over budget: ` +
            JSON.stringify(r.inputDecomposition),
        );
  // Any missing evidence (arm or round) fails the gate, as before; an
  // unmeasured dimension (Kimi usage) makes the verdict missing-evidence, with
  // the measured sub-items reported separately (contract §6).
  const gate = gateStatus({
    arms: result.arms,
    comparisons: result.comparisons,
  });
  result.status = gate.status;
  result.measuredStatus = gate.measuredStatus;
  if (result.status === "missing-evidence") {
    console.log(
      `unmeasured dimensions: verdict missing-evidence; measured sub-items ${gate.measuredStatus}`,
    );
    process.exitCode = 1;
  }
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
  console.log("GATE " + result.status + " " + written.rawPath);
  console.log(
    `EVIDENCE_REDACTED ${written.redactedPath} raw sha256 ${written.rawSha256}`,
  );
}
