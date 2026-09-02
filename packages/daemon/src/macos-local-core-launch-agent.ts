import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { request as createHttpRequest } from "node:http";
import { request as createHttpsRequest } from "node:https";
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  type FileHandle,
} from "node:fs/promises";
import {
  delimiter,
  basename,
  dirname,
  isAbsolute,
  join,
  resolve,
} from "node:path";

import {
  NodeMacOSLaunchCtl,
  type MacOSLaunchCtlPort,
} from "@rah-os/agent-host";

const LAUNCHCTL_MISSING_SERVICE_EXIT_CODE = 113;
const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_RUNNER_BYTES = 512 * 1024 * 1024;

export type MacOSLocalCoreMode =
  | Readonly<{ kind: "loopback"; port: number }>
  | Readonly<{
      bindHost: string;
      caCertificatePath?: string;
      certificatePath?: string;
      kind: "lan";
      privateKeyPath?: string;
      publicOrigin: string;
    }>;

export type MacOSLocalCoreLaunchAgentPlan = Readonly<{
  environment: Readonly<Record<string, string>>;
  health: Readonly<{ caCertificatePath?: string; origin: string }>;
  label: string;
  logDirectory: string;
  nodeExecutablePath: string;
  plist: string;
  plistPath: string;
  programArguments: readonly string[];
  runnerIntegrity?: Readonly<{ sha256: string; size: number }>;
  runnerScriptPath: string;
  staticDirectory: string;
  userHomeDirectory: string;
  workbenchHome: string;
  workspaceCwd: string;
}>;

export type MacOSLocalCoreLaunchAgentPlanOptions = Readonly<{
  label: string;
  logDirectory: string;
  mode: MacOSLocalCoreMode;
  nodeExecutablePath: string;
  pathEntries: readonly string[];
  plistPath: string;
  programArguments?: readonly string[];
  runnerIntegrity?: Readonly<{ sha256: string; size: number }>;
  runnerScriptPath: string;
  staticDirectory: string;
  userHomeDirectory: string;
  workbenchHome: string;
  workspaceCwd: string;
}>;

export function createMacOSLocalCoreLaunchAgentPlan(
  options: MacOSLocalCoreLaunchAgentPlanOptions,
): MacOSLocalCoreLaunchAgentPlan {
  const label = launchdLabel(options.label);
  const logDirectory = absolutePath(options.logDirectory, "logDirectory");
  const nodeExecutablePath = absolutePath(
    options.nodeExecutablePath,
    "nodeExecutablePath",
  );
  const plistPath = absolutePath(options.plistPath, "plistPath");
  if (basename(plistPath) !== `${label}.plist`) {
    throw new Error("LaunchAgent plist filename must match its label");
  }
  const runnerScriptPath = absolutePath(
    options.runnerScriptPath,
    "runnerScriptPath",
  );
  const staticDirectory = absolutePath(
    options.staticDirectory,
    "staticDirectory",
  );
  const userHomeDirectory = absolutePath(
    options.userHomeDirectory,
    "userHomeDirectory",
  );
  const workbenchHome = absolutePath(options.workbenchHome, "workbenchHome");
  const workspaceCwd = absolutePath(options.workspaceCwd, "workspaceCwd");
  const pathEntries = Object.freeze(
    Array.from(
      new Set(
        options.pathEntries.map((entry) => absolutePath(entry, "PATH entry")),
      ),
    ),
  );
  if (pathEntries.length === 0 || pathEntries.length > 128) {
    throw new Error("LaunchAgent PATH must contain between 1 and 128 entries");
  }
  const runnerIntegrity = normalizeIntegrity(options.runnerIntegrity);
  const mode = normalizeMode(options.mode);
  const environment: Record<string, string> = {
    HOME: userHomeDirectory,
    PATH: pathEntries.join(delimiter),
    RAH_DATA_HOME: workbenchHome,
    RAH_WEB_STATIC_DIRECTORY: staticDirectory,
    RAH_WORKSPACE_CWD: workspaceCwd,
  };
  let health: MacOSLocalCoreLaunchAgentPlan["health"];
  if (mode.kind === "loopback") {
    environment.RAH_WEB_PORT = String(mode.port);
    health = Object.freeze({ origin: `http://127.0.0.1:${String(mode.port)}` });
  } else {
    environment.RAH_LAN_BIND_HOST = mode.bindHost;
    environment.RAH_LAN_ORIGIN = mode.publicOrigin;
    if (mode.certificatePath !== undefined) {
      const privateKeyPath = mode.privateKeyPath;
      if (privateKeyPath === undefined) {
        throw new Error(
          "LAN certificate and private key must be provided together",
        );
      }
      environment.RAH_LAN_CERT_PATH = mode.certificatePath;
      environment.RAH_LAN_KEY_PATH = privateKeyPath;
    }
    health = Object.freeze({
      ...(mode.caCertificatePath === undefined
        ? {}
        : { caCertificatePath: mode.caCertificatePath }),
      origin: mode.publicOrigin,
    });
  }
  const frozenEnvironment = Object.freeze({ ...environment });
  const programArguments = Object.freeze(
    options.programArguments === undefined
      ? [nodeExecutablePath, runnerScriptPath]
      : normalizeProgramArguments(options.programArguments, nodeExecutablePath),
  );
  const plist = renderPlist({
    environment: frozenEnvironment,
    label,
    logDirectory,
    nodeExecutablePath,
    programArguments,
    workspaceCwd,
  });
  return Object.freeze({
    environment: frozenEnvironment,
    health,
    label,
    logDirectory,
    nodeExecutablePath,
    plist,
    plistPath,
    programArguments,
    ...(runnerIntegrity === undefined ? {} : { runnerIntegrity }),
    runnerScriptPath,
    staticDirectory,
    userHomeDirectory,
    workbenchHome,
    workspaceCwd,
  });
}

