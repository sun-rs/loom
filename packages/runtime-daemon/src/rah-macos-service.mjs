import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

import {
  assertRahInstallDataSeparation,
  resolveRahDataHome,
  resolveRahRuntimeHome,
} from "./rah-paths.mjs";

const execFileAsync = promisify(execFile);
export const RAH_MACOS_SERVICE_LABEL = "dev.rah.workbench";

/**
 * @typedef {{
 *   bootstrap: (plistPath: string) => Promise<void>,
 *   bootout: (serviceTarget: string) => Promise<void>,
 *   loaded: (serviceTarget: string) => Promise<boolean>
 * }} RahLaunchctl
 */

/**
 * @param {{ dataRoot?: string, environment?: NodeJS.ProcessEnv, host?: string,
 * installRoot: string, label?: string, nodeExecutablePath?: string, port?: number,
 * userHomeDirectory?: string }} options
 */
export function createRahMacOSServicePlan(options) {
  const environment = options.environment ?? process.env;
  const userHomeDirectory = absolutePath(
    options.userHomeDirectory ?? homedir(),
    "userHomeDirectory",
  );
  const installRoot = absolutePath(options.installRoot, "installRoot");
  const dataRoot =
    options.dataRoot === undefined
      ? resolveRahDataHome({ environment, userHomeDirectory })
      : absolutePath(options.dataRoot, "dataRoot");
  assertRahInstallDataSeparation(installRoot, dataRoot);
  const runtimeRoot = resolveRahRuntimeHome({
    environment: { RAH_DATA_HOME: dataRoot },
    userHomeDirectory,
  });
  const label = launchdLabel(options.label ?? RAH_MACOS_SERVICE_LABEL);
  const port = validPort(options.port ?? 43111);
  const host = nonEmpty(options.host ?? "127.0.0.1", "host");
  const nodeExecutablePath = absolutePath(
    options.nodeExecutablePath ?? process.execPath,
    "nodeExecutablePath",
  );
  const mainPath = join(
    installRoot,
    "packages",
    "runtime-daemon",
    "src",
    "main.ts",
  );
  const webIndexPath = join(
    installRoot,
    "packages",
    "client-web",
    "dist",
    "index.html",
  );
  const plistPath = join(
    userHomeDirectory,
    "Library",
    "LaunchAgents",
    `${label}.plist`,
  );
  const serviceTarget = `gui/${String(process.getuid?.() ?? 0)}/${label}`;
  const environmentVariables = Object.freeze({
    HOME: userHomeDirectory,
    PATH: environment.PATH?.trim() || "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    RAH_DATA_HOME: dataRoot,
    RAH_HOST: host,
    RAH_PORT: String(port),
  });
  const programArguments = Object.freeze([
    nodeExecutablePath,
    "--import",
    "tsx",
    mainPath,
  ]);
  const logPath = join(runtimeRoot, `service-${String(port)}.log`);
  const plist = renderPlist({
    environment: environmentVariables,
    label,
    logPath,
    programArguments,
    workingDirectory: installRoot,
  });
  return Object.freeze({
    dataRoot,
    environment: environmentVariables,
    host,
    installRoot,
    label,
    logPath,
    mainPath,
    nodeExecutablePath,
    plist,
    plistPath,
    port,
    programArguments,
    runtimeRoot,
    serviceTarget,
    userHomeDirectory,
    webIndexPath,
  });
}

/**
 * @param {{ healthCheck?: (origin: string) => Promise<boolean>, launchctl?: RahLaunchctl, plan: ReturnType<typeof createRahMacOSServicePlan>, replaceExisting?: boolean }} input
 */
export async function installRahMacOSService(input) {
  const plan = input.plan;
  await verifyPlan(plan);
  const launchctl = input.launchctl ?? defaultLaunchctl();
  const previousPlist = await readOptional(plan.plistPath);
  const wasLoaded = await launchctl.loaded(plan.serviceTarget);
  if ((previousPlist !== undefined || wasLoaded) && !input.replaceExisting) {
    throw new Error(
      "RAH service already exists; pass --replace to replace the registered service",
    );
  }
  await ensureOwnerDirectory(plan.dataRoot);
  await ensureOwnerDirectory(plan.runtimeRoot);
  await ensureDirectory(dirname(plan.plistPath));
  await writeAtomic(plan.plistPath, plan.plist, 0o600);
  try {
    if (wasLoaded) await launchctl.bootout(plan.serviceTarget);
    await launchctl.bootstrap(plan.plistPath);
    const healthHost =
      plan.host === "0.0.0.0" || plan.host === "::" ? "127.0.0.1" : plan.host;
    const healthy = await (input.healthCheck ?? defaultHealthCheck)(
      `http://${healthHost}:${String(plan.port)}`,
    );
    if (!healthy) throw new Error("RAH service failed readiness proof");
  } catch (error) {
    await launchctl.bootout(plan.serviceTarget).catch(() => undefined);
    if (previousPlist === undefined) {
      await rm(plan.plistPath, { force: true });
    } else {
      await writeAtomic(plan.plistPath, previousPlist, 0o600);
      if (wasLoaded) await launchctl.bootstrap(plan.plistPath);
    }
    throw error;
  }
  return Object.freeze({
    dataRoot: plan.dataRoot,
    kind: previousPlist === undefined ? "installed" : "replaced",
    plistPath: plan.plistPath,
    serviceTarget: plan.serviceTarget,
  });
}

