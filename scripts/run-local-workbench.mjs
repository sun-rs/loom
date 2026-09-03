import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  prepareRahDataHome,
  startLocalCoreWorkbench,
} from "@rah-os/daemon/local-workbench";
import {
  acquireWorkbenchAssetLease,
  pruneWorkbenchAssetSnapshots,
  snapshotWorkbenchAssets,
} from "./workbench-web-assets.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = join(scriptDirectory, "..");
const workspaceCwd = resolve(process.env.RAH_WORKSPACE_CWD ?? process.cwd());
const workbenchHome = await prepareRahDataHome({ environment: process.env });
const staticDirectory = await snapshotWorkbenchAssets(
  repositoryDirectory,
  process.env.RAH_WEB_STATIC_DIRECTORY,
);
const webPort = Number(process.env.RAH_WEB_PORT ?? "4173");
const releaseLease = await acquireWorkbenchAssetLease(
  repositoryDirectory,
  staticDirectory,
);

let running;
try {
  running = await startLocalCoreWorkbench({
    environment: process.env,
    mode: { kind: "loopback", port: webPort },
    staticDirectory,
    workbenchHome,
    workspaceCwd,
  });
  await pruneWorkbenchAssetSnapshots(repositoryDirectory);
  process.stdout.write(
    `RAH_LOCAL_WORKBENCH ${JSON.stringify(running.descriptor)}\n`,
  );
  process.stdout.write(
    `Open ${running.descriptor.webOrigin} in Firefox or Chrome.\n`,
  );
  await waitForShutdownSignal();
} finally {
  await running?.stop();
  await releaseLease.release();
}

async function waitForShutdownSignal() {
  await new Promise((resolvePromise) => {
    const finish = () => resolvePromise();
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
  });
}
