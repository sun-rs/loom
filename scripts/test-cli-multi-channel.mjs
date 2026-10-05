// P116: fixed script, three independent continuous sessions in each arm.
// --plan is free; no autonomous phase is admitted by this executable.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { multiWorkload } from "./cli-efficiency/multi-channel-workload.mjs";
import {
  speakers,
  channelPrompt,
  runNativeChannel,
  compareParticipants,
} from "./cli-efficiency/multi-channel-support.mjs";
import { parseEfficiencyEnv } from "./cli-efficiency/efficiency-config.mjs";
import {
  longHash,
  checkLongSessionBudget,
} from "./cli-efficiency/long-session-support.mjs";
import {
  codeProvenance,
  writeEvidence,
} from "./cli-efficiency/gate-evidence.mjs";
import { describeNativeMemoryPolicy } from "./cli-efficiency/native-memory-policy.mjs";
import {
  nativeInvocationArgs,
  nativeInvocationPolicy,
} from "./cli-efficiency/native-invocation.mjs";
import { longArmEnvironment } from "./test-cli-long-session.mjs";

export function multiPlan(args, version) {
  assert.ok(
    args.length === 1 && ["--plan", "--paid"].includes(args[0]),
    "Requires exactly --plan or --paid",
  );
  assert.equal(version, "codex-cli 0.160.0", "Unregistered CLI version");
  const config = parseEfficiencyEnv({
    RAH_EFFICIENCY_PROVIDER: "codex",
    RAH_EFFICIENCY_MODEL: "gpt-6-luna",
    RAH_EFFICIENCY_EFFORT: "low",
  });
  const identity = {
    workloadId: multiWorkload.id,
    sourceRef: multiWorkload.sourceRef,
    files: Object.fromEntries(
      Object.entries(multiWorkload.files).map(([p, b]) => [p, longHash(b)]),
    ),
    instructions: longHash(multiWorkload.instructions),
    steps: longHash(JSON.stringify(multiWorkload.steps)),
    version,
    model: config.model,
    effort: config.effort,
    order: ["native", "final-output"],
    historyPolicy:
      "independent arm histories; fixed business questions; own peer replies relayed without editing",
    routingIdentity:
      "native logical aliases; product actual instance handles including unique suffix; raw cost retained",
    nativeMemory: describeNativeMemoryPolicy("codex"),
    nativeInvocationPolicy: nativeInvocationPolicy("codex"),
    nativeInvocation: Object.fromEntries(
      ["initial", "resume"].map((phase) => [
        phase,
        nativeInvocationArgs("codex", {
          model: config.model,
          effort: config.effort,
          prompt: "<channel-delta>",
          sessionId: phase === "resume" ? "<session>" : undefined,
          launchArgs: [],
        }),
      ]),
    ),
    arms: Object.fromEntries(
      ["native", "final-output"].map((k) => [k, longArmEnvironment(k, {})]),
    ),
    relayTemplate: channelPrompt([{ author: "<author>", body: "<body>" }]),
    firstDelivery:
      "Role creation sequence is the origin floor before messages; first turn includes prior channel business messages",
    limits: { perArmInput: 1200000, perArmMs: 1200000, maxProductRuns: 12 },
  };
  return {
    mode: args[0].slice(2),
    providerStarted: false,
    config,
    ...identity,
    stageCount: 12,
    participantCount: 3,
    roundsPerParticipant: 4,
    autonomousAdmission: "requires-separate-four-gate-review",
    baselineIdentity: longHash(JSON.stringify(identity)),
  };
}
export function validateMultiHistory(arm) {
  const sessions = {};
  for (const r of arm.rounds) {
    assert.ok(r.longStageSucceeded === true, "Incomplete admitted stage");
    assert.ok(r.actualMemoryOff === true, "Native memory not disabled");
    assert.ok(
      r.actualIdentityVerified === true,
      "Actual identity not verified",
    );
    assert.ok(
      r.actualWorkspaceVerified === true,
      "Actual workspace not verified",
    );
    assert.ok(speakers.includes(r.speaker), "Unknown participant");
    assert.ok(r.sessionId, "Missing session");
    if (sessions[r.speaker])
      assert.equal(r.sessionId, sessions[r.speaker], "Session replaced");
    assert.ok(
      !Object.entries(sessions).some(
        ([s, id]) => s !== r.speaker && id === r.sessionId,
      ),
      "Participants share session",
    );
    sessions[r.speaker] = r.sessionId;
    const m = r.metrics;
    assert.ok(
      m &&
        ["input", "cached", "uncached", "output", "generations"].every(
          (k) => Number.isSafeInteger(m[k]) && m[k] >= 0,
        ) &&
        m.generations > 0 &&
        m.input === m.cached + m.uncached,
      "Missing/inconsistent usage",
    );
    if (arm.kind === "final-output")
      assert.ok(m.productUsage, "Missing product usage");
    if (m.productUsage) {
      assert.equal(
        m.productUsage.completeness,
        "complete",
        "Incomplete product usage",
      );
      assert.deepEqual(m.productUsage.gaps, []);
      for (const [k, v] of Object.entries({
        input: "inputTokens",
        cached: "cachedInputTokens",
        output: "outputTokens",
        generations: "generations",
      }))
        assert.equal(m[k], m.productUsage.totals[v], "Product usage mismatch");
    }
  }
}
const version = () =>
  execFileSync("codex", ["--version"], { encoding: "utf8" }).trim();
