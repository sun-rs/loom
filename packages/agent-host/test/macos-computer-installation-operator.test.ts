import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { join } from "node:path";
import test from "node:test";

import {
  installMacOSComputer,
  type MacOSComputerLaunchAgentInstallInput,
  type MacOSComputerProvisioningInput,
  type MacOSLaunchCtlPort,
} from "../src/index.ts";

const artifact = {
  path: "/tmp/rah-os-computer-operator-fixture",
  sha256: "a".repeat(64),
  size: 1024,
};

test("macOS Computer operator stages only after proving the service is unloaded", async () => {
  const launchctl = new FakeLaunchCtl([113]);
  const staged: MacOSComputerLaunchAgentInstallInput[] = [];
  const result = await installMacOSComputer(
    {
      provisioning: provisioning("/tmp/rah-computer-operator-stage"),
      serviceArtifact: artifact,
      serviceVersion: "1.2.3",
      supervisorArtifact: artifact,
      userId: 501,
    },
    {
      installFiles: async (input) => {
        staged.push(input);
        return {
          kind: "staged",
          plistPath: input.plan.plistPath,
          stableArtifactPath: join(input.plan.kStateDirectory, "stable"),
          supervisorExecutablePath: input.plan.supervisorExecutablePath,
        };
      },
      launchctl,
      verifyArtifacts: async () => undefined,
    },
  );

  assert.equal(result.kind, "staged");
  assert.equal(staged.length, 1);
  assert.equal(staged[0]?.serviceVersion, "1.2.3");
  assert.deepEqual(launchctl.calls, [
    ["print", "gui/501/dev.rah-os.computer-operator"],
  ]);
});

test("macOS Computer operator activates only after staging and service readiness", async () => {
  const launchctl = new FakeLaunchCtl([113, 113, 0, 0]);
  const order: string[] = [];
  const result = await installMacOSComputer(
    {
      activate: true,
      provisioning: provisioning("/tmp/rah-computer-operator-activate"),
      serviceArtifact: artifact,
      serviceVersion: "1.2.3",
      supervisorArtifact: artifact,
      userId: 501,
    },
    {
      installFiles: async (input) => {
        order.push("stage");
        return {
          kind: "staged",
          plistPath: input.plan.plistPath,
          stableArtifactPath: join(input.plan.kStateDirectory, "stable"),
          supervisorExecutablePath: input.plan.supervisorExecutablePath,
        };
      },
      launchctl,
      proveReady: async () => {
        order.push("ready");
      },
      verifyArtifacts: async () => {
        order.push("verify");
      },
    },
  );

  assert.equal(result.kind, "activated");
  assert.deepEqual(order, ["verify", "stage", "ready"]);
  assert.deepEqual(launchctl.calls, [
    ["print", "gui/501/dev.rah-os.computer-operator"],
    ["print", "gui/501/dev.rah-os.computer-operator"],
    [
      "bootstrap",
      "gui/501",
      "/tmp/rah-computer-operator-activate/LaunchAgents/dev.rah-os.computer-operator.plist",
    ],
    ["print", "gui/501/dev.rah-os.computer-operator"],
  ]);
});

