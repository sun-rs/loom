import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runMacOSLocalCoreProductOperator } from "../src/macos-local-core-product-operator.ts";

test("embedded product operator installs its verified product without source paths", async () => {
  let observedProgramArguments: readonly string[] = [];
  const result = await runMacOSLocalCoreProductOperator(
    [
      "--mode",
      "loopback",
      "--workspace",
      "/Users/test/workspace",
      "--activate",
    ],
    {
      discover: async () => [
        {
          agentBindings: [],
          available: true,
          configured: false,
          displayName: "Codex",
          executable: "codex",
          modelBindingDescriptors: [],
          resolvedExecutablePath: "/opt/homebrew/bin/codex",
          source: "discovered",
          version: "1.2.3",
        },
      ],
      environment: { PATH: "/opt/homebrew/bin:/usr/bin" },
      inspectProduct: async () => ({
        executablePath: "/Applications/RAH OS/bin/rah-os-core",
        nodeCarrierVersion: "v26.8.1",
        platformKey: "darwin-arm64",
        productDirectory: "/Applications/RAH OS",
        runnerIntegrity: { sha256: "a".repeat(64), size: 100 },
        staticDirectory: "/Applications/RAH OS/web",
        version: "0.1.0",
      }),
      install: async ({ plan }) => {
        observedProgramArguments = plan.programArguments;
        return {
          kind: "activated",
          serviceTarget: "gui/501/dev.rah-os.local-core",
          staged: { kind: "staged", plistPath: plan.plistPath },
        };
      },
      platform: "darwin",
      productDirectory: "/Applications/RAH OS",
      userHomeDirectory: "/Users/test",
    },
  );
  assert.equal(result.kind, "install");
  assert.deepEqual(observedProgramArguments, [
    "/Applications/RAH OS/bin/rah-os-core",
    "__local-core-service",
  ]);
  if (result.kind !== "install") throw new Error("expected install result");
  assert.equal(result.sourceBound, false);
  assert.equal(result.product.version, "0.1.0");
  assert.equal(result.availableRuntimes[0]?.version, "1.2.3");
});

test("embedded product operator uninstalls without inspecting the product", async () => {
  let inspected = false;
  const result = await runMacOSLocalCoreProductOperator(
    ["--uninstall", "--purge-data"],
    {
      inspectProduct: async () => {
        inspected = true;
        throw new Error("must not inspect");
      },
      platform: "darwin",
      uninstall: async (input) => ({
        dataPurged: input.purgeData === true,
        kind: "uninstalled",
        plistRemoved: true,
        serviceTarget: "gui/501/dev.rah-os.local-core",
      }),
      userHomeDirectory: "/Users/test",
    },
  );
  assert.equal(inspected, false);
  assert.equal(result.kind, "uninstall");
  if (result.kind !== "uninstall") throw new Error("expected uninstall result");
  assert.equal(result.purgeData, true);
  assert.equal(result.result.dataPurged, true);
});

test("embedded product quick start creates one private workspace and activates loopback", async () => {
  const userHomeDirectory = mkdtempSync(join(tmpdir(), "rah-os-quick-start-"));
  try {
    let activated = false;
    let workspace = "";
    const result = await runMacOSLocalCoreProductOperator(["--quick-start"], {
      discover: async () => [
        {
          agentBindings: [],
          available: true,
          configured: false,
          displayName: "Codex",
          executable: "codex",
          modelBindingDescriptors: [],
          resolvedExecutablePath: "/opt/homebrew/bin/codex",
          source: "discovered",
          version: "1.2.3",
        },
      ],
      environment: { PATH: "/opt/homebrew/bin:/usr/bin" },
      inspectProduct: async () => ({
        executablePath: "/Applications/RAH OS/bin/rah-os-core",
        nodeCarrierVersion: "v26.8.1",
        platformKey: "darwin-arm64",
        productDirectory: "/Applications/RAH OS",
        runnerIntegrity: { sha256: "a".repeat(64), size: 100 },
        staticDirectory: "/Applications/RAH OS/web",
        version: "0.1.0",
      }),
      install: async (input) => {
        activated = input.activate === true;
        workspace = input.plan.workspaceCwd;
        return {
          kind: "activated",
          serviceTarget: "gui/501/dev.rah-os.local-core",
          staged: { kind: "staged", plistPath: input.plan.plistPath },
        };
      },
      platform: "darwin",
      productDirectory: "/Applications/RAH OS",
      userHomeDirectory,
    });
    assert.equal(result.kind, "install");
    if (result.kind !== "install") throw new Error("expected install result");
    assert.equal(activated, true);
    assert.equal(workspace, join(userHomeDirectory, "RAH OS Workspace"));
    assert.equal(result.healthOrigin, "http://127.0.0.1:4173");
    assert.equal(existsSync(workspace), true);
  } finally {
    rmSync(userHomeDirectory, { force: true, recursive: true });
  }
});
