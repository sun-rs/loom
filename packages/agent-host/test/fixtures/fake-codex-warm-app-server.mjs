#!/usr/bin/env node
// FAKE Codex app-server for S2-a warm-runtime tests. Not a model and not the
// real Codex protocol implementation: it speaks the verified transport shape
// (WebSocket text frames over `--listen unix://PATH`) and a scripted subset of
// JSON-RPC (initialize, thread/start|resume, turn/start|steer|interrupt).
// Each turn's behaviour is chosen by `[fake:<directive>]` tokens in the turn
// input text (the Room message body reaches it through the bodied wake).
import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

import { acceptUnixWebSocket } from "../../src/unix-websocket.mjs";

if (process.argv[2] === "mcp") {
  // FAKE `codex mcp list --json`: no user MCP servers, unless the test wrote
  // `mcp.json` (server names) into the FAKE state directory; `-c
  // mcp_servers.<name>.enabled=false` disables one. `mcp-fail` makes the
  // listing fail like an unparsable user config.
  const state = process.env.FAKE_CODEX_STATE_DIR ?? "";
  if (state && existsSync(join(state, "mcp-fail"))) {
    process.stderr.write("FAKE bad toml in config.toml\n");
    process.exit(1);
  }
  const names =
    state && existsSync(join(state, "mcp.json"))
      ? JSON.parse(readFileSync(join(state, "mcp.json"), "utf8"))
      : [];
  const disabled = new Set(
    process.argv
      .slice(3)
      .map((arg) => /^mcp_servers\.([^.=]+)\.enabled=false$/u.exec(arg)?.[1])
      .filter(Boolean),
  );
  process.stdout.write(
    JSON.stringify(
      names.map((name) => ({ enabled: !disabled.has(name), name })),
    ),
  );
  process.exit(0);
}

const args = process.argv.slice(2);
const listen = args[args.indexOf("--listen") + 1] ?? "";
if (!listen.startsWith("unix://")) {
  process.stderr.write("fake warm app-server requires --listen unix://PATH\n");
  process.exit(2);
}
const socketPath = listen.slice("unix://".length);
const recordPath = process.env.FAKE_CODEX_RECORD_PATH;
const stateDirectory = process.env.FAKE_CODEX_STATE_DIR;
if (stateDirectory) mkdirSync(stateDirectory, { recursive: true });
const record = (event) => {
  if (recordPath)
    appendFileSync(
      recordPath,
      `${JSON.stringify({ pid: process.pid, at: Date.now(), ...event })}\n`,
    );
};
record({ event: "start", argv: args, runtimeTag: process.env.LOOM_RUNTIME_ID });

let turnCounter = 0;
let threadId;
let activeTurn;
let pendingLate;
let threadUnloaded = false;
const threadsPath = stateDirectory ? join(stateDirectory, "threads.json") : "";
const knownThreads = () =>
  threadsPath && existsSync(threadsPath)
    ? JSON.parse(readFileSync(threadsPath, "utf8"))
    : [];

