import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  chmodSync,
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { bootstrapStable } from "@rah-os/k-carrier";

import {
  computerServiceSupervisorControlSocketPath,
  createComputerServiceOwnershipProofToken,
  NODE_K_CARRIER_COMPUTER_SUPERVISOR_CONFIGURATION_SCHEMA_VERSION,
  NodeComputerServiceSupervisorControlClient,
  readNodeKCarrierComputerSupervisorConfiguration,
  readNodeKCarrierComputerSupervisorConfigurationPath,
  runNodeKCarrierComputerSupervisorCommand,
  runNodeKCarrierComputerSupervisorProcess,
} from "../src/index.ts";

test("Node Computer supervisor process owns the service and authenticated handoff socket", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-sup-proc-"));
  chmodSync(directory, 0o700);
  const kStateDir = join(directory, "k");
  const socketDirectory = join(directory, "s");
  await Promise.all(
    [kStateDir, socketDirectory].map(
      async (path) => await mkdir(path, { mode: 0o700 }),
    ),
  );
  const serviceFixturePath = join(
    import.meta.dirname,
    "fixtures",
    "k-supervised-service-child.mjs",
  );
  const sourceArtifactPath = join(directory, "source-service");
  writeFileSync(
    sourceArtifactPath,
    `#!/bin/sh\nexec "${process.execPath}" "${serviceFixturePath}" "$@"\n`,
    { mode: 0o500 },
  );
  await bootstrapStable({
    artifactPath: sourceArtifactPath,
    stateDir: kStateDir,
    version: "1.0.0",
  });
  const readyPath = join(directory, "service-ready.json");
  const serviceConfigurationPath = join(directory, "service.json");
  writeFileSync(
    serviceConfigurationPath,
    JSON.stringify({ configSecret: "private", readyPath }),
    { mode: 0o600 },
  );
  const controlToken = createComputerServiceOwnershipProofToken();
  const configuration = {
    controlToken,
    handoffTimeoutMs: 1_000,
    serviceArgumentPrefix: [],
    serviceConfigurationPath,
    socketDirectory,
    stateDir: kStateDir,
    stopTimeoutMs: 1_000,
  };
  const configurationPath = join(directory, "supervisor.json");
  writeFileSync(
    configurationPath,
    `${JSON.stringify({
      configuration,
      schemaVersion:
        NODE_K_CARRIER_COMPUTER_SUPERVISOR_CONFIGURATION_SCHEMA_VERSION,
    })}\n`,
    { mode: 0o600 },
  );
  const descriptor = openSync(configurationPath, "r");
  let parsed;
  try {
    parsed = readNodeKCarrierComputerSupervisorConfiguration(descriptor);
  } finally {
    closeSync(descriptor);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), configuration);
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        readNodeKCarrierComputerSupervisorConfigurationPath(configurationPath),
      ),
    ),
    configuration,
  );

  const signals = new EventEmitter();
  let replacementProcessId: number | undefined;
  try {
    const running = runNodeKCarrierComputerSupervisorProcess({
      configuration: parsed,
      signalSource: signals,
    });
    const initial = (await waitForJson(readyPath)) as { processId: number };
    const client = new NodeComputerServiceSupervisorControlClient({
      controlToken,
      socketPath: computerServiceSupervisorControlSocketPath(socketDirectory),
      timeoutMs: 1_000,
    });
    assert.deepEqual(
      await client.stopForHandoff({ expectedProcessId: initial.processId }),
      { kind: "handoff_waiting" },
    );
    const replacement = await client.startForHandoff("stable");
    assert.equal(replacement.kind, "running");
    if (replacement.kind !== "running") assert.fail("replacement did not run");
    replacementProcessId = replacement.processId;
    assert.notEqual(replacementProcessId, initial.processId);
    signals.emit("SIGTERM");
    assert.deepEqual(await running, { kind: "closed" });
    await waitUntil(() => !alive(replacementProcessId!), 2_000);
  } finally {
    if (replacementProcessId !== undefined && alive(replacementProcessId)) {
      process.kill(replacementProcessId, "SIGKILL");
    }
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Node Computer supervisor configuration rejects group-readable files", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-sup-config-"));
  chmodSync(directory, 0o700);
  const configurationPath = join(directory, "supervisor.json");
  writeFileSync(configurationPath, "{}", { mode: 0o644 });
  const descriptor = openSync(configurationPath, "r");
  try {
    assert.throws(
      () => readNodeKCarrierComputerSupervisorConfiguration(descriptor),
      /owner-private/u,
    );
  } finally {
    closeSync(descriptor);
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Node Computer supervisor configuration path refuses symlinks", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-sup-config-link-"));
  chmodSync(directory, 0o700);
  const targetPath = join(directory, "target.json");
  const linkPath = join(directory, "configuration.json");
  writeFileSync(targetPath, "{}", { mode: 0o600 });
  symlinkSync(targetPath, linkPath);
  try {
    assert.throws(
      () => readNodeKCarrierComputerSupervisorConfigurationPath(linkPath),
      /must not be a symlink/u,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Node Computer supervisor command accepts only the launchd contract and maps fatal completion", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-sup-command-"));
  chmodSync(directory, 0o700);
  const configurationPath = join(directory, "supervisor.json");
  const configuration = {
    controlToken: "a".repeat(64),
    handoffTimeoutMs: 1_000,
    serviceArgumentPrefix: [],
    serviceConfigurationPath: join(directory, "service.json"),
    socketDirectory: join(directory, "sockets"),
    stateDir: join(directory, "k"),
    stopTimeoutMs: 1_000,
  };
  writeFileSync(
    configurationPath,
    `${JSON.stringify({
      configuration,
      schemaVersion:
        NODE_K_CARRIER_COMPUTER_SUPERVISOR_CONFIGURATION_SCHEMA_VERSION,
    })}\n`,
    { mode: 0o600 },
  );
  const observed: unknown[] = [];
  try {
    assert.equal(
      await runNodeKCarrierComputerSupervisorCommand(
        ["__computer-supervisor", "--config-path", configurationPath],
        {
          runSupervisor: async (input) => {
            observed.push(input.configuration);
            return { kind: "closed" };
          },
        },
      ),
      0,
    );
    assert.deepEqual(observed, [configuration]);
    assert.equal(
      await runNodeKCarrierComputerSupervisorCommand(
        ["__computer-supervisor", "--config-path", configurationPath],
        {
          runSupervisor: async () => ({
            kind: "fatal",
            reason: "child_exited",
          }),
        },
      ),
      1,
    );
    await assert.rejects(
      runNodeKCarrierComputerSupervisorCommand(
        ["__computer-supervisor", "--config-path", "relative.json"],
        { runSupervisor: async () => ({ kind: "closed" }) },
      ),
      /absolute path/u,
    );
    await assert.rejects(
      runNodeKCarrierComputerSupervisorCommand(
        ["__computer-supervisor", "--config-path", configurationPath, "x"],
        { runSupervisor: async () => ({ kind: "closed" }) },
      ),
      /usage/u,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

async function waitForJson(path: string): Promise<unknown> {
  let value: unknown;
  await waitUntil(() => {
    try {
      value = JSON.parse(readFileSync(path, "utf8")) as unknown;
      return true;
    } catch {
      return false;
    }
  }, 3_000);
  return value;
}

function alive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
