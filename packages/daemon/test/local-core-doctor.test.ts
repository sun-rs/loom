import assert from "node:assert/strict";
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

import { provisionLanCertificate } from "../src/lan-certificate-provisioning.ts";
import { diagnoseLocalCore } from "../src/local-core-doctor.ts";

test("local Core doctor proves start readiness without initializing product state", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-local-core-doctor-"));
  try {
    const workspaceCwd = join(directory, "workspace");
    const staticDirectory = join(directory, "dist");
    const stateDirectory = join(directory, "state-not-created");
    const tlsDirectory = join(directory, "tls");
    mkdirSync(workspaceCwd, { mode: 0o700 });
    mkdirSync(staticDirectory, { mode: 0o700 });
    writeFileSync(join(staticDirectory, "index.html"), "<!doctype html>");
    const provisioned = provisionLanCertificate({
      directory: tlsDirectory,
      publicHostname: "127.0.0.1",
    });

    const report = await diagnoseLocalCore({
      runtimeInventory: [availableRuntime()],
      stateDirectory,
      staticDirectory,
      tls: {
        directory: tlsDirectory,
        kind: "managed",
        publicHostname: "127.0.0.1",
      },
      workspaceCwd,
    });

    assert.equal(report.readyToStart, true);
    assert.equal(
      report.checks.find(({ id }) => id === "state")?.status,
      "notice",
    );
    assert.equal(
      report.checks.find(({ id }) => id === "lan-tls")?.status,
      "pass",
    );
    assert.deepEqual(report.manualActions, ["trust-lan-ca-on-client-devices"]);
    assert.equal(JSON.stringify(report).includes("privateKeyPath"), false);
    assert.equal(JSON.stringify(report).includes("token"), false);
    assert.throws(
      () => chmodSync(stateDirectory, 0o700),
      /ENOENT/u,
      "doctor must not initialize state",
    );

    const external = await diagnoseLocalCore({
      runtimeInventory: [availableRuntime()],
      stateDirectory,
      staticDirectory,
      tls: {
        certificatePath: provisioned.certificatePath,
        kind: "external",
        privateKeyPath: provisioned.privateKeyPath,
        publicHostname: "127.0.0.1",
      },
      workspaceCwd,
    });
    assert.equal(external.readyToStart, true);
    assert.deepEqual(external.manualActions, []);
    assert.match(
      external.checks.find(({ id }) => id === "lan-tls")?.detail ?? "",
      /External LAN TLS identity/u,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("local Core doctor reports unavailable runtimes and unsafe TLS as failures", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-local-core-doctor-"));
  try {
    const workspaceCwd = join(directory, "workspace");
    const staticDirectory = join(directory, "dist");
    const tlsDirectory = join(directory, "tls");
    mkdirSync(workspaceCwd, { mode: 0o700 });
    mkdirSync(staticDirectory, { mode: 0o700 });
    writeFileSync(join(staticDirectory, "index.html"), "<!doctype html>");
    provisionLanCertificate({
      directory: tlsDirectory,
      publicHostname: "127.0.0.1",
    });
    chmodSync(tlsDirectory, 0o755);

    const report = await diagnoseLocalCore({
      runtimeInventory: [{ ...availableRuntime(), available: false }],
      stateDirectory: join(directory, "state"),
      staticDirectory,
      tls: {
        directory: tlsDirectory,
        kind: "managed",
        publicHostname: "127.0.0.1",
      },
      workspaceCwd,
    });

    assert.equal(report.readyToStart, false);
    assert.equal(
      report.checks.find(({ id }) => id === "runtime")?.status,
      "fail",
    );
    assert.equal(
      report.checks.find(({ id }) => id === "lan-tls")?.status,
      "fail",
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

function availableRuntime() {
  return {
    agentBindings: [],
    available: true,
    configured: false,
    displayName: "Codex",
    executable: "codex",
    modelBindingDescriptors: [],
    resolvedExecutablePath: "/opt/test/bin/codex",
    source: "discovered" as const,
    version: "codex-test",
  };
}
