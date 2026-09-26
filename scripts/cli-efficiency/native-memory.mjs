// Native memory-off proof (opt-in paid gate, scripts/test-native-memory-off.mjs).
// Pure pieces live here so the free unit tests cover them: per-arm launch
// construction (control = the product launch minus only its memory
// switches; experiment = the product launch), file/database snapshots,
// their difference, and the verdict. A control arm that writes no memory
// makes the experiment unprovable ("insensitive"), never a pass.
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { claudeNativeArgs } from "./claude-usage.mjs";
import {
  providerLaunchSwitches,
  providerMemoryConfig,
} from "../../packages/agent-host/src/provider-launch-arguments.js";

export const MEMORY_PROMPT =
  "Please remember for future sessions: I prefer tabs for indentation. Save this to your memory.";
// Codex generates memories from idle past threads at a later session start;
// this second, trivial turn (new thread, same arm) is that later start.
export const CODEX_FOLLOWUP_PROMPT = "Reply with exactly: OK";
export const ARMS = Object.freeze(["control", "experiment"]);
export const CLAUDE_MEMORY_ENV = "CLAUDE_CODE_DISABLE_AUTO_MEMORY";
const EXCERPT = 160;

const assertArm = (arm) => {
  if (!ARMS.includes(arm)) throw new Error(`Unknown arm ${arm}`);
};

// Claude Code 2.1.282 project bucket: the absolute (canonical) project path
// with every non-alphanumeric character replaced by "-". Longer names are
// shortened with a hash by the CLI, so the gate refuses them.
export function claudeProjectBucket(canonicalCwd) {
  if (!canonicalCwd.startsWith("/")) throw new Error("Absolute cwd required");
  const bucket = canonicalCwd.replace(/[^a-zA-Z0-9]/gu, "-");
  if (bucket.length > 180)
    throw new Error("Claude project path too long for a stable bucket name");
  return bucket;
}

// One `claude -p` turn with the product's process-only isolation switches;
// the control arm differs only by the missing memory environment switch
// (and removes an inherited one).
export function claudeArmLaunch({ arm, model, effort, prompt, environment }) {
  assertArm(arm);
  const policy = providerLaunchSwitches("claude");
  if (policy.environment[CLAUDE_MEMORY_ENV] !== "1")
    throw new Error("Product Claude memory switch changed; update the gate");
  const env = { ...environment, ...policy.environment };
  if (arm === "control") delete env[CLAUDE_MEMORY_ENV];
  return {
    args: [...claudeNativeArgs({ model, effort, prompt }), ...policy.args],
    env,
  };
}

const codexMemoryKeys = () =>
  new Set(Object.keys(providerMemoryConfig("codex")));

// Removes exactly the `-c <memory key>=...` pairs; everything else stays.
export function withoutCodexMemorySwitches(args) {
  const keys = codexMemoryKeys();
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-c" && keys.has(String(args[i + 1]).split("=")[0])) {
      i += 1;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

// `policyArgs`: providerLaunchPolicy("codex", env, {cwd}).args for this arm's
// CODEX_HOME. Thread config mirrors the product driver's thread/start.
export function codexArmLaunch({ arm, policyArgs, effort }) {
  assertArm(arm);
  const keys = codexMemoryKeys();
  for (const key of keys)
    if (!policyArgs.includes(`${key}=false`))
      throw new Error(`Product Codex launch lacks ${key}=false`);
  const args =
    arm === "control" ? withoutCodexMemorySwitches(policyArgs) : policyArgs;
  return {
    args: ["app-server", ...args],
    threadConfig: {
      ...(arm === "experiment" ? providerMemoryConfig("codex") : {}),
      model_reasoning_effort: effort,
    },
  };
}

// The arm's temporary CODEX_HOME config: a user who turned memories on
// (Codex 0.156.1 ships `memories` off by default), with generation allowed
// right away and every memory model pinned to the approved one. Both arms
// get it, so the experiment proves the product switches override it.
export function codexHomeConfigToml(model) {
  if (!/^[\w.\-/]+$/u.test(model)) throw new Error("Unexpected model id");
  return [
    "[features]",
    "memories = true",
    "",
    "[memories]",
    "generate_memories = true",
    "use_memories = true",
    "min_rollout_idle_hours = 0",
    `extract_model = "${model}"`,
    `consolidation_model = "${model}"`,
    "",
  ].join("\n");
}

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

// Regular files below `dir`: size, sha256 and a short excerpt. Symlinks are
// recorded, never followed.
export function snapshotTree(dir) {
  if (!existsSync(dir)) return { exists: false, files: {} };
  const files = {};
  const walk = (at) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      const stat = lstatSync(path);
      const rel = relative(dir, path);
      if (stat.isSymbolicLink()) files[rel] = { symlink: true };
      else if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) {
        const body = readFileSync(path);
        files[rel] = {
          size: stat.size,
          sha256: sha256(body),
          excerpt: body.toString("utf8", 0, EXCERPT),
        };
      }
    }
  };
  walk(dir);
  return { exists: true, files };
}