const server = createServer(async (socket) => {
  const ws = await acceptUnixWebSocket(socket);
  const send = (frame) => ws.open && ws.send(JSON.stringify(frame));
  const notify = (method, params) => send({ method, params });
  ws.onMessage = (text) => {
    const frame = JSON.parse(text);
    void handle(frame).catch((error) => {
      if (frame.id !== undefined)
        send({ id: frame.id, error: { code: -32000, message: String(error) } });
    });
  };
  async function handle(frame) {
    if (frame.method === undefined) return;
    record({ event: "request", method: frame.method, params: frame.params });
    const reply = (result) => send({ id: frame.id, result });
    const fail = (message) =>
      send({ id: frame.id, error: { code: -32600, message } });
    switch (frame.method) {
      case "initialize":
        return reply({ userAgent: "fake-codex-warm/0.0.0" });
      case "initialized":
        return;
      case "thread/start": {
        threadId = `thread-${process.pid}-${Date.now()}`;
        if (threadsPath)
          writeFileSync(
            threadsPath,
            JSON.stringify([...knownThreads(), threadId]),
          );
        return reply({ thread: { id: threadId } });
      }
      case "thread/resume": {
        if (!knownThreads().includes(frame.params.threadId))
          return fail(
            `no rollout found for thread id ${frame.params.threadId}`,
          );
        threadId = frame.params.threadId;
        threadUnloaded = false;
        await delay(Number(process.env.FAKE_CODEX_RESUME_DELAY_MS ?? "0"));
        return reply({ thread: { id: threadId } });
      }
      case "turn/start": {
        if (threadUnloaded)
          return fail(`thread ${frame.params.threadId} is not loaded`);
        if (pendingLate !== undefined) {
          // A frame of the previous turn arriving while the next one starts.
          notify("thread/tokenUsage/updated", pendingLate);
          pendingLate = undefined;
        }
        if (activeTurn !== undefined) return fail("a turn is already active");
        turnCounter += 1;
        const turnId = `turn-${process.pid}-${turnCounter}`;
        const text = frame.params.input?.[0]?.text ?? "";
        let completed;
        activeTurn = {
          id: turnId,
          steers: [],
          interrupted: false,
          text,
          completed: new Promise((resolve) => {
            completed = resolve;
          }),
        };
        activeTurn.markCompleted = completed;
        reply({ turn: { id: turnId } });
        void runTurn(activeTurn);
        return;
      }
      case "turn/steer": {
        if (
          activeTurn === undefined ||
          frame.params.expectedTurnId !== activeTurn.id
        )
          return fail("expectedTurnId does not match the active turn");
        const steered = activeTurn;
        steered.steers.push(frame.params.input?.[0]?.text ?? "");
        if (steered.text.includes("[fake:steer-race]")) {
          // Codex answers this steer only after the turn already completed.
          await steered.completed;
          await delay(150);
        }
        return reply({ turnId: steered.id });
      }
      case "turn/interrupt": {
        if (activeTurn?.text.includes("[fake:final-reject]"))
          return fail("turn/interrupt is not supported");
        // Accepts the interrupt but never ends the turn (a wedged CLI).
        if (activeTurn?.text.includes("[fake:final-hang]")) return reply({});
        if (activeTurn?.id === frame.params.turnId) {
          activeTurn.interrupted = true;
          activeTurn.wake?.();
        }
        return reply({});
      }
      default:
        return fail(`unsupported method ${frame.method}`);
    }
  }

  async function runTurn(turn) {
    const has = (name) => turn.text.includes(`[fake:${name}]`);
    const handle = /--turn ([A-Za-z0-9_-]{22})/u.exec(turn.text)?.[1];
    record({
      event: "turn",
      turnId: turn.id,
      handle,
      scope: turnScope(handle),
      text: turn.text,
    });
    notify("turn/started", { threadId, turn: { id: turn.id } });
    notify("item/agentMessage/delta", {
      threadId,
      turnId: turn.id,
      itemId: `msg-${turn.id}`,
      delta: "working",
    });
    if (has("leftover")) spawnLeftover(turn);
    // Crash mid-turn once (input accepted, no completion); a retry proceeds.
    const crashMarker = join(stateDirectory, "crashed-during");
    if (has("crash-during") && !existsSync(crashMarker)) {
      writeFileSync(crashMarker, "1");
      await delay(100);
      process.exit(4);
    }
    if (has("steer-race")) {
      await runWorker(turn, handle, ["worker", "message-check"]);
      const deadline = Date.now() + 5_000;
      while (turn.steers.length === 0 && Date.now() < deadline) await delay(20);
    }
    if (has("compact")) {
      const item = { id: `compact-${turn.id}`, type: "contextCompaction" };
      notify("item/started", { threadId, turnId: turn.id, item });
      notify("item/completed", { threadId, turnId: turn.id, item });
      const deadline = Date.now() + 3_000;
      while (turn.steers.length === 0 && Date.now() < deadline) await delay(20);
    }
    if (has("background-tool")) spawnBackgroundTool(turn, handle);
    // Final-reply turn end: the reply is posted by a tool item; afterwards the
    // real tool loop requests one more full-context generation ("sent"),
    // unless the turn was interrupted first.
    const finalReply =
      has("final") ||
      has("final-reject") ||
      has("final-noack") ||
      has("final-late") ||
      has("post-nofinal") ||
      has("post-progress") ||
      has("final-wait") ||
      has("final-hang");
    if (finalReply) {
      usage(turn); // the generation that decided to post
      if (!has("final-noack"))
        await toolItem(turn, handle, "check", ["worker", "message-check"]);
      const flag =
        has("post-progress") || has("final-wait")
          ? ["--progress"]
          : has("post-nofinal")
            ? []
            : ["--final"];
      await toolItem(turn, handle, "post", [
        "worker",
        "message-post",
        ...flag,
        "--body",
        `FAKE final answer for ${turn.id}`,
      ]);
      if (has("final-late")) {
        notify("item/agentMessage/delta", {
          threadId,
          turnId: turn.id,
          itemId: `late-${turn.id}`,
          delta: "se",
        });
        record({ event: "follow-up-started", turnId: turn.id });
      }
      if (has("final-hang")) {
        record({ event: "final-hang", turnId: turn.id });
        await new Promise(() => {});
      }
      record({ event: "final-window", turnId: turn.id });
      await new Promise((resolve) => {
        turn.wake = resolve;
        setTimeout(resolve, has("final-wait") ? 1_500 : 1_000);
      });
      if (!turn.interrupted) {
        notify("item/agentMessage/delta", {
          threadId,
          turnId: turn.id,
          itemId: `sent-${turn.id}`,
          delta: "sent",
        });
        usage(turn);
        record({ event: "follow-up-generation", turnId: turn.id });
      }
      notify("turn/completed", {
        threadId,
        turn: {
          id: turn.id,
          status: turn.interrupted ? "interrupted" : "completed",
        },
      });
      record({ event: "turn-completed", turnId: turn.id, steers: turn.steers });
      activeTurn = undefined;
      turn.markCompleted();
      return;
    }
    // Hang only in the first turn that carries it (a retry proceeds).
    const hangOnceMarker = join(stateDirectory, "hung-once");
    const hangOnce = has("hang-once") && !existsSync(hangOnceMarker);
    if (hangOnce) writeFileSync(hangOnceMarker, "1");
    if (
      hangOnce ||
      has("hang") ||
      has("hang-ignore-interrupt") ||
      has("steer-wait")
    ) {
      const deadline = has("steer-wait") ? 5_000 : 60_000;
      await new Promise((resolve) => {
        turn.wake = resolve;
        const timer = setTimeout(resolve, deadline);
        const poll = setInterval(() => {
          if (has("steer-wait") && turn.steers.length > 0) {
            clearInterval(poll);
            clearTimeout(timer);
            resolve();
          }
        }, 20);
      });
      if (has("hang-ignore-interrupt")) await new Promise(() => {});
    }
    if (
      !turn.interrupted &&
      (has("ack") || has("steer-wait") || has("background-tool"))
    )
      await runWorker(turn, handle, ["worker", "message-check"]);
    usage(turn);
    if (has("late-usage")) pendingLate = usagePayload(turn, 999_000);
    notify("turn/completed", {
      threadId,
      turn: {
        id: turn.id,
        status: turn.interrupted ? "interrupted" : "completed",
      },
    });
    record({ event: "turn-completed", turnId: turn.id, steers: turn.steers });
    activeTurn = undefined;
    turn.markCompleted();
    if (has("crash-after")) setTimeout(() => process.exit(3), 300);
    // Codex may unload an idle thread while the process lives on.
    if (has("unload-after")) threadUnloaded = true;
  }

  async function toolItem(turn, handle, name, command) {
    const item = { id: `${name}-${turn.id}`, type: "commandExecution" };
    notify("item/started", { threadId, turnId: turn.id, item });
    await runWorker(turn, handle, command);
    notify("item/completed", {
      threadId,
      turnId: turn.id,
      item: { ...item, status: "completed" },
    });
  }

  function usagePayload(turn, total) {
    const last = {
      inputTokens: 100,
      cachedInputTokens: 0,
      outputTokens: 10,
      reasoningOutputTokens: 0,
      totalTokens: 110,
    };
    return {
      threadId,
      turnId: turn.id,
      tokenUsage: {
        last,
        total: { ...last, inputTokens: total, totalTokens: total + 10 },
        modelContextWindow: 200_000,
      },
    };
  }

  let usageTotal = 0;
  function usage(turn) {
    usageTotal += 100;
    notify("thread/tokenUsage/updated", usagePayload(turn, usageTotal));
  }
});

