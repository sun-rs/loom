// Opt-in research, never imports or connects to the product daemon.
import assert from "node:assert/strict";
import { spawn, execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  openSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  isolatedEnvironment,
  assertStudySocket,
  createFixture,
} from "./fixture.mjs";

assert(process.argv.includes("--run-free"), "Explicit --run-free required");
const execute = promisify(execFileCallback);
function execFile(...args) {
  const pending = execute(...args);
  pending.child.stdin?.end();
  return pending;
}
const root = mkdtempSync("/tmp/lh-"),
  name = "probe";
const env = isolatedEnvironment(root);
const herdr = "/opt/homebrew/bin/herdr",
  pi = "/opt/homebrew/bin/pi";
const result = {
  kind: "isolated-native-cli-smoke",
  root,
  startedAt: new Date().toISOString(),
  paidCalls: 0,
  excludedClis: ["claude"],
  productionTouched: false,
  checks: [],
  commands: [],
};
const save = (path, value) =>
  writeFileSync(
    root + "/" + path,
    typeof value === "string" ? value : JSON.stringify(value, null, 2),
  );
const hash = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
for (const p of [
  "home",
  "work-a",
  "work-b",
  "work-c",
  "pi/extensions",
  "config/herdr",
  "state",
  "cache",
])
  mkdirSync(root + "/" + p, { recursive: true });
