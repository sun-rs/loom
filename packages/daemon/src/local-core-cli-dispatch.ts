import { startRestartableLocalCoreWorkbench } from "./restartable-local-workbench.ts";
import { join, resolve } from "node:path";

import {
  runEmbeddedProcessSupervisor,
  runEmbeddedRuntimeDriver,
  runWorkerCliCommand,
  type EmbeddedRuntimeDriverKind,
} from "@rah-os/agent-host";

import {
  startLocalCoreWorkbench,
  type RunningLocalCoreWorkbench,
} from "./local-core-workbench.ts";
import {
  runMacOSLocalCoreProductOperator,
  type MacOSLocalCoreProductOperatorResult,
} from "./macos-local-core-product-operator.ts";
import { resolveRahDataHome } from "./rah-data-home.ts";

export type LocalCoreCommandRuntime = Readonly<{
  environment?: NodeJS.ProcessEnv;
  runProcessSupervisor?: typeof runEmbeddedProcessSupervisor;
  runRuntimeDriver?: typeof runEmbeddedRuntimeDriver;
  runProductOperator?: (
    arguments_: readonly string[],
  ) => Promise<MacOSLocalCoreProductOperatorResult>;
  runService?: () => Promise<0>;
  runWorkerCli?: typeof runWorkerCliCommand;
  startWorkbench?: typeof startLocalCoreWorkbench;
  waitForShutdown?: () => Promise<void>;
  writeOutput?: (value: string) => void;
}>;

/** Exact command surface embedded in the self-contained Local Core SEA. */
export async function runLocalCoreCommand(
  arguments_: readonly string[],
  runtime: LocalCoreCommandRuntime = {},
): Promise<0 | 1> {
  if (arguments_[0] === "install" || arguments_[0] === "uninstall") {
    const operatorArguments =
      arguments_[0] === "install"
        ? arguments_.slice(1)
        : ["--uninstall", ...arguments_.slice(1)];
    const result = await (
      runtime.runProductOperator ?? runMacOSLocalCoreProductOperator
    )(operatorArguments);
    (runtime.writeOutput ?? ((value) => process.stdout.write(value)))(
      result.kind === "help"
        ? result.usage
        : `RAH_MACOS_LOCAL_CORE_${result.kind.toUpperCase()} ${JSON.stringify(result)}\n`,
    );
    return 0;
  }
  if (
    arguments_.length === 1 &&
    (arguments_[0] === "help" || arguments_[0] === "--help")
  ) {
    (runtime.writeOutput ?? ((value) => process.stdout.write(value)))(
      productUsage(),
    );
    return 0;
  }
  if (arguments_[0] === "__runtime-process-supervisor") {
    if (arguments_.length !== 1) throw usage();
    return await (
      runtime.runProcessSupervisor ?? runEmbeddedProcessSupervisor
    )();
  }
  if (arguments_[0] === "__worker-cli") {
    return await (runtime.runWorkerCli ?? runWorkerCliCommand)(
      arguments_.slice(1),
    );
  }
  const runtimeDriver = runtimeDriverKind(arguments_[0]);
  if (runtimeDriver !== undefined) {
    return await (runtime.runRuntimeDriver ?? runEmbeddedRuntimeDriver)(
      runtimeDriver,
      arguments_.slice(1),
    );
  }
  if (arguments_[0] === "__local-core-service") {
    if (arguments_.length !== 1) throw usage();
    const service =
      runtime.runService ??
      (() =>
        runLocalCoreService({
          ...(runtime.environment === undefined
            ? {}
            : { environment: runtime.environment }),
          ...(runtime.startWorkbench === undefined
            ? {}
            : { startWorkbench: runtime.startWorkbench }),
          ...(runtime.waitForShutdown === undefined
            ? {}
            : { waitForShutdown: runtime.waitForShutdown }),
        }));
    return await service();
  }
  throw usage();
}

export async function runLocalCoreService(input: {
  environment?: NodeJS.ProcessEnv;
  startWorkbench?: typeof startLocalCoreWorkbench;
  waitForShutdown?: () => Promise<void>;
}): Promise<0> {
  const environment = input.environment ?? process.env;
  const staticDirectory = requiredPath(environment, "RAH_WEB_STATIC_DIRECTORY");
  const workbenchHome = resolveRahDataHome({ environment });
  const workspaceCwd = resolve(
    environment.RAH_WORKSPACE_CWD?.trim() || process.cwd(),
  );
  const publicOrigin = environment.RAH_LAN_ORIGIN?.trim();
  const certificatePath = optional(environment, "RAH_LAN_CERT_PATH");
  const privateKeyPath = optional(environment, "RAH_LAN_KEY_PATH");
  const mode =
    publicOrigin === undefined || publicOrigin === ""
      ? {
          kind: "loopback" as const,
          port: port(environment.RAH_WEB_PORT ?? "4173"),
        }
      : {
          bindHost: environment.RAH_LAN_BIND_HOST?.trim() || "0.0.0.0",
          ...(certificatePath === undefined ? {} : { certificatePath }),
          kind: "lan" as const,
          ...(privateKeyPath === undefined ? {} : { privateKeyPath }),
          publicOrigin,
          tlsDirectory: join(workbenchHome, "tls"),
        };
  const running = await (
    input.startWorkbench ?? startRestartableLocalCoreWorkbench
  )({
    environment,
    mode,
    staticDirectory,
    workbenchHome,
    workspaceCwd,
  });
  await serveUntilShutdown(running, input.waitForShutdown ?? waitForSignal);
  return 0;
}

async function serveUntilShutdown(
  running: RunningLocalCoreWorkbench,
  waitForShutdown: () => Promise<void>,
): Promise<void> {
  try {
    process.stdout.write(
      `RAH_LOCAL_CORE ${JSON.stringify(running.descriptor)}\n`,
    );
    await waitForShutdown();
  } finally {
    await running.stop();
  }
}

function requiredPath(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }
  return resolve(value);
}

function optional(
  environment: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const value = environment[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

function port(value: string): number {
  if (!/^\d+$/u.test(value)) throw new Error("RAH_WEB_PORT is invalid");
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("RAH_WEB_PORT must be between 1 and 65535");
  }
  return parsed;
}

async function waitForSignal(): Promise<void> {
  await new Promise<void>((resolvePromise) => {
    const finish = () => resolvePromise();
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
  });
}

function usage(): Error {
  return new Error(productUsage());
}

function runtimeDriverKind(
  argument: string | undefined,
): EmbeddedRuntimeDriverKind | undefined {
  if (argument === "__claude-stream-json-driver") return "claude-stream-json";
  if (argument === "__codex-app-server-driver") return "codex-app-server";
  if (argument === "__kimi-acp-driver") return "kimi-acp";
  if (argument === "__opencode-server-driver") return "opencode-server";
  return undefined;
}

function productUsage(): string {
  return "usage: rah-os-core install ... | uninstall ... | __local-core-service | __runtime-process-supervisor | __worker-cli | __claude-stream-json-driver | __codex-app-server-driver | __kimi-acp-driver | __opencode-server-driver ...\n";
}
