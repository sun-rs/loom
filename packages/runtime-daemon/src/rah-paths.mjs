import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

/**
 * Resolve the durable RAH data root. RAH_DATA_HOME is the canonical public
 * setting. RAH_HOME remains supported for existing installations.
 * @param {{ environment?: NodeJS.ProcessEnv, userHomeDirectory?: string }} [options]
 */
export function resolveRahDataHome(options = {}) {
  const environment = options.environment ?? process.env;
  const userHomeDirectory = resolve(options.userHomeDirectory ?? homedir());
  const canonical = normalizedOverride(
    environment.RAH_DATA_HOME,
    "RAH_DATA_HOME",
  );
  const legacy = normalizedOverride(environment.RAH_HOME, "RAH_HOME");
  if (canonical !== undefined && legacy !== undefined && canonical !== legacy) {
    throw new Error(
      `conflicting RAH data roots: RAH_DATA_HOME=${canonical} and RAH_HOME=${legacy}`,
    );
  }
  return canonical ?? legacy ?? join(userHomeDirectory, ".rah");
}

/** @param {{ environment?: NodeJS.ProcessEnv, userHomeDirectory?: string }} [options] */
export function resolveRahRuntimeHome(options = {}) {
  return join(resolveRahDataHome(options), "runtime-daemon");
}

/**
 * @param {{ environment?: NodeJS.ProcessEnv, installRoot: string, userHomeDirectory?: string }} options
 */
export function resolveRahStorageLayout(options) {
  const installRoot = absolutePath(options.installRoot, "installRoot");
  const dataRoot = resolveRahDataHome(options);
  assertRahInstallDataSeparation(installRoot, dataRoot);
  return Object.freeze({
    attachmentsRoot: join(dataRoot, "attachments"),
    authRoot: join(dataRoot, "auth"),
    councilRoot: join(dataRoot, "council"),
    dataRoot,
    installRoot,
    runtimeRoot: join(dataRoot, "runtime-daemon"),
  });
}

/** @param {string} installRoot @param {string} dataRoot */
export function assertRahInstallDataSeparation(installRoot, dataRoot) {
  const install = absolutePath(installRoot, "installRoot");
  const data = absolutePath(dataRoot, "dataRoot");
  if (
    install === data ||
    containsPath(install, data) ||
    containsPath(data, install)
  ) {
    throw new Error(
      `RAH install and durable data roots must be separate: ${install} vs ${data}`,
    );
  }
}

/** @param {string | undefined} value @param {string} name */
function normalizedOverride(value, name) {
  const trimmed = value?.trim();
  return trimmed ? absolutePath(trimmed, name) : undefined;
}

/** @param {string} value @param {string} name */
function absolutePath(value, name) {
  if (typeof value !== "string" || !isAbsolute(value) || value.includes("\0")) {
    throw new Error(`${name} must be an absolute path`);
  }
  return resolve(value);
}

/** @param {string} parent @param {string} child */
function containsPath(parent, child) {
  const difference = relative(parent, child);
  return (
    difference !== "" &&
    difference !== ".." &&
    !difference.startsWith(`..${sep}`) &&
    !isAbsolute(difference)
  );
}
