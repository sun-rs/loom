import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createMacOSComputerProvisioning,
  NODE_K_CARRIER_COMPUTER_SERVICE_CONFIGURATION_SCHEMA_VERSION,
  NODE_K_CARRIER_COMPUTER_SUPERVISOR_CONFIGURATION_SCHEMA_VERSION,
  NODE_K_CARRIER_COMPUTER_UPGRADE_PROCESS_CONFIGURATION_SCHEMA_VERSION,
  resolveMacOSComputerProvisioning,
  type MacOSComputerProvisioningInput,
} from "../src/index.ts";

function input(root: string): MacOSComputerProvisioningInput {
  const publicKey = generateKeyPairSync("ed25519").publicKey.export({
    format: "pem",
    type: "spki",
  });
  return {
    executableDirectory: join(root, "bin"),
    label: "dev.rah.computer",
    logDirectory: join(root, "logs"),
    plistPath: join(root, "LaunchAgents", "dev.rah.computer.plist"),
    privateConfigurationDirectory: join(root, "private"),
    release: {
      baseUrl: "https://releases.example.test/computer",
      publicKeyPem: publicKey.toString(),
    },
    service: {
      activationLeaseMs: 30_000,
      attachmentReconcileIntervalMs: 5_000,
      buildVersion: "1.2.3",
      capacity: 2,
      controlRequestTimeoutMs: 5_000,
      runtimeProtocolVersion: 1,
      runtimeRegistryOwnerId: "computer-runtime-owner",
      runtimes: [
        {
          credentialBindings: {},
          offer: {
            leaseMs: 60_000,
            maxConcurrent: 2,
            runtimeOfferId: "offer-primary",
          },
          registryDatabasePath: join(root, "runtime-registry.db"),
          runtimeProfileId: "runtime-primary",
        },
      ],
      workspace: {
        cwd: root,
        mode: "in_place",
        workspaceDefinitionId: "workspace-primary",
        workspaceMountDigest: `sha256:${"a".repeat(64)}`,
        workspaceMountRevisionId: "workspace-mount-primary-v1",
      },
    },
    stateDirectory: join(root, "state"),
  };
}

test("macOS provisioning derives one exact service/upgrade/supervisor closure", () => {
  const root = "/tmp/rah-computer-provisioning";
  const tokens = ["1".repeat(64), "2".repeat(64), "3".repeat(64)];
  const provisioning = createMacOSComputerProvisioning(input(root), {
    createToken: () => tokens.shift()!,
  });

  assert.equal(provisioning.plan.stateDirectory, join(root, "state"));
  assert.equal(
    provisioning.plan.supervisorExecutablePath,
    join(root, "bin", "rah-os-computer"),
  );
  assert.equal(
    provisioning.serviceConfiguration.upgradeConfigurationPath,
    join(root, "private", "upgrade.json"),
  );
  assert.equal(
    provisioning.supervisorConfiguration.serviceConfigurationPath,
    join(root, "private", "service.json"),
  );
  assert.equal(
    provisioning.upgradeConfiguration.serviceConfigurationPath,
    provisioning.supervisorConfiguration.serviceConfigurationPath,
  );
  assert.equal(
    provisioning.upgradeConfiguration.attachmentStatePath,
    provisioning.serviceConfiguration.attachmentStatePath,
  );
  assert.equal(
    provisioning.upgradeConfiguration.stateDir,
    provisioning.plan.kStateDirectory,
  );
  assert.equal(
    provisioning.upgradeConfiguration.supervisorControlToken,
    provisioning.supervisorConfiguration.controlToken,
  );
  assert.equal(
    provisioning.supervisorConfiguration.controlToken,
    "1".repeat(64),
  );
  assert.equal(
    provisioning.upgradeConfiguration.ownershipControlToken,
    "2".repeat(64),
  );
  assert.equal(
    provisioning.upgradeConfiguration.upgradeControlToken,
    "3".repeat(64),
  );
  assert.equal(provisioning.plan.plist.includes("1".repeat(64)), false);
  assert.equal(
    "command" in provisioning.serviceConfiguration ||
      "env" in provisioning.serviceConfiguration,
    false,
  );
});

test("macOS provisioning rejects weak or reused control capabilities", () => {
  const root = "/tmp/rah-computer-provisioning-invalid";
  assert.throws(
    () =>
      createMacOSComputerProvisioning(input(root), {
        createToken: () => "same-token",
      }),
    /control capability/u,
  );
  assert.throws(
    () =>
      createMacOSComputerProvisioning(input(root), {
        createToken: () => "a".repeat(64),
      }),
    /control capabilities must be unique/u,
  );
});

test("macOS provisioning resumes an exact staged capability closure and rejects partial or conflicting state", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "rah-provisioning-resume-"));
  context.after(async () => await rm(root, { force: true, recursive: true }));
  await chmod(root, 0o700);
  const configurationDirectory = join(root, "private");
  await mkdir(configurationDirectory, { mode: 0o700 });
  const request = input(root);
  const tokens = ["1".repeat(64), "2".repeat(64), "3".repeat(64)];
  const staged = createMacOSComputerProvisioning(request, {
    createToken: () => tokens.shift()!,
  });
  const paths = {
    service: join(configurationDirectory, "service.json"),
    supervisor: join(configurationDirectory, "supervisor.json"),
    upgrade: join(configurationDirectory, "upgrade.json"),
  };
  await writeConfiguration(
    paths.service,
    NODE_K_CARRIER_COMPUTER_SERVICE_CONFIGURATION_SCHEMA_VERSION,
    staged.serviceConfiguration,
  );
  await assert.rejects(
    resolveMacOSComputerProvisioning(request),
    /configuration set is incomplete/u,
  );
  await writeConfiguration(
    paths.supervisor,
    NODE_K_CARRIER_COMPUTER_SUPERVISOR_CONFIGURATION_SCHEMA_VERSION,
    staged.supervisorConfiguration,
  );
  await writeConfiguration(
    paths.upgrade,
    NODE_K_CARRIER_COMPUTER_UPGRADE_PROCESS_CONFIGURATION_SCHEMA_VERSION,
    staged.upgradeConfiguration,
  );
  const resumed = await resolveMacOSComputerProvisioning(request);
  assert.deepEqual(resumed, staged);

  await writeConfiguration(
    paths.service,
    NODE_K_CARRIER_COMPUTER_SERVICE_CONFIGURATION_SCHEMA_VERSION,
    {
      ...staged.serviceConfiguration,
      runtimeRegistryOwnerId: "conflicting-owner",
    },
  );
  await assert.rejects(
    resolveMacOSComputerProvisioning(request),
    /conflicts with the install request/u,
  );
});

async function writeConfiguration(
  path: string,
  schemaVersion: number,
  configuration: unknown,
): Promise<void> {
  await writeFile(
    path,
    `${JSON.stringify({ configuration, schemaVersion })}\n`,
    { mode: 0o600 },
  );
}
