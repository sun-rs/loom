// Shared bootstrap of the isolated gate daemon for the paid efficiency
// (rah.mjs) and drift (drift-runner.mjs) arms: the guarded CLI shim, the
// prepared local workbench in the arm's own temporary state directory, the
// per-turn/warm runtime switch, and daemon.mjs start/stop plus the
// authenticated client API. Nothing touches the formal workbench.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  localCliRuntimeSpec,
  prepareLocalWorkbench,
} from "../../packages/daemon/src/index.ts";
import { wait } from "./common.mjs";
import {
  assertNoGuardViolations,
  resolveGateShimOptions,
  writeGuardedShim,
} from "./guarded-shim.mjs";

// Codex and OpenCode run warm by default in the product; a per-turn arm opts
// out explicitly, a warm arm turns on only the provider under test.
export function gateWarmRuntimes(provider, warm) {
  return warm
    ? { [provider]: { enabled: true } }
    : { codex: { enabled: false }, opencode: { enabled: false } };
}

// processes: the evidence array each daemon start/stop is recorded in.
export async function prepareGateDaemon({
  provider,
  model,
  effort,
  root,
  cwd,
  warm,
  shimOptions = {},
  processes,
  save,
  consumerId,
}) {
  const stateDirectory = join(root, "state");
  const realCli = execFileSync("which", [provider], {
    encoding: "utf8",
  }).trim();
  // OpenCode: the compaction reasoning options are resolved here, once, for
  // both the efficiency and the drift arms.
  const options = resolveGateShimOptions({
    provider,
    realCli,
    model,
    effort,
    options: shimOptions,
  });
  const shimPath = writeGuardedShim({
    provider,
    path: join(root, `guarded-${provider}.mjs`),
    realCli,
    model,
    effort,
    options,
  });
  // effort null (effortless Claude Haiku): the product sends no effort.
  const spec = {
    ...localCliRuntimeSpec(provider, cwd),
    reasoning: effort ?? "default",
    executable: shimPath,
  };
  const prepared = await prepareLocalWorkbench({
    runtimeSpecs: [spec],
    stateDirectory,
    workspaceCwd: cwd,
  });
  const configPath = join(root, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      ...prepared.config,
      warmRuntimes: gateWarmRuntimes(provider, warm),
    }),
    { mode: 0o600 },
  );

  let child, exit, origin;
  async function start() {
    let out = "";
    child = spawn(
      process.execPath,
      [new URL("./daemon.mjs", import.meta.url).pathname, configPath],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    exit = new Promise((r) =>
      child.once("close", (code, signal) => r({ code, signal })),
    );
    child.stdout.on("data", (b) => {
      out = (out + b).slice(-10000);
      const m = out.match(/GATE_READY (.*)\n/);
      if (m) origin = JSON.parse(m[1]).origin;
    });
    child.stderr.on("data", (b) =>
      writeFileSync(join(root, "daemon.log"), b, { flag: "a", mode: 0o600 }),
    );
    await wait(() => {
      assert.equal(child.exitCode, null, "Daemon startup failed");
      return origin;
    }, 60000);
    processes.push({ pid: child.pid, startedAt: new Date().toISOString() });
    save();
  }
  // Graceful drain; resolves the daemon exit status (recorded as evidence).
  async function stop() {
    if (!child) return undefined;
    child.kill("SIGTERM");
    let timer;
    try {
      const status = await Promise.race([
        exit,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Graceful drain timed out")),
            45000,
          );
        }),
      ]);
      Object.assign(processes.at(-1), {
        finishedAt: new Date().toISOString(),
        exit: status,
      });
      child = undefined;
      origin = undefined;
      save();
      return status;
    } finally {
      clearTimeout(timer);
    }
  }
  async function post(path, body) {
    const r = await fetch(origin + path, {
      method: "POST",
      headers: {
        authorization: `Bearer ${prepared.humanAccessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    assert.equal(
      r.status,
      200,
      `${path}: ${JSON.stringify(data).slice(0, 500)}`,
    );
    return data;
  }
  const head = async (roomId) =>
    (await post("/v3/client/rooms/sync", { roomId, consumerId })).latestRoomSeq;
  return {
    realCli,
    shimPath,
    compactionOptions: options.compactionOptions,
    spec,
    prepared,
    stateDirectory,
    start,
    stop,
    post,
    head,
    // Post-hoc guard records (e.g. a Claude result frame naming another
    // model); any record fails the arm.
    assertNoGuardViolations: () => assertNoGuardViolations(shimPath),
  };
}