export async function runMultiChannel(args) {
  const plan = multiPlan(args, version()),
    provenance = codeProvenance({ sourceRef: multiWorkload.sourceRef });
  if (plan.mode === "plan") {
    console.log(JSON.stringify({ ...plan, ...provenance }, null, 2));
    return;
  }
  assert.equal(
    provenance.workingTree.dirty,
    false,
    "Paid gate requires clean committed sources",
  );
  const root = mkdtempSync(join(tmpdir(), "loom-cli-multi-channel-"));
  const result = {
    sampleId: "P116",
    ...plan,
    ...provenance,
    root,
    startedAt: new Date().toISOString(),
    status: "running",
    arms: {},
    qualityReview: "required",
  };
  const save = () => writeEvidence(root, result);
  save();
  console.log("EVIDENCE " + join(root, "result.json"));
  const { nativeRound } = await import("./cli-efficiency/native.mjs");
  const { transcript, measure } = await import("./cli-efficiency/common.mjs");
  const { runMultiProduct } =
    await import("./cli-efficiency/multi-channel-product.mjs");
  const { probeLocalModelCatalog } =
    await import("../packages/agent-host/src/model-catalog-probe.ts");
  const markIdentity = (arm) => {
    for (const r of arm.rounds) {
      const rows = transcript(r.sessionId),
        metas = rows.filter((x) => x.type === "session_meta");
      r.actualMemoryOff =
        metas.length > 0 &&
        metas.every((x) => x.payload.memory_mode === "disabled");
      const contexts = rows.filter(
        (x) =>
          x.type === "turn_context" &&
          x.timestamp >= r.startedAt &&
          x.timestamp <= r.finishedAt,
      );
      assert.ok(contexts.length > 0, "Missing actual model context");
      for (const c of contexts) {
        assert.equal(c.payload.model, plan.config.model);
        assert.equal(c.payload.effort, plan.config.effort);
        assert.equal(
          realpathSync(c.payload.cwd),
          realpathSync(arm.workspace),
          "Actual CLI workspace changed",
        );
      }
      r.actualIdentityVerified = true;
      r.actualWorkspaceVerified = true;
    }
  };
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
      for (const [p, b] of Object.entries(multiWorkload.files))
        writeFileSync(join(cwd, p), b);
      writeFileSync(join(cwd, "AGENTS.md"), multiWorkload.instructions + "\n");
      const arm = {
        kind,
        workspace: cwd,
        rounds: [],
        messages: [],
        processes: [],
        startedAt: new Date().toISOString(),
        status: "running",
      };
      result.arms[kind] = arm;
      save();
      const startedAt = Date.now();
      const keys = [
        "LOOM_CODEX_FINAL_OUTPUT_TRIAL",
        "LOOM_OPENCODE_FINAL_OUTPUT_TRIAL",
        "RAH_EFFICIENCY_WARM_RESTART",
      ];
      const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
      Object.assign(process.env, longArmEnvironment(kind));
      const verify = () => {
        assert.equal(version(), plan.version, "CLI changed");
        for (const [p, body] of Object.entries(multiWorkload.files))
          assert.equal(
            readFileSync(join(cwd, p), "utf8"),
            body,
            "Fixture changed",
          );
        assert.equal(
          readFileSync(join(cwd, "AGENTS.md"), "utf8"),
          multiWorkload.instructions + "\n",
          "Instructions changed",
        );
      };
      const beforeRound = () => {
        verify();
        markIdentity(arm);
        validateMultiHistory(arm);
        checkLongSessionBudget(arm, {
          startedAt,
          maxMs: plan.limits.perArmMs,
          maxInput: plan.limits.perArmInput,
        });
        save();
      };
      try {
        result.providerStarted = true;
        save();
        if (kind === "native")
          await runNativeChannel({
            arm,
            steps: multiWorkload.steps,
            cwd,
            config: plan.config,
            save,
            beforeRound,
            invoke: (options) =>
              nativeRound({
                ...options,
                answerValidator: (answer) =>
                  /^审查结论：\s*\S/u.test(answer.trim()),
              }),
          });
        else
          await runMultiProduct({
            root: armRoot,
            cwd,
            config: plan.config,
            instructions: multiWorkload.instructions,
            steps: multiWorkload.steps,
            arm,
            save,
            beforeRound,
          });
        markIdentity(arm);
        validateMultiHistory(arm);
        verify();
        assert.equal(arm.rounds.length, 12);
        arm.status = "complete";
      } catch (error) {
        arm.status = "failed";
        arm.error = String(error);
        if (kind === "native")
          for (const r of arm.rounds)
            if (!r.metrics && r.sessionId && r.startedAt && r.finishedAt) {
              try {
                r.metrics = measure(r.sessionId, r, undefined, plan.config);
                r.recoveredUsage = "native-transcript";
              } catch (e) {
                r.usageRecoveryError = String(e);
              }
            }
      } finally {
        try {
          verify();
        } catch (error) {
          arm.status = "failed";
          arm.integrityError = String(error);
        }
        arm.finishedAt = new Date().toISOString();
        for (const [k, v] of Object.entries(saved)) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
        save();
      }
      if (arm.status !== "complete") {
        result.status = `${kind}-incomplete`;
        break;
      }
    }
    result.contractComparison = compareParticipants(
      result.arms.native,
      result.arms["final-output"],
    );
    if (result.status === "running") result.status = "needs-quality-review";
  } catch (error) {
    result.status = "failed";
    result.error = String(error);
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
  await runMultiChannel(process.argv.slice(2));
