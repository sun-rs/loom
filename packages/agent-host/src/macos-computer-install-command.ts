import { installMacOSComputer } from "./macos-computer-installation-operator.ts";
import { readMacOSComputerInstallRequest } from "./macos-computer-install-request.ts";

export const MACOS_COMPUTER_INSTALL_USAGE = `Usage:
  npm run install:computer:macos -- --request <absolute-request.json> [--activate] [--replace-loaded]

Options:
  --request <absolute-request.json>  Owner-private strict install request
  --activate                        Bootstrap and prove service readiness
  --replace-loaded                  Replace an already loaded service; requires --activate
  --help                            Show this help

Safety default: stage files only. A loaded service is never mutated without
both --activate and --replace-loaded.
`;

export type MacOSComputerInstallCommandRuntime = Readonly<{
  install?: typeof installMacOSComputer;
  readRequest?: typeof readMacOSComputerInstallRequest;
}>;

/** Runs the operator command without owning stdout/stderr or process exit. */
export async function runMacOSComputerInstallCommand(
  arguments_: readonly string[],
  runtime: MacOSComputerInstallCommandRuntime = {},
): Promise<string> {
  const options = parseArguments(arguments_);
  if (options.help) return MACOS_COMPUTER_INSTALL_USAGE;
  if (options.requestPath === undefined) {
    throw new Error("--request is required");
  }
  if (options.replaceLoaded && !options.activate) {
    throw new Error("--replace-loaded requires --activate");
  }
  const request = await (
    runtime.readRequest ?? readMacOSComputerInstallRequest
  )(options.requestPath);
  const result = await (runtime.install ?? installMacOSComputer)({
    activate: options.activate,
    provisioning: request.provisioning,
    replaceLoaded: options.replaceLoaded,
    serviceArtifact: request.serviceArtifact,
    serviceVersion: request.serviceVersion,
    supervisorArtifact: request.supervisorArtifact,
  });
  return `${JSON.stringify({
    kind: result.kind,
    serviceTarget: result.serviceTarget,
    staged: {
      plistPath: result.staged.plistPath,
      stableArtifactPath: result.staged.stableArtifactPath,
      supervisorExecutablePath: result.staged.supervisorExecutablePath,
    },
  })}\n`;
}

type ParsedArguments = Readonly<{
  activate: boolean;
  help: boolean;
  replaceLoaded: boolean;
  requestPath?: string;
}>;

function parseArguments(arguments_: readonly string[]): ParsedArguments {
  let activate = false;
  let help = false;
  let replaceLoaded = false;
  let requestPath: string | undefined;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }
    if (argument === "--activate") {
      if (activate) throw new Error("--activate must be specified once");
      activate = true;
      continue;
    }
    if (argument === "--replace-loaded") {
      if (replaceLoaded) {
        throw new Error("--replace-loaded must be specified once");
      }
      replaceLoaded = true;
      continue;
    }
    if (argument === "--request") {
      if (requestPath !== undefined) {
        throw new Error("--request must be specified once");
      }
      const value = arguments_[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error("--request requires a value");
      }
      requestPath = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${String(argument)}`);
  }
  if (help && arguments_.length > 1) {
    throw new Error("--help must be used alone");
  }
  return Object.freeze({
    activate,
    help,
    replaceLoaded,
    ...(requestPath === undefined ? {} : { requestPath }),
  });
}
