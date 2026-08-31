import { randomUUID } from "node:crypto";
import { closeSync, createReadStream, openSync, readFileSync } from "node:fs";
import { access, writeFile } from "node:fs/promises";

import {
  ComputerServiceAttachmentWorkload,
  ComputerUpgradeParkedAttachmentStore,
  recoverNodeKCarrierComputerUpgradeOnServiceStartup,
  readNodeKCarrierComputerUpgradeProcessConfiguration,
  runNodeKCarrierComputerServiceProcess,
} from "../../src/index.ts";

const buildArgument = process.argv.find((value) =>
  value.startsWith("--build-version="),
);
if (buildArgument === undefined) throw new Error("build version is required");
const buildVersion = buildArgument.slice("--build-version=".length);
const config = JSON.parse(readFileSync(3, "utf8"));
const attachmentIdentities = Object.freeze({
  ...config.managedAttachmentIdentities,
});
const serviceGeneration = randomUUID();
const computerInstanceId = randomUUID();
const holdStore = new ComputerUpgradeParkedAttachmentStore({
  stateDir: config.parkedAttachmentStateDir,
});
const attachmentStore = {
  read: async () =>
    Object.entries(attachmentIdentities).map(
      ([attachmentId, connectionId]) => ({
        attachmentId,
        connectionId,
        createdAt: "2026-08-28T00:00:00.000Z",
        hostAccessToken: `rah_host_${"a".repeat(48)}`,
        origin: "https://control.example.test",
      }),
    ),
};
const workload = new ComputerServiceAttachmentWorkload({
  attachmentStore,
  createManager: () => {
    const stopped = new AbortController();
    return {
      run: async ({ signal }) => {
        await waitForAbort(AbortSignal.any([signal, stopped.signal]));
      },
      stop: async () => {
        if (typeof config.holdBarrierPath === "string") {
          while (await exists(config.holdBarrierPath)) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        }
        stopped.abort("fixture attachment manager stopped");
      },
    };
  },
  parkedStore: holdStore,
});
const leaseShutdown = new AbortController();
const supervisorLease = process.argv.includes("--supervisor-fd=4")
  ? createReadStream("", { autoClose: false, fd: 4 })
  : undefined;
supervisorLease?.once("end", () =>
  leaseShutdown.abort("supervisor lease ended"),
);
supervisorLease?.once("error", () =>
  leaseShutdown.abort("supervisor lease failed"),
);
supervisorLease?.resume();

await runNodeKCarrierComputerServiceProcess({
  buildVersion,
  computerInstanceId,
  ownershipControlToken: config.ownershipControlToken,
  serviceGeneration,
  shutdownSignal: leaseShutdown.signal,
  socketDirectory: config.socketDirectory,
  startupRecovery:
    typeof config.upgradeCoordinatorConfigurationPath === "string"
      ? async () =>
          await recoverUpgradeOnStartup(
            config.upgradeCoordinatorConfigurationPath,
          )
      : undefined,
  upgradeControlToken: config.upgradeControlToken,
  workload,
});

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function waitForAbort(signal) {
  if (signal.aborted) return;
  await new Promise((resolve) => {
    signal.addEventListener("abort", resolve, { once: true });
  });
}
if (supervisorLease !== undefined) {
  supervisorLease.destroy();
  closeSync(4);
}

async function recoverUpgradeOnStartup(configurationPath) {
  const descriptor = openSync(configurationPath, "r");
  let configuration;
  try {
    configuration =
      readNodeKCarrierComputerUpgradeProcessConfiguration(descriptor);
  } finally {
    closeSync(descriptor);
  }
  const deadline = Date.now() + 5_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await recoverNodeKCarrierComputerUpgradeOnServiceStartup({
        argumentPrefix: config.upgradeCoordinatorArgumentPrefix,
        configuration,
        configurationPath,
        executablePath:
          config.upgradeCoordinatorExecutablePath ?? process.execPath,
      });
      await writeFile(
        `${configuration.requestPath}.startup-recovery-result`,
        `${JSON.stringify({ result })}\n`,
        { mode: 0o600 },
      );
      if (result.kind === "successor_acknowledged") {
        await writeFile(
          `${configuration.requestPath}.successor-result`,
          `${JSON.stringify({
            result: {
              kind: "ready_acknowledged",
              operationId: result.operationId,
            },
          })}\n`,
          { mode: 0o600 },
        );
      }
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  await writeFile(
    `${configuration.requestPath}.startup-recovery-result`,
    `${JSON.stringify({
      error: lastError instanceof Error ? lastError.message : String(lastError),
    })}\n`,
    { mode: 0o600 },
  );
}
