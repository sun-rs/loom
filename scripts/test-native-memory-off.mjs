// Opt-in paid gate: proves the product's native-memory switches keep Claude
// Code and Codex from writing their own persistent memory. Never included in
// npm run check. Per provider a control arm (the product launch minus only
// its memory switches) must write native memory first; otherwise the test is
// insensitive and proves nothing. The experiment arm (the product launch)
// then must write none. Approved models only (approved-models.mjs), every
// model process behind the existing guarded shims.
//
//   npm run test:cli:native-memory -- --paid [--provider=claude|codex|all]
//     [--no-codex-followup] [--codex-wait-seconds=180]
//
// Authentication without touching user files:
// - Claude: a temporary HOME loses the keychain login (`claude auth status`
//   reports loggedIn false), so both arms run under the real HOME, each in
//   its own new temporary cwd. Claude's project memory bucket
//   ~/.claude/projects/<cwd bucket>/memory is therefore unique to the arm;
//   it is snapshotted before and after, and every other bucket's memory
//   directory is snapshotted too (changes there are reported as
//   unattributed, e.g. the Human's own sessions).
// - Codex: each arm gets a temporary CODEX_HOME whose auth.json is a
//   symlink to the real one (a token refresh writes through the link; a
//   replaced link is reported with the remedy). Its config.toml turns
//   memories on as a user could (off by default in 0.156.1) and pins the
//   memory models to the approved one.
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { assertApprovedGateModel } from "./cli-efficiency/approved-models.mjs";
import {
  claudeModelMatches,
  parseClaudeStreamRound,
} from "./cli-efficiency/claude-usage.mjs";
import { nativeEnvironment, runLines } from "./cli-efficiency/cli-process.mjs";
import { sleep } from "./cli-efficiency/common.mjs";
import {
  codeProvenance,
  writeEvidence,
} from "./cli-efficiency/gate-evidence.mjs";
import {
  assertNoGuardViolations,
  writeGuardedShim,
} from "./cli-efficiency/guarded-shim.mjs";
import {
  ARMS,
  CODEX_FOLLOWUP_PROMPT,
  MEMORY_PROMPT,
  checkCodexRolloutModels,
  claudeArmLaunch,
  claudeProjectBucket,
  codexArmLaunch,
  codexAuthLinkState,
  codexHomeConfigToml,
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
  treeChanged,
} from "./cli-efficiency/native-memory.mjs";
import { providerLaunchPolicy } from "../packages/agent-host/src/provider-launch-arguments.js";

const options = parseNativeMemoryArgs(process.argv.slice(2));
const APPROVED = {
  claude: { provider: "claude", model: "haiku", effort: null },
  codex: { provider: "codex", model: "gpt-6-luna", effort: "low" },
};
for (const p of options.providers) assertApprovedGateModel(APPROVED[p]);

const which = (cli) =>
  execFileSync("which", [cli], { encoding: "utf8" }).trim();
const excerpt = (text, n = 200) =>
  typeof text === "string" ? text.slice(0, n) : null;
const root = realpathSync(mkdtempSync(join(tmpdir(), "loom-nmem-")));
const violations = [];
const result = {
  schemaVersion: 1,
  gate: "native-memory-off",
  root,
  startedAt: new Date().toISOString(),
  ...codeProvenance(),
  prompt: MEMORY_PROMPT,
  options,
  plannedModelTurns: plannedTurns(options),
  approved: Object.fromEntries(options.providers.map((p) => [p, APPROVED[p]])),
  cliVersions: Object.fromEntries(
    options.providers.map((p) => [
      p,
      execFileSync(p, ["--version"], { encoding: "utf8" }).trim(),
    ]),
  ),
  providers: {},
  violations,
  status: "running",
};
const save = () => writeEvidence(root, result);
console.log(
  `Native memory-off gate: ${options.providers.join(", ")}; at most ${result.plannedModelTurns} model turns (plus Codex background memory calls). Evidence: ${root}`,
);
save();

// --- Claude --------------------------------------------------------------