/** The per-turn Room scope the Host issued with this turn's handle. */
function turnScope(handle) {
  const root = process.env.RAH_WORKER_TURN_ROOT;
  if (!root || !handle) return undefined;
  try {
    const scope = JSON.parse(
      readFileSync(join(root, handle, "scope.json"), "utf8"),
    );
    return {
      room: scope.RAH_ROOM_ID,
      from: scope.RAH_FROM_SEQ,
      to: scope.RAH_TO_SEQ,
    };
  } catch {
    return undefined;
  }
}

async function runWorker(turn, handle, command) {
  const cli = process.env.RAH_WORKER_CLI;
  if (!cli || !handle) {
    record({ event: "worker", turnId: turn.id, skipped: true });
    return;
  }
  const result = await execute(cli, [...command, "--turn", handle]);
  record({ event: "worker", turnId: turn.id, command, ...result });
}

function spawnLeftover(turn) {
  // A detached grandchild in its own session: it survives the turn and the
  // app-server's group, but still inherits the runtime's LOOM_* tags.
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  record({ event: "leftover", turnId: turn.id, leftoverPid: child.pid });
}

function spawnBackgroundTool(turn, handle) {
  // Turn N's background tool: it waits for the test's release file, then
  // tries to act with its (now revoked) handle and to discover a newer one.
  const releaseFile = join(stateDirectory, "release-background");
  const resultFile = join(stateDirectory, "background-result.json");
  const script = `
const { spawnSync } = require("node:child_process");
const { existsSync, readdirSync, writeFileSync } = require("node:fs");
const wait = () => new Promise((r) => setTimeout(r, 25));
(async () => {
  while (!existsSync(${JSON.stringify(releaseFile)})) await wait();
  const run = spawnSync(process.env.RAH_WORKER_CLI, ["worker", "message-check", "--turn", ${JSON.stringify(handle ?? "")}], { encoding: "utf8" });
  let listing;
  try { listing = readdirSync(process.env.RAH_WORKER_TURN_ROOT); } catch (error) { listing = String(error.code); }
  const bare = spawnSync(process.env.RAH_WORKER_CLI, ["worker", "message-check"], { encoding: "utf8" });
  writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify({ status: run.status, stderr: run.stderr, listing, bareStatus: bare.status, bareStderr: bare.stderr }));
})();`;
  const child = spawn(process.execPath, ["-e", script], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  record({ event: "background-tool", turnId: turn.id, toolPid: child.pid });
}

function execute(command, commandArgs) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("close", (status) =>
      resolve({
        status,
        stdout: stdout.slice(0, 4000),
        stderr: stderr.slice(0, 4000),
      }),
    );
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

rmSync(socketPath, { force: true });
server.listen(socketPath);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    record({ event: "stop", signal });
    server.close();
    process.exit(0);
  });
