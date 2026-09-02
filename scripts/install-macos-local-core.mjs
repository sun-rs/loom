import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { snapshotWorkbenchAssets } from "./workbench-web-assets.mjs";

import {
  MACOS_LOCAL_CORE_INSTALL_USAGE,
  createMacOSLocalCoreLaunchAgentPlan,
  describeMacOSLocalCoreRunner,
  discoverKnownLocalClis,
  installMacOSLocalCore,
  inspectLocalCoreProduct,
  parseMacOSLocalCoreInstallArguments,
  prepareRahDataHome,
  uninstallMacOSLocalCore,
} from "@rah-os/daemon";

const parsed = parseMacOSLocalCoreInstallArguments(process.argv.slice(2));
if ("help" in parsed) {
  process.stdout.write(MACOS_LOCAL_CORE_INSTALL_USAGE);
  process.exit(0);
}
if (process.platform !== "darwin") {
  throw new Error("the local Core LaunchAgent installer requires macOS");
}

const userHomeDirectory = homedir();
const workbenchHome =
  parsed.home ??
  (await prepareRahDataHome({
    environment: process.env,
    userHomeDirectory,
  }));
const label = "dev.rah-os.local-core";
const plistPath = join(
  userHomeDirectory,
  "Library",
  "LaunchAgents",
  `${label}.plist`,
);
if ("uninstall" in parsed) {
  const result = await uninstallMacOSLocalCore({
    label,
    plistPath,
    workbenchHome,
  });
  process.stdout.write(
    `RAH_MACOS_LOCAL_CORE_UNINSTALL ${JSON.stringify(result)}\n`,
  );
  process.exit(0);
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = resolve(scriptDirectory, "..");
const product =
  parsed.productDirectory === undefined
    ? undefined
    : await inspectLocalCoreProduct(parsed.productDirectory);
const serviceExecutablePath = product?.executablePath ?? process.execPath;
const pathEntries = Array.from(
  new Set([
    dirname(serviceExecutablePath),
    dirname(process.execPath),
    ...(process.env.PATH ?? "")
      .split(delimiter)
      .filter((entry) => isAbsolute(entry)),
  ]),
);
const inventory = await discoverKnownLocalClis({
  environment: { ...process.env, PATH: pathEntries.join(delimiter) },
});
const availableRuntimes = inventory.filter(({ available }) => available);
if (availableRuntimes.length === 0) {
  throw new Error(
    "No supported local Agent CLI was found; install and sign in before staging the Core",
  );
}

const runnerScriptPath =
  product?.executablePath ??
  join(
    repositoryDirectory,
    "scripts",
    parsed.mode === "lan" ? "run-lan-workbench.mjs" : "run-local-workbench.mjs",
  );
const runnerIntegrity =
  product?.runnerIntegrity ??
  (await describeMacOSLocalCoreRunner(runnerScriptPath));
const mode =
  parsed.mode === "loopback"
    ? { kind: "loopback", port: parsed.webPort }
    : {
        bindHost: parsed.bindHost,
        caCertificatePath:
          parsed.caCertificatePath ??
          (parsed.certificatePath === undefined
            ? join(workbenchHome, "tls", "local-ca.crt")
            : undefined),
        ...(parsed.certificatePath === undefined
          ? {}
          : {
              certificatePath: parsed.certificatePath,
              privateKeyPath: parsed.privateKeyPath,
            }),
        kind: "lan",
        publicOrigin: parsed.origin,
      };
const plan = createMacOSLocalCoreLaunchAgentPlan({
  label,
  logDirectory: join(workbenchHome, "logs"),
  mode,
  nodeExecutablePath: serviceExecutablePath,
  pathEntries,
  plistPath,
  ...(product === undefined
    ? {}
    : {
        programArguments: [product.executablePath, "__local-core-service"],
      }),
  runnerIntegrity,
  runnerScriptPath,
  staticDirectory:
    product?.staticDirectory ??
    (await snapshotWorkbenchAssets(repositoryDirectory)),
  userHomeDirectory,
  workbenchHome,
  workspaceCwd: parsed.workspace,
});
const result = await installMacOSLocalCore({
  activate: parsed.activate,
  plan,
  replaceLoaded: parsed.replaceLoaded,
  replaceStaged: parsed.replaceStaged,
});

process.stdout.write(
  `RAH_MACOS_LOCAL_CORE_INSTALL ${JSON.stringify({
    availableRuntimes: availableRuntimes.map(
      ({ displayName, resolvedExecutablePath, version }) => ({
        displayName,
        resolvedExecutablePath,
        version,
      }),
    ),
    healthOrigin: plan.health.origin,
    kind: result.kind,
    logDirectory: plan.logDirectory,
    pairingCodeLogPath:
      parsed.mode === "lan"
        ? join(plan.logDirectory, "core.stdout.log")
        : undefined,
    plistPath: result.staged.plistPath,
    product:
      product === undefined
        ? undefined
        : {
            directory: product.productDirectory,
            nodeCarrierVersion: product.nodeCarrierVersion,
            version: product.version,
          },
    serviceTarget: result.serviceTarget,
    sourceBound: product === undefined,
    workbenchHome: plan.workbenchHome,
    workspace: plan.workspaceCwd,
  })}\n`,
);
