import { rotateServiceLogs } from "./service-log-rotation.ts";
import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { isAbsolute } from "node:path";

import {
  createMacOSComputerLaunchAgentPlan,
  type MacOSComputerLaunchAgentPlan,
} from "./macos-computer-launch-agent.ts";
import { readComputerServiceLiveAttestation } from "./computer-service-ownership-proof.ts";
import type { ComputerServiceSupervisorSnapshot } from "./computer-service-supervisor.ts";

const LAUNCHCTL_MISSING_SERVICE_EXIT_CODE = 113;
const HEX_256 = /^[0-9a-f]{64}$/u;

export type MacOSLaunchCtlPort = Readonly<{
  run(arguments_: readonly string[]): Promise<Readonly<{ exitCode: number }>>;
}>;

export type MacOSComputerLaunchAgentActivationResult = Readonly<{
  kind: "activated" | "already_loaded" | "reloaded";
  serviceTarget: string;
}>;

export type MacOSComputerLaunchAgentInspectionResult = Readonly<{
  kind: "loaded" | "unloaded";
  serviceTarget: string;
}>;

export type MacOSComputerLaunchAgentInspectionOptions = Readonly<{
  launchctl?: MacOSLaunchCtlPort;
  plan: MacOSComputerLaunchAgentPlan;
  userId?: number;
}>;

export type MacOSComputerLaunchAgentActivationOptions = Readonly<{
  launchctl?: MacOSLaunchCtlPort;
  plan: MacOSComputerLaunchAgentPlan;
  pollAttempts?: number;
  pollIntervalMs?: number;
  proveReady?: () => Promise<void>;
  replaceLoaded?: boolean;
  userId?: number;
  wait?: (delayMs: number) => Promise<void>;
}>;

export type MacOSComputerLaunchAgentRestartResult = Readonly<{
  kind: "restarted";
  serviceTarget: string;
}>;

export type MacOSComputerLaunchAgentRestartOptions = Readonly<{
  launchctl?: MacOSLaunchCtlPort;
  plan: MacOSComputerLaunchAgentPlan;
  proveReady: () => Promise<void>;
  userId?: number;
}>;

export type MacOSComputerLaunchAgentDeactivationResult = Readonly<{
  kind: "already_unloaded" | "deactivated";
  serviceTarget: string;
}>;

export type MacOSComputerLaunchAgentDeactivationOptions = Readonly<{
  launchctl?: MacOSLaunchCtlPort;
  plan: MacOSComputerLaunchAgentPlan;
  pollAttempts?: number;
  pollIntervalMs?: number;
  userId?: number;
  wait?: (delayMs: number) => Promise<void>;
}>;

export type MacOSComputerLaunchAgentReadinessOptions = Readonly<{
  expectedBuildVersion?: string;
  ownershipControlToken: string;
  ownershipSocketPath: string;
  pollAttempts?: number;
  pollIntervalMs?: number;
  supervisor: Readonly<{
    readStatus(): Promise<ComputerServiceSupervisorSnapshot>;
  }>;
  wait?: (delayMs: number) => Promise<void>;
}>;

/** Read-only registration probe used before any installer mutates files. */
export async function inspectMacOSComputerLaunchAgent(
  options: MacOSComputerLaunchAgentInspectionOptions,
): Promise<MacOSComputerLaunchAgentInspectionResult> {
  const plan = normalizePlan(options.plan);
  const launchctl = options.launchctl ?? new NodeMacOSLaunchCtl();
  const userId = nonNegativeInteger(
    options.userId ?? currentUserId(),
    "userId",
  );
  const serviceTarget = `gui/${String(userId)}/${plan.label}`;
  return Object.freeze({
    kind: (await probeLoaded(launchctl, serviceTarget)) ? "loaded" : "unloaded",
    serviceTarget,
  });
}

/**
 * Explicit activation boundary for an already-staged LaunchAgent. It never
 * edits files, shells out through a command string, or treats arbitrary
 * launchctl failures as "not loaded". Bootstrap success is followed by a
 * bounded launchd registration proof and an optional service-level proof.
 */