export type MacOSLocalCoreStageResult = Readonly<{
  kind: "staged";
  plistPath: string;
}>;

export async function describeMacOSLocalCoreRunner(
  runnerScriptPath: string,
): Promise<Readonly<{ sha256: string; size: number }>> {
  const path = absolutePath(runnerScriptPath, "runnerScriptPath");
  const handle = await openRegularFile(path, "Core runner");
  try {
    const metadata = await handle.stat();
    if (metadata.size < 1 || metadata.size > MAX_RUNNER_BYTES) {
      throw new Error("Core runner size is invalid");
    }
    return Object.freeze({
      sha256: await hashHandle(handle, metadata.size),
      size: metadata.size,
    });
  } finally {
    await handle.close();
  }
}

/**
 * Verifies the source-bound Core runner and Web bundle before atomically
 * publishing its non-secret plist. It never calls launchctl.
 */
export async function stageMacOSLocalCoreLaunchAgent(input: {
  plan: MacOSLocalCoreLaunchAgentPlan;
  replaceExisting?: boolean;
}): Promise<MacOSLocalCoreStageResult> {
  const plan = normalizePlan(input.plan);
  await verifyMacOSLocalCoreLaunchAgentPlan(plan);
  await ensurePrivateDirectory(plan.workbenchHome);
  await ensurePrivateDirectory(plan.logDirectory);
  await ensureOwnedDirectory(dirname(plan.plistPath));
  await writeAtomicPlist(plan.plistPath, plan.plist, input.replaceExisting);
  return Object.freeze({ kind: "staged", plistPath: plan.plistPath });
}

/** Read-only preflight used before an operator stops an existing service. */
export async function verifyMacOSLocalCoreLaunchAgentPlan(
  inputPlan: MacOSLocalCoreLaunchAgentPlan,
): Promise<void> {
  const plan = normalizePlan(inputPlan);
  await Promise.all([
    verifyExecutable(plan.nodeExecutablePath, "Node executable"),
    verifyRunner(plan),
    verifyDirectory(plan.workspaceCwd, "Workspace"),
    verifyRegularFile(join(plan.staticDirectory, "index.html"), "Web build"),
  ]);
}

export async function inspectMacOSLocalCoreLaunchAgent(input: {
  launchctl?: MacOSLaunchCtlPort;
  plan: MacOSLocalCoreLaunchAgentPlan;
  userId?: number;
}): Promise<
  Readonly<{
    kind: "loaded" | "unloaded";
    serviceTarget: string;
  }>
