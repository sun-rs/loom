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

import {
  assertMultiProviderVersion,
  readMultiProviderEvents,
  assertMultiProviderIdentity,
} from "./cli-efficiency/multi-provider.mjs";
import { recoverFailedNativeRounds } from "./cli-efficiency/multi-native-recovery.mjs";
import { MULTI_INSTRUCTION_POLICY } from "./cli-efficiency/multi-channel-product.mjs";

const DEFAULT_PROFILE = {
  workload: multiWorkload,
  experimentVersion: "multi-channel/v2",
  sampleId: "P116",
  roundsPerParticipant: 4,
  limits: { perArmInput: 1200000, perArmMs: 1200000, maxProductRuns: 12 },
};

export function multiPlan(
  args,
  version,
  profile = DEFAULT_PROFILE,
  environment = {},
) {
  const workload = profile.workload;
  const productArm = profile.productArm ?? "final-output";
  assert.ok(
    ["final-output", "worker-mcp", "worker-delivery"].includes(productArm),
    "Unknown product arm",
  );
  assert.equal(
    workload.steps.length,
    speakers.length * profile.roundsPerParticipant,
  );
  if (productArm === "worker-delivery") {
    assert.ok(
      Number.isSafeInteger(profile.limits.maxProductRuns) &&
        profile.limits.maxProductRuns >= workload.steps.length,
    );
    assert.equal(profile.answerPolicy, "business-content");
  } else assert.equal(profile.limits.maxProductRuns, workload.steps.length);
  assert.ok(
    profile.platformMemoryPolicy === undefined ||
      profile.platformMemoryPolicy === "disabled",
    "Unsupported platform memory policy",
  );
  const order = profile.order ?? ["native", productArm];
  assert.deepEqual([...order].sort(), ["native", productArm].sort());
  assert.ok(
    args.length === 1 && ["--plan", "--paid"].includes(args[0]),
    "Requires exactly --plan or --paid",
  );
  const config = parseEfficiencyEnv(environment);
  assertMultiProviderVersion(config.provider, version);
  assert.ok(
    config.provider === "codex" || productArm === "worker-delivery",
    "This profile requires Codex; cross-provider business profile required",
  );
  const identity = {
    experimentVersion: profile.experimentVersion,
    ...(profile.productArm === undefined ? {} : { productArm }),
    ...(profile.answerPolicy === undefined
      ? {}
      : { answerPolicy: profile.answerPolicy }),
    ...(profile.validationPolicy
      ? { validationPolicy: profile.validationPolicy }
      : {}),
    ...(profile.platformMemoryPolicy === undefined
      ? {}
      : { platformMemoryPolicy: profile.platformMemoryPolicy }),
    ...(profile.completionPolicy === undefined
      ? {}
      : { completionPolicy: profile.completionPolicy }),
    instructionPolicy:
      config.provider === "claude"
        ? {
            ...MULTI_INSTRUCTION_POLICY,
            id: "workspace-native-business-only/v1",
            businessCarrier: "workspace/CLAUDE.md in both arms",
            roleInstructions: "Follow the workspace CLAUDE.md.",
          }
        : MULTI_INSTRUCTION_POLICY,
    workloadId: workload.id,
    sourceRef: workload.sourceRef,
    files: Object.fromEntries(
      Object.entries(workload.files).map(([p, b]) => [p, longHash(b)]),
    ),
    instructions: longHash(workload.instructions),
    steps: longHash(JSON.stringify(workload.steps)),
    version,
    model: config.model,
    effort: config.effort,
    order,
    historyPolicy:
      "independent arm histories; fixed business questions; own peer replies relayed without editing",
    routingIdentity:
      "native logical aliases; product actual instance handles including unique suffix; raw cost retained",
    nativeMemory: describeNativeMemoryPolicy(config.provider),
    nativeInvocationPolicy: nativeInvocationPolicy(config.provider),
    nativeInvocation: Object.fromEntries(
      ["initial", "resume"].map((phase) => [
        phase,
        nativeInvocationArgs(config.provider, {
          model: config.model,
          effort: config.effort,
          prompt: "<channel-delta>",
          sessionId: phase === "resume" ? "<session>" : undefined,
          launchArgs: [],
        }),
      ]),
    ),
    arms: Object.fromEntries(
      ["native", productArm].map((k) => [
        k,
        longArmEnvironment(
          ["worker-mcp", "worker-delivery"].includes(k) ? "default" : k,
          {},
        ),
      ]),
    ),
    relayTemplate: channelPrompt([{ author: "<author>", body: "<body>" }]),
    firstDelivery:
      "Role creation sequence is the origin floor before messages; first turn includes prior channel business messages",
    limits: profile.limits,
  };
  return {
    mode: args[0].slice(2),
    providerStarted: false,
    config,
    ...identity,
    stageCount: workload.steps.length,
    participantCount: 3,
    roundsPerParticipant: profile.roundsPerParticipant,
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
      m?.requestCoverage === undefined ||
        m.requestCoverage.status === "complete",
      "Native request coverage incomplete",
    );
    assert.ok(
      m &&
        ["input", "cached", "uncached", "output", "generations"].every(
          (k) => Number.isSafeInteger(m[k]) && m[k] >= 0,
        ) &&
        m.generations > 0 &&
        m.input === m.cached + m.uncached,
      "Missing/inconsistent usage",
    );
    if (["final-output", "worker-mcp", "worker-delivery"].includes(arm.kind))
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
const version = (provider = "codex") =>
  execFileSync(provider, ["--version"], { encoding: "utf8" }).trim();
export function createRoundValidationFence({
  arm,
  transcript,
  evidenceText,
  expectedFor,
  validate,
}) {
  let processed = 0;
  arm.validationProcessedPrefix = 0;
  return () => {
    while (processed < arm.rounds.length) {
      const round = arm.rounds[processed];
      if (round.validationError) throw new Error(round.validationError);
      try {
        round.validation = validate({
          armKind: arm.kind,
          round,
          previousRounds: arm.rounds
            .slice(0, processed)
            .filter((r) => r.speaker === round.speaker),
          events: transcript(round.sessionId),
          expectedAnswer: expectedFor(round),
          evidenceText,
        });
        processed += 1;
        arm.validationProcessedPrefix = processed;
      } catch (error) {
        round.validationError = String(error);
        throw error;
      }
    }
  };
}

export async function runMultiChannel(args, profile = DEFAULT_PROFILE) {
  const workload = profile.workload;
  const selected = parseEfficiencyEnv(process.env);
  const plan = multiPlan(
      args,
      version(selected.provider),
      profile,
      process.env,
    ),
    provenance = codeProvenance({ sourceRef: workload.sourceRef });
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
    sampleId: profile.sampleId,
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
  const { nativeClaudeRound, nativeClaudeEnvironment } =
    await import("./cli-efficiency/native-claude.mjs");
  const { nativeKimiRound } = await import("./cli-efficiency/native-kimi.mjs");
  const { nativeOpenCodeRound } =
    await import("./cli-efficiency/native-opencode.mjs");
  const invokeNative = {
    codex: nativeRound,
    claude: nativeClaudeRound,
    kimi: nativeKimiRound,
    opencode: nativeOpenCodeRound,
  }[selected.provider];
  if (selected.provider === "claude") nativeClaudeEnvironment(selected);
  const { runMultiProduct } =
    await import("./cli-efficiency/multi-channel-product.mjs");
  const { probeLocalModelCatalog } =
    await import("../packages/agent-host/src/model-catalog-probe.ts");
  const markIdentity = (arm) => {
    for (const r of arm.rounds) {
      assertMultiProviderIdentity({
        config: plan.config,
        round: r,
        cwd: arm.workspace,
      });
      if (plan.config.provider !== "codex" && arm.kind === "native") {
        assert.ok(
          ["enforced", "not-applicable"].includes(r.nativeMemoryPolicy?.status),
          "Missing native launch memory policy",
        );
        assert.equal(r.nativeMemoryPolicy.provider, plan.config.provider);
        assert.equal(
          realpathSync(r.nativeLaunchCwd),
          realpathSync(arm.workspace),
          "Actual CLI workspace changed",
        );
        r.actualMemoryOff = true;
        r.actualWorkspaceVerified = true;
      }
    }
  };
  try {
    const catalog = await probeLocalModelCatalog({
      kind: plan.config.catalogKind,
      executablePath: execFileSync("which", [plan.config.provider], {
        encoding: "utf8",
      }).trim(),
      cwd: root,
    });
    const binding = catalog.find(
      (b) => b.modelBindingId === plan.config.bindingId,
    );
    assert.equal(binding?.modelId, plan.config.model);
    assert.ok(
      plan.config.effort === null
        ? binding.supportedReasoning.length === 0
        : binding.supportedReasoning.includes(plan.config.effort),
    );
    result.catalogVerifiedAt = new Date().toISOString();
    save();
    for (const kind of plan.order) {
      const armRoot = join(root, kind),
        cwd = join(armRoot, "workspace");
      mkdirSync(cwd, { recursive: true });
      for (const [p, b] of Object.entries(workload.files))
        writeFileSync(join(cwd, p), b);
      writeFileSync(
        join(cwd, plan.config.instructionFile),
        workload.instructions + "\n",
      );
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
      Object.assign(
        process.env,
        longArmEnvironment(
          ["worker-mcp", "worker-delivery"].includes(kind) ? "default" : kind,
        ),
      );
      const verify = () => {
        assert.equal(
          version(plan.config.provider),
          plan.version,
          "CLI changed",
        );
        for (const [p, body] of Object.entries(workload.files))
          assert.equal(
            readFileSync(join(cwd, p), "utf8"),
            body,
            "Fixture changed",
          );
        assert.equal(
          readFileSync(join(cwd, plan.config.instructionFile), "utf8"),
          workload.instructions + "\n",
          "Instructions changed",
        );
      };
      const validateRounds = profile.validateRound
        ? createRoundValidationFence({
            arm,
            transcript: (id) =>
              readMultiProviderEvents(plan.config.provider, id),
            evidenceText: workload.files["evidence.txt"],
            expectedFor: profile.expectedFor,
            validate: profile.validateRound,
          })
        : () => {};
      const beforeRound = () => {
        verify();
        markIdentity(arm);
        validateMultiHistory(arm);
        validateRounds();
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
            steps: workload.steps,
            cwd,
            config: plan.config,
            save,
            beforeRound,
            invoke: (options) =>
              invokeNative({
                ...options,
                answerValidator: (answer) =>
                  profile.answerPolicy === "business-content"
                    ? Boolean(answer.trim())
                    : /^审查结论：\s*\S/u.test(answer.trim()),
              }),
          });
        else
          await runMultiProduct({
            productArm: profile.productArm ?? "final-output",
            maxRunAttempts: profile.limits.maxProductRuns,
            platformMemoryPolicy: profile.platformMemoryPolicy,
            completionPolicy: profile.completionPolicy,
            root: armRoot,
            cwd,
            config: plan.config,
            steps: workload.steps,
            arm,
            save,
            beforeRound,
          });
        markIdentity(arm);
        validateMultiHistory(arm);
        validateRounds();
        verify();
        assert.equal(arm.rounds.length, plan.stageCount);
        arm.status = "complete";
      } catch (error) {
        arm.status = "failed";
        arm.error = String(error);
        if (kind === "native") recoverFailedNativeRounds(arm, plan.config);
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
      result.arms[profile.productArm ?? "final-output"],
      plan.roundsPerParticipant,
    );
    if (result.status === "running") result.status = "needs-quality-review";
  } catch (error) {
    result.status = "failed";
    result.error = String(error);
  } finally {
    result.finishedAt = new Date().toISOString();
    if (profile.summarize)
      result.longObservation = profile.summarize(result.arms);
    save();
  }
  return result;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await runMultiChannel(process.argv.slice(2));
