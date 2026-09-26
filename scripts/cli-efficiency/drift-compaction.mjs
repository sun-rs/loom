// Forced native compaction for the paid drift gate (test-only hooks; the
// product never forces compaction). Every request is validated by the same
// exact-model guard as the runtime before it leaves this process.
//
//   codex warm:     a second WebSocket client on the warm runtime's socket,
//                   which the guarded shim's proxy serves (so the fence sees
//                   it), sends `thread/compact/start` while the runtime idles.
//   codex per-turn: after the round's run exited, a short-lived
//                   `codex app-server` (stdio) resumes the same thread with
//                   the approved model/effort, compacts, and exits before the
//                   next round (a lingering writer would make the product
//                   start a new session).
//   kimi:           a short-lived `kimi acp` resumes the session and sends the
//                   ACP builtin `/compact` (no LLM turn is started for the
//                   command itself; the summarization does call the model).
//   claude per-turn: a short-lived `claude -p /compact --resume <session>`
//                   (the documented SDK/print-mode slash command) with the
//                   approved --model/--effort, after the round's run exited;
//                   observed by the `system/compact_boundary` frame and the
//                   transcript's compact_boundary record.
//   claude warm:    the guarded shim (claude-guard.mjs) injects `/compact` as
//                   a stream-json user message into the idle warm process;
//                   its frames never reach the product driver.
//   opencode per-turn: after the round's run exited, a short-lived
//                   `opencode serve` (the approved compaction reasoning in
//                   its config) receives the native `POST
//                   /session/:id/summarize` with the approved model;
//                   observed by the new finished compaction assistant.
//   opencode warm:  the guarded shim (drift-opencode-guard.mjs) sends the
//                   same summarize to the idle warm serve; the session's
//                   events never reach the product driver.
import { spawn } from "node:child_process";
import { globSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { connectUnixWebSocket } from "../../packages/agent-host/src/unix-websocket.mjs";
import {
  providerLaunchPolicy,
  providerLaunchSwitches,
} from "../../packages/agent-host/src/provider-launch-arguments.js";
import { countCodexCompactions } from "./drift-checks.mjs";
import { sleep } from "./common.mjs";
import {
  classifyClaudeLaunch,
  requestClaudeInjection,
} from "./claude-guard.mjs";
import {
  claudeTranscriptRound,
  parseClaudeStreamRound,
} from "./claude-usage.mjs";
import { nativeEnvironment, runLines } from "./cli-process.mjs";
import { readClaudeTranscript, readKimiWire } from "./provider-files.mjs";
import { kimiWireCompactions } from "./kimi-usage.mjs";
import {
  allocateLoopbackPort,
  assertOpenCodeServerConfig,
  openCodeSessionDirectory,
  openCodeSummarize,
  requestOpenCodeCompaction,
  waitForOpenCodeConfig,
  withCompactionOptions,
} from "./drift-opencode-guard.mjs";

const COMPACTION_TIMEOUT_MS = 240_000;

const cleanEnv = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !k.startsWith("RAH_") && !k.startsWith("LOOM_"),
    ),
  );

// Count of rollout compaction records (types only; no content is read out).
export function codexRolloutCompactions(threadId) {
  const home = process.env.CODEX_HOME ?? join(homedir(), ".codex");
  const paths = globSync(join(home, "sessions/**/*" + threadId + "*.jsonl"));
  if (paths.length !== 1) return null;
  const events = readFileSync(paths[0], "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return {};
      }
    });
  return countCodexCompactions(events);
}