> {
  const plan = normalizePlan(input.plan);
  const launchctl = input.launchctl ?? new NodeMacOSLaunchCtl();
  const userId = nonNegativeInteger(input.userId ?? currentUserId(), "userId");
  const serviceTarget = `gui/${String(userId)}/${plan.label}`;
  return Object.freeze({
    kind: (await probeLoaded(launchctl, serviceTarget)) ? "loaded" : "unloaded",
    serviceTarget,
  });
}

export type MacOSLocalCoreInstallationResult = Readonly<{
  kind: "activated" | "replaced" | "staged";
  serviceTarget: string;
  staged: MacOSLocalCoreStageResult;
}>;

export async function installMacOSLocalCore(
  options: Readonly<{
    activate?: boolean;
    plan: MacOSLocalCoreLaunchAgentPlan;
    replaceLoaded?: boolean;
    replaceStaged?: boolean;
    userId?: number;
  }>,
  runtime: Readonly<{
    launchctl?: MacOSLaunchCtlPort;
    proveReady?: () => Promise<void>;
    stage?: typeof stageMacOSLocalCoreLaunchAgent;
    verify?: typeof verifyMacOSLocalCoreLaunchAgentPlan;
    wait?: (delayMs: number) => Promise<void>;
  }> = {},
): Promise<MacOSLocalCoreInstallationResult> {
  const activate = options.activate ?? false;
  const replaceLoaded = options.replaceLoaded ?? false;
  const replaceStaged = options.replaceStaged ?? false;
  if (replaceLoaded && !activate) {
    throw new Error("local Core replacement requires activation");
  }
  const launchctl = runtime.launchctl ?? new NodeMacOSLaunchCtl();
  const inspection = await inspectMacOSLocalCoreLaunchAgent({
    launchctl,
    plan: options.plan,
    ...(options.userId === undefined ? {} : { userId: options.userId }),
  });
  const wasLoaded = inspection.kind === "loaded";
  if (wasLoaded && !replaceLoaded) {
    throw new Error(
      "local Core LaunchAgent is already loaded; explicit replacement is required",
    );
  }
  await (runtime.verify ?? verifyMacOSLocalCoreLaunchAgentPlan)(options.plan);
  if (wasLoaded) {
    await deactivateMacOSLocalCoreLaunchAgent({
      launchctl,
      plan: options.plan,
      ...(options.userId === undefined ? {} : { userId: options.userId }),
      ...(runtime.wait === undefined ? {} : { wait: runtime.wait }),
    });
  }
  const staged = await (runtime.stage ?? stageMacOSLocalCoreLaunchAgent)({
    plan: options.plan,
    replaceExisting: replaceLoaded || replaceStaged,
  });
  if (!activate) {
    return Object.freeze({
      kind: "staged",
      serviceTarget: inspection.serviceTarget,
      staged,
    });
  }
  const proveReady =
    runtime.proveReady ??
    (async () =>
      await proveMacOSLocalCoreReady({ health: options.plan.health }));
  await activateMacOSLocalCoreLaunchAgent({
    launchctl,
    plan: options.plan,
    proveReady,
    ...(options.userId === undefined ? {} : { userId: options.userId }),
    ...(runtime.wait === undefined ? {} : { wait: runtime.wait }),
  });
  return Object.freeze({
    kind: wasLoaded ? "replaced" : "activated",
    serviceTarget: inspection.serviceTarget,
    staged,
  });
}

export type MacOSLocalCoreActivationResult = Readonly<{
  kind: "activated" | "already_loaded" | "reloaded";
  serviceTarget: string;
}>;

