import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { assertApprovedGateModel } from "./approved-models.mjs";
import { classifyClaudeLaunch } from "./claude-guard.mjs";
import {
  classifyCodexLaunch,
  createCodexRequestGuard,
} from "./model-guard.mjs";
import {
  armSignal,
  checkCodexRolloutModels,
  claudeArmLaunch,
  claudeProjectBucket,
  codexArmLaunch,
  codexAuthLinkState,
  codexBackgroundModels,
  codexHomeConfigToml,
  codexMemoryContent,
  codexMemoryDiff,
  codexRolloutModels,
  controlGate,
  diffCodexMemoryDb,
  diffTree,
  judgeProvider,
  overallVerdict,
  parseNativeMemoryArgs,
  plannedTurns,
  snapshotCodexMemoryDb,
  snapshotTree,
  withoutCodexMemorySwitches,
} from "./native-memory.mjs";
import { providerLaunchSwitches } from "../../packages/agent-host/src/provider-launch-arguments.js";

const HAIKU = { model: "haiku", effort: null };
const LUNA = { model: "gpt-6-luna", effort: "low" };
const temp = () => mkdtempSync(join(tmpdir(), "nmem-test-"));
const noTree = { added: [], modified: [], removed: [] };
const wrote = { added: ["MEMORY.md"], modified: [], removed: [] };

test("gate models are in the approval table", () => {
  assertApprovedGateModel({ provider: "claude", ...HAIKU });
  assertApprovedGateModel({ provider: "codex", ...LUNA });
});

test("Claude bucket replaces every non-alphanumeric character", () => {
  assert.equal(
    claudeProjectBucket("/Users/sun/Code/repos/rah_os"),
    "-Users-sun-Code-repos-rah-os",
  );
  assert.throws(() => claudeProjectBucket("relative/path"));
  assert.throws(() => claudeProjectBucket("/" + "a".repeat(200)));
});

test("Claude arms differ only by the memory environment switch", () => {
  const environment = { PATH: "/bin", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "0" };
  const base = { ...HAIKU, prompt: "p", environment };
  const control = claudeArmLaunch({ arm: "control", ...base });
  const experiment = claudeArmLaunch({ arm: "experiment", ...base });
  assert.deepEqual(control.args, experiment.args);
  assert.equal(experiment.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, "1");
  assert.equal("CLAUDE_CODE_DISABLE_AUTO_MEMORY" in control.env, false);
  assert.equal(control.env.ENABLE_CLAUDEAI_MCP_SERVERS, "false");
  for (const a of providerLaunchSwitches("claude").args)
    assert.ok(experiment.args.includes(a));
  assert.ok(!experiment.args.includes("--effort"));
  // The existing guard admits both launches for the effortless binding.
  assert.equal(classifyClaudeLaunch(control.args, HAIKU), "turn");
  assert.throws(() => claudeArmLaunch({ arm: "other", ...base }));
});

const policyArgs = [
  ...providerLaunchSwitches("codex").args,
  "-c",
  "mcp_servers.demo.enabled=false",
];