// JSON-RPC client over either transport; `validate` runs before each send.
function rpcClient({ write, validate }) {
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  return {
    request(method, params, timeoutMs = 60_000) {
      const message = { jsonrpc: "2.0", id: ++id, method, params };
      validate(message);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(message.id);
          reject(new Error(`${method} timed out`));
        }, timeoutMs);
        pending.set(message.id, { resolve, reject, timer, method });
        write(JSON.stringify(message));
      });
    },
    notify(method, params) {
      const message = { jsonrpc: "2.0", method, params };
      validate(message);
      write(JSON.stringify(message));
    },
    respond(id, error) {
      write(JSON.stringify({ jsonrpc: "2.0", id, error }));
    },
    onNotification(fn) {
      listeners.add(fn);
    },
    handle(text) {
      let m;
      try {
        m = JSON.parse(text);
      } catch {
        return;
      }
      if (m.id !== undefined && m.method === undefined) {
        const p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        clearTimeout(p.timer);
        if (m.error)
          p.reject(
            new Error(`${p.method}: ${String(m.error.message ?? "error")}`),
          );
        else p.resolve(m.result);
        return;
      }
      for (const fn of listeners) fn(m);
    },
    failAll(error) {
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(error);
      }
      pending.clear();
    },
  };
}

function codexCompactionWatcher(client, threadId) {
  const seen = {
    itemCompleted: false,
    threadCompacted: false,
    turnStarted: false,
    turnCompleted: false,
  };
  client.onNotification((m) => {
    const p = m.params ?? {};
    if (p.threadId !== undefined && p.threadId !== threadId) return;
    if (m.method === "thread/compacted") seen.threadCompacted = true;
    if (m.method === "item/completed" && p.item?.type === "contextCompaction")
      seen.itemCompleted = true;
    if (m.method === "turn/started") seen.turnStarted = true;
    if (m.method === "turn/completed") seen.turnCompleted = true;
  });
  return seen;
}

async function awaitCodexCompaction(seen, threadId, before, timeoutMs) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const notified = seen.itemCompleted || seen.threadCompacted;
    const rollout = codexRolloutCompactions(threadId);
    const grew = rollout !== null && before !== null && rollout > before;
    if ((notified || grew) && (!seen.turnStarted || seen.turnCompleted))
      return { notified, rolloutAfter: rollout };
    if (Date.now() > end)
      return { notified, rolloutAfter: rollout, timedOut: true };
    await sleep(250);
  }
}

const INIT = {
  clientInfo: {
    name: "loom-drift-gate",
    title: "Loom drift gate",
    version: "1",
  },
  capabilities: { experimentalApi: true },
};
const resumeParams = ({ threadId, model, effort, cwd }) => ({
  threadId,
  model,
  config: {
    ...Object.fromEntries(
      // The product's boolean process switches as thread config; the
      // non-boolean isolation switches and MCP disables stay process-level.
      providerLaunchSwitches("codex")
        .args.filter((a) => a !== "-c" && a.endsWith("=false"))
        .map((a) => [a.split("=")[0], false]),
    ),
    model_reasoning_effort: effort,
  },
  approvalPolicy: "never",
  sandbox: "read-only",
  excludeTurns: true,
  ...(cwd ? { cwd } : {}),
});

export async function compactCodexWarm({
  socketPath,
  threadId,
  model,
  effort,
  validate,
  timeoutMs = COMPACTION_TIMEOUT_MS,
}) {
  const started = Date.now();
  const before = codexRolloutCompactions(threadId);
  const connection = await connectUnixWebSocket(socketPath);
  const client = rpcClient({ write: (t) => connection.send(t), validate });
  connection.onMessage = (text) => client.handle(text);
  connection.onClose = () => client.failAll(new Error("warm socket closed"));
  const seen = codexCompactionWatcher(client, threadId);
  const record = {
    mechanism: "codex-warm:thread/compact/start via guarded socket",
    forced: true,
    rolloutBefore: before,
  };
  try {
    await client.request("initialize", INIT);
    client.notify("initialized", {});
    try {
      await client.request("thread/compact/start", { threadId });
    } catch (error) {
      // The runtime owns the loaded thread; subscribe this connection with
      // the exact approved model/effort and retry once.
      record.resumedFirst = String(error.message).slice(0, 200);
      await client.request(
        "thread/resume",
        resumeParams({ threadId, model, effort }),
      );
      await client.request("thread/compact/start", { threadId });
    }
    const outcome = await awaitCodexCompaction(
      seen,
      threadId,
      before,
      timeoutMs,
    );
    Object.assign(record, outcome, {
      turn: { started: seen.turnStarted, completed: seen.turnCompleted },
    });
  } catch (error) {
    record.error = String(error.message ?? error).slice(0, 300);
  } finally {
    connection.close();
  }
  record.durationMs = Date.now() - started;
  record.observed = Boolean(
    record.notified || (record.rolloutAfter ?? 0) > (before ?? Infinity),
  );
  return record;
}