export async function activateMacOSLocalCoreLaunchAgent(input: {
  launchctl?: MacOSLaunchCtlPort;
  plan: MacOSLocalCoreLaunchAgentPlan;
  pollAttempts?: number;
  pollIntervalMs?: number;
  proveReady: () => Promise<void>;
  replaceLoaded?: boolean;
  userId?: number;
  wait?: (delayMs: number) => Promise<void>;
}): Promise<MacOSLocalCoreActivationResult> {
  const plan = normalizePlan(input.plan);
  const launchctl = input.launchctl ?? new NodeMacOSLaunchCtl();
  const userId = nonNegativeInteger(input.userId ?? currentUserId(), "userId");
  const attempts = positiveInteger(input.pollAttempts ?? 100, "pollAttempts");
  const intervalMs = positiveInteger(
    input.pollIntervalMs ?? 100,
    "pollIntervalMs",
  );
  const wait = input.wait ?? waitForDelay;
  const domainTarget = `gui/${String(userId)}`;
  const serviceTarget = `${domainTarget}/${plan.label}`;
  const loaded = await probeLoaded(launchctl, serviceTarget);
  if (loaded && input.replaceLoaded !== true) {
    await input.proveReady();
    return Object.freeze({ kind: "already_loaded", serviceTarget });
  }
  let kind: MacOSLocalCoreActivationResult["kind"] = "activated";
  if (loaded) {
    requireSuccess("bootout", await launchctl.run(["bootout", serviceTarget]));
    await waitForRegistration({
      attempts,
      expectedLoaded: false,
      intervalMs,
      launchctl,
      serviceTarget,
      wait,
    });
    kind = "reloaded";
  }
  requireSuccess(
    "bootstrap",
    await launchctl.run(["bootstrap", domainTarget, plan.plistPath]),
  );
  await waitForRegistration({
    attempts,
    expectedLoaded: true,
    intervalMs,
    launchctl,
    serviceTarget,
    wait,
  });
  try {
    await input.proveReady();
  } catch (readinessError) {
    try {
      requireSuccess(
        "bootout after failed readiness",
        await launchctl.run(["bootout", serviceTarget]),
      );
      await waitForRegistration({
        attempts,
        expectedLoaded: false,
        intervalMs,
        launchctl,
        serviceTarget,
        wait,
      });
    } catch (rollbackError) {
      throw new AggregateError(
        [readinessError, rollbackError],
        "local Core readiness failed and launchd rollback also failed",
      );
    }
    throw readinessError;
  }
  return Object.freeze({ kind, serviceTarget });
}

export async function deactivateMacOSLocalCoreLaunchAgent(input: {
  launchctl?: MacOSLaunchCtlPort;
  plan: MacOSLocalCoreLaunchAgentPlan;
  pollAttempts?: number;
  pollIntervalMs?: number;
  userId?: number;
  wait?: (delayMs: number) => Promise<void>;
}): Promise<
  Readonly<{
    kind: "already_unloaded" | "deactivated";
    serviceTarget: string;
  }>
> {
  const plan = normalizePlan(input.plan);
  const launchctl = input.launchctl ?? new NodeMacOSLaunchCtl();
  const userId = nonNegativeInteger(input.userId ?? currentUserId(), "userId");
  const attempts = positiveInteger(input.pollAttempts ?? 100, "pollAttempts");
  const intervalMs = positiveInteger(
    input.pollIntervalMs ?? 100,
    "pollIntervalMs",
  );
  const wait = input.wait ?? waitForDelay;
  const serviceTarget = `gui/${String(userId)}/${plan.label}`;
  if (!(await probeLoaded(launchctl, serviceTarget))) {
    return Object.freeze({ kind: "already_unloaded", serviceTarget });
  }
  requireSuccess("bootout", await launchctl.run(["bootout", serviceTarget]));
  await waitForRegistration({
    attempts,
    expectedLoaded: false,
    intervalMs,
    launchctl,
    serviceTarget,
    wait,
  });
  return Object.freeze({ kind: "deactivated", serviceTarget });
}

export type MacOSLocalCoreUninstallResult = Readonly<{
  dataRootPreserved: string;
  kind: "already_absent" | "uninstalled";
  plistRemoved: boolean;
  serviceTarget: string;
}>;

/**
 * Removes only the per-user LaunchAgent. Persistent Room, Agent,
 * credential-digest and TLS state is never part of service removal.
 */