test("Codex control drops only the three memory switches", () => {
  const control = codexArmLaunch({ arm: "control", policyArgs, effort: "low" });
  const experiment = codexArmLaunch({
    arm: "experiment",
    policyArgs,
    effort: "low",
  });
  assert.deepEqual(experiment.args, ["app-server", ...policyArgs]);
  assert.equal(control.args.length, experiment.args.length - 6);
  for (const key of [
    "features.memories",
    "memories.generate_memories",
    "memories.use_memories",
  ]) {
    assert.ok(experiment.args.includes(`${key}=false`));
    assert.ok(!control.args.some((a) => a.startsWith(key + "=")));
  }
  assert.ok(control.args.includes("features.multi_agent=false"));
  assert.ok(control.args.includes("mcp_servers.demo.enabled=false"));
  assert.deepEqual(control.threadConfig, { model_reasoning_effort: "low" });
  assert.equal(experiment.threadConfig["features.memories"], false);
  assert.equal(experiment.threadConfig.model_reasoning_effort, "low");
  // Both launches and thread configs pass the existing Codex fence.
  const guard = createCodexRequestGuard(LUNA);
  for (const arm of [control, experiment]) {
    assert.equal(classifyCodexLaunch(arm.args).kind, "app-server");
    guard({
      jsonrpc: "2.0",
      id: 1,
      method: "thread/start",
      params: {
        model: "gpt-6-luna",
        config: arm.threadConfig,
        approvalPolicy: "never",
        cwd: "/tmp/x",
        sandbox: "workspace-write",
      },
    });
  }
  assert.throws(() =>
    codexArmLaunch({
      arm: "experiment",
      policyArgs: ["-c", "notify=[]"],
      effort: "low",
    }),
  );
});

test("withoutCodexMemorySwitches keeps unrelated -c pairs", () => {
  assert.deepEqual(
    withoutCodexMemorySwitches([
      "-c",
      "features.memories=false",
      "-c",
      "features.goals=false",
    ]),
    ["-c", "features.goals=false"],
  );
});

test("Codex home config turns memories on with the approved model", () => {
  const toml = codexHomeConfigToml("gpt-6-luna");
  assert.match(toml, /\[features\]\nmemories = true/u);
  assert.match(toml, /extract_model = "gpt-6-luna"/u);
  assert.match(toml, /consolidation_model = "gpt-6-luna"/u);
  assert.throws(() => codexHomeConfigToml('x"\n[evil]'));
});

test("tree snapshot and diff report added, modified and removed files", () => {
  const dir = temp();
  assert.deepEqual(snapshotTree(join(dir, "missing")), {
    exists: false,
    files: {},
  });
  mkdirSync(join(dir, "notes"));
  writeFileSync(join(dir, "a.md"), "one");
  writeFileSync(join(dir, "gone.md"), "x");
  const before = snapshotTree(dir);
  writeFileSync(join(dir, "a.md"), "two");
  writeFileSync(join(dir, "notes", "b.md"), "tabs");
  unlinkSync(join(dir, "gone.md"));
  const after = snapshotTree(dir);
  assert.equal(after.files["notes/b.md"].excerpt, "tabs");
  assert.deepEqual(diffTree(before, after), {
    added: ["notes/b.md"],
    modified: ["a.md"],
    removed: ["gone.md"],
  });
  symlinkSync("/etc/hosts", join(dir, "link"));
  assert.deepEqual(snapshotTree(dir).files.link, { symlink: true });
});

test("Codex memory database snapshot counts rows read-only", () => {
  const dir = temp();
  const path = join(dir, "memories_1.sqlite");
  assert.equal(snapshotCodexMemoryDb(path).exists, false);
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE stage1_outputs (thread_id TEXT PRIMARY KEY, raw_memory TEXT, generated_at INTEGER);" +
      "CREATE TABLE jobs (kind TEXT, job_key TEXT, status TEXT);",
  );
  const before = snapshotCodexMemoryDb(path);
  db.exec(
    "INSERT INTO stage1_outputs VALUES ('t1', 'prefers tabs', 1);" +
      "INSERT INTO jobs VALUES ('memory_stage1', 't1', 'done');",
  );
  db.close();
  const after = snapshotCodexMemoryDb(path);
  assert.deepEqual(diffCodexMemoryDb(before, after), {
    stage1Outputs: 1,
    jobs: 1,
  });
  assert.deepEqual(after.jobKinds, { "memory_stage1:done": 1 });
  assert.equal(after.stage1Excerpts[0].rawExcerpt, "prefers tabs");
});