/**
 * Removing the program registration deliberately has no data-deletion option.
 * @param {{ launchctl?: RahLaunchctl, plan: ReturnType<typeof createRahMacOSServicePlan> }} input
 */
export async function uninstallRahMacOSService(input) {
  const plan = input.plan;
  const launchctl = input.launchctl ?? defaultLaunchctl();
  await launchctl.bootout(plan.serviceTarget).catch(() => undefined);
  await rm(plan.plistPath, { force: true });
  return Object.freeze({
    dataRootPreserved: plan.dataRoot,
    kind: "uninstalled",
    plistPath: plan.plistPath,
    serviceTarget: plan.serviceTarget,
  });
}

/** @param {ReturnType<typeof createRahMacOSServicePlan>} plan */
async function verifyPlan(plan) {
  assertRahInstallDataSeparation(plan.installRoot, plan.dataRoot);
  await Promise.all([
    access(plan.nodeExecutablePath, constants.X_OK),
    regularFile(plan.mainPath, "daemon entry"),
    regularFile(plan.webIndexPath, "Web build"),
  ]);
}

/** @param {string} path @param {string} name */
async function regularFile(path, name) {
  const evidence = await lstat(path).catch(() => undefined);
  if (!evidence?.isFile() || evidence.isSymbolicLink()) {
    throw new Error(`${name} must be a regular file: ${path}`);
  }
}

/** @param {string} path */
async function ensureOwnerDirectory(path) {
  await mkdir(path, { mode: 0o700, recursive: true });
  const evidence = await lstat(path);
  if (
    !evidence.isDirectory() ||
    evidence.isSymbolicLink() ||
    (process.getuid?.() !== undefined && evidence.uid !== process.getuid?.())
  ) {
    throw new Error(`RAH data path must be an owner directory: ${path}`);
  }
  await chmod(path, 0o700);
}

/** @param {string} path */
async function ensureDirectory(path) {
  await mkdir(path, { recursive: true });
  const evidence = await lstat(path);
  if (!evidence.isDirectory() || evidence.isSymbolicLink()) {
    throw new Error(`expected a directory: ${path}`);
  }
}

/** @param {string} path */
async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

/** @param {string} path @param {string} value @param {number} mode */
async function writeAtomic(path, value, mode) {
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${String(process.pid)}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporary, value, { flag: "wx", mode });
    await rename(temporary, path);
    await chmod(path, mode);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

/** @param {string} origin */
async function defaultHealthCheck(origin) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/readyz`, {
        signal: AbortSignal.timeout(1_500),
      });
      if (response.ok && (await response.text()).trim() === "ok") return true;
    } catch {
      // launchd may still be starting the service
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  return false;
}

/** @returns {Readonly<RahLaunchctl>} */
function defaultLaunchctl() {
  const domain = `gui/${String(process.getuid?.() ?? 0)}`;
  return Object.freeze({
    loaded: async (serviceTarget) => {
      try {
        await execFileAsync("/bin/launchctl", ["print", serviceTarget]);
        return true;
      } catch (error) {
        if (errorCode(error) === 113) return false;
        return false;
      }
    },
    bootout: async (serviceTarget) => {
      try {
        await execFileAsync("/bin/launchctl", ["bootout", serviceTarget]);
      } catch (error) {
        if (errorCode(error) !== 113) throw error;
      }
    },
    bootstrap: async (plistPath) => {
      await execFileAsync("/bin/launchctl", ["bootstrap", domain, plistPath]);
    },
  });
}

/**
 * @param {{ environment: Readonly<Record<string, string>>, label: string,
 * logPath: string, programArguments: readonly string[], workingDirectory: string }} input
 */
function renderPlist(input) {
  const argumentsXml = input.programArguments
    .map((value) => `      <string>${xml(value)}</string>`)
    .join("\n");
  const environmentXml = Object.entries(input.environment)
    .map(
      ([key, value]) =>
        `      <key>${xml(key)}</key>\n      <string>${xml(value)}</string>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(input.label)}</string>
  <key>ProgramArguments</key>
  <array>
${argumentsXml}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${environmentXml}
  </dict>
  <key>WorkingDirectory</key>
  <string>${xml(input.workingDirectory)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xml(input.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(input.logPath)}</string>
</dict>
</plist>
`;
}

/** @param {string} value */
function xml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** @param {string} value @param {string} name */
function absolutePath(value, name) {
  if (!isAbsolute(value) || value.includes("\0")) {
    throw new Error(`${name} must be an absolute path`);
  }
  return resolve(value);
}

/** @param {string} value */
function launchdLabel(value) {
  if (!/^[A-Za-z0-9.-]{1,128}$/u.test(value)) {
    throw new Error("invalid launchd label");
  }
  return value;
}

/** @param {number} value */
function validPort(value) {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error("port must be between 1 and 65535");
  }
  return value;
}

/** @param {string} value @param {string} name */
function nonEmpty(value, name) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} must not be empty`);
  return normalized;
}

/** @param {unknown} error */
function errorCode(error) {
  return error !== null && typeof error === "object" && "code" in error
    ? error.code
    : undefined;
}