save(
  "config/herdr/config.toml",
  'onboarding=false\n[update]\nversion_check=false\nmanifest_check=false\n[terminal]\ndefault_shell="/bin/sh"\nshell_mode="non_login"\n[server]\nheadless_cols=120\nheadless_rows=40\n',
);
const fixture = await createFixture();
save("pi/models.json", {
  providers: {
    fixture: {
      baseUrl: fixture.origin + "/v1",
      api: "openai-completions",
      apiKey: "fixture-only",
      models: [
        {
          id: "fixture",
          name: "LOCAL FIXTURE ONLY",
          reasoning: false,
          input: ["text"],
          contextWindow: 32000,
          maxTokens: 2048,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    },
  },
});
save("pi/settings.json", {
  quietStartup: true,
  autoUpdate: false,
  compaction: { enabled: false },
  retry: { enabled: false, maxRetries: 0 },
});
for (const p of ["work-a", "work-b", "work-c"])
  save(p + "/probe.txt", fixture.marker);
const socket = root + "/config/herdr/sessions/" + name + "/herdr.sock";
assertStudySocket(root, socket);
let server, serverClosed;
const streams = [];
function terminalStream(mode, target, cols = 100, rows = 30) {
  const p = spawn(
    herdr,
    [
      "--session",
      name,
      "terminal",
      "session",
      mode,
      target,
      "--cols",
      String(cols),
      "--rows",
      String(rows),
    ],
    { env, cwd: root, stdio: ["pipe", "pipe", "pipe"] },
  );
  const stream = { p, output: "", stderr: "", closed: null };
  stream.closed = new Promise((r) =>
    p.once("close", (code, signal) => r({ code, signal })),
  );
  p.stdout.on("data", (b) => (stream.output += b));
  p.stderr.on("data", (b) => (stream.stderr += b));
  streams.push(stream);
  return stream;
}
async function closeStream(stream) {
  stream.p.kill("SIGTERM");
  await Promise.race([
    stream.closed,
    delay(3000).then(() => {
      throw Error("Observer cleanup timeout");
    }),
  ]);
}
async function command(args, options = {}) {
  const start = Date.now();
  try {
    const r = await execFile(herdr, ["--session", name, ...args], {
      env,
      cwd: root,
      timeout: 35000,
      maxBuffer: 2 * 1024 * 1024,
      ...options,
    });
    result.commands.push({
      args,
      ms: Date.now() - start,
      stdout: r.stdout,
      stderr: r.stderr,
      code: 0,
    });
    const output = r.stdout.trim();
    return output.startsWith("{") ? JSON.parse(output) : output || null;
  } catch (e) {
    result.commands.push({
      args,
      ms: Date.now() - start,
      stdout: e.stdout,
      stderr: e.stderr,
      code: e.code,
    });
    throw e;
  }
}
async function until(predicate, label, ms = 20000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await predicate()) return;
    await delay(100);
  }
  throw Error("Timed out: " + label);
}
const check = (id, data = {}) => {
  result.checks.push({ id, ...data });
  console.log(JSON.stringify({ check: id, ...data }));
};
const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
const flags = [
  "--offline",
  "--no-context-files",
  "--no-extensions",
  "--no-skills",
  "--no-prompt-templates",
  "--no-mcp",
  "--no-themes",
  "--provider",
  "fixture",
  "--model",
  "fixture",
  "--thinking",
  "off",
  "--tools",
  "read",
];
const prompt = "Read probe.txt using the read tool, then finish.";
try {
  console.log(JSON.stringify({ root, paidCalls: 0 }));
  result.executables = await Promise.all(
    [herdr, pi].map(async (path) => ({
      path: realpathSync(path),
      sha256: hash(realpathSync(path)),
      version: (await execFile(path, ["--version"], { env })).stdout.trim(),
    })),
  );
  assert.match(
    result.executables[0].version,
    /0\.9\.1/,
    "Version changed: create a new batch",
  );
  assert.match(
    result.executables[1].version,
    /1\.5\.0/,
    "Version changed: create a new batch",
  );
  server = spawn(herdr, ["--session", name, "server"], {
    cwd: root,
    env,
    stdio: [
      "ignore",
      openSync(root + "/herdr.out", "w"),
      openSync(root + "/herdr.err", "w"),
    ],
  });
  serverClosed = new Promise((r) =>
    server.once("close", (code, signal) => r({ code, signal })),
  );
  await until(() => existsSync(socket), "isolated Herdr socket");
  result.serverStatus = await command(["status", "server"]);
  check("isolated-server-ready", { pid: server.pid, socket });
  await command(["integration", "install", "pi"]);
  const hook = readdirSync(root + "/pi/extensions").find((x) =>
    x.includes("herdr"),
  );
  assert(hook, "Native Herdr Pi integration missing");
  result.piIntegration = {
    file: hook,
    sha256: hash(root + "/pi/extensions/" + hook),
  };

  // Structured native CLI baseline. This is A0, not a full Loom Activation.
  const coldArgs = [
    ...flags,
    "--print",
    "--mode",
    "json",
    "--session",
    root + "/a.jsonl",
    prompt,
  ];
  let count = fixture.requests.length,
    start = Date.now();
  const a = await execFile(pi, coldArgs, {
    env,
    cwd: root + "/work-a",
    timeout: 30000,
    maxBuffer: 2 * 1024 * 1024,
  });
  save("a.stdout.jsonl", a.stdout);
  save("a.stderr", a.stderr);
  assert(
    fixture.receipts.length === 1,
    "Baseline must produce real tool receipt",
  );
  assert(a.stdout.includes("Fixture task completed."));
  check("A0-native-structured-tool-final", {
    ms: Date.now() - start,
    requests: fixture.requests.length - count,
  });

  // B0 redirects the same native JSON stream through a Herdr shell; no screen parser.
  const b = await command([
    "workspace",
    "create",
    "--cwd",
    root + "/work-b",
    "--label",
    "carrier",
    "--no-focus",
  ]);
  save("b.workspace.json", b);
  const bp = b.result.root_pane.pane_id;
  const bArgs = coldArgs.map((x) =>
    x === root + "/a.jsonl" ? root + "/b.jsonl" : x,
  );
  save(
    "b.sh",
    "#!/bin/sh\n" +
      [pi, ...bArgs].map(quote).join(" ") +
      " > " +
      quote(root + "/b.stdout.jsonl") +
      " 2> " +
      quote(root + "/b.stderr") +
      '\nprintf "%s" "$?" > ' +
      quote(root + "/b.exit") +
      "\n",
  );
  count = fixture.requests.length;
  start = Date.now();
  await command(["pane", "run", bp, "/bin/sh " + quote(root + "/b.sh")]);
  await until(() => existsSync(root + "/b.exit"), "carrier child exit", 30000);
  assert.equal(readFileSync(root + "/b.exit", "utf8"), "0");
  assert(
    readFileSync(root + "/b.stdout.jsonl", "utf8").includes(
      "Fixture task completed.",
    ),
  );
  assert.equal(fixture.receipts.length, 2);
  check("B0-same-stdio-tool-final", {
    ms: Date.now() - start,
    requests: fixture.requests.length - count,
    scope: "stdout file relay only; not a production RuntimeAdapter",
  });

  const c = await command([
    "workspace",
    "create",
    "--cwd",
    root + "/work-c",
    "--label",
    "interactive",
    "--no-focus",
  ]);
  save("c.workspace.json", c);
  const cp = c.result.root_pane.pane_id;
  const interactive = [
    ...flags,
    "--extension",
    root + "/pi/extensions/" + hook,
    "--session",
    root + "/c.jsonl",
    "--tui-mode",
    "regular",
  ];
  await command([
    "agent",
    "start",
    "study-pi",
    "--kind",
    "pi",
    "--pane",
    cp,
    "--",
    ...interactive,
  ]);
  save(
    "c.start-screen.json",
    await command([
      "agent",
      "read",
      "study-pi",
      "--source",
      "recent-unwrapped",
      "--lines",
      "80",
    ]),
  );
  count = fixture.requests.length;
  await command(["agent", "prompt", "study-pi", prompt]);
  await until(
    () =>
      fixture.receipts.length === 3 &&
      existsSync(root + "/c.jsonl") &&
      readFileSync(root + "/c.jsonl", "utf8").includes(
        "Fixture task completed.",
      ),
    "native interactive final",
    30000,
  );
  const binding = await command(["agent", "get", "study-pi"]);
  save("c.binding.json", binding);
  check("C-native-interactive-tool-final", {
    requests: fixture.requests.length - count,
  });

  const before = fixture.requests.length,
    beforeSession = readFileSync(root + "/c.jsonl", "utf8").split("\n")[0];
  for (let i = 0; i < 5; i++) {
    await command([
      "agent",
      "read",
      "study-pi",
      "--source",
      "recent-unwrapped",
      "--lines",
      "80",
    ]);
    await command(["agent", "get", "study-pi"]);
  }
  assert.equal(fixture.requests.length, before);
  assert.equal(
    readFileSync(root + "/c.jsonl", "utf8").split("\n")[0],
    beforeSession,
  );
  check("C-observe-repeated-read-zero-generation", {
    reads: 10,
    extraRequests: 0,
  });

  // Preserve the first failure, without resending an unknown prompt.
  count = fixture.requests.length;
  let waitError;
  try {
    await command([
      "agent",
      "prompt",
      "study-pi",
      "SLOW: " + prompt,
      "--wait",
      "--timeout",
      "12000",
    ]);
  } catch (e) {
    waitError = { code: e.code, stderr: e.stderr };
  }
  await until(
    () =>
      fixture.receipts.length === 4 &&
      (
        readFileSync(root + "/c.jsonl", "utf8").match(
          /Fixture task completed\./g,
        ) || []
      ).length === 2,
    "second native final",
    20000,
  );
  check("C-second-turn-exact-native-final", {
    requests: fixture.requests.length - count,
    waitError: waitError ?? null,
  });
  if (waitError)
    throw Error(
      "Herdr wait did not acknowledge an actually completed native turn",
    );
  if (process.argv.includes("--extended")) {
    const nativeId = JSON.parse(
      readFileSync(root + "/c.jsonl", "utf8").split("\n")[0],
    ).id;
    // Predeclared seeds change viewport and fast/streaming order, not model sampling.
    for (let seed = 0; seed < 10; seed++) {
      count = fixture.requests.length;
      const observer = terminalStream("observe", cp, 80 + seed * 4, 24 + seed);
      await until(
        () => observer.output.includes("terminal.frame"),
        "observer initial frame",
      );
      await closeStream(observer);
      save("observer-" + seed + ".jsonl", observer.output);
      assert.equal(
        fixture.requests.length,
        count,
        "Observation generated a model call",
      );
      await command([
        "agent",
        "prompt",
        "study-pi",
        (seed % 2 ? "SLOW: " : "") + prompt,
      ]);
      const expected = 3 + seed;
      await until(
        () =>
          readFileSync(root + "/c.jsonl", "utf8")
            .split("\n")
            .filter(Boolean)
            .map(JSON.parse)
            .filter(
              (x) =>
                x.message?.role === "assistant" &&
                x.message.stopReason === "stop",
            ).length === expected,
        "seed final " + seed,
      );
      assert.equal(fixture.requests.length - count, 2);
      assert.equal(
        JSON.parse(readFileSync(root + "/c.jsonl", "utf8").split("\n")[0]).id,
        nativeId,
      );
      check("C-fixed-seed-observe-and-turn", {
        seed,
        extraObservationRequests: 0,
        turnRequests: 2,
        nativeSessionId: nativeId,
      });
    }
    // Acquire the same native terminal through the official control surface.
    // A controller is not assumed to fence the separate automation API.
    const controller = terminalStream("control", cp);
    await until(
      () => controller.output.includes("terminal.frame"),
      "controller initial frame",
    );
    const second = terminalStream("control", cp);
    const conflict = await Promise.race([
      second.closed,
      delay(4000).then(() => null),
    ]);
    save("control-conflict.json", {
      exit: conflict,
      stderr: second.stderr,
      output: second.output,
    });
    assert(conflict, "Expected a second controller to be rejected");
    count = fixture.requests.length;
    let automaticError;
    try {
      await command(["agent", "prompt", "study-pi", prompt]);
    } catch (e) {
      automaticError = { code: e.code, stderr: e.stderr };
    }
    await delay(1000);
    save("control-first.jsonl", controller.output);
    const extra = fixture.requests.length - count;
    result.takeover = {
      secondControllerRejected: true,
      automaticError: automaticError ?? null,
      automaticRequestsWhileControlled: extra,
    };
    check("C-takeover-automation-boundary", result.takeover);
    assert.equal(
      extra,
      0,
      "Herdr terminal ownership did not pause the independent automation API",
    );
    // A future adapter may reject or durably queue the command; either is valid
    // if it produces no native generation until control is returned.
    await closeStream(controller);
  }
  result.status = "smoke-passed-not-production-accepted";
} catch (e) {
  result.status = "stopped-at-first-failure";
  result.error = String(e);
  result.stack = e.stack;
  result.failureDetail = {
    stdout: e.stdout,
    stderr: e.stderr,
    code: e.code,
    signal: e.signal,
    killed: e.killed,
  };
  console.error(String(e));
  process.exitCode = 1;
} finally {
  result.fixture = {
    origin: fixture.origin,
    requests: fixture.requests,
    receipts: fixture.receipts,
    errors: fixture.errors,
    paidCalls: 0,
  };
  save("fixture.json", result.fixture);
  for (const stream of streams)
    if (stream.p.exitCode === null && !stream.p.signalCode) {
      try {
        await closeStream(stream);
      } catch (e) {
        result.streamCleanupError = String(e);
      }
    }
  if (server) {
    try {
      await command(["server", "stop"]);
    } catch (e) {
      result.cleanupError = String(e);
    }
    result.serverExit = await Promise.race([
      serverClosed,
      delay(5000).then(() => null),
    ]);
    if (!result.serverExit) {
      server.kill("SIGTERM");
      result.serverExit = await Promise.race([
        serverClosed,
        delay(5000).then(() => null),
      ]);
    }
  }
  await fixture.close();
  result.finishedAt = new Date().toISOString();
  result.cleanup = {
    socketRemoved: !existsSync(socket),
    serverExit: result.serverExit,
  };
  save("result.json", result);
  console.log(
    JSON.stringify({
      root,
      status: result.status,
      error: result.error,
      cleanup: result.cleanup,
    }),
  );
}