export async function activateMacOSComputerLaunchAgent(
  options: MacOSComputerLaunchAgentActivationOptions,
): Promise<MacOSComputerLaunchAgentActivationResult> {
  const plan = normalizePlan(options.plan);
  const launchctl = options.launchctl ?? new NodeMacOSLaunchCtl();
  const userId = nonNegativeInteger(
    options.userId ?? currentUserId(),
    "userId",
  );
  const pollAttempts = positiveInteger(
    options.pollAttempts ?? 100,
    "pollAttempts",
  );
  const pollIntervalMs = positiveInteger(
    options.pollIntervalMs ?? 100,
    "pollIntervalMs",
  );
  const wait = options.wait ?? waitForDelay;
  const domainTarget = `gui/${String(userId)}`;
  const serviceTarget = `${domainTarget}/${plan.label}`;
  const initiallyLoaded = await probeLoaded(launchctl, serviceTarget);
  if (initiallyLoaded && options.replaceLoaded !== true) {
    await options.proveReady?.();
    return Object.freeze({ kind: "already_loaded", serviceTarget });
  }

  let kind: MacOSComputerLaunchAgentActivationResult["kind"] = "activated";
  if (initiallyLoaded) {
    requireSuccess("bootout", await launchctl.run(["bootout", serviceTarget]));
    await waitForRegistration({
      attempts: pollAttempts,
      expectedLoaded: false,
      intervalMs: pollIntervalMs,
      launchctl,
      serviceTarget,
      wait,
    });
    kind = "reloaded";
  }

  await rotateServiceLogs(plan.logDirectory, "computer");
  requireSuccess(
    "bootstrap",
    await launchctl.run(["bootstrap", domainTarget, plan.plistPath]),
  );
  await waitForRegistration({
    attempts: pollAttempts,
    expectedLoaded: true,
    intervalMs: pollIntervalMs,
    launchctl,
    serviceTarget,
    wait,
  });
  await options.proveReady?.();
  return Object.freeze({ kind, serviceTarget });
}

/**
 * Restarts an already-registered Computer without changing its files or
 * creating a missing registration. The caller must supply the same
 * service-level successor proof used by activation; launchctl success alone
 * is not runtime readiness.
 */
export async function restartMacOSComputerLaunchAgent(
  options: MacOSComputerLaunchAgentRestartOptions,
): Promise<MacOSComputerLaunchAgentRestartResult> {
  const plan = normalizePlan(options.plan);
  const launchctl = options.launchctl ?? new NodeMacOSLaunchCtl();
  const userId = nonNegativeInteger(
    options.userId ?? currentUserId(),
    "userId",
  );
  const serviceTarget = `gui/${String(userId)}/${plan.label}`;
  if (!(await probeLoaded(launchctl, serviceTarget))) {
    throw new Error("Computer LaunchAgent is not loaded");
  }
  requireSuccess(
    "kickstart",
    await launchctl.run(["kickstart", "-k", serviceTarget]),
  );
  await options.proveReady();
  return Object.freeze({ kind: "restarted", serviceTarget });
}

/**
 * Removes an existing per-user registration and proves it disappeared. This
 * is idempotent and intentionally leaves staged files intact for inspection,
 * rollback, or an explicit uninstall owner.
 */
export async function deactivateMacOSComputerLaunchAgent(
  options: MacOSComputerLaunchAgentDeactivationOptions,
): Promise<MacOSComputerLaunchAgentDeactivationResult> {
  const plan = normalizePlan(options.plan);
  const launchctl = options.launchctl ?? new NodeMacOSLaunchCtl();
  const userId = nonNegativeInteger(
    options.userId ?? currentUserId(),
    "userId",
  );
  const pollAttempts = positiveInteger(
    options.pollAttempts ?? 100,
    "pollAttempts",
  );
  const pollIntervalMs = positiveInteger(
    options.pollIntervalMs ?? 100,
    "pollIntervalMs",
  );
  const wait = options.wait ?? waitForDelay;
  const serviceTarget = `gui/${String(userId)}/${plan.label}`;
  if (!(await probeLoaded(launchctl, serviceTarget))) {
    return Object.freeze({ kind: "already_unloaded", serviceTarget });
  }
  requireSuccess("bootout", await launchctl.run(["bootout", serviceTarget]));
  await waitForRegistration({
    attempts: pollAttempts,
    expectedLoaded: false,
    intervalMs: pollIntervalMs,
    launchctl,
    serviceTarget,
    wait,
  });
  return Object.freeze({ kind: "deactivated", serviceTarget });
}

