import {
  runNodeKCarrierComputerServiceCommand,
  type NodeKCarrierComputerServiceCommandRuntime,
} from "./node-k-carrier-computer-service-entry.ts";
import { runEmbeddedProcessSupervisor } from "./embedded-process-supervisor.ts";
import {
  runEmbeddedRuntimeDriver,
  type EmbeddedRuntimeDriverKind,
} from "./embedded-runtime-driver.ts";
import { runNodeKCarrierComputerSupervisorCommand } from "./node-k-carrier-computer-supervisor-process.ts";
import { runNodeKCarrierComputerUpgradeProcess } from "./node-k-carrier-computer-upgrade-process.ts";
import { runWorkerCliCommand } from "./worker-cli.ts";

export type NodeKCarrierComputerCommandRuntime = Readonly<{
  runProcessSupervisor?: typeof runEmbeddedProcessSupervisor;
  runRuntimeDriver?: typeof runEmbeddedRuntimeDriver;
  runService?: (
    arguments_: readonly string[],
    runtime?: NodeKCarrierComputerServiceCommandRuntime,
  ) => Promise<0>;
  runSupervisor?: typeof runNodeKCarrierComputerSupervisorCommand;
  runUpgrade?: typeof runNodeKCarrierComputerUpgradeProcess;
  runWorkerCli?: typeof runWorkerCliCommand;
  serviceRuntime?: NodeKCarrierComputerServiceCommandRuntime;
}>;

/** One exact dispatch surface for the self-contained Computer artifact. */
export async function runNodeKCarrierComputerCommand(
  arguments_: readonly string[],
  runtime: NodeKCarrierComputerCommandRuntime = {},
): Promise<0 | 1> {
  if (arguments_[0] === "__computer-supervisor") {
    return await (
      runtime.runSupervisor ?? runNodeKCarrierComputerSupervisorCommand
    )(arguments_);
  }
  if (arguments_[0] === "__computer-service") {
    return await (runtime.runService ?? runNodeKCarrierComputerServiceCommand)(
      arguments_,
      runtime.serviceRuntime,
    );
  }
  if (arguments_[0] === "__computer-upgrade") {
    if (
      arguments_.length !== 3 ||
      arguments_[1] === undefined ||
      arguments_[2] !== "--config-fd=3"
    ) {
      throw usage();
    }
    const result = await (
      runtime.runUpgrade ?? runNodeKCarrierComputerUpgradeProcess
    )({ configurationFd: 3, requestPath: arguments_[1] });
    return result.kind === "failed" ? 1 : 0;
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
  throw usage();
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

function usage(): Error {
  return new Error(
    "usage: rah-os-computer __computer-supervisor|__computer-service|__computer-upgrade|__runtime-process-supervisor|__worker-cli|__claude-stream-json-driver|__codex-app-server-driver|__kimi-acp-driver|__opencode-server-driver ...",
  );
}