const claudeArm = (tree, ok = true) => ({ ok, diff: { memoryDir: tree } });
const codexArm = (tree, db, ok = true) => ({
  ok,
  diff: {
    memoriesDir: tree,
    memoriesContent: [...tree.added, ...tree.modified],
    memoryDb: db,
  },
});
const noDb = { stage1Outputs: 0, jobs: 0 };

test("verdict: a control that writes nothing is insensitive, never a pass", () => {
  const v = judgeProvider("claude", {
    control: claudeArm(noTree),
    experiment: claudeArm(noTree),
  });
  assert.equal(v.verdict, "insensitive");
  assert.equal(
    judgeProvider("codex", {
      control: codexArm(noTree, { stage1Outputs: 0, jobs: 2 }),
      experiment: codexArm(noTree, noDb),
    }).verdict,
    "insensitive",
  );
});

test("verdict: pass, fail and inconclusive", () => {
  assert.equal(
    judgeProvider("claude", {
      control: claudeArm(wrote),
      experiment: claudeArm(noTree),
    }).verdict,
    "pass",
  );
  assert.equal(
    judgeProvider("claude", {
      control: claudeArm(wrote),
      experiment: claudeArm({ ...noTree, modified: ["MEMORY.md"] }),
    }).verdict,
    "fail",
  );
  // Codex: stage1 rows alone prove sensitivity; a started pipeline fails
  // the experiment.
  assert.equal(
    judgeProvider("codex", {
      control: codexArm(noTree, { stage1Outputs: 1, jobs: 1 }),
      experiment: codexArm(noTree, { stage1Outputs: 0, jobs: 1 }),
    }).verdict,
    "fail",
  );
  assert.equal(
    judgeProvider("codex", {
      control: codexArm(wrote, noDb),
      experiment: codexArm(noTree, noDb),
    }).verdict,
    "pass",
  );
  assert.equal(
    judgeProvider("claude", {
      control: { ok: false, error: "exit 1" },
      experiment: claudeArm(noTree),
    }).verdict,
    "inconclusive",
  );
  assert.equal(
    judgeProvider("claude", {
      control: claudeArm(wrote),
      experiment: { ok: false, error: "timeout" },
    }).verdict,
    "inconclusive",
  );
  assert.equal(
    judgeProvider("claude", { control: claudeArm(wrote) }).verdict,
    "inconclusive",
  );
});

test("control gate runs the experiment only after a sensitive control", () => {
  assert.deepEqual(controlGate("claude", claudeArm(wrote)), { proceed: true });
  assert.equal(controlGate("claude", claudeArm(noTree)).proceed, false);
  assert.equal(controlGate("codex", { ok: false, error: "x" }).proceed, false);
});

test("overall verdict: violations win, then the worst provider verdict", () => {
  const pass = { verdict: "pass" };
  assert.equal(overallVerdict({ claude: pass, codex: pass }), "pass");
  assert.equal(
    overallVerdict({ claude: pass, codex: { verdict: "insensitive" } }),
    "insensitive",
  );
  assert.equal(
    overallVerdict({
      claude: { verdict: "fail" },
      codex: { verdict: "insensitive" },
    }),
    "fail",
  );
  assert.equal(overallVerdict({ claude: pass }, ["x"]), "guard-violation");
  assert.equal(overallVerdict({}), "inconclusive");
});

test("Codex rollout models: other models are violations", () => {
  const home = temp();
  mkdirSync(join(home, "sessions", "2026"), { recursive: true });
  writeFileSync(
    join(home, "sessions", "2026", "rollout-a.jsonl"),
    [
      JSON.stringify({
        type: "turn_context",
        payload: { model: "gpt-6-luna", effort: "low" },
      }),
      "torn line {",
      JSON.stringify({
        type: "turn_context",
        payload: { model: "gpt-6-luna", effort: "medium" },
      }),
      JSON.stringify({
        type: "turn_context",
        payload: { model: "other-mini", effort: "low" },
      }),
    ].join("\n"),
  );
  const records = codexRolloutModels(home);
  assert.equal(records.length, 3);
  const checked = checkCodexRolloutModels(records, LUNA);
  assert.deepEqual(
    checked.violations.map((r) => r.model),
    ["other-mini"],
  );
  assert.deepEqual(
    checked.otherEfforts.map((r) => r.effort),
    ["medium"],
  );
});

