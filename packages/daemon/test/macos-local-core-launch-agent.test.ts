import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { delimiter, join } from "node:path";
import test from "node:test";

import type { MacOSLaunchCtlPort } from "@rah-os/agent-host";

import {
  activateMacOSLocalCoreLaunchAgent,
  createMacOSLocalCoreLaunchAgentPlan,
  deactivateMacOSLocalCoreLaunchAgent,
  installMacOSLocalCore,
  proveMacOSLocalCoreReady,
  stageMacOSLocalCoreLaunchAgent,
  uninstallMacOSLocalCore,
} from "../src/macos-local-core-launch-agent.ts";

test("macOS local Core plan freezes a secret-free loopback launchd contract", () => {
  const directory = join(tmpdir(), "rah-local-core-plan & xml");
  const plan = createMacOSLocalCoreLaunchAgentPlan({
    label: "dev.rah-os.local-core",
    logDirectory: join(directory, "logs"),
    mode: { kind: "loopback", port: 4173 },
    nodeExecutablePath: process.execPath,
    pathEntries: ["/opt/homebrew/bin", "/usr/bin", "/opt/homebrew/bin"],
    plistPath: join(directory, "LaunchAgents", "dev.rah-os.local-core.plist"),
    runnerScriptPath: join(directory, "runner & core.mjs"),
    staticDirectory: join(directory, "web & dist"),
    userHomeDirectory: join(directory, "home & user"),
    workbenchHome: join(directory, "RAH OS"),
    workspaceCwd: join(directory, "workspace & source"),
  });

  assert.deepEqual(plan.programArguments, [
    process.execPath,
    join(directory, "runner & core.mjs"),
  ]);
  assert.equal(
    plan.environment.PATH,
    ["/opt/homebrew/bin", "/usr/bin"].join(delimiter),
  );
  assert.equal(plan.environment.RAH_WEB_PORT, "4173");
  assert.equal(plan.environment.RAH_DATA_HOME, join(directory, "RAH OS"));
  assert.equal(plan.environment.RAH_OS_HOME, undefined);
  assert.equal(
    plan.environment.RAH_WEB_STATIC_DIRECTORY,
    join(directory, "web & dist"),
  );
  assert.equal(plan.environment.RAH_LAN_ORIGIN, undefined);
  assert.equal(plan.health.origin, "http://127.0.0.1:4173");
  assert.equal(plan.plist.includes("token"), false);
  assert.equal(plan.plist.includes("credential"), false);
  assert.match(plan.plist, /runner &amp; core\.mjs/u);
  assert.match(plan.plist, /workspace &amp; source/u);
  if (process.platform === "darwin") {
    assert.doesNotThrow(() =>
      execFileSync("/usr/bin/plutil", ["-lint", "-"], {
        input: plan.plist,
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
  }
});

test("macOS packaged Core plan launches the SEA service role directly", () => {
  const directory = join(tmpdir(), "rah-local-core-packaged-plan");
  const executablePath = join(directory, "product", "bin", "rah-os-core");
  const plan = createMacOSLocalCoreLaunchAgentPlan({
    label: "dev.rah-os.local-core",
    logDirectory: join(directory, "logs"),
    mode: { kind: "loopback", port: 4173 },
    nodeExecutablePath: executablePath,
    pathEntries: [join(directory, "product", "bin"), "/usr/bin"],
    plistPath: join(directory, "LaunchAgents", "dev.rah-os.local-core.plist"),
    programArguments: [executablePath, "__local-core-service"],
    runnerScriptPath: executablePath,
    staticDirectory: join(directory, "product", "web"),
    userHomeDirectory: join(directory, "home"),
    workbenchHome: join(directory, "RAH OS"),
    workspaceCwd: join(directory, "workspace"),
  });
  assert.deepEqual(plan.programArguments, [
    executablePath,
    "__local-core-service",
  ]);
  assert.equal(
    plan.environment.RAH_WEB_STATIC_DIRECTORY,
    join(directory, "product", "web"),
  );
});

test("macOS local Core LAN plan keeps TLS identity and exact origin explicit", () => {
  const directory = join(tmpdir(), "rah-local-core-lan-plan");
  const certificatePath = join(directory, "tls.crt");
  const privateKeyPath = join(directory, "tls.key");
  const caCertificatePath = join(directory, "ca.crt");
  const plan = fixturePlan(directory, {
    bindHost: "0.0.0.0",
    caCertificatePath,
    certificatePath,
    kind: "lan",
    privateKeyPath,
    publicOrigin: "https://192.168.1.86:4174",
  });

  assert.equal(plan.environment.RAH_LAN_BIND_HOST, "0.0.0.0");
  assert.equal(plan.environment.RAH_LAN_ORIGIN, "https://192.168.1.86:4174");
  assert.equal(plan.environment.RAH_LAN_CERT_PATH, certificatePath);
  assert.equal(plan.environment.RAH_LAN_KEY_PATH, privateKeyPath);
  assert.deepEqual(plan.health, {
    caCertificatePath,
    origin: "https://192.168.1.86:4174",
  });

  assert.throws(
    () =>
      fixturePlan(directory, {
        bindHost: "0.0.0.0",
        certificatePath,
        kind: "lan",
        publicOrigin: "https://192.168.1.86:4174",
      }),
    /certificate and private key must be provided together/u,
  );
  assert.throws(
    () =>
      fixturePlan(directory, {
        bindHost: "0.0.0.0",
        kind: "lan",
        publicOrigin: "http://192.168.1.86:4174",
      }),
    /exact https origin/u,
  );
});

test("macOS local Core staging verifies immutable inputs and publishes plist last", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-local-core-stage-"));
  try {
    const workspaceCwd = join(directory, "workspace");
    const staticDirectory = join(directory, "dist");
    const runnerScriptPath = join(directory, "run-core.mjs");
    const runnerBytes = Buffer.from("await Promise.resolve();\n");
    mkdirSync(workspaceCwd, { mode: 0o700 });
    mkdirSync(staticDirectory, { mode: 0o700 });
    writeFileSync(join(staticDirectory, "index.html"), "<!doctype html>");
    writeFileSync(runnerScriptPath, runnerBytes, {
      mode: 0o500,
    });
    const plan = fixturePlan(
      directory,
      { kind: "loopback", port: 4173 },
      {
        sha256: createHash("sha256").update(runnerBytes).digest("hex"),
        size: runnerBytes.byteLength,
      },
    );

    const first = await stageMacOSLocalCoreLaunchAgent({ plan });
    assert.equal(first.kind, "staged");
    assert.equal(readFileSync(plan.plistPath, "utf8"), plan.plist);
    assert.equal(statSync(plan.plistPath).mode & 0o777, 0o644);
    assert.equal(statSync(plan.workbenchHome).mode & 0o777, 0o700);
    assert.equal(statSync(plan.logDirectory).mode & 0o777, 0o700);

    assert.deepEqual(await stageMacOSLocalCoreLaunchAgent({ plan }), first);
    chmodSync(plan.runnerScriptPath, 0o600);
    writeFileSync(plan.runnerScriptPath, "await Promise.resolve(2);\n", {
      mode: 0o600,
    });
    await assert.rejects(
      stageMacOSLocalCoreLaunchAgent({ plan }),
      /runner changed after the plan was created/u,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("macOS local Core activation separates registration from health readiness", async () => {
  const plan = fixturePlan(join(tmpdir(), "rah-local-core-activate"), {
    kind: "loopback",
    port: 4173,
  });
  const launchctl = new FakeLaunchCtl([113, 0, 0]);
  let readiness = 0;
  assert.deepEqual(
    await activateMacOSLocalCoreLaunchAgent({
      launchctl,
      plan,
      proveReady: async () => {
        readiness += 1;
      },
      userId: 501,
    }),
    { kind: "activated", serviceTarget: "gui/501/dev.rah-os.local-core" },
  );
  assert.deepEqual(launchctl.calls, [
    ["print", "gui/501/dev.rah-os.local-core"],
    [
      "bootstrap",
      "gui/501",
      join(
        tmpdir(),
        "rah-local-core-activate",
        "LaunchAgents",
        "dev.rah-os.local-core.plist",
      ),
    ],
    ["print", "gui/501/dev.rah-os.local-core"],
  ]);
  assert.equal(readiness, 1);

  const deactivation = new FakeLaunchCtl([0, 0, 113]);
  assert.deepEqual(
    await deactivateMacOSLocalCoreLaunchAgent({
      launchctl: deactivation,
      plan,
      userId: 501,
    }),
    {
      kind: "deactivated",
      serviceTarget: "gui/501/dev.rah-os.local-core",
    },
  );
  assert.deepEqual(deactivation.calls, [
    ["print", "gui/501/dev.rah-os.local-core"],
    ["bootout", "gui/501/dev.rah-os.local-core"],
    ["print", "gui/501/dev.rah-os.local-core"],
  ]);
});

test("macOS local Core activation unloads a newly bootstrapped service when readiness fails", async () => {
  const plan = fixturePlan(
    join(tmpdir(), "rah-local-core-readiness-rollback"),
    {
      kind: "loopback",
      port: 4173,
    },
  );
  const launchctl = new FakeLaunchCtl([113, 0, 0, 0, 113]);
  await assert.rejects(
    activateMacOSLocalCoreLaunchAgent({
      launchctl,
      plan,
      proveReady: async () => {
        throw new Error("gateway did not become ready");
      },
      userId: 501,
    }),
    /gateway did not become ready/u,
  );
  assert.deepEqual(launchctl.calls, [
    ["print", "gui/501/dev.rah-os.local-core"],
    ["bootstrap", "gui/501", plan.plistPath],
    ["print", "gui/501/dev.rah-os.local-core"],
    ["bootout", "gui/501/dev.rah-os.local-core"],
    ["print", "gui/501/dev.rah-os.local-core"],
  ]);
});

test("macOS local Core readiness requires the exact content-free gateway proof", async () => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify(
        requests === 1
          ? { service: "other", state: "online" }
          : { service: "rah-os-local-core", state: "online" },
      ),
    );
  });
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  try {
    const address = server.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, "object");
    await proveMacOSLocalCoreReady({
      health: {
        origin: `http://127.0.0.1:${String(
          typeof address === "object" && address !== null ? address.port : 0,
        )}`,
      },
      pollAttempts: 2,
      pollIntervalMs: 1,
      requestTimeoutMs: 1_000,
    });
    assert.equal(requests, 2);
  } finally {
    await new Promise<void>((resolvePromise, reject) =>
      server.close((error) =>
        error === undefined ? resolvePromise() : reject(error),
      ),
    );
  }
});

test("macOS local Core operator preflights before replacing a loaded service", async () => {
  const plan = fixturePlan(join(tmpdir(), "rah-local-core-operator"), {
    kind: "loopback",
    port: 4173,
  });
  const launchctl = new FakeLaunchCtl([0, 0, 0, 113, 113, 0, 0]);
  const actions: string[] = [];
  const result = await installMacOSLocalCore(
    {
      activate: true,
      plan,
      replaceLoaded: true,
      userId: 501,
    },
    {
      launchctl,
      proveReady: async () => {
        actions.push("ready");
      },
      stage: async ({ replaceExisting }) => {
        actions.push(`stage:${String(replaceExisting)}`);
        return { kind: "staged", plistPath: plan.plistPath };
      },
      verify: async () => {
        actions.push("verify");
      },
    },
  );
  assert.deepEqual(result, {
    kind: "replaced",
    serviceTarget: "gui/501/dev.rah-os.local-core",
    staged: { kind: "staged", plistPath: plan.plistPath },
  });
  assert.deepEqual(actions, ["verify", "stage:true", "ready"]);
  assert.deepEqual(launchctl.calls, [
    ["print", "gui/501/dev.rah-os.local-core"],
    ["print", "gui/501/dev.rah-os.local-core"],
    ["bootout", "gui/501/dev.rah-os.local-core"],
    ["print", "gui/501/dev.rah-os.local-core"],
    ["print", "gui/501/dev.rah-os.local-core"],
    ["bootstrap", "gui/501", plan.plistPath],
    ["print", "gui/501/dev.rah-os.local-core"],
  ]);
});

test("macOS local Core uninstall unloads before removing plist and preserves data by default", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-local-core-uninstall-"));
  try {
    const plistPath = join(
      directory,
      "LaunchAgents",
      "dev.rah-os.local-core.plist",
    );
    const workbenchHome = join(directory, "workbench");
    mkdirSync(join(directory, "LaunchAgents"), { mode: 0o755 });
    mkdirSync(workbenchHome, { mode: 0o700 });
    writeFileSync(plistPath, "plist", { mode: 0o644 });
    writeFileSync(join(workbenchHome, "state.db"), "durable", { mode: 0o600 });
    const launchctl = new FakeLaunchCtl([0, 0, 113]);

    assert.deepEqual(
      await uninstallMacOSLocalCore({
        label: "dev.rah-os.local-core",
        launchctl,
        plistPath,
        userId: 501,
        workbenchHome,
      }),
      {
        dataRootPreserved: workbenchHome,
        kind: "uninstalled",
        plistRemoved: true,
        serviceTarget: "gui/501/dev.rah-os.local-core",
      },
    );
    assert.equal(statSync(join(workbenchHome, "state.db")).isFile(), true);
    assert.throws(() => statSync(plistPath), /ENOENT/u);
    assert.deepEqual(launchctl.calls, [
      ["print", "gui/501/dev.rah-os.local-core"],
      ["bootout", "gui/501/dev.rah-os.local-core"],
      ["print", "gui/501/dev.rah-os.local-core"],
    ]);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

class FakeLaunchCtl implements MacOSLaunchCtlPort {
  readonly calls: string[][] = [];
  readonly #exitCodes: number[];

  constructor(exitCodes: number[]) {
    this.#exitCodes = [...exitCodes];
  }

  async run(arguments_: readonly string[]): Promise<{ exitCode: number }> {
    this.calls.push([...arguments_]);
    const exitCode = this.#exitCodes.shift();
    if (exitCode === undefined) throw new Error("unexpected launchctl call");
    return { exitCode };
  }
}

function fixturePlan(
  directory: string,
  mode:
    | { kind: "loopback"; port: number }
    | {
        bindHost: string;
        caCertificatePath?: string;
        certificatePath?: string;
        kind: "lan";
        privateKeyPath?: string;
        publicOrigin: string;
      },
  runnerIntegrity?: { sha256: string; size: number },
) {
  const runnerScriptPath = join(directory, "run-core.mjs");
  const staticDirectory = join(directory, "dist");
  return createMacOSLocalCoreLaunchAgentPlan({
    label: "dev.rah-os.local-core",
    logDirectory: join(directory, "logs"),
    mode,
    nodeExecutablePath: process.execPath,
    pathEntries: [join(directory, "bin"), "/usr/bin"],
    plistPath: join(directory, "LaunchAgents", "dev.rah-os.local-core.plist"),
    ...(runnerIntegrity === undefined ? {} : { runnerIntegrity }),
    runnerScriptPath,
    staticDirectory,
    userHomeDirectory: join(directory, "user-home"),
    workbenchHome: join(directory, "workbench"),
    workspaceCwd: join(directory, "workspace"),
  });
}

test("log rotation happens only after old service stops and before bootstrap", async () => {
  const { mkdtemp, mkdir, writeFile, readFile, utimes, rm } =
    await import("node:fs/promises");
  const { randomUUID } = await import("node:crypto");
  const directory = await mkdtemp(join(tmpdir(), "rah-log-lifecycle-"));
  const plan = fixturePlan(directory, { kind: "loopback", port: 4173 });
  try {
    await mkdir(plan.logDirectory, { recursive: true });
    const log = join(plan.logDirectory, "core.stdout.log");
    await writeFile(log, "previous-process");
    await utimes(log, new Date("2000-01-01"), new Date("2000-01-01"));
    let loaded = true;
    const launchctl = {
      async run(args: readonly string[]) {
        if (args[0] === "print") return { exitCode: loaded ? 0 : 113 };
        if (args[0] === "bootout") {
          assert.equal(await readFile(log, "utf8"), "previous-process");
          loaded = false;
          return { exitCode: 0 };
        }
        if (args[0] === "bootstrap") {
          await assert.rejects(readFile(log), { code: "ENOENT" });
          loaded = true;
          return { exitCode: 0 };
        }
        throw new Error("unexpected launchctl action");
      },
    };
    await activateMacOSLocalCoreLaunchAgent({
      plan,
      launchctl,
      userId: 501,
      proveReady: async () => {},
    });
    assert.equal(
      await readFile(log, "utf8"),
      "previous-process",
      "already-loaded activation must not rename its live log",
    );
    await activateMacOSLocalCoreLaunchAgent({
      plan,
      launchctl,
      userId: 501,
      replaceLoaded: true,
      proveReady: async () => {},
    });
  } finally {
    await rm(plan.logDirectory, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
});