export async function uninstallMacOSLocalCore(input: {
  label: string;
  launchctl?: MacOSLaunchCtlPort;
  plistPath: string;
  pollAttempts?: number;
  pollIntervalMs?: number;
  userId?: number;
  wait?: (delayMs: number) => Promise<void>;
  workbenchHome: string;
}): Promise<MacOSLocalCoreUninstallResult> {
  const label = launchdLabel(input.label);
  const plistPath = absolutePath(input.plistPath, "plistPath");
  if (basename(plistPath) !== `${label}.plist`) {
    throw new Error("LaunchAgent plist filename must match its label");
  }
  const workbenchHome = absolutePath(input.workbenchHome, "workbenchHome");
  const launchctl = input.launchctl ?? new NodeMacOSLaunchCtl();
  const userId = nonNegativeInteger(input.userId ?? currentUserId(), "userId");
  const attempts = positiveInteger(input.pollAttempts ?? 100, "pollAttempts");
  const intervalMs = positiveInteger(
    input.pollIntervalMs ?? 100,
    "pollIntervalMs",
  );
  const wait = input.wait ?? waitForDelay;
  const serviceTarget = `gui/${String(userId)}/${label}`;
  const loaded = await probeLoaded(launchctl, serviceTarget);
  if (loaded) {
    requireSuccess("bootout", await launchctl.run(["bootout", serviceTarget]));
    await waitForRegistration({
      attempts,
      expectedLoaded: false,
      intervalMs,
      launchctl,
      serviceTarget,
      wait,
    });
  }
  const plistRemoved = await removeOwnedRegularFile(
    plistPath,
    "LaunchAgent plist",
  );
  return Object.freeze({
    dataRootPreserved: workbenchHome,
    kind: loaded || plistRemoved ? "uninstalled" : "already_absent",
    plistRemoved,
    serviceTarget,
  });
}

/**
 * Proves the public gateway, not merely launchd registration, using a fixed,
 * content-free endpoint. LAN readiness can pin the local CA without changing
 * global trust state.
 */
export async function proveMacOSLocalCoreReady(input: {
  health: MacOSLocalCoreLaunchAgentPlan["health"];
  pollAttempts?: number;
  pollIntervalMs?: number;
  requestTimeoutMs?: number;
  wait?: (delayMs: number) => Promise<void>;
}): Promise<void> {
  // Cold launch performs bounded identity and optional catalog probes for
  // every installed CLI. A single provider probe may legitimately consume
  // 15 seconds, and launchd can also throttle a recently replaced label, so
  // the outer readiness window must cover that declared startup work.
  const attempts = positiveInteger(input.pollAttempts ?? 600, "pollAttempts");
  const intervalMs = positiveInteger(
    input.pollIntervalMs ?? 100,
    "pollIntervalMs",
  );
  const requestTimeoutMs = positiveInteger(
    input.requestTimeoutMs ?? 2_000,
    "requestTimeoutMs",
  );
  const wait = input.wait ?? waitForDelay;
  const origin = new URL(input.health.origin);
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== ""
  ) {
    throw new Error("local Core health origin is invalid");
  }
  let ca: Buffer | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (
        origin.protocol === "https:" &&
        input.health.caCertificatePath !== undefined
      ) {
        ca = await readBoundedCertificate(input.health.caCertificatePath);
      }
      const healthy = await requestLocalCoreHealth({
        ...(ca === undefined ? {} : { ca }),
        origin,
        timeoutMs: requestTimeoutMs,
      });
      if (healthy) return;
    } catch {
      // A newly bootstrapped LaunchAgent may still be building its state/TLS.
    }
    if (attempt + 1 < attempts) await wait(intervalMs);
  }
  throw new Error("local Core did not prove gateway readiness");
}