const claudeProjects = join(homedir(), ".claude", "projects");
// Every bucket's memory directory, flattened to "<bucket>/memory/<file>".
// Buckets under this run's temporary root are attributed to the running arm
// (arms run one at a time); the rest are reported as unattributed.
const rootBucket = claudeProjectBucket(root);
function claudeMemorySnapshot() {
  const attributed = { exists: true, files: {} };
  const other = { exists: true, files: {} };
  if (!existsSync(claudeProjects)) return { attributed, other };
  for (const bucket of readdirSync(claudeProjects)) {
    const tree = snapshotTree(join(claudeProjects, bucket, "memory"));
    const into = bucket.startsWith(rootBucket) ? attributed : other;
    for (const [rel, file] of Object.entries(tree.files))
      into.files[`${bucket}/memory/${rel}`] = file;
  }
  return { attributed, other };
}

async function claudeArm(arm) {
  const approved = APPROVED.claude;
  const dir = join(root, `claude-${arm}`);
  const cwd = join(dir, "cwd");
  mkdirSync(cwd, { recursive: true });
  const bucket = claudeProjectBucket(realpathSync(cwd));
  const memoryDir = join(claudeProjects, bucket, "memory");
  const record = { arm, cwd, bucket, memoryDir };
  try {
    if (existsSync(join(claudeProjects, bucket)))
      throw new Error("Claude project bucket already exists");
    const shim = writeGuardedShim({
      provider: "claude",
      path: join(dir, "claude-shim.mjs"),
      realCli: which("claude"),
      model: approved.model,
      effort: approved.effort,
    });
    const launch = claudeArmLaunch({
      arm,
      model: approved.model,
      effort: approved.effort,
      prompt: MEMORY_PROMPT,
      environment: nativeEnvironment(),
    });
    record.args = launch.args.filter((a) => a !== MEMORY_PROMPT);
    record.memoryEnv = launch.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY ?? null;
    const before = claudeMemorySnapshot();
    record.startedAt = new Date().toISOString();
    const run = await runLines({
      executable: shim,
      args: launch.args,
      cwd,
      env: launch.env,
    });
    record.finishedAt = new Date().toISOString();
    await sleep(3000);
    const after = claudeMemorySnapshot();
    const parsed = parseClaudeStreamRound(run.entries);
    const models = [
      ...parsed.models,
      ...parsed.subagentModels,
      ...parsed.resultModels,
    ];
    Object.assign(record, {
      exit: run.exit,
      timedOut: run.timedOut || undefined,
      stderrTail: excerpt(run.stderr, 600),
      sessionId: parsed.sessionId ?? null,
      models: [...new Set(models)],
      answerExcerpt: excerpt(parsed.answer),
      memoryBefore: before.attributed,
      memoryAfter: after.attributed,
      cwdFiles: snapshotTree(cwd),
      unattributedMemoryChanges: diffTree(before.other, after.other),
      diff: { memoryDir: diffTree(before.attributed, after.attributed) },
    });
    for (const m of models)
      if (!claudeModelMatches(approved.model, m))
        violations.push(`claude ${arm}: unapproved model ${m}`);
    try {
      assertNoGuardViolations(shim);
    } catch (e) {
      violations.push(`claude ${arm}: ${e.message}`);
    }
    if (/PAID_GATE_MODEL_DENIED/u.test(run.stderr))
      violations.push(`claude ${arm}: guard denied the launch`);
    if (run.exit !== 0 || !parsed.result || parsed.result.isError)
      throw new Error(`Claude turn failed (exit ${run.exit})`);
    if (!models.length) throw new Error("No Claude model evidence");
    record.ok = true;
  } catch (e) {
    record.ok = false;
    record.error = String(e.message ?? e).slice(0, 400);
  }
  return record;
}

// --- Codex ---------------------------------------------------------------