/**
 * Service-level readiness proof used after launchd registration. A running
 * supervisor alone is insufficient: the same PID must also own the HMAC
 * singleton and, when supplied, attest the expected build.
 */
export async function proveMacOSComputerLaunchAgentServiceReady(
  options: MacOSComputerLaunchAgentReadinessOptions,
  runtime: Readonly<{
    readLiveAttestation?: typeof readComputerServiceLiveAttestation;
  }> = {},
): Promise<void> {
  const pollAttempts = positiveInteger(
    options.pollAttempts ?? 100,
    "pollAttempts",
  );
  const pollIntervalMs = positiveInteger(
    options.pollIntervalMs ?? 100,
    "pollIntervalMs",
  );
  if (!HEX_256.test(options.ownershipControlToken)) {
    throw new Error("ownershipControlToken is invalid");
  }
  if (
    typeof options.ownershipSocketPath !== "string" ||
    !options.ownershipSocketPath.startsWith("/") ||
    options.ownershipSocketPath.includes("\0")
  ) {
    throw new Error("ownershipSocketPath must be absolute");
  }
  const expectedBuildVersion =
    options.expectedBuildVersion === undefined
      ? undefined
      : requiredText(options.expectedBuildVersion, "expectedBuildVersion");
  const readLive =
    runtime.readLiveAttestation ?? readComputerServiceLiveAttestation;
  const wait = options.wait ?? waitForDelay;
  for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
    try {
      const status = await options.supervisor.readStatus();
      if (status.kind === "running") {
        const live = await readLive({
          controlToken: options.ownershipControlToken,
          socketPath: options.ownershipSocketPath,
          timeoutMs: Math.max(250, pollIntervalMs),
        });
        if (
          live !== null &&
          live.candidateProcessId === status.processId &&
          (expectedBuildVersion === undefined ||
            live.buildVersion === expectedBuildVersion)
        ) {
          return;
        }
      }
    } catch {
      // Registration can precede socket acquisition; only a later matching
      // supervisor + singleton pair is accepted as readiness.
    }
    if (attempt + 1 < pollAttempts) await wait(pollIntervalMs);
  }
  throw new Error(
    "launchd did not prove a live supervised Computer service before the deadline",
  );
}

export type NodeMacOSLaunchCtlOptions = Readonly<{
  spawn?: (
    executablePath: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => ChildProcess;
  timeoutMs?: number;
}>;

/** Fixed-path, shell-free launchctl adapter with no inherited environment. */
export class NodeMacOSLaunchCtl implements MacOSLaunchCtlPort {
  readonly #spawn: NonNullable<NodeMacOSLaunchCtlOptions["spawn"]>;
  readonly #timeoutMs: number;

  constructor(options: NodeMacOSLaunchCtlOptions = {}) {
    this.#spawn = options.spawn ?? spawn;
    this.#timeoutMs = positiveInteger(options.timeoutMs ?? 10_000, "timeoutMs");
  }

  async run(
    arguments_: readonly string[],
  ): Promise<Readonly<{ exitCode: number }>> {
    const args = launchctlArguments(arguments_);
    const child = this.#spawn("/bin/launchctl", args, {
      detached: false,
      env: Object.create(null) as NodeJS.ProcessEnv,
      stdio: "ignore",
      windowsHide: true,
    });
    return await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, exitCode?: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.removeAllListeners("error");
        child.removeAllListeners("exit");
        if (error !== undefined) reject(error);
        else resolve(Object.freeze({ exitCode: exitCode! }));
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(new Error("launchctl operation timed out"));
      }, this.#timeoutMs);
      child.once("error", (error) => finish(error));
      child.once("exit", (code, signal) => {
        if (code === null) {
          finish(
            new Error(
              `launchctl terminated by ${signal ?? "an unknown signal"}`,
            ),
          );
          return;
        }
        finish(undefined, code);
      });
    });
  }
}