test("Codex auth link state", () => {
  const dir = temp();
  const real = join(dir, "real-auth.json");
  writeFileSync(real, "{}");
  const home = join(dir, "home");
  mkdirSync(home);
  assert.equal(codexAuthLinkState(home, real).state, "missing");
  symlinkSync(real, join(home, "auth.json"));
  assert.equal(codexAuthLinkState(home, real).state, "linked");
  unlinkSync(join(home, "auth.json"));
  writeFileSync(join(home, "auth.json"), "{}");
  assert.equal(codexAuthLinkState(home, real).state, "replaced");
});

test("arguments: --paid required, provider and wait parsed", () => {
  assert.throws(() => parseNativeMemoryArgs([]), /--paid/u);
  const all = parseNativeMemoryArgs(["--paid"]);
  assert.deepEqual(all, {
    providers: ["claude", "codex"],
    codexFollowup: true,
    codexWaitSeconds: 180,
  });
  assert.equal(plannedTurns(all), 6);
  const codex = parseNativeMemoryArgs([
    "--paid",
    "--provider=codex",
    "--no-codex-followup",
    "--codex-wait-seconds=30",
  ]);
  assert.deepEqual(codex.providers, ["codex"]);
  assert.equal(plannedTurns(codex), 2);
  assert.equal(codex.codexWaitSeconds, 30);
  assert.throws(() => parseNativeMemoryArgs(["--paid", "--provider=kimi"]));
  assert.throws(() =>
    parseNativeMemoryArgs(["--paid", "--codex-wait-seconds=0"]),
  );
  assert.throws(() => parseNativeMemoryArgs(["--paid", "--bogus"]));
});

