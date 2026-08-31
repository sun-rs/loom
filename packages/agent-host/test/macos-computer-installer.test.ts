import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  closeSync,
  constants,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { slotArtifactPath } from "@rah-os/k-carrier";

import {
  createMacOSComputerProvisioning,
  installMacOSComputerLaunchAgentFiles,
  readNodeKCarrierComputerServiceConfiguration,
  readNodeKCarrierComputerUpgradeProcessConfigurationPath,
} from "../src/index.ts";

test("macOS installer stages verified carrier, stable service, private config, and plist without loading launchd", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-macos-install-"));
  chmodSync(directory, 0o700);
  const sources = join(directory, "sources");
  const stateDirectory = join(directory, "installed", "state");
  const kStateDirectory = join(stateDirectory, "k");
  const supervisorConfigurationPath = join(
    directory,
    "installed",
    "private",
    "supervisor.json",
  );
  const supervisorExecutablePath = join(
    directory,
    "installed",
    "bin",
    "rah-os-computer",
  );
  const plistPath = join(directory, "LaunchAgents", "dev.rah.computer.plist");
  const supervisorSource = join(sources, "carrier");
  const serviceSource = join(sources, "service");
  const supervisorBytes = Buffer.from("#!/bin/sh\nexit 0\n");
  const serviceBytes = Buffer.from("#!/bin/sh\nexit 0\n");
  try {
    mkdirSync(sources, { mode: 0o700, recursive: true });
    writeFileSync(supervisorSource, supervisorBytes, { mode: 0o500 });
    writeFileSync(serviceSource, serviceBytes, { mode: 0o500 });
    const provisioning = createTestProvisioning(directory);
    assert.deepEqual(
      await installMacOSComputerLaunchAgentFiles({
        plan: provisioning.plan,
        serviceArtifact: descriptor(serviceSource, serviceBytes),
        serviceConfiguration: provisioning.serviceConfiguration,
        serviceVersion: "1.0.0",
        supervisorArtifact: descriptor(supervisorSource, supervisorBytes),
        supervisorConfiguration: provisioning.supervisorConfiguration,
        upgradeConfiguration: provisioning.upgradeConfiguration,
      }),
      {
        kind: "staged",
        plistPath,
        stableArtifactPath: slotArtifactPath(kStateDirectory, "stable"),
        supervisorExecutablePath,
      },
    );
    assert.equal(statSync(supervisorExecutablePath).mode & 0o777, 0o500);
    assert.equal(statSync(supervisorConfigurationPath).mode & 0o777, 0o600);
    assert.equal(
      statSync(provisioning.serviceConfiguration.upgradeConfigurationPath)
        .mode & 0o777,
      0o600,
    );
    assert.equal(statSync(plistPath).mode & 0o777, 0o644);
    assert.deepEqual(readFileSync(supervisorExecutablePath), supervisorBytes);
    assert.deepEqual(
      readFileSync(slotArtifactPath(kStateDirectory, "stable")),
      serviceBytes,
    );
    assert.equal(
      readFileSync(join(kStateDirectory, "slots", "stable", "VERSION"), "utf8"),
      "1.0.0",
    );
    const serviceConfigurationDescriptor = openSync(
      provisioning.supervisorConfiguration.serviceConfigurationPath,
      constants.O_RDONLY,
    );
    try {
      assert.deepEqual(
        readNodeKCarrierComputerServiceConfiguration(
          serviceConfigurationDescriptor,
        ),
        provisioning.serviceConfiguration,
      );
    } finally {
      closeSync(serviceConfigurationDescriptor);
    }
    assert.deepEqual(
      readNodeKCarrierComputerUpgradeProcessConfigurationPath(
        provisioning.serviceConfiguration.upgradeConfigurationPath,
      ),
      provisioning.upgradeConfiguration,
    );
    assert.match(
      execFileSync("/usr/bin/plutil", ["-lint", plistPath], {
        encoding: "utf8",
      }),
      /OK/u,
    );
    assert.equal(
      readFileSync(plistPath, "utf8").includes("c".repeat(64)),
      false,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
    rmSync(testSocketDirectory(directory), { force: true, recursive: true });
  }
});