// One guarded `codex app-server` (stdio): a thread, one turn, then an
// optional hold while the process stays alive (memory jobs run inside it).
async function codexSession({ shim, launch, env, cwd, prompt, hold }) {
  const approved = APPROVED.codex;
  const child = spawn(shim, launch.args, {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const out = { pid: child.pid, stderr: "" };
  child.stdin.on("error", () => {});
  child.once("error", (e) => (out.spawnError = String(e.message)));
  child.stderr.on("data", (b) => (out.stderr = (out.stderr + b).slice(-1500)));
  const pending = new Map();
  const closed = new Promise((resolve) => child.once("close", resolve));
  // Requests still open when the process exits end quietly (the race above
  // them already reported the exit).
  void closed.then(() => {
    for (const p of pending.values()) clearTimeout(p.timer);
    pending.clear();
  });
  let id = 0;
  let threadId;
  let turnDone;
  const turnCompleted = new Promise((resolve) => (turnDone = resolve));
  const write = (m) => child.stdin.write(JSON.stringify(m) + "\n");
  const request = (method, params, ms = 60_000) =>
    new Promise((resolve, reject) => {
      const rid = ++id;
      const timer = setTimeout(
        () => reject(new Error(`${method} timed out`)),
        ms,
      );
      pending.set(rid, { resolve, reject, timer, method });
      write({ jsonrpc: "2.0", id: rid, method, params });
    });
  createInterface({ input: child.stdout }).on("line", (line) => {
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    if (m.id !== undefined && m.method === undefined) {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.error) p.reject(new Error(`${p.method}: ${m.error.message}`));
      else p.resolve(m.result);
      return;
    }
    // Server requests (approvals): refused; approvalPolicy is never.
    if (m.id !== undefined)
      return write({
        jsonrpc: "2.0",
        id: m.id,
        error: { code: -32601, message: "not supported by the gate" },
      });
    const p = m.params ?? {};
    if (threadId && p.threadId !== undefined && p.threadId !== threadId) return;
    if (m.method === "item/completed" && p.item?.type === "agentMessage")
      out.answer = p.item.text;
    if (m.method === "turn/completed") {
      out.turnStatus = p.turn?.status ?? null;
      turnDone();
    }
  });
  try {
    const exitedEarly = closed.then(() => {
      throw new Error("codex app-server exited");
    });
    // Handled here too: the normal close at the end must not surface as an
    // unhandled rejection.
    exitedEarly.catch(() => {});
    const race = (promise) => Promise.race([promise, exitedEarly]);
    await race(
      request("initialize", {
        capabilities: { experimentalApi: true },
        clientInfo: {
          name: "loom-native-memory-gate",
          title: "Loom",
          version: "1",
        },
      }),
    );
    write({ jsonrpc: "2.0", method: "initialized", params: {} });
    const started = await race(
      request("thread/start", {
        model: approved.model,
        config: launch.threadConfig,
        approvalPolicy: "never",
        cwd,
        sandbox: "workspace-write",
      }),
    );
    threadId = started?.thread?.id;
    if (!threadId) throw new Error("thread/start returned no thread.id");
    out.threadId = threadId;
    await race(
      request("turn/start", {
        threadId,
        input: [{ type: "text", text: prompt }],
        effort: approved.effort,
      }),
    );
    let turnTimer;
    const timeout = new Promise((_, reject) => {
      turnTimer = setTimeout(
        () => reject(new Error("turn timed out")),
        240_000,
      );
    });
    try {
      await race(Promise.race([turnCompleted, timeout]));
    } finally {
      clearTimeout(turnTimer);
    }
    if (out.turnStatus !== "completed")
      throw new Error(`turn ended ${out.turnStatus}`);
    if (hold) {
      const end = Date.now() + hold.ms;
      out.holdStartedAt = new Date().toISOString();
      while (Date.now() < end && !hold.until()) await sleep(2000);
      out.holdEndedAt = new Date().toISOString();
    }
    out.ok = true;
  } catch (e) {
    out.ok = false;
    out.error = String(e.message ?? e).slice(0, 300);
  } finally {
    child.stdin.end();
    const killer = setTimeout(() => child.kill("SIGTERM"), 15_000);
    await closed;
    clearTimeout(killer);
  }
  if (/PAID_GATE_MODEL_DENIED/u.test(out.stderr))
    violations.push(`codex: guard denied a request (${excerpt(out.stderr)})`);
  out.answer = excerpt(out.answer);
  out.stderr = excerpt(out.stderr, 600);
  return out;
}

const realCodexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
const realCodexAuth = join(realCodexHome, "auth.json");

async function codexArm(arm) {
  const approved = APPROVED.codex;
  const dir = join(root, `codex-${arm}`);
  const cwd = join(dir, "cwd");
  const codexHome = join(dir, "codex-home");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(codexHome, { recursive: true });
  const record = { arm, cwd, codexHome };
  const memoryState = () => ({
    memoriesDir: snapshotTree(join(codexHome, "memories")),
    memoryDb: snapshotCodexMemoryDb(join(codexHome, "memories_1.sqlite")),
  });
  try {
    if (!existsSync(realCodexAuth)) throw new Error("No Codex auth.json");
    writeFileSync(
      join(codexHome, "config.toml"),
      codexHomeConfigToml(approved.model),
    );
    symlinkSync(realCodexAuth, join(codexHome, "auth.json"));
    const realCli = which("codex");
    const env = nativeEnvironment({ CODEX_HOME: codexHome });
    const launch = codexArmLaunch({
      arm,
      effort: approved.effort,
      policyArgs: providerLaunchPolicy("codex", env, {
        cwd,
        codexExecutable: realCli,
      }).args,
    });
    record.args = launch.args;
    record.threadConfig = launch.threadConfig;
    const shim = writeGuardedShim({
      provider: "codex",
      path: join(dir, "codex-shim.mjs"),
      realCli,
      model: approved.model,
      effort: approved.effort,
    });
    const before = memoryState();
    record.memoryBefore = before;
    // The control may stop waiting once memory files exist; the experiment
    // always waits the whole window (absence needs the full window).
    const hold = {
      ms: options.codexWaitSeconds * 1000,
      until: () =>
        arm === "control" &&
        treeChanged(diffTree(before.memoriesDir, memoryState().memoriesDir)),
    };
    record.sessions = [];
    const first = await codexSession({
      shim,
      launch,
      env,
      cwd,
      prompt: MEMORY_PROMPT,
      hold: options.codexFollowup ? undefined : hold,
    });
    record.sessions.push(first);
    if (first.ok && options.codexFollowup)
      record.sessions.push(
        await codexSession({
          shim,
          launch,
          env,
          cwd,
          prompt: CODEX_FOLLOWUP_PROMPT,
          hold,
        }),
      );
    await sleep(2000);
    const after = memoryState();
    record.memoryAfter = after;
    record.cwdFiles = snapshotTree(cwd);
    record.diff = {
      memoriesDir: diffTree(before.memoriesDir, after.memoriesDir),
      memoryDb: diffCodexMemoryDb(before.memoryDb, after.memoryDb),
    };
    record.rolloutModels = codexRolloutModels(codexHome);
    const models = checkCodexRolloutModels(record.rolloutModels, approved);
    record.otherEfforts = models.otherEfforts;
    for (const v of models.violations)
      violations.push(`codex ${arm}: unapproved model ${v.model} in ${v.file}`);
    record.authLink = codexAuthLinkState(codexHome, realCodexAuth);
    if (record.authLink.state !== "linked")
      record.authRemedy = `Codex replaced the auth.json symlink (${record.authLink.state}); if the real login stops working, copy ${join(codexHome, "auth.json")} over ${realCodexAuth} after review, or run codex login`;
    const failed = record.sessions.find((s) => !s.ok);
    if (failed) throw new Error(`Codex session failed: ${failed.error}`);
    record.ok = true;
  } catch (e) {
    record.ok = false;
    record.error = String(e.message ?? e).slice(0, 400);
  }
  return record;
}

// --- Run -----------------------------------------------------------------

const runners = { claude: claudeArm, codex: codexArm };
for (const provider of options.providers) {
  const arms = {};
  result.providers[provider] = { arms };
  for (const arm of ARMS) {
    console.log(`${provider} ${arm} ...`);
    arms[arm] = await runners[provider](arm);
    save();
    // Without a sensitive control the experiment proves nothing; skip it.
    const gate = arm === "control" && controlGate(provider, arms.control);
    if (gate && !gate.proceed) {
      result.providers[provider].experimentSkipped = gate.reason;
      break;
    }
  }
  result.providers[provider].verdict = judgeProvider(provider, arms);
  console.log(
    `${provider}: ${result.providers[provider].verdict.verdict} — ${result.providers[provider].verdict.reason}`,
  );
  save();
}
result.status = overallVerdict(
  Object.fromEntries(
    Object.entries(result.providers).map(([p, r]) => [p, r.verdict]),
  ),
  violations,
);
result.finishedAt = new Date().toISOString();
const paths = save();
console.log(`Overall: ${result.status}`);
for (const v of violations) console.log(`Violation: ${v}`);
console.log(`Evidence: ${paths.redactedPath}`);
process.exitCode = result.status === "pass" ? 0 : 1;