async function waitForRegistration(input: {
  attempts: number;
  expectedLoaded: boolean;
  intervalMs: number;
  launchctl: MacOSLaunchCtlPort;
  serviceTarget: string;
  wait: (delayMs: number) => Promise<void>;
}): Promise<void> {
  for (let attempt = 0; attempt < input.attempts; attempt += 1) {
    if (
      (await probeLoaded(input.launchctl, input.serviceTarget)) ===
      input.expectedLoaded
    ) {
      return;
    }
    if (attempt + 1 < input.attempts) await input.wait(input.intervalMs);
  }
  throw new Error(
    input.expectedLoaded
      ? "launchd did not register the Computer service before the deadline"
      : "launchd did not remove the Computer service before the deadline",
  );
}

async function probeLoaded(
  launchctl: MacOSLaunchCtlPort,
  serviceTarget: string,
): Promise<boolean> {
  const result = await launchctl.run(["print", serviceTarget]);
  const exitCode = exitStatus(result.exitCode);
  if (exitCode === 0) return true;
  if (exitCode === LAUNCHCTL_MISSING_SERVICE_EXIT_CODE) return false;
  throw new Error(`launchctl print failed with exit code ${String(exitCode)}`);
}

function requireSuccess(
  operation: "bootstrap" | "bootout" | "kickstart",
  result: Readonly<{ exitCode: number }>,
): void {
  const exitCode = exitStatus(result.exitCode);
  if (exitCode !== 0) {
    throw new Error(
      `launchctl ${operation} failed with exit code ${String(exitCode)}`,
    );
  }
}

function normalizePlan(
  value: MacOSComputerLaunchAgentPlan,
): MacOSComputerLaunchAgentPlan {
  const normalized = createMacOSComputerLaunchAgentPlan({
    kStateDirectory: value.kStateDirectory,
    label: value.label,
    logDirectory: value.logDirectory,
    plistPath: value.plistPath,
    stateDirectory: value.stateDirectory,
    supervisorConfigurationPath: value.supervisorConfigurationPath,
    supervisorExecutablePath: value.supervisorExecutablePath,
  });
  if (
    value.plist !== normalized.plist ||
    JSON.stringify(value.programArguments) !==
      JSON.stringify(normalized.programArguments)
  ) {
    throw new Error("LaunchAgent plan does not match its normalized contract");
  }
  return normalized;
}

function launchctlArguments(values: readonly string[]): readonly string[] {
  if (values.some((value) => !safeArgument(value))) {
    throw new Error("launchctl arguments are invalid");
  }
  const valid =
    ((values[0] === "print" || values[0] === "bootout") &&
      values.length === 2 &&
      serviceTarget(values[1]!)) ||
    (values[0] === "bootstrap" &&
      values.length === 3 &&
      domainTarget(values[1]!) &&
      isAbsolute(values[2]!)) ||
    (values[0] === "kickstart" &&
      values.length === 3 &&
      values[1] === "-k" &&
      serviceTarget(values[2]!));
  if (!valid) throw new Error("launchctl arguments are invalid");
  return Object.freeze([...values]);
}

function safeArgument(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4_096 &&
    !value.includes("\0")
  );
}

function domainTarget(value: string): boolean {
  return /^gui\/(?:0|[1-9][0-9]*)$/u.test(value);
}

function serviceTarget(value: string): boolean {
  const separator = value.indexOf("/", "gui/".length);
  return (
    separator > 0 &&
    domainTarget(value.slice(0, separator)) &&
    /^[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+$/u.test(
      value.slice(separator + 1),
    )
  );
}

function currentUserId(): number {
  if (typeof process.getuid !== "function") {
    throw new Error("macOS LaunchAgent activation requires a POSIX user id");
  }
  return process.getuid();
}

function exitStatus(value: number): number {
  return nonNegativeInteger(value, "launchctl exitCode");
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

function requiredText(value: string, name: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    value.trim() !== value ||
    value.includes("\0")
  ) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

async function waitForDelay(delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