test("macOS installer rejects a tampered artifact before publishing files", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-macos-tamper-"));
  chmodSync(directory, 0o700);
  const source = join(directory, "source");
  writeFileSync(source, "tampered", { mode: 0o500 });
  const provisioning = createTestProvisioning(directory);
  try {
    await assert.rejects(
      installMacOSComputerLaunchAgentFiles({
        plan: provisioning.plan,
        serviceArtifact: {
          path: source,
          sha256: "0".repeat(64),
          size: 8,
        },
        serviceConfiguration: provisioning.serviceConfiguration,
        serviceVersion: "1.0.0",
        supervisorArtifact: {
          path: source,
          sha256: "0".repeat(64),
          size: 8,
        },
        supervisorConfiguration: provisioning.supervisorConfiguration,
        upgradeConfiguration: provisioning.upgradeConfiguration,
      }),
      /artifact digest does not match/u,
    );
    assert.throws(() => statSync(provisioning.plan.plistPath), /ENOENT/u);
  } finally {
    rmSync(directory, { force: true, recursive: true });
    rmSync(testSocketDirectory(directory), { force: true, recursive: true });
  }
});

test("macOS installer rejects aliased private configuration paths before publishing files", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-macos-config-alias-"));
  chmodSync(directory, 0o700);
  const source = join(directory, "source");
  const bytes = Buffer.from("#!/bin/sh\nexit 0\n");
  writeFileSync(source, bytes, { mode: 0o500 });
  const provisioning = createTestProvisioning(directory);
  try {
    await assert.rejects(
      installMacOSComputerLaunchAgentFiles({
        plan: provisioning.plan,
        serviceArtifact: descriptor(source, bytes),
        serviceConfiguration: {
          ...provisioning.serviceConfiguration,
          upgradeConfigurationPath:
            provisioning.supervisorConfiguration.serviceConfigurationPath,
        },
        serviceVersion: "1.0.0",
        supervisorArtifact: descriptor(source, bytes),
        supervisorConfiguration: provisioning.supervisorConfiguration,
        upgradeConfiguration: provisioning.upgradeConfiguration,
      }),
      /configuration paths must be distinct/u,
    );
    assert.throws(
      () => statSync(provisioning.plan.supervisorExecutablePath),
      /ENOENT/u,
    );
    assert.throws(() => statSync(provisioning.plan.plistPath), /ENOENT/u);
  } finally {
    rmSync(directory, { force: true, recursive: true });
    rmSync(testSocketDirectory(directory), { force: true, recursive: true });
  }
});

function descriptor(path: string, bytes: Buffer) {
  return {
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.byteLength,
  };
}

function createTestProvisioning(directory: string) {
  const stateDirectory = join(directory, "installed", "state");
  const publicKeyPem = generateKeyPairSync("ed25519")
    .publicKey.export({ format: "pem", type: "spki" })
    .toString();
  return createMacOSComputerProvisioning({
    executableDirectory: join(directory, "installed", "bin"),
    label: "dev.rah.computer",
    logDirectory: join(directory, "installed", "logs"),
    plistPath: join(directory, "LaunchAgents", "dev.rah.computer.plist"),
    privateConfigurationDirectory: join(directory, "installed", "private"),
    release: {
      baseUrl: "https://releases.example.test/computer",
      publicKeyPem,
    },
    service: {
      activationLeaseMs: 30_000,
      attachmentReconcileIntervalMs: 5_000,
      buildVersion: "1.0.0",
      capacity: 1,
      controlRequestTimeoutMs: 5_000,
      runtimeProtocolVersion: 1,
      runtimeRegistryOwnerId: "runtime-owner-install",
      runtimes: [
        {
          credentialBindings: {},
          offer: {
            leaseMs: 60_000,
            maxConcurrent: 1,
            runtimeOfferId: "offer-install",
          },
          registryDatabasePath: join(stateDirectory, "registry.db"),
          runtimeProfileId: "runtime-install",
        },
      ],
      workspace: {
        cwd: directory,
        mode: "in_place",
        workspaceDefinitionId: "workspace-install",
        workspaceMountDigest: `sha256:${"a".repeat(64)}`,
        workspaceMountRevisionId: "workspace-mount-install-v1",
      },
    },
    socketDirectory: testSocketDirectory(directory),
    stateDirectory,
  });
}

function testSocketDirectory(directory: string): string {
  const digest = createHash("sha256")
    .update(directory, "utf8")
    .digest("hex")
    .slice(0, 12);
  return `/tmp/rahc-installer-${digest}`;
}
