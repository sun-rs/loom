// Opt-in PAID A/B of the Loom Worker tool facade on OpenCode (evo §57, owner
// decision 2026-09-27). Never part of `npm run check`; refuses to start
// without `--paid`. Groups native / cli-post / tool-post, 6 new sessions
// each × the efficiency gate's 3 questions, product arms alternating (ABAB),
// deepseek/deepseek-flash at low through the approval table and the guarded
// OpenCode shim. Pre-registered verdict: scripts/cli-efficiency/worker-tool-ab.mjs.
//
//   node scripts/test-worker-tool-ab.mjs --paid
//   LOOM_AB_SAMPLES=1 node scripts/test-worker-tool-ab.mjs --paid   (smoke)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeLocalModelCatalog } from "../packages/agent-host/src/model-catalog-probe.ts";
import { instructions, questions } from "./cli-efficiency/common.mjs";
import {
  codeProvenance,
  writeEvidence,
} from "./cli-efficiency/gate-evidence.mjs";
import { isEffectiveAnswer } from "./cli-efficiency/metrics.mjs";
import { nativeOpenCodeRound } from "./cli-efficiency/native-opencode.mjs";
import { rahArm } from "./cli-efficiency/rah.mjs";
import {
  AB_ROUNDS,
  AB_THRESHOLDS,
  CLI_POST_DAEMON_ENV,
  abPlan,
  abVerdict,
  parseWorkerToolAbConfig,
  readOpenCodeRoundParts,
  roundPartMetrics,
  sampleMetrics,
  summarizeAb,
} from "./cli-efficiency/worker-tool-ab.mjs";

assert.ok(
  process.argv.includes("--paid"),
  "Requires explicit --paid and owner authorization for this run batch",
);
assert.equal(
  questions.length,
  AB_ROUNDS,
  "the A/B uses the gate's 3 questions",
);
const config = parseWorkerToolAbConfig(process.env);
const root = mkdtempSync(join(tmpdir(), "loom-worker-tool-ab-"));
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
  kind: "worker-tool-ab",
  root,
  startedAt: new Date().toISOString(),
  provider: "opencode",
  model: config.model,
  effort: config.effort,
  bindingId: config.bindingId,
  cliVersion: execFileSync("opencode", ["--version"], {
    encoding: "utf8",
  }).trim(),
  ...provenance,
  samplesPerGroup: config.samples,
  thresholds: AB_THRESHOLDS,
  plan: abPlan(config.samples),
  questions,
  sourceHashes: Object.fromEntries(files.map((f) => [f, hash(snapshot[f])])),
  runs: [],
  status: "running",
};
let written;
const save = () => {
  written = writeEvidence(root, result);
};
save();
console.log("EVIDENCE " + join(root, "result.json"));

/** Stored OpenCode evidence of each round (the CLI's own database). */
function withParts(rounds) {
  return rounds.map((round) => {
    if (!round.sessionId || !round.startedAt || !round.finishedAt) return round;
    return {
      ...round,
      parts: roundPartMetrics(
        readOpenCodeRoundParts(
          round.sessionId,
          Date.parse(round.startedAt),
          Date.parse(round.finishedAt),
        ),
      ),
    };
  });
}

async function runStep(step) {
  const armRoot = join(root, `${step.group}-${step.sample}`);
  const cwd = join(armRoot, "workspace");
  mkdirSync(join(cwd, "scripts"), { recursive: true });
  for (const f of files) writeFileSync(join(cwd, f), snapshot[f]);
  writeFileSync(join(cwd, config.instructionFile), instructions + "\n");
  const arm = { ...step, rounds: [], processes: [], status: "running" };
  result.runs.push(arm);
  save();
  try {
    if (step.group === "native") {
      let sessionId;
      for (let i = 0; i < questions.length; i += 1) {
        const round = { round: i + 1 };
        arm.rounds.push(round);
        sessionId = await nativeOpenCodeRound({
          cwd,
          sessionId,
          prompt: questions[i],
          save,
          round,
          config,
        });
        round.answerEffective = isEffectiveAnswer(round.answer);
      }
      arm.status = "complete";
    } else {
      // The daemon reads the switch from its own environment at start.
      const saved = { ...process.env };
      if (step.group === "cli-post")
        Object.assign(process.env, CLI_POST_DAEMON_ENV);
      else delete process.env.RAH_OPENCODE_WORKER_TOOLS;
      try {
        await rahArm({
          kind: "role-warm",
          root: armRoot,
          cwd,
          questions,
          arm,
          save,
          config,
        });
      } finally {
        for (const key of Object.keys(CLI_POST_DAEMON_ENV))
          if (saved[key] === undefined) delete process.env[key];
          else process.env[key] = saved[key];
      }
      // rahArm times the reply from the effective Room answer only.
      for (const round of arm.rounds)
        round.answerEffective = typeof round.replySeconds === "number";
    }
    for (const f of files)
      assert.equal(
        hash(readFileSync(join(cwd, f))),
        result.sourceHashes[f],
        "Source changed",
      );
  } catch (error) {
    arm.status = "failed";
    arm.error = String(error);
    console.error(`${step.group} ${step.sample}`, arm.error);
  }
  try {
    arm.rounds = withParts(arm.rounds);
  } catch (error) {
    arm.partsError = String(error);
  }
  save();
  return arm;
}

try {
  const catalog = await probeLocalModelCatalog({
    kind: config.catalogKind,
    executablePath: execFileSync("which", ["opencode"], {
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
  const natives = new Map();
  const samples = [];
  for (const step of result.plan) {
    const arm = await runStep(step);
    if (step.group === "native") natives.set(step.sample, arm);
    samples.push(
      sampleMetrics({
        group: arm.group,
        sample: arm.sample,
        status: arm.status,
        rounds: arm.rounds,
        native: natives.get(step.sample),
      }),
    );
    result.samples = samples;
    save();
    console.log(
      `${step.group} ${step.sample}: ${arm.status}` +
        ` r1 reasoning ${samples.at(-1).firstRound.reasoningTokens ?? "?"} tok` +
        ` reply ${samples.at(-1).firstRound.replySeconds ?? "?"} s`,
    );
  }
  result.summary = summarizeAb(samples);
  result.verdict = abVerdict(result.summary, config.samples);
  result.status = result.verdict.status;
  for (const [group, s] of Object.entries(result.summary))
    console.log(
      `${group}: r1 reasoning tokens median ${s.firstRoundReasoningTokens.median ?? "?"} ` +
        `IQR ${JSON.stringify(s.firstRoundReasoningTokens.iqr)}, ` +
        `r1 reply median ${s.firstRoundReplySeconds.median ?? "?"} s, ` +
        `delivered ${s.delivery.delivered}/${s.delivery.expected}`,
    );
  console.log(
    `VERDICT ${result.verdict.status}: ${[...result.verdict.failures, ...result.verdict.missing].join("; ") || "all pre-registered criteria met"} (${result.verdict.note})`,
  );
  if (result.status === "fail") process.exitCode = 2;
  if (result.status === "missing-evidence") process.exitCode = 1;
} catch (error) {
  result.status = "failed";
  result.error = String(error);
  process.exitCode = 1;
  console.error(error);
} finally {
  result.finishedAt = new Date().toISOString();
  save();
  console.log("AB " + result.status + " " + written.rawPath);
  console.log(
    `EVIDENCE_REDACTED ${written.redactedPath} raw sha256 ${written.rawSha256}`,
  );
}
