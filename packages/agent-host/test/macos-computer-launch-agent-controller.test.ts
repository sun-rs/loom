import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  activateMacOSComputerLaunchAgent,
  createMacOSComputerLaunchAgentPlan,
  deactivateMacOSComputerLaunchAgent,
  inspectMacOSComputerLaunchAgent,
  proveMacOSComputerLaunchAgentServiceReady,
  restartMacOSComputerLaunchAgent,
  type MacOSLaunchCtlPort,
  NodeMacOSLaunchCtl,
} from "../src/index.ts";

test("macOS LaunchAgent inspection returns only the exact registration state", async () => {
  const plan = fixturePlan("inspect");
  const loaded = new FakeLaunchCtl([0]);
  const absent = new FakeLaunchCtl([113]);
  assert.deepEqual(
    await inspectMacOSComputerLaunchAgent({
      launchctl: loaded,
      plan,
      userId: 501,
    }),
    { kind: "loaded", serviceTarget: "gui/501/dev.rah-os.inspect" },
  );
  assert.deepEqual(
    await inspectMacOSComputerLaunchAgent({
      launchctl: absent,
      plan,
      userId: 501,
    }),
    { kind: "unloaded", serviceTarget: "gui/501/dev.rah-os.inspect" },
  );
  assert.deepEqual(loaded.calls, [["print", "gui/501/dev.rah-os.inspect"]]);
  assert.deepEqual(absent.calls, [["print", "gui/501/dev.rah-os.inspect"]]);
});

test("macOS LaunchAgent activation bootstraps an absent service and proves readiness", async () => {
  const plan = fixturePlan("activate");
  const launchctl = new FakeLaunchCtl([113, 0, 0]);
  let ready = 0;
  assert.deepEqual(
    await activateMacOSComputerLaunchAgent({
      launchctl,
      plan,
      proveReady: async () => {
        ready += 1;
      },
      userId: 501,
      wait: async () => undefined,
    }),
    { kind: "activated", serviceTarget: "gui/501/dev.rah-os.activate" },
  );
  assert.deepEqual(launchctl.calls, [
    ["print", "gui/501/dev.rah-os.activate"],
    ["bootstrap", "gui/501", plan.plistPath],
    ["print", "gui/501/dev.rah-os.activate"],
  ]);
  assert.equal(ready, 1);
});

test("macOS LaunchAgent activation is idempotent unless replacement is explicit", async () => {
  const plan = fixturePlan("idempotent");
  const launchctl = new FakeLaunchCtl([0]);
  assert.deepEqual(
    await activateMacOSComputerLaunchAgent({
      launchctl,
      plan,
      userId: 501,
    }),
    {
      kind: "already_loaded",
      serviceTarget: "gui/501/dev.rah-os.idempotent",
    },
  );
  assert.equal(launchctl.calls.length, 1);
});

test("macOS LaunchAgent replacement waits for bootout before one bootstrap", async () => {
  const plan = fixturePlan("replace");
  const launchctl = new FakeLaunchCtl([0, 0, 0, 113, 0, 113, 0]);
  let waits = 0;
  assert.deepEqual(
    await activateMacOSComputerLaunchAgent({
      launchctl,
      plan,
      replaceLoaded: true,
      userId: 501,
      wait: async () => {
        waits += 1;
      },
    }),
    { kind: "reloaded", serviceTarget: "gui/501/dev.rah-os.replace" },
  );
  assert.deepEqual(launchctl.calls, [
    ["print", "gui/501/dev.rah-os.replace"],
    ["bootout", "gui/501/dev.rah-os.replace"],
    ["print", "gui/501/dev.rah-os.replace"],
    ["print", "gui/501/dev.rah-os.replace"],
    ["bootstrap", "gui/501", plan.plistPath],
    ["print", "gui/501/dev.rah-os.replace"],
    ["print", "gui/501/dev.rah-os.replace"],
  ]);
  assert.equal(waits, 2);
});

test("macOS LaunchAgent activation fails closed on an ambiguous launchctl probe", async () => {
  const launchctl = new FakeLaunchCtl([64]);
  await assert.rejects(
    activateMacOSComputerLaunchAgent({
      launchctl,
      plan: fixturePlan("ambiguous"),
      userId: 501,
    }),
    /print failed with exit code 64/u,
  );
  assert.equal(launchctl.calls.length, 1);
});

test("macOS LaunchAgent restart uses one forced kickstart and requires readiness proof", async () => {
  const plan = fixturePlan("restart");
  const launchctl = new FakeLaunchCtl([0, 0]);
  let ready = 0;
  assert.deepEqual(
    await restartMacOSComputerLaunchAgent({
      launchctl,
      plan,
      proveReady: async () => {
        ready += 1;
      },
      userId: 501,
    }),
    { kind: "restarted", serviceTarget: "gui/501/dev.rah-os.restart" },
  );
  assert.deepEqual(launchctl.calls, [
    ["print", "gui/501/dev.rah-os.restart"],
    ["kickstart", "-k", "gui/501/dev.rah-os.restart"],
  ]);
  assert.equal(ready, 1);
});