// Full review 2 B-P1-1: the committed 2026-09-27 run. The Codex control arm
// only produced the memory workspace skeleton (its own version-control
// directory, extension instructions, the phase-2 diff and the "No raw
// memories yet." placeholder) and one failed consolidation job: no memory
// content, so the run is insensitive, never a pass.
const evidence = JSON.parse(
  readFileSync(
    new URL(
      "../../docs/evo/evidence/2026-09-27-native-memory-off.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

test("Codex skeleton files are not memory content (committed control arm is insensitive)", () => {
  const control = evidence.providers.codex.arms.control;
  const diff = codexMemoryDiff(control.memoryBefore, control.memoryAfter);
  assert.ok(diff.memoriesDir.added.includes("raw_memories.md"));
  assert.deepEqual(diff.memoriesContent, []);
  assert.deepEqual(armSignal("codex", diff), {
    wroteMemory: false,
    memoryActivity: true,
  });
  assert.equal(
    judgeProvider("codex", {
      control: { ok: true, diff },
      experiment: evidence.providers.codex.arms.experiment,
    }).verdict,
    "insensitive",
  );
  assert.equal(controlGate("codex", { ok: true, diff }).proceed, false);
});

const file = (excerpt, size = excerpt.length) => ({
  size,
  sha256: excerpt,
  excerpt,
});
const PLACEHOLDER = "# Raw Memories\n\nNo raw memories yet.\n";

test("Codex memory content: real raw memories, summaries and memory files count", () => {
  const before = { exists: false, files: {} };
  const skeleton = {
    [[".git", "HEAD"].join("/")]: file("ref: refs/heads/main\n"),
    "extensions/ad_hoc/instructions.md": file("# Ad-hoc notes\n"),
    "phase2_workspace_diff.md": file("# Memory Workspace Diff\n"),
    "raw_memories.md": file(PLACEHOLDER),
  };
  assert.deepEqual(
    codexMemoryContent(before, { exists: true, files: skeleton }),
    [],
  );
  assert.deepEqual(
    codexMemoryContent(before, {
      exists: true,
      files: {
        ...skeleton,
        "raw_memories.md": file("# Raw Memories\n\n- User prefers tabs.\n"),
      },
    }),
    ["raw_memories.md"],
  );
  assert.deepEqual(
    codexMemoryContent(before, {
      exists: true,
      files: { ...skeleton, "memory_summary.md": file("tabs") },
    }),
    ["memory_summary.md"],
  );
  // A placeholder longer than the recorded excerpt cannot be proven empty.
  assert.deepEqual(
    codexMemoryContent(before, {
      exists: true,
      files: { "raw_memories.md": file(PLACEHOLDER, 400) },
    }),
    ["raw_memories.md"],
  );
});

test("Codex early stop uses the same content signal as the verdict", () => {
  const empty = {
    memoriesDir: { exists: false, files: {} },
    memoryDb: { exists: false, stage1Outputs: 0, jobs: 0, jobKinds: {} },
  };
  const skeletonOnly = {
    memoriesDir: {
      exists: true,
      files: { "raw_memories.md": file(PLACEHOLDER) },
    },
    memoryDb: { exists: true, stage1Outputs: 0, jobs: 1, jobKinds: {} },
  };
  assert.equal(
    armSignal("codex", codexMemoryDiff(empty, skeletonOnly)).wroteMemory,
    false,
  );
  const stage1 = {
    ...skeletonOnly,
    memoryDb: { ...skeletonOnly.memoryDb, stage1Outputs: 1 },
  };
  assert.equal(
    armSignal("codex", codexMemoryDiff(empty, stage1)).wroteMemory,
    true,
  );
  assert.throws(
    () => armSignal("codex", { memoriesDir: noTree, memoryDb: noDb }),
    /memoriesContent/u,
  );
});

// Full review 2 B-P2-2: background memory calls run inside app-server,
// outside the JSON-RPC fence; their models come only from rollouts.
test("Codex background memory calls: unfenced, models from rollouts, missing when unrecorded", () => {
  const sessions = [{ threadId: "t-main-1" }, { threadId: "t-main-2" }];
  const main = [
    { file: "sessions/rollout-1-t-main-1.jsonl", model: "gpt-6-luna" },
    { file: "sessions/rollout-2-t-main-2.jsonl", model: "gpt-6-luna" },
  ];
  const none = codexBackgroundModels({
    rolloutModels: main,
    sessions,
    jobs: 0,
  });
  assert.equal(none.fenced, false);
  assert.equal(none.status, "no-background-jobs");
  const missing = codexBackgroundModels({
    rolloutModels: main,
    sessions,
    jobs: 1,
  });
  assert.equal(missing.status, "missing");
  assert.deepEqual(missing.rollouts, []);
  const recorded = codexBackgroundModels({
    rolloutModels: [
      ...main,
      {
        file: "sessions/rollout-3-t-bg.jsonl",
        model: "gpt-6-luna",
        effort: "medium",
      },
    ],
    sessions,
    jobs: 1,
  });
  assert.equal(recorded.status, "recorded");
  assert.deepEqual(
    recorded.rollouts.map((r) => r.effort),
    ["medium"],
  );
  // The committed control arm: one job, no background rollout recorded.
  const control = evidence.providers.codex.arms.control;
  assert.equal(
    codexBackgroundModels({
      rolloutModels: control.rolloutModels,
      sessions: control.sessions,
      jobs: control.memoryAfter.memoryDb.jobs,
    }).status,
    "missing",
  );
  assert.equal(
    overallVerdict({ codex: { verdict: "pass" } }, [], ["codex: unrecorded"]),
    "missing-evidence",
  );
  assert.equal(
    overallVerdict({ codex: { verdict: "fail" } }, [], ["x"]),
    "fail",
  );
});
