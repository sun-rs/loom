import assert from "node:assert/strict";
import test from "node:test";

import {
  runMacOSComputerInstallCommand,
  type MacOSComputerInstallRequest,
  type MacOSComputerInstallationOptions,
} from "../src/index.ts";

test("macOS Computer install command is explicit and emits a redacted result", async () => {
  const request = installRequest();
  const reads: string[] = [];
  const installs: MacOSComputerInstallationOptions[] = [];
  const output = await runMacOSComputerInstallCommand(
    [
      "--request",
      "/private/tmp/install.json",
      "--activate",
      "--replace-loaded",
    ],
    {
      install: async (options) => {
        installs.push(options);
        return {
          kind: "replaced",
          serviceTarget: "gui/501/dev.rah-os.computer",
          staged: {
            kind: "staged",
            plistPath: "/Users/test/Library/LaunchAgents/dev.rah.plist",
            stableArtifactPath: "/Users/test/Library/RAH/k/stable/artifact",
            supervisorExecutablePath:
              "/Users/test/Library/RAH/bin/rah-os-computer",
          },
        };
      },
      readRequest: async (path) => {
        reads.push(path);
        return request;
      },
    },
  );
  assert.deepEqual(reads, ["/private/tmp/install.json"]);
  assert.deepEqual(installs, [
    {
      activate: true,
      provisioning: request.provisioning,
      replaceLoaded: true,
      serviceArtifact: request.serviceArtifact,
      serviceVersion: request.serviceVersion,
      supervisorArtifact: request.supervisorArtifact,
    },
  ]);
  assert.deepEqual(JSON.parse(output), {
    kind: "replaced",
    serviceTarget: "gui/501/dev.rah-os.computer",
    staged: {
      plistPath: "/Users/test/Library/LaunchAgents/dev.rah.plist",
      stableArtifactPath: "/Users/test/Library/RAH/k/stable/artifact",
      supervisorExecutablePath: "/Users/test/Library/RAH/bin/rah-os-computer",
    },
  });
});

test("macOS Computer install command defaults to staging and rejects ambiguous arguments", async () => {
  const request = installRequest();
  let observed: MacOSComputerInstallationOptions | undefined;
  await runMacOSComputerInstallCommand(
    ["--request", "/private/tmp/install.json"],
    {
      install: async (options) => {
        observed = options;
        return {
          kind: "staged",
          serviceTarget: "gui/501/dev.rah-os.computer",
          staged: {
            kind: "staged",
            plistPath: "/a",
            stableArtifactPath: "/b",
            supervisorExecutablePath: "/c",
          },
        };
      },
      readRequest: async () => request,
    },
  );
  assert.equal(observed?.activate, false);
  assert.equal(observed?.replaceLoaded, false);

  await assert.rejects(
    runMacOSComputerInstallCommand(["--activate"], {
      install: async () => assert.fail("must not install"),
      readRequest: async () => assert.fail("must not read"),
    }),
    /--request is required/u,
  );
  await assert.rejects(
    runMacOSComputerInstallCommand(["--request", "/a", "--request", "/b"], {
      install: async () => assert.fail("must not install"),
      readRequest: async () => assert.fail("must not read"),
    }),
    /must be specified once/u,
  );
  await assert.rejects(
    runMacOSComputerInstallCommand(["--shell", "/bin/sh"], {
      install: async () => assert.fail("must not install"),
      readRequest: async () => assert.fail("must not read"),
    }),
    /unknown argument/u,
  );
});

test("macOS Computer install command help is side-effect free", async () => {
  const output = await runMacOSComputerInstallCommand(["--help"], {
    install: async () => assert.fail("must not install"),
    readRequest: async () => assert.fail("must not read"),
  });
  assert.match(output, /--request <absolute-request.json>/u);
  assert.match(output, /default: stage files only/u);
});

function installRequest(): MacOSComputerInstallRequest {
  const artifact = Object.freeze({
    path: "/private/tmp/rah-os-computer",
    sha256: "a".repeat(64),
    size: 1024,
  });
  return Object.freeze({
    provisioning: Object.freeze(
      {},
    ) as MacOSComputerInstallRequest["provisioning"],
    schemaVersion: 1,
    serviceArtifact: artifact,
    serviceVersion: "1.2.3",
    supervisorArtifact: artifact,
  });
}
