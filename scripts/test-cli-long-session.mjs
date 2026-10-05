// Explicit opt-in observational gate. --plan never probes a model/catalog.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { longWorkload } from "./cli-efficiency/long-session-workload.mjs";
import {
  longHash,
  verifyLongSnapshot,
  checkLongSessionBudget,
} from "./cli-efficiency/long-session-support.mjs";
import { recoverFailedProductRound } from "./cli-efficiency/long-session-recovery.mjs";
import { summarizeLongSession } from "./cli-efficiency/long-session-metrics.mjs";
import { parseEfficiencyEnv } from "./cli-efficiency/efficiency-config.mjs";
import {
  codeProvenance,
  writeEvidence,
} from "./cli-efficiency/gate-evidence.mjs";

import {
  nativeInvocationArgs,
  nativeInvocationPolicy,
} from "./cli-efficiency/native-invocation.mjs";
import { describeNativeMemoryPolicy } from "./cli-efficiency/native-memory-policy.mjs";

export function longSessionPlan(args, cliVersion) {
  assert.ok(
    ["--plan", "--paid"].includes(args[0]) &&
      (args.length === 1 ||
        (args.length === 2 && args[1] === "--final-output-only")),
    "Requires --plan or --paid, optionally followed by --final-output-only",
  );
  assert.equal(
    cliVersion,
    "codex-cli 0.160.0",
    "Long-session CLI version is preregistered",
  );
  const config = parseEfficiencyEnv({
    RAH_EFFICIENCY_PROVIDER: "codex",
    RAH_EFFICIENCY_MODEL: "gpt-6-luna",
    RAH_EFFICIENCY_EFFORT: "low",
  });
  assert.equal(config.model, "gpt-6-luna");
  assert.equal(config.effort, "low");
  assert.equal(longWorkload.questions.length, 12);
  longWorkload.questions.forEach((q, i) =>
    assert.equal(longHash(q), longWorkload.questionHashes[i]),
  );
  const order =
    args[1] === "--final-output-only"
      ? ["native", "final-output"]
      : ["native", "default", "final-output"];
  const limits = {
    perArmInput: 1200000,
    perArmMs: 1200000,
    scope: "admission-only; one in-flight stage can exceed observed cap",
  };
  const policy = {
    cliVersion,
    model: config.model,
    effort: config.effort,
    order,
    limits,
    nativeInvocationPolicy: nativeInvocationPolicy("codex"),
    memoryPolicy: describeNativeMemoryPolicy("codex"),
    nativeInvocation: Object.fromEntries(
      ["initial", "resume"].map((phase) => [
        phase,
        nativeInvocationArgs("codex", {
          model: config.model,
          effort: config.effort,
          prompt: "<question>",
          sessionId: phase === "resume" ? "<session>" : undefined,
          launchArgs: [],
        }),
      ]),
    ),
    arms: Object.fromEntries(
      order.map((kind) => [kind, longArmEnvironment(kind, {})]),
    ),
    warmRestart: false,
    forcedCompaction: false,
    compactionPolicy: "provider-native automatic; no forced compaction",
    stageCount: 12,
  };
  return {
    mode: args[0].slice(2),
    config,
    cliVersion,
    order,
    questions: longWorkload.questions,
    instructions: longWorkload.instructions,
    limits,
    baseline: {
      ...policy,
      workloadId: longWorkload.id,
      sourceRef: longWorkload.sourceRef,
      sourceHashes: longWorkload.sourceHashes,
      instructionsSha256: longHash(longWorkload.instructions),
      questionHashes: longWorkload.questionHashes,
      promptSetHash: longWorkload.promptSetHash,
      identitySha256: longHash(
        JSON.stringify({
          id: longWorkload.id,
          sourceHashes: longWorkload.sourceHashes,
          instructions: longWorkload.instructions,
          questions: longWorkload.questions,
          ...policy,
        }),
      ),
    },
  };
}
export function longArmEnvironment(kind, environment = process.env) {
  assert.ok(
    ["native", "default", "final-output"].includes(kind),
    "Unknown long-session arm",
  );
  return {
    ...environment,
    LOOM_CODEX_FINAL_OUTPUT_TRIAL: kind === "final-output" ? "1" : "0",
    LOOM_OPENCODE_FINAL_OUTPUT_TRIAL: "0",
    RAH_EFFICIENCY_WARM_RESTART: "0",
  };
}
export function normalizeLongStage(
  r,
  { native, memoryOff, identityVerified = true },
) {
  const m = r.metrics;
  const product = m?.productUsage;
  const gaps = [
    ...(native ? [] : (product?.gaps ?? ["missing-product-usage"])),
  ];
  if (!native && m)
    for (const [key, pkey] of Object.entries({
      input: "inputTokens",
      cached: "cachedInputTokens",
      output: "outputTokens",
      generations: "generations",
    }))
      if (m[key] !== product?.totals?.[pkey])
        gaps.push(`product-mismatch:${key}`);
  const usable =
    !!m &&
    ["input", "cached", "uncached", "output", "generations"].every(
      (k) => Number.isSafeInteger(m[k]) && m[k] >= 0,
    ) &&
    m.input === m.cached + m.uncached &&
    m.generations > 0 &&
    gaps.length === 0 &&
    (native || product?.completeness === "complete");
  return {
    stage: r.round,
    sessionId: r.sessionId,
    completed:
      identityVerified &&
      r.longStageSucceeded === true &&
      (native ||
        (!!r.runs?.length &&
          r.runs.every((x) => x.succeeded === true) &&
          !r.runVerdict?.length)),
    memoryOff,
    durationSeconds:
      (Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000,
    usage: {
      input: m?.input,
      cached: m?.cached,
      uncached: m?.uncached,
      output: m?.output,
      generations: m?.generations,
      completeness: usable ? "complete" : m ? "incomplete" : "missing",
      gaps,
    },
  };
}
const cliVersion = () =>
  execFileSync("codex", ["--version"], { encoding: "utf8" }).trim();
export async function runLongSession(args) {
  const plan = longSessionPlan(args, cliVersion());
  const snapshot = Object.fromEntries(
    Object.keys(longWorkload.sourceHashes).map((p) => [
      p,
      execFileSync("git", ["show", `${longWorkload.sourceRef}:${p}`]),
    ]),
  );
  verifyLongSnapshot(snapshot, longWorkload.sourceHashes);
  const provenance = codeProvenance({ sourceRef: longWorkload.sourceRef });
  if (plan.mode === "plan") {
    console.log(
      JSON.stringify(
        { ...plan, ...provenance, status: "planned", providerStarted: false },
        null,
        2,
      ),
    );
    return;
  }
  assert.equal(
    provenance.workingTree.dirty,
    false,
    "Paid long-session gate requires clean committed sources",
  );
  const root = mkdtempSync(join(tmpdir(), "loom-cli-long-session-"));
  const result = {
    schemaVersion: 1,
    sampleId: randomUUID(),
    root,
    startedAt: new Date().toISOString(),
    ...plan,
    ...provenance,
    status: "running",
    qualityReview: "required",
    arms: {},
  };
  const save = () => writeEvidence(root, result);
  save();
  console.log("EVIDENCE " + join(root, "result.json"));
  const { nativeRound } = await import("./cli-efficiency/native.mjs");
  const { rahArm } = await import("./cli-efficiency/rah.mjs");
  const { transcript, measure } = await import("./cli-efficiency/common.mjs");
  const { probeLocalModelCatalog } =
    await import("../packages/agent-host/src/model-catalog-probe.ts");
  const evidenceFor = (arm, native) =>
    arm.rounds.map((r) => {
      let memoryOff = false;
      try {
        const rows = transcript(r.sessionId);
        const metas = rows.filter((e) => e.type === "session_meta");
        memoryOff =
          metas.length > 0 &&
          metas.every((e) => e.payload.memory_mode === "disabled");
        const contexts = rows.filter(
          (e) =>
            e.type === "turn_context" &&
            e.timestamp >= r.startedAt &&
            e.timestamp <= r.finishedAt,
        );
        assert.ok(contexts.length > 0, "No actual native turn context");
        for (const e of contexts) {
          assert.equal(e.payload.model, plan.config.model);
          assert.equal(e.payload.effort, plan.config.effort);
        }
        assert.ok(memoryOff, "Actual transcript memory_mode is not disabled");
        r.actualIdentityVerified = true;
      } catch (e) {
        r.identityError = String(e);
      }
      r.actualMemoryOff = memoryOff;
      const stage = normalizeLongStage(r, {
        native,
        memoryOff,
        identityVerified: arm.identityVerified !== false,
      });
      if (r.identityError) stage.completed = false;
      return stage;
    });
  try {
    const catalog = await probeLocalModelCatalog({
      kind: plan.config.catalogKind,
      executablePath: execFileSync("which", ["codex"], {
        encoding: "utf8",
      }).trim(),
      cwd: root,
    });
    const binding = catalog.find(
      (b) => b.modelBindingId === plan.config.bindingId,
    );
    assert.equal(binding?.modelId, plan.config.model);
    assert.ok(binding.supportedReasoning.includes(plan.config.effort));
    result.catalogVerifiedAt = new Date().toISOString();
    save();
    for (const kind of plan.order) {
      const armRoot = join(root, kind),
        cwd = join(armRoot, "workspace");
      mkdirSync(cwd, { recursive: true });
      for (const [p, b] of Object.entries(snapshot)) {
        mkdirSync(dirname(join(cwd, p)), { recursive: true });
        writeFileSync(join(cwd, p), b);
      }
      writeFileSync(join(cwd, "AGENTS.md"), plan.instructions + "\n");
      const arm = {
        kind,
        rounds: [],
        processes: [],
        status: "running",
        startedAt: new Date().toISOString(),
      };
      result.arms[kind] = arm;
      save();
      const startedAt = Date.now();
      const savedEnv = Object.fromEntries(
        [
          "LOOM_CODEX_FINAL_OUTPUT_TRIAL",
          "LOOM_OPENCODE_FINAL_OUTPUT_TRIAL",
          "RAH_EFFICIENCY_WARM_RESTART",
        ].map((k) => [k, process.env[k]]),
      );
      Object.assign(process.env, longArmEnvironment(kind));
      const verify = () => {
        arm.identityVerified = false;
        try {
          assert.equal(cliVersion(), plan.cliVersion, "CLI changed");
          verifyLongSnapshot(
            Object.fromEntries(
              Object.keys(snapshot).map((p) => [p, readFileSync(join(cwd, p))]),
            ),
            longWorkload.sourceHashes,
          );
          assert.equal(
            readFileSync(join(cwd, "AGENTS.md"), "utf8"),
            plan.instructions + "\n",
            "Instructions changed",
          );
          arm.identityVerified = arm.identityError === undefined;
        } catch (error) {
          arm.identityError = String(error);
          throw error;
        }
      };
      const admit = () => {
        verify();
        if (arm.rounds.length) {
          const stages = evidenceFor(arm, kind === "native");
          assert.ok(
            stages.every(
              (s) =>
                s.completed &&
                s.memoryOff &&
                s.usage.completeness === "complete",
            ),
            "Prior stage identity/execution incomplete",
          );
          assert.equal(
            new Set(stages.map((s) => s.sessionId)).size,
            1,
            "Session replaced",
          );
        }
        checkLongSessionBudget(arm, {
          startedAt,
          maxMs: plan.limits.perArmMs,
          maxInput: plan.limits.perArmInput,
        });
        save();
      };
      try {
        if (kind === "native") {
          let sessionId;
          for (let i = 0; i < plan.questions.length; i++) {
            admit();
            const round = { round: i + 1 };
            arm.rounds.push(round);
            save();
            sessionId = await nativeRound({
              cwd,
              sessionId,
              prompt: plan.questions[i],
              save,
              round,
              config: plan.config,
            });
            round.longStageSucceeded = true;
            save();
          }
          arm.status = "complete";
        } else
          await rahArm({
            kind: "role-warm",
            root: armRoot,
            cwd,
            questions: plan.questions,
            arm,
            save,
            config: plan.config,
            businessInstructions: plan.instructions,
            beforeRound: admit,
          });
        verify();
        arm.stages = evidenceFor(arm, kind === "native");
        assert.equal(arm.rounds.length, 12);
        assert.ok(
          arm.stages.every(
            (s) =>
              s.completed && s.memoryOff && s.usage.completeness === "complete",
          ),
        );
        assert.equal(new Set(arm.stages.map((s) => s.sessionId)).size, 1);
      } catch (e) {
        arm.status = "failed";
        arm.error = String(e);
        for (const r of arm.rounds)
          if (
            !r.metrics &&
            kind === "native" &&
            r.sessionId &&
            r.startedAt &&
            r.finishedAt
          ) {
            try {
              r.metrics = measure(r.sessionId, r, undefined, plan.config);
              r.recoveredUsageEvidence =
                "native-transcript-complete-round-window";
            } catch (error) {
              r.usageRecoveryError = String(error);
            }
          }
        if (kind !== "native")
          for (const round of arm.rounds) {
            try {
              Object.assign(
                round,
                recoverFailedProductRound({
                  stateDirectory: join(armRoot, "state"),
                  roomId: arm.roomId,
                  participantId: arm.participantId,
                  round,
                }),
              );
            } catch (error) {
              round.usageRecoveryError = String(error);
            }
          }
        arm.failureEvidence = {
          stateDirectory: join(armRoot, "state"),
          nativeTranscriptSessionIds: [
            ...new Set(arm.rounds.map((r) => r.sessionId).filter(Boolean)),
          ],
          missingUsage:
            "not-zero; original transcripts and product SQLite retained",
        };
      } finally {
        try {
          verify();
        } catch (error) {
          arm.identityVerified = false;
          arm.status = "failed";
          arm.identityError = String(error);
        }
        if (arm.warmFailures?.length) arm.identityVerified = false;
        arm.stages = evidenceFor(arm, kind === "native");
        arm.finishedAt = new Date().toISOString();
        for (const [k, v] of Object.entries(savedEnv)) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
        save();
      }
      if (kind === "native" && arm.status !== "complete") {
        result.status = "native-incomplete";
        break;
      }
    }
    result.summary = summarizeLongSession({
      arms: Object.fromEntries(
        Object.entries(result.arms).map(([k, a]) => [k, { stages: a.stages }]),
      ),
      checkpoints: longWorkload.checkpoints,
      expectedStages: 12,
    });
    if (result.status === "running")
      result.status = Object.values(result.arms).every(
        (a) => a.status === "complete",
      )
        ? "needs-quality-review"
        : "partial-failure";
  } catch (e) {
    result.status = "failed";
    result.error = String(e);
  } finally {
    result.finishedAt = new Date().toISOString();
    save();
  }
  return result;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await runLongSession(process.argv.slice(2));