test("macOS Computer operator refuses live mutation and deactivates before an explicit replacement", async () => {
  const input = {
    activate: true,
    provisioning: provisioning("/tmp/rah-computer-operator-replace"),
    serviceArtifact: artifact,
    serviceVersion: "1.2.3",
    supervisorArtifact: artifact,
    userId: 501,
  } as const;
  let staged = 0;
  const loaded = new FakeLaunchCtl([0]);
  await assert.rejects(
    installMacOSComputer(input, {
      installFiles: async () => {
        staged += 1;
        throw new Error("must not stage over a loaded service");
      },
      launchctl: loaded,
      proveReady: async () => undefined,
      verifyArtifacts: async () => undefined,
    }),
    /already loaded/u,
  );
  assert.equal(staged, 0);

  const replacing = new FakeLaunchCtl([0, 0, 0, 113, 113, 0, 0]);
  const order: string[] = [];
  const result = await installMacOSComputer(
    { ...input, replaceLoaded: true },
    {
      installFiles: async (installInput) => {
        order.push("stage");
        return {
          kind: "staged",
          plistPath: installInput.plan.plistPath,
          stableArtifactPath: join(installInput.plan.kStateDirectory, "stable"),
          supervisorExecutablePath: installInput.plan.supervisorExecutablePath,
        };
      },
      launchctl: replacing,
      proveReady: async () => {
        order.push("ready");
      },
      verifyArtifacts: async () => {
        order.push("verify");
      },
      wait: async () => undefined,
    },
  );
  assert.equal(result.kind, "replaced");
  assert.deepEqual(order, ["verify", "stage", "ready"]);
  assert.deepEqual(replacing.calls, [
    ["print", "gui/501/dev.rah-os.computer-operator"],
    ["print", "gui/501/dev.rah-os.computer-operator"],
    ["bootout", "gui/501/dev.rah-os.computer-operator"],
    ["print", "gui/501/dev.rah-os.computer-operator"],
    ["print", "gui/501/dev.rah-os.computer-operator"],
    [
      "bootstrap",
      "gui/501",
      "/tmp/rah-computer-operator-replace/LaunchAgents/dev.rah-os.computer-operator.plist",
    ],
    ["print", "gui/501/dev.rah-os.computer-operator"],
  ]);

  await assert.rejects(
    installMacOSComputer(
      {
        ...input,
        activate: false,
        replaceLoaded: true,
      },
      {
        launchctl: new FakeLaunchCtl([]),
        verifyArtifacts: async () => undefined,
      },
    ),
    /requires activation/u,
  );

  const invalidArtifact = new FakeLaunchCtl([0]);
  await assert.rejects(
    installMacOSComputer(
      { ...input, replaceLoaded: true },
      {
        launchctl: invalidArtifact,
        verifyArtifacts: async () => {
          throw new Error("artifact invalid before deactivation");
        },
      },
    ),
    /artifact invalid before deactivation/u,
  );
  assert.deepEqual(invalidArtifact.calls, [
    ["print", "gui/501/dev.rah-os.computer-operator"],
  ]);
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

function provisioning(root: string): MacOSComputerProvisioningInput {
  const publicKeyPem = generateKeyPairSync("ed25519")
    .publicKey.export({ format: "pem", type: "spki" })
    .toString();
  const socketDigest = createHash("sha256")
    .update(root, "utf8")
    .digest("hex")
    .slice(0, 12);
  return {
    executableDirectory: join(root, "bin"),
    label: "dev.rah-os.computer-operator",
    logDirectory: join(root, "logs"),
    plistPath: join(root, "LaunchAgents", "dev.rah-os.computer-operator.plist"),
    privateConfigurationDirectory: join(root, "private"),
    release: {
      baseUrl: "https://releases.example.test/computer",
      publicKeyPem,
    },
    service: {
      activationLeaseMs: 30_000,
      attachmentReconcileIntervalMs: 5_000,
      buildVersion: "1.2.3",
      capacity: 1,
      controlRequestTimeoutMs: 5_000,
      runtimeProtocolVersion: 1,
      runtimeRegistryOwnerId: "computer-operator-runtime-owner",
      runtimes: [
        {
          credentialBindings: {},
          offer: {
            leaseMs: 60_000,
            maxConcurrent: 1,
            runtimeOfferId: "computer-operator-offer",
          },
          registryDatabasePath: join(root, "runtime-registry.db"),
          runtimeProfileId: "computer-operator-runtime",
        },
      ],
      workspace: {
        cwd: root,
        mode: "in_place",
        workspaceDefinitionId: "computer-operator-workspace",
        workspaceMountDigest: `sha256:${"a".repeat(64)}`,
        workspaceMountRevisionId: "computer-operator-mount-v1",
      },
    },
    socketDirectory: `/tmp/rahc-operator-${socketDigest}`,
    stateDirectory: join(root, "state"),
  };
}
