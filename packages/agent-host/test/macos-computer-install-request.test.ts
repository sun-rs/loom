import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readMacOSComputerInstallRequest } from "../src/index.ts";

test("macOS Computer install request is strict, owner-private, and provisioning-valid", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "rah-install-request-"));
  context.after(
    async () => await rm(directory, { force: true, recursive: true }),
  );
  await chmod(directory, 0o700);
  const path = join(directory, "install-request.json");
  const request = validRequest(directory);
  await writeFile(path, `${JSON.stringify(request)}\n`, { mode: 0o600 });
  assert.deepEqual(
    JSON.parse(JSON.stringify(await readMacOSComputerInstallRequest(path))),
    request,
  );

  await writeFile(
    path,
    `${JSON.stringify({ ...request, command: "/bin/sh" })}\n`,
    {
      mode: 0o600,
    },
  );
  await assert.rejects(
    readMacOSComputerInstallRequest(path),
    /shape is invalid/u,
  );

  await writeFile(path, `${JSON.stringify(request)}\n`, { mode: 0o600 });
  await chmod(path, 0o640);
  await assert.rejects(readMacOSComputerInstallRequest(path), /owner-private/u);

  const linkPath = join(directory, "request-link.json");
  await symlink(path, linkPath);
  await assert.rejects(
    readMacOSComputerInstallRequest(linkPath),
    /symbolic link/u,
  );
});

function validRequest(directory: string) {
  const publicKeyPem = generateKeyPairSync("ed25519")
    .publicKey.export({ format: "pem", type: "spki" })
    .toString();
  const artifact = {
    path: join(directory, "rah-os-computer"),
    sha256: "a".repeat(64),
    size: 1024,
  };
  return {
    provisioning: {
      executableDirectory: join(directory, "installed", "bin"),
      label: "dev.rah-os.computer",
      logDirectory: join(directory, "installed", "logs"),
      plistPath: join(directory, "LaunchAgents", "dev.rah-os.computer.plist"),
      privateConfigurationDirectory: join(directory, "installed", "private"),
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
        runtimeRegistryOwnerId: "install-request-runtime-owner",
        runtimes: [
          {
            credentialBindings: {},
            offer: {
              leaseMs: 60_000,
              maxConcurrent: 1,
              runtimeOfferId: "install-request-offer",
            },
            registryDatabasePath: join(directory, "runtime-registry.db"),
            runtimeProfileId: "install-request-runtime",
          },
        ],
        workspace: {
          cwd: directory,
          mode: "in_place",
          workspaceDefinitionId: "install-request-workspace",
          workspaceMountDigest: `sha256:${"a".repeat(64)}`,
          workspaceMountRevisionId: "install-request-mount-v1",
        },
      },
      socketDirectory: join(tmpdir(), `rhi-${String(process.pid)}`),
      stateDirectory: join(directory, "installed", "state"),
    },
    schemaVersion: 1,
    serviceArtifact: artifact,
    serviceVersion: "1.2.3",
    supervisorArtifact: artifact,
  };
}
