import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { isAbsolute, resolve } from "node:path";

import {
  ComputerServiceSupervisor,
  type ComputerServiceSupervisorCompletion,
} from "./computer-service-supervisor.ts";
import { createComputerServiceSupervisorControlHandler } from "./computer-service-supervisor-control.ts";
import { UnixSocketInstanceLock } from "./agent-host-daemon.ts";
import { NodeKCarrierSupervisedServiceLauncher } from "./node-k-carrier-supervised-service-launcher.ts";

export const NODE_K_CARRIER_COMPUTER_SUPERVISOR_CONFIGURATION_SCHEMA_VERSION = 1;
export const NODE_K_CARRIER_COMPUTER_SUPERVISOR_CONTROL_HOST_ID =
  "computer-supervisor-control";
const HEX_256 = /^[0-9a-f]{64}$/u;
const MAX_CONFIGURATION_BYTES = 64 * 1_024;

export type NodeKCarrierComputerSupervisorConfiguration = Readonly<{
  controlToken: string;
  handoffTimeoutMs: number;
  serviceArgumentPrefix: readonly string[];
  serviceConfigurationPath: string;
  socketDirectory: string;
  stateDir: string;
  stopTimeoutMs: number;
}>;

export type NodeKCarrierComputerSupervisorSignalSource = Readonly<{
  off(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  once(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}>;

export type NodeKCarrierComputerSupervisorCommandRuntime = Readonly<{
  runSupervisor?: typeof runNodeKCarrierComputerSupervisorProcess;
}>;

export function computerServiceSupervisorControlSocketPath(
  socketDirectory: string,
): string {
  return new UnixSocketInstanceLock({
    directory: absolutePath(socketDirectory, "socketDirectory"),
    hostId: NODE_K_CARRIER_COMPUTER_SUPERVISOR_CONTROL_HOST_ID,
  }).socketPath;
}

export function readNodeKCarrierComputerSupervisorConfiguration(
  descriptor: number,
): NodeKCarrierComputerSupervisorConfiguration {
  if (!Number.isSafeInteger(descriptor) || descriptor < 0) {
    throw new Error("Computer supervisor configuration fd is invalid");
  }
  const metadata = fstatSync(descriptor);
  if (
    !metadata.isFile() ||
    (metadata.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error(
      "Computer supervisor configuration must be an owner-private regular file",
    );
  }
  if (metadata.size <= 0 || metadata.size > MAX_CONFIGURATION_BYTES) {
    throw new Error("Computer supervisor configuration size is invalid");
  }
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(descriptor, "utf8")) as unknown;
  } catch {
    throw new Error("Computer supervisor configuration must be valid JSON");
  }
  const envelope = record(value, "configuration envelope");
  exactKeys(envelope, ["configuration", "schemaVersion"]);
  if (
    envelope.schemaVersion !==
    NODE_K_CARRIER_COMPUTER_SUPERVISOR_CONFIGURATION_SCHEMA_VERSION
  ) {
    throw new Error("unsupported Computer supervisor configuration schema");
  }
  return normalizeNodeKCarrierComputerSupervisorConfiguration(
    envelope.configuration,
  );
}

export function normalizeNodeKCarrierComputerSupervisorConfiguration(
  value: unknown,
): NodeKCarrierComputerSupervisorConfiguration {
  return parseConfiguration(value);
}

export function readNodeKCarrierComputerSupervisorConfigurationPath(
  configurationPath: string,
): NodeKCarrierComputerSupervisorConfiguration {
  const path = absolutePath(configurationPath, "configurationPath");
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (hasCode(error, "ELOOP")) {
      throw new Error(
        "Computer supervisor configuration must not be a symlink",
      );
    }
    throw error;
  }
  try {
    return readNodeKCarrierComputerSupervisorConfiguration(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Exact internal argv contract used by the staged launchd artifact. The
 * command owns path parsing and completion-to-exit-code mapping; launchd never
 * needs to infer service health from output text.
 */
export async function runNodeKCarrierComputerSupervisorCommand(
  arguments_: readonly string[],
  runtime: NodeKCarrierComputerSupervisorCommandRuntime = {},
): Promise<0 | 1> {
  if (
    arguments_.length !== 3 ||
    arguments_[0] !== "__computer-supervisor" ||
    arguments_[1] !== "--config-path"
  ) {
    throw new Error(
      "usage: rah-os-computer __computer-supervisor --config-path /absolute/path/configuration.json",
    );
  }
  const configurationPath = absolutePath(arguments_[2], "configuration path");
  const configuration =
    readNodeKCarrierComputerSupervisorConfigurationPath(configurationPath);
  const completion = await (
    runtime.runSupervisor ?? runNodeKCarrierComputerSupervisorProcess
  )({ configuration });
  return completion.kind === "closed" ? 0 : 1;
}

/** Direct launchd process body; it never daemonizes or unrefs its child. */
export async function runNodeKCarrierComputerSupervisorProcess(input: {
  configuration: NodeKCarrierComputerSupervisorConfiguration;
  signalSource?: NodeKCarrierComputerSupervisorSignalSource;
}): Promise<ComputerServiceSupervisorCompletion> {
  const configuration = parseConfiguration(input.configuration);
  const launcher = new NodeKCarrierSupervisedServiceLauncher({
    argumentPrefix: configuration.serviceArgumentPrefix,
    configurationPath: configuration.serviceConfigurationPath,
    stateDir: configuration.stateDir,
    stopTimeoutMs: configuration.stopTimeoutMs,
  });
  const supervisor = new ComputerServiceSupervisor({
    handoffTimeoutMs: configuration.handoffTimeoutMs,
    launch: async (slot) => await launcher.launch(slot),
  });
  const lock = new UnixSocketInstanceLock({
    directory: configuration.socketDirectory,
    handleConnection: createComputerServiceSupervisorControlHandler({
      controlToken: configuration.controlToken,
      supervisor,
    }),
    hostId: NODE_K_CARRIER_COMPUTER_SUPERVISOR_CONTROL_HOST_ID,
  });
  const signalSource = input.signalSource ?? process;
  const onSignal = () => {
    void supervisor.close();
  };
  await lock.acquire();
  signalSource.once("SIGINT", onSignal);
  signalSource.once("SIGTERM", onSignal);
  try {
    await supervisor.start();
    return await supervisor.completion;
  } finally {
    signalSource.off("SIGINT", onSignal);
    signalSource.off("SIGTERM", onSignal);
    await supervisor.close();
    await lock.release();
  }
}

function parseConfiguration(
  value: unknown,
): NodeKCarrierComputerSupervisorConfiguration {
  const configuration = record(value, "configuration");
  exactKeys(configuration, [
    "controlToken",
    "handoffTimeoutMs",
    "serviceArgumentPrefix",
    "serviceConfigurationPath",
    "socketDirectory",
    "stateDir",
    "stopTimeoutMs",
  ]);
  const controlToken = boundedString(
    configuration.controlToken,
    "controlToken",
    64,
  );
  if (!HEX_256.test(controlToken)) {
    throw new Error("Computer supervisor controlToken is invalid");
  }
  return Object.freeze({
    controlToken,
    handoffTimeoutMs: positiveInteger(
      configuration.handoffTimeoutMs,
      "handoffTimeoutMs",
    ),
    serviceArgumentPrefix: argumentPrefix(configuration.serviceArgumentPrefix),
    serviceConfigurationPath: absolutePath(
      configuration.serviceConfigurationPath,
      "serviceConfigurationPath",
    ),
    socketDirectory: absolutePath(
      configuration.socketDirectory,
      "socketDirectory",
    ),
    stateDir: absolutePath(configuration.stateDir, "stateDir"),
    stopTimeoutMs: positiveInteger(
      configuration.stopTimeoutMs,
      "stopTimeoutMs",
    ),
  });
}

function argumentPrefix(value: unknown): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length > 16 ||
    value.some(
      (entry) =>
        typeof entry !== "string" ||
        entry.length === 0 ||
        entry.length > 4_096 ||
        entry.includes("\0"),
    )
  ) {
    throw new Error("Computer supervisor serviceArgumentPrefix is invalid");
  }
  return Object.freeze([...value] as string[]);
}

function absolutePath(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    !isAbsolute(value) ||
    value.includes("\0") ||
    value.length > 4_096
  ) {
    throw new Error(`${name} must be an absolute path`);
  }
  return resolve(value);
}

function boundedString(value: unknown, name: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (
    actual.length !== sorted.length ||
    actual.some((key, index) => key !== sorted[index])
  ) {
    throw new Error("Computer supervisor configuration shape is invalid");
  }
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