function normalizePlan(
  value: MacOSLocalCoreLaunchAgentPlan,
): MacOSLocalCoreLaunchAgentPlan {
  const path = requiredEnvironment(value.environment, "PATH");
  const mode: MacOSLocalCoreMode =
    value.environment.RAH_LAN_ORIGIN === undefined
      ? {
          kind: "loopback",
          port: Number(requiredEnvironment(value.environment, "RAH_WEB_PORT")),
        }
      : {
          bindHost: requiredEnvironment(value.environment, "RAH_LAN_BIND_HOST"),
          ...(value.health.caCertificatePath === undefined
            ? {}
            : { caCertificatePath: value.health.caCertificatePath }),
          ...(value.environment.RAH_LAN_CERT_PATH === undefined
            ? {}
            : {
                certificatePath: value.environment.RAH_LAN_CERT_PATH,
                privateKeyPath: requiredEnvironment(
                  value.environment,
                  "RAH_LAN_KEY_PATH",
                ),
              }),
          kind: "lan",
          publicOrigin: value.environment.RAH_LAN_ORIGIN,
        };
  const expected = createMacOSLocalCoreLaunchAgentPlan({
    label: value.label,
    logDirectory: value.logDirectory,
    mode,
    nodeExecutablePath: value.nodeExecutablePath,
    pathEntries: path.split(delimiter),
    plistPath: value.plistPath,
    programArguments: value.programArguments,
    ...(value.runnerIntegrity === undefined
      ? {}
      : { runnerIntegrity: value.runnerIntegrity }),
    runnerScriptPath: value.runnerScriptPath,
    staticDirectory: value.staticDirectory,
    userHomeDirectory: value.userHomeDirectory,
    workbenchHome: value.workbenchHome,
    workspaceCwd: value.workspaceCwd,
  });
  if (expected.plist !== value.plist) {
    throw new Error("local Core LaunchAgent plan was mutated");
  }
  return expected;
}

function normalizeProgramArguments(
  values: readonly string[],
  executablePath: string,
): string[] {
  if (values.length < 1 || values.length > 64) {
    throw new Error("Local Core program arguments are invalid");
  }
  const normalized = values.map((value) => {
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > 16_384 ||
      value.includes("\0")
    ) {
      throw new Error("Local Core program argument is invalid");
    }
    return value;
  });
  if (normalized[0] !== executablePath) {
    throw new Error("Local Core program must start with its executable");
  }
  return normalized;
}

function normalizeMode(mode: MacOSLocalCoreMode): MacOSLocalCoreMode {
  if (mode.kind === "loopback") {
    return Object.freeze({
      kind: "loopback",
      port: tcpPort(mode.port, "loopback port"),
    });
  }
  if (mode.kind !== "lan") throw new Error("local Core mode is invalid");
  if (
    typeof mode.bindHost !== "string" ||
    mode.bindHost.trim().length === 0 ||
    mode.bindHost.length > 255 ||
    mode.bindHost.includes("\0")
  ) {
    throw new Error("LAN bind host is invalid");
  }
  const publicOrigin = exactHttpsOrigin(mode.publicOrigin);
  if (
    (mode.certificatePath === undefined) !==
    (mode.privateKeyPath === undefined)
  ) {
    throw new Error(
      "LAN certificate and private key must be provided together",
    );
  }
  const privateKeyPath = mode.privateKeyPath;
  if (mode.certificatePath !== undefined && privateKeyPath === undefined) {
    throw new Error(
      "LAN certificate and private key must be provided together",
    );
  }
  return Object.freeze({
    bindHost: mode.bindHost,
    ...(mode.caCertificatePath === undefined
      ? {}
      : {
          caCertificatePath: absolutePath(
            mode.caCertificatePath,
            "caCertificatePath",
          ),
        }),
    ...(mode.certificatePath === undefined
      ? {}
      : {
          certificatePath: absolutePath(
            mode.certificatePath,
            "certificatePath",
          ),
          privateKeyPath: absolutePath(
            requiredString(privateKeyPath, "privateKeyPath"),
            "privateKeyPath",
          ),
        }),
    kind: "lan",
    publicOrigin,
  });
}

function exactHttpsOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("LAN publicOrigin must be an exact https origin");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error("LAN publicOrigin must be an exact https origin");
  }
  tcpPort(parsed.port === "" ? 443 : Number(parsed.port), "LAN port");
  return parsed.origin;
}

