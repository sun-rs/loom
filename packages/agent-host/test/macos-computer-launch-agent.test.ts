import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { slotArtifactPath } from "@rah-os/k-carrier";

import { createMacOSComputerLaunchAgentPlan } from "../src/index.ts";

test("macOS LaunchAgent keeps a constant supervisor and passes only a private config path", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-launch-agent-"));
  chmodSync(directory, 0o700);
  const stateDirectory = join(directory, "state");
  const logDirectory = join(directory, "logs");
  const supervisorConfigurationPath = join(
    directory,
    "private",
    "supervisor.json",
  );
  const supervisorExecutablePath = join(
    directory,
    "bin",
    "rah-computer-carrier",
  );
  const plistPath = join(directory, "LaunchAgents", "dev.rah.computer.plist");
  try {
    const plan = createMacOSComputerLaunchAgentPlan({
      kStateDirectory: join(stateDirectory, "k"),
      label: "dev.rah.computer",
      logDirectory,
      plistPath,
      supervisorConfigurationPath,
      stateDirectory,
      supervisorExecutablePath,
    });

    assert.equal(plan.label, "dev.rah.computer");
    assert.equal(plan.plistPath, plistPath);
    assert.deepEqual(plan.programArguments, [
      supervisorExecutablePath,
      "__computer-supervisor",
      "--config-path",
      supervisorConfigurationPath,
    ]);
    assert.equal(plan.plist.includes("fd-only-secret-must-not-appear"), false);
    mkdirSync(join(directory, "LaunchAgents"), { recursive: true });
    writeFileSync(plistPath, plan.plist, { mode: 0o644 });
    assert.match(
      execFileSync("/usr/bin/plutil", ["-lint", plistPath], {
        encoding: "utf8",
      }),
      /OK/u,
    );
    const parsed = JSON.parse(
      execFileSync(
        "/usr/bin/plutil",
        ["-convert", "json", "-o", "-", plistPath],
        { encoding: "utf8" },
      ),
    ) as Record<string, unknown>;
    assert.deepEqual(parsed, {
      KeepAlive: true,
      Label: "dev.rah.computer",
      ProcessType: "Background",
      Program: supervisorExecutablePath,
      ProgramArguments: plan.programArguments,
      RunAtLoad: true,
      StandardErrorPath: join(logDirectory, "computer.stderr.log"),
      StandardOutPath: join(logDirectory, "computer.stdout.log"),
      ThrottleInterval: 10,
      TimeOut: 30,
      Umask: "0077",
      WorkingDirectory: stateDirectory,
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("macOS LaunchAgent refuses to supervise the replaceable K stable artifact directly", () => {
  const directory = join(tmpdir(), "rah-launch-agent-contract");
  const kStateDirectory = join(directory, "k");
  assert.throws(
    () =>
      createMacOSComputerLaunchAgentPlan({
        kStateDirectory,
        label: "dev.rah.computer",
        logDirectory: join(directory, "logs"),
        plistPath: join(directory, "dev.rah.computer.plist"),
        supervisorConfigurationPath: join(directory, "supervisor.json"),
        stateDirectory: directory,
        supervisorExecutablePath: slotArtifactPath(kStateDirectory, "stable"),
      }),
    /must not execute the replaceable K stable slot directly/u,
  );
});

test("macOS LaunchAgent validates labels and XML-sensitive paths", () => {
  const directory = join(tmpdir(), "rah-launch-agent-&-contract");
  const plan = createMacOSComputerLaunchAgentPlan({
    kStateDirectory: join(directory, "k"),
    label: "dev.rah.computer-test",
    logDirectory: join(directory, "logs"),
    plistPath: join(directory, "dev.rah.computer-test.plist"),
    supervisorConfigurationPath: join(directory, "private", "supervisor.json"),
    stateDirectory: directory,
    supervisorExecutablePath: join(directory, "bin", "carrier"),
  });
  assert.match(plan.plist, /rah-launch-agent-&amp;-contract/u);
  assert.throws(
    () =>
      createMacOSComputerLaunchAgentPlan({
        kStateDirectory: join(directory, "k"),
        label: "not a launchd label",
        logDirectory: join(directory, "logs"),
        plistPath: join(directory, "invalid.plist"),
        supervisorConfigurationPath: join(directory, "supervisor.json"),
        stateDirectory: directory,
        supervisorExecutablePath: join(directory, "carrier"),
      }),
    /label is invalid/u,
  );
});
