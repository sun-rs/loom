import { lstat, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";

import {
  createMacOSLocalCoreLaunchAgentPlan,
  installMacOSLocalCore,
  uninstallMacOSLocalCore,
  type MacOSLocalCoreInstallationResult,
  type MacOSLocalCoreUninstallResult,
} from "./macos-local-core-launch-agent.ts";
import {
  MACOS_LOCAL_CORE_INSTALL_USAGE,
  parseMacOSLocalCoreInstallArguments,
} from "./macos-local-core-install-command.ts";
import {
  inspectLocalCoreProduct,
  type InspectedLocalCoreProduct,
} from "./local-core-product.ts";
import { discoverKnownLocalClis } from "./local-runtime-inventory.ts";
import { prepareRahDataHome } from "./rah-data-home.ts";

const LOCAL_CORE_LABEL = "dev.rah-os.local-core";

export type MacOSLocalCoreProductOperatorResult =
  | Readonly<{ kind: "help"; usage: string }>
  | Readonly<{
      availableRuntimes: readonly Readonly<{
        displayName: string;
        resolvedExecutablePath?: string;
        version?: string;
      }>[];
      healthOrigin: string;
      installationKind: MacOSLocalCoreInstallationResult["kind"];
      kind: "install";
      logDirectory: string;
      pairingCodeLogPath?: string;
      plistPath: string;
      product: Readonly<{
        directory: string;
        nodeCarrierVersion: string;
        version: string;
      }>;
      serviceTarget: string;
      sourceBound: false;
      workbenchHome: string;
      workspace: string;
    }>
  | Readonly<{
      kind: "uninstall";
      result: MacOSLocalCoreUninstallResult;
      workbenchHome: string;
    }>;

export type MacOSLocalCoreProductOperatorRuntime = Readonly<{
  discover?: typeof discoverKnownLocalClis;
  environment?: NodeJS.ProcessEnv;
  inspectProduct?: typeof inspectLocalCoreProduct;
  install?: typeof installMacOSLocalCore;
  platform?: NodeJS.Platform;
  productDirectory?: string;
  uninstall?: typeof uninstallMacOSLocalCore;
  userHomeDirectory?: string;
}>;

/**
 * Customer-facing installer embedded in the immutable Core product. It uses
 * only the verified product tree and macOS launchd; no repository, npm, Node
 * installation, shell command composition, or source checkout is required.
 */
export async function runMacOSLocalCoreProductOperator(
  arguments_: readonly string[],
  runtime: MacOSLocalCoreProductOperatorRuntime = {},
): Promise<MacOSLocalCoreProductOperatorResult> {
  const parsed = parseMacOSLocalCoreInstallArguments(arguments_);
  if ("help" in parsed) {
    return Object.freeze({
      kind: "help",
      usage: MACOS_LOCAL_CORE_INSTALL_USAGE,
    });
  }
  if ((runtime.platform ?? process.platform) !== "darwin") {
    throw new Error("the local Core product operator requires macOS");
  }
  const userHomeDirectory = resolve(runtime.userHomeDirectory ?? homedir());
  const workbenchHome =
    parsed.home ??
    (await prepareRahDataHome({
      environment: runtime.environment ?? process.env,
      userHomeDirectory,
    }));
  const plistPath = join(
    userHomeDirectory,
    "Library",
    "LaunchAgents",
    `${LOCAL_CORE_LABEL}.plist`,
  );
  if ("uninstall" in parsed) {
    const result = await (runtime.uninstall ?? uninstallMacOSLocalCore)({
      label: LOCAL_CORE_LABEL,
      plistPath,
      workbenchHome,
    });
    return Object.freeze({
      kind: "uninstall",
      result,
      workbenchHome,
    });
  }

  const productDirectory =
    parsed.productDirectory ??
    runtime.productDirectory ??
    resolve(dirname(process.execPath), "..");
  const product = await (runtime.inspectProduct ?? inspectLocalCoreProduct)(
    productDirectory,
  );
  const environment = runtime.environment ?? process.env;
  const pathEntries = productPathEntries(product, environment);
  const inventory = await (runtime.discover ?? discoverKnownLocalClis)({
    environment: { ...environment, PATH: pathEntries.join(delimiter) },
  });
  const availableRuntimes = inventory.filter(({ available }) => available);
  if (availableRuntimes.length === 0) {
    throw new Error(
      "No supported local Agent CLI was found; install and sign in before installing the Core",
    );
  }
  const workspace =
    "quickStart" in parsed
      ? await prepareQuickStartWorkspace(userHomeDirectory)
      : parsed.workspace;
  const mode =
    parsed.mode === "loopback"
      ? { kind: "loopback" as const, port: parsed.webPort ?? 4173 }
      : (() => {
          const caCertificatePath =
            parsed.caCertificatePath ??
            (parsed.certificatePath === undefined
              ? join(workbenchHome, "tls", "local-ca.crt")
              : undefined);
          return {
            bindHost: parsed.bindHost ?? "0.0.0.0",
            ...(caCertificatePath === undefined ? {} : { caCertificatePath }),
            ...(parsed.certificatePath === undefined
              ? {}
              : {
                  certificatePath: parsed.certificatePath,
                  privateKeyPath: parsed.privateKeyPath,
                }),
            kind: "lan" as const,
            publicOrigin: requiredString(parsed.origin, "LAN public origin"),
          };
        })();
  const plan = createMacOSLocalCoreLaunchAgentPlan({
    label: LOCAL_CORE_LABEL,
    logDirectory: join(workbenchHome, "logs"),
    mode,
    nodeExecutablePath: product.executablePath,
    pathEntries,
    plistPath,
    programArguments: [product.executablePath, "__local-core-service"],
    runnerIntegrity: product.runnerIntegrity,
    runnerScriptPath: product.executablePath,
    staticDirectory: product.staticDirectory,
    userHomeDirectory,
    workbenchHome,
    workspaceCwd: workspace,
  });
  const result = await (runtime.install ?? installMacOSLocalCore)({
    activate: parsed.activate,
    plan,
    replaceLoaded: parsed.replaceLoaded,
    replaceStaged: parsed.replaceStaged,
  });
  return Object.freeze({
    availableRuntimes: Object.freeze(
      availableRuntimes.map(
        ({ displayName, resolvedExecutablePath, version }) =>
          Object.freeze({
            displayName,
            ...(resolvedExecutablePath === undefined
              ? {}
              : { resolvedExecutablePath }),
            ...(version === undefined ? {} : { version }),
          }),
      ),
    ),
    healthOrigin: plan.health.origin,
    installationKind: result.kind,
    kind: "install",
    logDirectory: plan.logDirectory,
    ...(parsed.mode === "lan"
      ? { pairingCodeLogPath: join(plan.logDirectory, "core.stdout.log") }
      : {}),
    plistPath: result.staged.plistPath,
    product: Object.freeze({
      directory: product.productDirectory,
      nodeCarrierVersion: product.nodeCarrierVersion,
      version: product.version,
    }),
    serviceTarget: result.serviceTarget,
    sourceBound: false,
    workbenchHome: plan.workbenchHome,
    workspace: plan.workspaceCwd,
  });
}

async function prepareQuickStartWorkspace(
  userHomeDirectory: string,
): Promise<string> {
  const workspace = join(userHomeDirectory, "RAH OS Workspace");
  try {
    await mkdir(workspace, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const evidence = await lstat(workspace);
  if (
    evidence.isSymbolicLink() ||
    !evidence.isDirectory() ||
    (evidence.mode & 0o077) !== 0 ||
    (process.getuid?.() !== undefined && evidence.uid !== process.getuid?.())
  ) {
    throw new Error(
      "quick-start workspace must be an owner-private local directory",
    );
  }
  return workspace;
}

function productPathEntries(
  product: InspectedLocalCoreProduct,
  environment: NodeJS.ProcessEnv,
): readonly string[] {
  return Object.freeze(
    Array.from(
      new Set([
        dirname(product.executablePath),
        ...(environment.PATH ?? "")
          .split(delimiter)
          .filter((entry) => isAbsolute(entry)),
      ]),
    ),
  );
}

function requiredString(value: string | undefined, name: string): string {
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
}