function normalizeIntegrity(
  value: MacOSLocalCoreLaunchAgentPlanOptions["runnerIntegrity"],
): MacOSLocalCoreLaunchAgentPlan["runnerIntegrity"] {
  if (value === undefined) return undefined;
  if (
    !SHA256.test(value.sha256) ||
    !Number.isSafeInteger(value.size) ||
    value.size < 1 ||
    value.size > MAX_RUNNER_BYTES
  ) {
    throw new Error("runner integrity descriptor is invalid");
  }
  return Object.freeze({ sha256: value.sha256, size: value.size });
}

function renderPlist(input: {
  environment: Readonly<Record<string, string>>;
  label: string;
  logDirectory: string;
  nodeExecutablePath: string;
  programArguments: readonly string[];
  workspaceCwd: string;
}): string {
  const argumentsXml = input.programArguments
    .map((argument) => `      <string>${xml(argument)}</string>`)
    .join("\n");
  const environmentXml = Object.entries(input.environment)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([name, value]) =>
        `      <key>${xml(name)}</key>\n      <string>${xml(value)}</string>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${xml(input.label)}</string>
    <key>Program</key>
    <string>${xml(input.nodeExecutablePath)}</string>
    <key>ProgramArguments</key>
    <array>
${argumentsXml}
    </array>
    <key>EnvironmentVariables</key>
    <dict>
${environmentXml}
    </dict>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>ProcessType</key>
    <string>Background</string>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>TimeOut</key>
    <integer>30</integer>
    <key>Umask</key>
    <string>0077</string>
    <key>WorkingDirectory</key>
    <string>${xml(input.workspaceCwd)}</string>
    <key>StandardOutPath</key>
    <string>${xml(join(input.logDirectory, "core.stdout.log"))}</string>
    <key>StandardErrorPath</key>
    <string>${xml(join(input.logDirectory, "core.stderr.log"))}</string>
  </dict>
</plist>
`;
}

async function verifyRunner(
  plan: MacOSLocalCoreLaunchAgentPlan,
): Promise<void> {
  if (plan.runnerIntegrity === undefined) {
    throw new Error("local Core runner integrity descriptor is required");
  }
  const handle = await openRegularFile(plan.runnerScriptPath, "Core runner");
  try {
    const metadata = await handle.stat();
    if (
      metadata.size !== plan.runnerIntegrity.size ||
      (await hashHandle(handle, metadata.size)) !== plan.runnerIntegrity.sha256
    ) {
      throw new Error("Core runner changed after the plan was created");
    }
  } finally {
    await handle.close();
  }
}

async function verifyExecutable(path: string, label: string): Promise<void> {
  const handle = await openRegularFile(path, label);
  try {
    const metadata = await handle.stat();
    if ((metadata.mode & 0o111) === 0) {
      throw new Error(`${label} is not executable`);
    }
  } finally {
    await handle.close();
  }
}

async function verifyRegularFile(path: string, label: string): Promise<void> {
  const handle = await openRegularFile(path, label);
  await handle.close();
}

async function openRegularFile(
  path: string,
  label: string,
): Promise<FileHandle> {
  let handle: FileHandle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (hasCode(error, "ELOOP"))
      throw new Error(`${label} must not be a symlink`);
    throw error;
  }
  const metadata = await handle.stat();
  if (!metadata.isFile()) {
    await handle.close();
    throw new Error(`${label} must be a regular file`);
  }
  return handle;
}