export function diffTree(before, after) {
  const added = [];
  const modified = [];
  const removed = [];
  for (const [rel, file] of Object.entries(after.files))
    if (!(rel in before.files)) added.push(rel);
    else if (before.files[rel].sha256 !== file.sha256) modified.push(rel);
  for (const rel of Object.keys(before.files))
    if (!(rel in after.files)) removed.push(rel);
  return {
    added: added.sort(),
    modified: modified.sort(),
    removed: removed.sort(),
  };
}

export const treeChanged = (d) => d.added.length + d.modified.length > 0;

// memories_1.sqlite row counts (read-only; absent file or table is 0).
export function snapshotCodexMemoryDb(path) {
  if (!existsSync(path))
    return { exists: false, stage1Outputs: 0, jobs: 0, jobKinds: {} };
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((r) => r.name),
    );
    const count = (table) =>
      tables.has(table)
        ? Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n)
        : 0;
    const jobKinds = tables.has("jobs")
      ? Object.fromEntries(
          db
            .prepare(
              "SELECT kind || ':' || status AS k, count(*) AS n FROM jobs GROUP BY kind, status",
            )
            .all()
            .map((r) => [r.k, Number(r.n)]),
        )
      : {};
    const excerpts = tables.has("stage1_outputs")
      ? db
          .prepare(
            "SELECT thread_id, substr(raw_memory, 1, ?) AS raw FROM stage1_outputs ORDER BY generated_at",
          )
          .all(EXCERPT)
          .map((r) => ({ threadId: r.thread_id, rawExcerpt: r.raw }))
      : [];
    return {
      exists: true,
      stage1Outputs: count("stage1_outputs"),
      jobs: count("jobs"),
      jobKinds,
      stage1Excerpts: excerpts,
    };
  } finally {
    db.close();
  }
}

export function diffCodexMemoryDb(before, after) {
  return {
    stage1Outputs: after.stage1Outputs - before.stage1Outputs,
    jobs: after.jobs - before.jobs,
  };
}

// The arm's memory signal. Claude: any new or changed file in the arm's
// bucket memory directory. Codex: memory content (new memory files or
// stage1 rows) versus a pipeline that only started (job rows).
export function armSignal(provider, diff) {
  if (provider === "claude") {
    const wrote = treeChanged(diff.memoryDir);
    return { wroteMemory: wrote, memoryActivity: wrote };
  }
  const content =
    treeChanged(diff.memoriesDir) || diff.memoryDb.stage1Outputs > 0;
  return {
    wroteMemory: content,
    memoryActivity: content || diff.memoryDb.jobs > 0,
  };
}

// arm: {ok, error?, diff}. Returns {verdict, reason}; verdict is one of
// pass | fail | insensitive | inconclusive. The experiment fails on any
// memory activity (a started pipeline included); the control proves
// sensitivity only with memory content.
export function judgeProvider(provider, { control, experiment }) {
  if (!control?.ok)
    return {
      verdict: "inconclusive",
      reason: `control arm did not complete: ${control?.error ?? "not run"}`,
    };
  const controlSignal = armSignal(provider, control.diff);
  if (!controlSignal.wroteMemory)
    return {
      verdict: "insensitive",
      reason: controlSignal.memoryActivity
        ? "control started the memory pipeline but produced no memory; the test is insensitive and cannot prove the switch"
        : "control wrote no native memory; the test is insensitive and cannot prove the switch",
    };
  if (!experiment?.ok)
    return {
      verdict: "inconclusive",
      reason: `experiment arm did not complete: ${experiment?.error ?? "not run"}`,
    };
  const experimentSignal = armSignal(provider, experiment.diff);
  if (experimentSignal.memoryActivity)
    return {
      verdict: "fail",
      reason:
        "native memory activity under the product switches (" +
        (experimentSignal.wroteMemory
          ? "memory written"
          : "memory pipeline started") +
        ")",
    };
  return {
    verdict: "pass",
    reason:
      "control wrote native memory; the same launch with the product switches wrote none",
  };
}