test("macOS LaunchAgent restart refuses to create an absent registration", async () => {
  const launchctl = new FakeLaunchCtl([113]);
  await assert.rejects(
    restartMacOSComputerLaunchAgent({
      launchctl,
      plan: fixturePlan("restart-missing"),
      proveReady: async () => undefined,
      userId: 501,
    }),
    /is not loaded/u,
  );
  assert.equal(launchctl.calls.length, 1);
});

test("macOS LaunchAgent deactivation is idempotent and waits for removal", async () => {
  const absentPlan = fixturePlan("deactivate-absent");
  const absent = new FakeLaunchCtl([113]);
  assert.deepEqual(
    await deactivateMacOSComputerLaunchAgent({
      launchctl: absent,
      plan: absentPlan,
      userId: 501,
    }),
    {
      kind: "already_unloaded",
      serviceTarget: "gui/501/dev.rah-os.deactivate-absent",
    },
  );

  const loadedPlan = fixturePlan("deactivate-loaded");
  const loaded = new FakeLaunchCtl([0, 0, 0, 113]);
  let waits = 0;
  assert.deepEqual(
    await deactivateMacOSComputerLaunchAgent({
      launchctl: loaded,
      plan: loadedPlan,
      userId: 501,
      wait: async () => {
        waits += 1;
      },
    }),
    {
      kind: "deactivated",
      serviceTarget: "gui/501/dev.rah-os.deactivate-loaded",
    },
  );
  assert.deepEqual(loaded.calls, [
    ["print", "gui/501/dev.rah-os.deactivate-loaded"],
    ["bootout", "gui/501/dev.rah-os.deactivate-loaded"],
    ["print", "gui/501/dev.rah-os.deactivate-loaded"],
    ["print", "gui/501/dev.rah-os.deactivate-loaded"],
  ]);
  assert.equal(waits, 1);
});

test("macOS LaunchAgent readiness binds supervisor PID to live singleton attestation", async () => {
  let reads = 0;
  let waits = 0;
  await proveMacOSComputerLaunchAgentServiceReady(
    {
      expectedBuildVersion: "2.0.0",
      ownershipControlToken: "a".repeat(64),
      ownershipSocketPath: join(tmpdir(), "rah-ready-ownership.sock"),
      pollAttempts: 2,
      pollIntervalMs: 1,
      supervisor: {
        readStatus: async () => ({
          kind: "running",
          processId: 44,
          slot: "stable",
        }),
      },
      wait: async () => {
        waits += 1;
      },
    },
    {
      readLiveAttestation: async () => {
        reads += 1;
        return {
          buildVersion: reads === 1 ? "1.0.0" : "2.0.0",
          candidateComputerInstanceId: "computer-instance",
          candidateProcessId: 44,
          managedAttachmentIds: ["primary"],
          managedAttachmentIdentities: { primary: "connection-primary" },
          serviceGeneration: "service-generation",
          sourceProcessId: 43,
        };
      },
    },
  );
  assert.equal(reads, 2);
  assert.equal(waits, 1);
});

test("macOS LaunchAgent readiness rejects a supervisor and singleton PID split", async () => {
  await assert.rejects(
    proveMacOSComputerLaunchAgentServiceReady(
      {
        ownershipControlToken: "a".repeat(64),
        ownershipSocketPath: join(tmpdir(), "rah-ready-split.sock"),
        pollAttempts: 1,
        pollIntervalMs: 1,
        supervisor: {
          readStatus: async () => ({
            kind: "running",
            processId: 70,
            slot: "stable",
          }),
        },
      },
      {
        readLiveAttestation: async () => ({
          buildVersion: "1.0.0",
          candidateComputerInstanceId: "computer-instance",
          candidateProcessId: 71,
          managedAttachmentIds: [],
          managedAttachmentIdentities: {},
          serviceGeneration: "service-generation",
          sourceProcessId: 69,
        }),
      },
    ),
    /did not prove a live supervised Computer service/u,
  );
});

test("Node launchctl adapter exposes only exact Computer lifecycle command shapes", async () => {
  let spawned = 0;
  const launchctl = new NodeMacOSLaunchCtl({
    spawn: () => {
      spawned += 1;
      throw new Error("unexpected spawn");
    },
  });
  await assert.rejects(
    launchctl.run(["remove", "gui/501/dev.rah-os.service"]),
    /arguments are invalid/u,
  );
  await assert.rejects(
    launchctl.run(["bootstrap", "system", "/tmp/service.plist"]),
    /arguments are invalid/u,
  );
  await assert.rejects(
    launchctl.run(["kickstart", "gui/501/dev.rah-os.service"]),
    /arguments are invalid/u,
  );
  assert.equal(spawned, 0);
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

function fixturePlan(suffix: string) {
  const directory = join(tmpdir(), `rah-launchctl-${suffix}`);
  return createMacOSComputerLaunchAgentPlan({
    kStateDirectory: join(directory, "k"),
    label: `dev.rah-os.${suffix}`,
    logDirectory: join(directory, "logs"),
    plistPath: join(directory, "LaunchAgents", `dev.rah-os.${suffix}.plist`),
    stateDirectory: join(directory, "state"),
    supervisorConfigurationPath: join(directory, "supervisor.json"),
    supervisorExecutablePath: join(directory, "rah-os-computer-supervisor"),
  });
}