function spawnStdio(executable, args, cwd) {
  const child = spawn(executable, args, {
    cwd,
    env: cleanEnv(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  let stderr = "";
  const exited = new Promise((resolve) =>
    child.once("close", (code, signal) => resolve({ code, signal })),
  );
  child.stdin.on("error", () => {});
  child.stderr.on("data", (b) => (stderr = (stderr + b).slice(-2000)));
  return {
    child,
    exited,
    stderr: () => stderr,
    lines(fn) {
      child.stdout.on("data", (chunk) => {
        buffer += chunk;
        let n;
        while ((n = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, n);
          buffer = buffer.slice(n + 1);
          fn(line);
        }
      });
    },
    async stop() {
      child.stdin.end();
      const kill = setTimeout(() => child.kill("SIGTERM"), 3000);
      const hard = setTimeout(() => child.kill("SIGKILL"), 8000);
      const status = await exited;
      clearTimeout(kill);
      clearTimeout(hard);
      return status;
    },
  };
}

export async function compactCodexPerTurn({
  codex,
  cwd,
  threadId,
  model,
  effort,
  validate,
  timeoutMs = COMPACTION_TIMEOUT_MS,
}) {
  const started = Date.now();
  const before = codexRolloutCompactions(threadId);
  const proc = spawnStdio(
    codex,
    [
      "app-server",
      ...providerLaunchPolicy("codex", process.env, {
        codexExecutable: codex,
        cwd,
      }).args,
    ],
    cwd,
  );
  const client = rpcClient({
    write: (t) => proc.child.stdin.write(t + "\n"),
    validate,
  });
  proc.lines((line) => client.handle(line));
  void proc.exited.then(() =>
    client.failAll(new Error("codex app-server exited")),
  );
  const seen = codexCompactionWatcher(client, threadId);
  const record = {
    mechanism: "codex-per-turn:thread/compact/start via short-lived app-server",
    forced: true,
    rolloutBefore: before,
  };
  try {
    await client.request("initialize", INIT);
    client.notify("initialized", {});
    const resumed = await client.request(
      "thread/resume",
      resumeParams({ threadId, model, effort, cwd }),
    );
    if (resumed?.thread?.id !== threadId)
      throw new Error("thread/resume returned a different thread");
    await client.request("thread/compact/start", { threadId });
    Object.assign(
      record,
      await awaitCodexCompaction(seen, threadId, before, timeoutMs),
      {
        turn: { started: seen.turnStarted, completed: seen.turnCompleted },
      },
    );
  } catch (error) {
    record.error = String(error.message ?? error).slice(0, 300);
    if (proc.stderr()) record.stderrTail = proc.stderr().slice(-300);
  } finally {
    record.exit = await proc.stop();
  }
  // The writer is gone; the rollout now holds the final compaction record.
  record.rolloutAfter = codexRolloutCompactions(threadId);
  record.durationMs = Date.now() - started;
  record.observed = Boolean(
    record.notified || (record.rolloutAfter ?? 0) > (before ?? Infinity),
  );
  return record;
}

// Kimi `/usage` text: "Context: N / M tokens (x%)" or "Context: N tokens".
export function parseKimiContextTokens(text) {
  const m = /Context:\s*([\d,]+)/u.exec(String(text));
  return m ? Number(m[1].replace(/,/gu, "")) : null;
}
export function parseKimiCompaction(text) {
  const s = String(text);
  const num = (label) => {
    const m = new RegExp(`${label}:\\s*([\\d,]+)`, "u").exec(s);
    return m ? Number(m[1].replace(/,/gu, "")) : null;
  };
  return {
    completed: /Compaction completed/u.test(s),
    background: /runs in the background/u.test(s),
    alreadyRunning: /already running/u.test(s),
    blocked: /blocked|not started|failed|cancelled/iu.test(s),
    tokensBefore: num("Tokens before"),
    tokensAfter: num("Tokens after"),
  };
}

// Observed: the reply said completed, the session wire holds a completed
// native compaction since the request (the durable proof; kimi-code 0.39
// runs `/compact` in the background and its `/usage` after the compaction is
// a rebased estimate that can exceed the measured count before), or `/usage`
// dropped. None of these → not observed; an unreadable wire proves nothing.
export function kimiCompactionObserved(record, wireCompactions = []) {
  return Boolean(
    record.reply?.completed ||
    wireCompactions.some((c) => c.completed) ||
    (record.contextBefore !== null &&
      record.contextBefore !== undefined &&
      record.contextAfter !== null &&
      record.contextAfter !== undefined &&
      record.contextAfter < record.contextBefore),
  );
}

export async function compactKimi({
  kimi,
  cwd,
  sessionId,
  model,
  effort,
  validate,
  timeoutMs = COMPACTION_TIMEOUT_MS,
  readWire = () => readKimiWire(sessionId),
}) {
  const started = Date.now();
  const since = new Date(started).toISOString();
  const wireCompactions = () => {
    try {
      return kimiWireCompactions(readWire(), { from: since });
    } catch (error) {
      record.wireError = String(error.message ?? error).slice(0, 200);
      return [];
    }
  };
  const proc = spawnStdio(kimi, ["acp"], cwd);
  const client = rpcClient({
    write: (t) => proc.child.stdin.write(t + "\n"),
    validate,
  });
  proc.lines((line) => client.handle(line));
  void proc.exited.then(() => client.failAll(new Error("kimi acp exited")));
  let text = "";
  client.onNotification((m) => {
    if (m.id !== undefined && m.method) {
      // Agent → client requests (permissions, fs, terminal) are refused.
      client.respond(m.id, {
        code: -32601,
        message: "drift compaction client",
      });
      return;
    }
    const u = m.params?.update;
    if (
      m.method === "session/update" &&
      u?.sessionUpdate === "agent_message_chunk" &&
      u.content?.type === "text"
    )
      text += u.content.text;
  });
  const say = async (command) => {
    text = "";
    await client.request(
      "session/prompt",
      { sessionId, prompt: [{ type: "text", text: command }] },
      timeoutMs,
    );
    return text;
  };
  const record = {
    mechanism: "kimi-acp:/compact builtin via short-lived acp",
    forced: true,
  };
  try {
    const init = await client.request("initialize", {
      clientCapabilities: { terminal: false },
      clientInfo: { name: "loom-drift-gate", version: "1" },
      protocolVersion: 1,
    });
    const caps = init?.agentCapabilities?.sessionCapabilities;
    const canResume = Boolean(caps) && Object.hasOwn(caps, "resume");
    await client.request(canResume ? "session/resume" : "session/load", {
      sessionId,
      cwd,
      mcpServers: [],
    });
    await client.request("session/set_model", { modelId: model, sessionId });
    await client.request("session/set_config_option", {
      configId: "thinking",
      sessionId,
      value: effort,
    });
    record.contextBefore = parseKimiContextTokens(await say("/usage"));
    const reply = await say("/compact");
    record.reply = parseKimiCompaction(reply);
    record.contextAfter = null;
    const end = Date.now() + timeoutMs;
    // Background variant: poll the wire and `/usage` (local, no LLM turn)
    // until the wire records the completed compaction or the context drops.
    while (!record.reply.completed && Date.now() < end) {
      await sleep(3000);
      record.contextAfter = parseKimiContextTokens(await say("/usage"));
      if (kimiCompactionObserved(record, wireCompactions())) break;
    }
    if (record.reply.completed)
      record.contextAfter = parseKimiContextTokens(await say("/usage"));
  } catch (error) {
    record.error = String(error.message ?? error).slice(0, 300);
    if (proc.stderr()) record.stderrTail = proc.stderr().slice(-300);
  } finally {
    record.exit = await proc.stop();
  }
  record.durationMs = Date.now() - started;
  record.wireCompactions = wireCompactions();
  record.observed = kimiCompactionObserved(record, record.wireCompactions);
  return record;
}

// effort null: the effortless (Haiku) binding, launched without --effort.
export function claudeCompactArgs({ model, effort, sessionId }) {
  if (effort === undefined || effort === "")
    throw new Error("Claude compaction needs an effort (null for none)");
  return [
    "-p",
    "/compact",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    model,
    ...(effort === null ? [] : ["--effort", effort]),
    "--resume",
    sessionId,
  ];
}

// before/after: transcript compact_boundary counts (null = unreadable).
export function claudeCompactionOutcome({
  sessionId,
  sessionIds,
  boundaries,
  before,
  after,
}) {
  const grew = before !== null && after !== null && after > before;
  return {
    observed: boundaries.length > 0 || grew,
    boundary: boundaries.at(-1) ?? null,
    transcriptBefore: before,
    transcriptAfter: after,
    sessionChanged: sessionIds.some((id) => id !== sessionId),
  };
}

function claudeTranscriptState(sessionId) {
  try {
    const t = claudeTranscriptRound(readClaudeTranscript(sessionId));
    return { cwd: t.cwd, boundaries: t.compactBoundaries };
  } catch {
    return { cwd: undefined, boundaries: null };
  }
}

export async function compactClaudePerTurn({
  claude,
  cwd,
  sessionId,
  model,
  effort,
  timeoutMs = COMPACTION_TIMEOUT_MS,
}) {
  const started = Date.now();
  const before = claudeTranscriptState(sessionId);
  const record = {
    mechanism: "claude-per-turn:/compact via short-lived resumed print run",
    forced: true,
  };
  try {
    const args = claudeCompactArgs({ model, effort, sessionId });
    classifyClaudeLaunch(args, { model, effort });
    // The session belongs to the directory it was created in.
    const run = await runLines({
      executable: claude,
      args,
      cwd: before.cwd ?? cwd,
      env: nativeEnvironment({ CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" }),
      timeoutMs,
    });
    const parsed = parseClaudeStreamRound(run.entries);
    Object.assign(record, {
      exit: run.exit,
      timedOut: run.timedOut || undefined,
      result: parsed.result ?? null,
      ...claudeCompactionOutcome({
        sessionId,
        sessionIds: parsed.sessionIds,
        boundaries: parsed.compactBoundaries,
        before: before.boundaries,
        after: claudeTranscriptState(sessionId).boundaries,
      }),
    });
    if (run.exit !== 0 && run.stderr)
      record.stderrTail = run.stderr.slice(-300);
  } catch (error) {
    record.error = String(error.message ?? error).slice(0, 300);
    record.observed = false;
  }
  record.durationMs = Date.now() - started;
  return record;
}

export async function compactClaudeWarm({
  socketPath,
  sessionId,
  timeoutMs = COMPACTION_TIMEOUT_MS,
}) {
  const started = Date.now();
  const before = claudeTranscriptState(sessionId).boundaries;
  const record = {
    mechanism: "claude-warm:/compact injected into the idle warm runtime",
    forced: true,
  };
  try {
    let reply;
    // The warm runtime may still be closing the round's turn.
    for (let i = 0; i < 30; i++) {
      reply = await requestClaudeInjection(socketPath, "compact", timeoutMs);
      if (reply.refused !== "busy") break;
      await sleep(1000);
    }
    if (reply.refused || reply.error)
      throw new Error(reply.refused ?? reply.error);
    Object.assign(record, {
      result: reply.result,
      timedOut: reply.timedOut,
      framesDropped: reply.framesDropped,
      ...claudeCompactionOutcome({
        sessionId,
        sessionIds: [],
        boundaries: reply.compactBoundary ? [reply.compactBoundary] : [],
        before,
        after: claudeTranscriptState(sessionId).boundaries,
      }),
    });
  } catch (error) {
    record.error = String(error.message ?? error).slice(0, 300);
    record.observed = false;
  }
  record.durationMs = Date.now() - started;
  return record;
}

// A model-fence violation fails the gate instead of becoming a record error.
const rethrowUnapproved = (error) => {
  if (/Unapproved/u.test(String(error?.message ?? error))) throw error;
};

export async function compactOpenCodePerTurn({
  opencode,
  cwd,
  sessionId,
  model,
  effort,
  compactionOptions,
  validate,
  dbPath,
  timeoutMs = COMPACTION_TIMEOUT_MS,
}) {
  const started = Date.now();
  const record = {
    mechanism:
      "opencode-per-turn:POST /session/:id/summarize via short-lived serve",
    forced: true,
  };
  // The session belongs to the directory it was created in.
  let directory = cwd;
  try {
    directory = openCodeSessionDirectory(sessionId, dbPath) ?? cwd;
  } catch {
    // keep cwd; a wrong directory makes summarize fail visibly
  }
  const port = await allocateLoopbackPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const approved = { model, effort, compactionOptions };
  let child;
  const exited = { done: false };
  try {
    child = spawn(
      opencode,
      ["serve", "--pure", "--hostname", "127.0.0.1", "--port", String(port)],
      {
        cwd: directory,
        env: {
          ...cleanEnv(),
          OPENCODE_CONFIG_CONTENT: withCompactionOptions(
            process.env.OPENCODE_CONFIG_CONTENT,
            compactionOptions,
            model,
          ),
        },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.on("data", (b) => (stderr = (stderr + b).slice(-2000)));
    child.once("close", () => (exited.done = true));
    child.once("error", () => (exited.done = true));
    try {
      assertOpenCodeServerConfig(
        await waitForOpenCodeConfig(baseUrl, directory, { exited }),
        approved,
      );
      Object.assign(
        record,
        await openCodeSummarize({
          baseUrl,
          directory,
          sessionId,
          approved,
          validate,
          timeoutMs,
        }),
      );
    } catch (error) {
      rethrowUnapproved(error);
      record.error = String(error.message ?? error).slice(0, 300);
      if (stderr) record.stderrTail = stderr.slice(-300);
    }
  } finally {
    if (child && !exited.done) {
      const closed = new Promise((r) => child.once("close", r));
      child.kill("SIGTERM");
      const hard = setTimeout(() => child.kill("SIGKILL"), 8000);
      await closed;
      clearTimeout(hard);
    }
  }
  record.observed = Boolean(record.observed);
  record.durationMs = Date.now() - started;
  return record;
}

export async function compactOpenCodeWarm({
  socketPath,
  sessionId,
  timeoutMs = COMPACTION_TIMEOUT_MS,
}) {
  const started = Date.now();
  const record = {
    mechanism: "opencode-warm:summarize through the guarded warm serve",
    forced: true,
  };
  try {
    let reply;
    // The warm runtime may still be answering the round's prompt.
    for (let i = 0; i < 30; i++) {
      reply = await requestOpenCodeCompaction(socketPath, sessionId, timeoutMs);
      if (reply.refused !== "busy") break;
      await sleep(1000);
    }
    if (reply.refused || reply.error)
      throw new Error(reply.refused ?? reply.error);
    Object.assign(record, reply);
  } catch (error) {
    rethrowUnapproved(error);
    record.error = String(error.message ?? error).slice(0, 300);
  }
  record.observed = Boolean(record.observed);
  record.durationMs = Date.now() - started;
  return record;
}