export function overallVerdict(verdicts, violations = []) {
  if (violations.length) return "guard-violation";
  const values = Object.values(verdicts).map((v) => v.verdict);
  if (!values.length) return "inconclusive";
  for (const v of ["fail", "inconclusive", "insensitive"])
    if (values.includes(v)) return v;
  return "pass";
}

// Models/efforts recorded in Codex rollouts under a CODEX_HOME (main turns
// and any background memory threads it recorded).
export function codexRolloutModels(codexHome) {
  const out = [];
  const tree = snapshotTreePaths(join(codexHome, "sessions"));
  for (const path of tree) {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (!line.includes('"turn_context"')) continue;
      try {
        const e = JSON.parse(line);
        if (e.type === "turn_context")
          out.push({
            file: relative(codexHome, path),
            model: e.payload?.model ?? null,
            effort: e.payload?.effort ?? null,
          });
      } catch {
        // Diagnostics only; a torn line is ignored.
      }
    }
  }
  return out;
}

function snapshotTreePaths(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (at) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      const stat = lstatSync(path);
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile() && name.endsWith(".jsonl")) out.push(path);
    }
  };
  walk(dir);
  return out;
}

// Every recorded model must be the approved one; efforts other than the
// approved one are returned for the report (background memory calls are
// not under the gate's effort control).
export function checkCodexRolloutModels(records, approved) {
  return {
    violations: records.filter((r) => r.model !== approved.model),
    otherEfforts: records.filter(
      (r) => r.model === approved.model && r.effort !== approved.effort,
    ),
  };
}

// A refreshed login written over the symlink target is fine; a replaced
// symlink means the temporary home now holds the newer token.
export function codexAuthLinkState(codexHome, realAuth) {
  const path = join(codexHome, "auth.json");
  if (!existsSync(path)) return { state: "missing" };
  const stat = lstatSync(path);
  if (!stat.isSymbolicLink()) return { state: "replaced", path };
  return realpathSync(path) === realpathSync(realAuth)
    ? { state: "linked" }
    : { state: "retargeted", path };
}

// argv: --paid (required), --provider=claude|codex|all, --no-codex-followup,
// --codex-wait-seconds=N (1..900, default 180).
export function parseNativeMemoryArgs(argv) {
  if (!argv.includes("--paid"))
    throw new Error("Requires explicit --paid and owner authorization");
  const options = { providers: ["claude", "codex"], codexFollowup: true };
  options.codexWaitSeconds = 180;
  for (const a of argv) {
    if (a === "--paid") continue;
    else if (a === "--no-codex-followup") options.codexFollowup = false;
    else if (a.startsWith("--provider=")) {
      const v = a.slice("--provider=".length);
      if (v === "all") options.providers = ["claude", "codex"];
      else if (v === "claude" || v === "codex") options.providers = [v];
      else throw new Error(`Unknown provider ${v}`);
    } else if (a.startsWith("--codex-wait-seconds=")) {
      const n = Number(a.slice("--codex-wait-seconds=".length));
      if (!Number.isInteger(n) || n < 1 || n > 900)
        throw new Error("--codex-wait-seconds must be an integer 1..900");
      options.codexWaitSeconds = n;
    } else throw new Error(`Unknown argument ${a}`);
  }
  return options;
}

// Model turns the run may start (background Codex memory extraction and
// consolidation calls come on top and are reported from the rollouts).
export function plannedTurns(options) {
  const perArm = { claude: 1, codex: options.codexFollowup ? 2 : 1 };
  return options.providers.reduce((n, p) => n + perArm[p] * ARMS.length, 0);
}

// After the control arm: run the experiment only when the control proved
// the test sensitive (a paid experiment without it proves nothing).
export function controlGate(provider, control) {
  const verdict = judgeProvider(provider, {
    control,
    experiment: { ok: true, diff: control?.diff },
  });
  return verdict.verdict === "insensitive" || verdict.verdict === "inconclusive"
    ? { proceed: false, reason: verdict.reason }
    : { proceed: true };
}