async function verifyDirectory(path: string, label: string): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory`);
  }
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true });
  const metadata = await lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error(`${path} must be an owner-private directory`);
  }
}

async function ensureOwnedDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o755, recursive: true });
  const metadata = await lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error(`${path} must be an owned directory`);
  }
}

async function removeOwnedRegularFile(
  path: string,
  label: string,
): Promise<boolean> {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error(`${label} must be an owned regular file`);
  }
  await rm(path);
  await syncDirectory(dirname(path));
  return true;
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeAtomicPlist(
  path: string,
  plist: string,
  replaceExisting = false,
): Promise<void> {
  const bytes = Buffer.from(plist);
  try {
    const existing = await readFile(path);
    if (existing.equals(bytes)) return;
    if (!replaceExisting) {
      throw new Error(
        "local Core LaunchAgent plist already exists with different content",
      );
    }
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
  const temporaryPath = `${path}.tmp-${String(process.pid)}-${randomUUID()}`;
  let handle: FileHandle | undefined;
  try {
    handle = await open(
      temporaryPath,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o644,
    );
    await handle.writeFile(bytes);
    await handle.chmod(0o644);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, path);
    const directory = await open(dirname(path), constants.O_RDONLY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await handle?.close();
    await rm(temporaryPath, { force: true });
  }
}

async function readBoundedCertificate(path: string): Promise<Buffer> {
  const handle = await openRegularFile(
    absolutePath(path, "CA certificate path"),
    "CA certificate",
  );
  try {
    const metadata = await handle.stat();
    if (metadata.size < 1 || metadata.size > 1024 * 1024) {
      throw new Error("CA certificate size is invalid");
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function requestLocalCoreHealth(input: {
  ca?: Buffer;
  origin: URL;
  timeoutMs: number;
}): Promise<boolean> {
  return await new Promise<boolean>((resolvePromise) => {
    const request = (
      input.origin.protocol === "https:"
        ? createHttpsRequest
        : createHttpRequest
    )(
      new URL("/_rah/health", input.origin),
      {
        ...(input.ca === undefined ? {} : { ca: input.ca }),
        headers: { accept: "application/json" },
        method: "GET",
        timeout: input.timeoutMs,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer | string) => {
          const bytes = Buffer.from(chunk);
          total += bytes.byteLength;
          if (total > 4_096) {
            response.destroy();
            resolvePromise(false);
            return;
          }
          chunks.push(bytes);
        });
        response.once("error", () => resolvePromise(false));
        response.once("end", () => {
          if (response.statusCode !== 200) {
            resolvePromise(false);
            return;
          }
          try {
            const parsed = JSON.parse(
              Buffer.concat(chunks).toString("utf8"),
            ) as {
              service?: unknown;
              state?: unknown;
            };
            resolvePromise(
              parsed.service === "rah-os-local-core" &&
                parsed.state === "online",
            );
          } catch {
            resolvePromise(false);
          }
        });
      },
    );
    request.once("timeout", () => request.destroy());
    request.once("error", () => resolvePromise(false));
    request.end();
  });
}

async function hashHandle(handle: FileHandle, size: number): Promise<string> {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let position = 0;
  while (position < size) {
    const length = Math.min(buffer.byteLength, size - position);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    if (bytesRead <= 0) throw new Error("Core runner ended early");
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest("hex");
}

async function probeLoaded(
  launchctl: MacOSLaunchCtlPort,
  serviceTarget: string,
): Promise<boolean> {
  const result = await launchctl.run(["print", serviceTarget]);
  if (result.exitCode === 0) return true;
  if (result.exitCode === LAUNCHCTL_MISSING_SERVICE_EXIT_CODE) return false;
  throw new Error(
    `launchctl print failed with exit code ${String(result.exitCode)}`,
  );
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
    `local Core LaunchAgent did not become ${input.expectedLoaded ? "loaded" : "unloaded"}`,
  );
}

function requireSuccess(operation: string, result: { exitCode: number }): void {
  if (result.exitCode !== 0) {
    throw new Error(
      `launchctl ${operation} failed with exit code ${String(result.exitCode)}`,
    );
  }
}

function currentUserId(): number {
  if (typeof process.getuid !== "function") {
    throw new Error("macOS local Core LaunchAgent requires a POSIX user ID");
  }
  return process.getuid();
}

function launchdLabel(value: string): string {
  if (
    typeof value !== "string" ||
    value.length < 3 ||
    value.length > 255 ||
    !/^[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+$/u.test(value)
  ) {
    throw new Error("LaunchAgent label is invalid");
  }
  return value;
}

function requiredEnvironment(
  environment: Readonly<Record<string, string>>,
  name: string,
): string {
  return requiredString(environment[name], name);
}

function requiredString(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function absolutePath(value: string, name: string): string {
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

function tcpPort(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be between 1 and 65535`);
  }
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

async function waitForDelay(delayMs: number): Promise<void> {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
}
