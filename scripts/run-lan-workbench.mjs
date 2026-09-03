import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  prepareRahDataHome,
  startLocalCoreWorkbench,
} from "@rah-os/daemon/local-workbench";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = join(scriptDirectory, "..");
const workspaceCwd = resolve(process.env.RAH_WORKSPACE_CWD ?? process.cwd());
const workbenchHome = await prepareRahDataHome({ environment: process.env });
const { snapshotWorkbenchAssets } = await import("./workbench-web-assets.mjs");
const staticDirectory = await snapshotWorkbenchAssets(
  repositoryDirectory,
  process.env.RAH_WEB_STATIC_DIRECTORY,
);
const { acquireWorkbenchAssetLease, pruneWorkbenchAssetSnapshots } =
  await import("./workbench-web-assets.mjs");
const releaseLease = await acquireWorkbenchAssetLease(
  repositoryDirectory,
  staticDirectory,
);
const publicOrigin = requiredEnvironment("RAH_LAN_ORIGIN");
const certificatePath = optionalEnvironment("RAH_LAN_CERT_PATH");
const privateKeyPath = optionalEnvironment("RAH_LAN_KEY_PATH");

let running;
try {
  running = await startLocalCoreWorkbench({
    environment: process.env,
    mode: {
      bindHost: process.env.RAH_LAN_BIND_HOST?.trim() || "0.0.0.0",
      ...(certificatePath === undefined ? {} : { certificatePath }),
      kind: "lan",
      ...(privateKeyPath === undefined ? {} : { privateKeyPath }),
      publicOrigin,
      tlsDirectory: join(workbenchHome, "tls"),
    },
    staticDirectory,
    workbenchHome,
    workspaceCwd,
  });
  await pruneWorkbenchAssetSnapshots(repositoryDirectory);
  if (!("pairingCode" in running.descriptor)) {
    throw new Error("LAN local Core did not produce a pairing descriptor");
  }
  process.stdout.write(
    `RAH_LAN_WORKBENCH ${JSON.stringify(running.descriptor)}\n`,
  );
  process.stdout.write(
    `Open ${running.descriptor.pairingUrl} on the LAN device and enter ${running.descriptor.pairingCode}.\n`,
  );
  if (running.descriptor.tlsIdentity.managed) {
    process.stdout.write(
      `Trust ${running.descriptor.tlsIdentity.caCertificatePath} on each device before opening RAH OS; never copy the local CA private key.\n`,
    );
  }
  await waitForShutdownSignal();
} finally {
  await running?.stop();
  await releaseLease.release();
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalEnvironment(name) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

async function waitForShutdownSignal() {
  await new Promise((resolvePromise) => {
    const finish = () => resolvePromise();
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
  });
}
