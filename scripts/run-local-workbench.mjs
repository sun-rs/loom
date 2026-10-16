import { writeLaunchReceipt } from "./workbench-launch-receipt.mjs";
import { workbenchLaunchMode } from "./workbench-launch-mode.mjs";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  acquireWorkbenchAssetLease,
  pruneWorkbenchAssetSnapshots,
  readWorkbenchAssetIdentity,
  snapshotWorkbenchAssets,
} from "./workbench-web-assets.mjs";
import { workbenchDaemonIdentityEnvironment } from "./release-version.mjs";
import { assertRahOsRepositoryIdentity } from "./repository-identity.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = join(scriptDirectory, "..");
await assertRahOsRepositoryIdentity({
  commandCwd: process.cwd(),
  repositoryDirectory,
});
const workspaceCwd = resolve(process.env.RAH_WORKSPACE_CWD ?? process.cwd());
const staticDirectory = await snapshotWorkbenchAssets(
  repositoryDirectory,
  process.env.RAH_WEB_STATIC_DIRECTORY,
);
// The daemon must report the identity of the bundle it is actually serving, in
// development too. Apply it before the daemon module is loaded, because the
// build identity is resolved once at import time. An identity already in the
// environment wins but must agree with the bundle.
Object.assign(
  process.env,
  workbenchDaemonIdentityEnvironment({
    bundleIdentity: await readWorkbenchAssetIdentity(staticDirectory),
    environment: process.env,
  }),
);
const { prepareRahDataHome, startRestartableLocalCoreWorkbench } =
  await import("@rah-os/daemon/local-workbench");
const workbenchHome = await prepareRahDataHome({ environment: process.env });
const releaseLease = await acquireWorkbenchAssetLease(
  repositoryDirectory,
  staticDirectory,
);

const launchMode = workbenchLaunchMode(process.env, workbenchHome);
let running;
try {
  running = await startRestartableLocalCoreWorkbench({
    environment: process.env,
    mode: launchMode,
    staticDirectory,
    workbenchHome,
    workspaceCwd,
  });
  await writeLaunchReceipt(join(workbenchHome, "state"), launchMode);
  await pruneWorkbenchAssetSnapshots(repositoryDirectory);
  process.stdout.write(
    `RAH_LOCAL_WORKBENCH ${JSON.stringify(running.descriptor)}\n`,
  );
  process.stdout.write(
    `Open ${running.descriptor.webOrigin} in Firefox or Chrome.\n`,
  );
  await Promise.race([
    waitForShutdownSignal(),
    running.failed.then((error) => {
      throw error;
    }),
  ]);
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
