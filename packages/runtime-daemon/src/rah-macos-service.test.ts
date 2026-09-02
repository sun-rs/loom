import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import {
  createRahMacOSServicePlan,
  installRahMacOSService,
  uninstallRahMacOSService,
} from "./rah-macos-service.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "rah-macos-service-"));
  const installRoot = join(root, "program");
  const dataRoot = join(root, "data");
  const userHomeDirectory = join(root, "home");
  const main = join(
    installRoot,
    "packages",
    "runtime-daemon",
    "src",
    "main.ts",
  );
  const web = join(installRoot, "packages", "client-web", "dist", "index.html");
  mkdirSync(dirname(main), { recursive: true });
  mkdirSync(dirname(web), { recursive: true });
  mkdirSync(join(userHomeDirectory, "Library", "LaunchAgents"), {
    recursive: true,
  });
  writeFileSync(main, "export {};\n");
  writeFileSync(web, "<!doctype html>\n");
  const plan = createRahMacOSServicePlan({
    dataRoot,
    installRoot,
    nodeExecutablePath: process.execPath,
    port: 43119,
    userHomeDirectory,
  });
  return { dataRoot, plan, root };
}

test("LaunchAgent plan keeps program and durable data separate and exports no secrets", () => {
  const { plan, root } = fixture();
  try {
    assert.deepEqual(Object.keys(plan.environment).sort(), [
      "HOME",
      "PATH",
      "RAH_DATA_HOME",
      "RAH_HOST",
      "RAH_PORT",
    ]);
    assert.equal(plan.environment.RAH_DATA_HOME, join(root, "data"));
    assert.equal(plan.programArguments[0], process.execPath);
    assert.match(plan.plist, /RAH_DATA_HOME/u);
    assert.doesNotMatch(plan.plist, /TOKEN|SECRET|PASSWORD/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("service uninstall removes only launchd registration and preserves data", async () => {
  const { dataRoot, plan, root } = fixture();
  const calls: string[] = [];
  const launchctl = {
    bootstrap: async () => {
      calls.push("bootstrap");
    },
    bootout: async () => {
      calls.push("bootout");
    },
    loaded: async () => false,
  };
  try {
    await installRahMacOSService({
      healthCheck: async () => true,
      launchctl,
      plan,
    });
    const sentinel = join(dataRoot, "keep-me");
    writeFileSync(sentinel, "durable\n");
    const result = await uninstallRahMacOSService({ launchctl, plan });
    assert.equal(result.dataRootPreserved, dataRoot);
    assert.equal(readFileSync(sentinel, "utf8"), "durable\n");
    assert.equal(existsSync(plan.plistPath), false);
    assert.deepEqual(calls, ["bootstrap", "bootout"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("service readiness probes wildcard listeners through loopback", async () => {
  const { plan, root } = fixture();
  let healthOrigin = "";
  try {
    await installRahMacOSService({
      healthCheck: async (origin) => {
        healthOrigin = origin;
        return true;
      },
      launchctl: {
        bootstrap: async () => undefined,
        bootout: async () => undefined,
        loaded: async () => false,
      },
      plan: createRahMacOSServicePlan({
        ...plan,
        dataRoot: plan.dataRoot,
        host: "0.0.0.0",
        installRoot: plan.installRoot,
        nodeExecutablePath: plan.nodeExecutablePath,
        port: plan.port,
        userHomeDirectory: plan.userHomeDirectory,
      }),
    });
    assert.equal(healthOrigin, `http://127.0.0.1:${String(plan.port)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("failed replacement rolls back the prior plist and loaded service", async () => {
  const { plan, root } = fixture();
  const oldPlist = "<plist>old</plist>\n";
  writeFileSync(plan.plistPath, oldPlist);
  chmodSync(plan.plistPath, 0o600);
  const calls: string[] = [];
  let bootstrapCount = 0;
  const launchctl = {
    bootstrap: async () => {
      bootstrapCount += 1;
      calls.push(`bootstrap:${bootstrapCount}`);
    },
    bootout: async () => {
      calls.push("bootout");
    },
    loaded: async () => true,
  };
  try {
    await assert.rejects(
      installRahMacOSService({
        healthCheck: async () => false,
        launchctl,
        plan,
        replaceExisting: true,
      }),
      /failed readiness proof/u,
    );
    assert.equal(readFileSync(plan.plistPath, "utf8"), oldPlist);
    assert.deepEqual(calls, ["bootout", "bootstrap:1", "bootout", "bootstrap:2"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
