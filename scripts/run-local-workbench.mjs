import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DaemonApplication,
  LocalWorkbenchGateway,
  discoverKnownLocalClis,
  localCliRuntimeSpec,
  prepareLocalWorkbench,
} from "@rah-os/daemon";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = join(scriptDirectory, "..");
const workspaceCwd = resolve(process.env.RAH_WORKSPACE_CWD ?? process.cwd());
const workbenchHome = resolve(
  process.env.RAH_OS_HOME?.trim() || defaultWorkbenchHome(),
);
const stateDirectory = join(workbenchHome, "state");
const staticDirectory = join(repositoryDirectory, "apps", "web", "dist");
const webPort = Number(process.env.RAH_WEB_PORT ?? "4173");
if (!Number.isInteger(webPort) || webPort < 1 || webPort > 65_535) {
  throw new Error("RAH_WEB_PORT must be an integer between 1 and 65535");
}
if (!existsSync(staticDirectory)) {
  throw new Error(
    `The production Web build is missing at ${staticDirectory}. Run npm run build:web:workbench first.`,
  );
}

const discovered = await discoverKnownLocalClis();
const runtimeSpecs = discovered.flatMap((candidate) => {
  if (!candidate.available) return [];
  const spec = localCliRuntimeSpec(candidate.executable, workspaceCwd);
  return spec === undefined ? [] : [spec];
});
if (runtimeSpecs.length === 0) {
  throw new Error(
    "No supported local Agent CLI was found. Install and sign in to Codex, Kimi, OpenCode, or Claude Code.",
  );
}

const prepared = await prepareLocalWorkbench({
  runtimeSpecs,
  stateDirectory,
  workspaceCwd,
});
const application = new DaemonApplication({ config: prepared.config });
const shutdown = new AbortController();
const running = application.run({ signal: shutdown.signal });
let gateway;
try {
  await waitUntil(() => application.clientOrigin() !== undefined, 15_000);
  gateway = new LocalWorkbenchGateway({
    accessToken: prepared.humanAccessToken,
    daemonOrigin: application.clientOrigin(),
    port: webPort,
    staticDirectory,
  });
  await gateway.start();
  process.stdout.write(
    `RAH_LOCAL_WORKBENCH ${JSON.stringify({
      defaultRoomId: prepared.metadata.defaultRoomId,
      persistent: true,
      runtimes: runtimeSpecs.map(({ cliId, displayName }) => ({
        cliId,
        displayName,
      })),
      stateDirectory,
      webOrigin: gateway.origin,
      workspaceCwd,
      workspaceId: prepared.metadata.workspaceId,
    })}\n`,
  );
  process.stdout.write(`Open ${gateway.origin} in Firefox or Chrome.\n`);
  await waitForShutdownSignal();
} finally {
  await gateway?.stop().catch(() => undefined);
  shutdown.abort("local-workbench-shutdown");
  await running.catch(() => undefined);
}

function defaultWorkbenchHome() {
  return process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support", "RAH OS")
    : join(homedir(), ".local", "share", "rah-os");
}

async function waitUntil(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("local workbench daemon startup timed out");
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
}

async function waitForShutdownSignal() {
  await new Promise((resolvePromise) => {
    const finish = () => resolvePromise();
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
  });
}
