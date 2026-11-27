import { accessSync, constants, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ownRelease = fileURLToPath(new URL('../', import.meta.url));
const versionPattern = /^\d+\.\d+\.\d+$/;
const legacyProbeKey = 'LOOM_NODE_LEGACY_SELF_CHECK';

export function nodeVersion(root = ownRelease) {
  let version;
  try { [version] = readFileSync(join(root, 'bin', 'node-runtime'), 'utf8').split('\n', 1); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (!versionPattern.test(version)) throw new Error('Invalid Loom Node version pin');
  return version;
}

export function nodeRuntimeRoot() {
  const executable = dirname(dirname(process.execPath));
  const root = process.env.LOOM_NODE_ROOT ?? (basename(executable) === `node-${process.versions.node}` ?
    dirname(executable) : join(homedir(), '.loom-cell', 'runtime'));
  if (!isAbsolute(root)) throw new Error('Loom Node runtime directory must be absolute');
  return root;
}

export function releaseNode(root, recorded) {
  const version = nodeVersion(root);
  if (!version) {
    const path = recorded?.path ?? process.execPath;
    if (!isAbsolute(path)) throw new Error('Recorded legacy Node path must be absolute');
    return realpathSync(path);
  }
  const path = join(nodeRuntimeRoot(), `node-${version}`, 'bin', 'node');
  try {
    accessSync(path, constants.X_OK);
    return realpathSync(path);
  } catch (error) {
    throw new Error(`Missing Loom Node ${version} at ${path}. Run bin/install-node.`, { cause: error });
  }
}

export const runningNode = () => ({ path: process.execPath, version: process.versions.node, abi: process.versions.modules });

export function enterPinnedNode({ legacyProbe = false } = {}) {
  const path = releaseNode(ownRelease);
  const legacy = process.env[legacyProbeKey];
  delete process.env[legacyProbeKey];
  process.env.LOOM_NODE_ROOT = nodeRuntimeRoot();
  if (path !== process.execPath) {
    const env = { ...process.env };
    if (legacyProbe) env[legacyProbeKey] = JSON.stringify(runningNode());
    // The previous release's launcher observes this same PID during handoff.
    process.execve(path, [path, ...process.argv.slice(1)], env);
  }
  if (process.versions.node !== nodeVersion()) throw new Error('Loom Node does not match the pinned version');
  if (legacyProbe && legacy) return JSON.parse(legacy);
}
