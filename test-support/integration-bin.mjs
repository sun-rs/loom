import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute } from 'node:path';

export const UNIX_SOCKET_PATH_LIMIT = 103;

export function assertSocketPathLimit(path, label = 'Unix socket path') {
  const bytes = Buffer.byteLength(path);
  if (bytes > UNIX_SOCKET_PATH_LIMIT) {
    throw Object.assign(
      new Error(`${label} exceeds ${UNIX_SOCKET_PATH_LIMIT} bytes (${bytes}): ${path}`),
      { code: 'loom-test-socket-path' },
    );
  }
  return path;
}

export function validateIntegrationBinDir(dir, allowedParents = []) {
  if (typeof dir !== 'string' || !isAbsolute(dir) || basename(dir) !== 'integration-bin') return undefined;
  try {
    const real = realpathSync(dir);
    if (real !== dir || basename(real) !== 'integration-bin') return undefined;
    const info = lstatSync(real);
    if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o077)) return undefined;
    const parents = allowedParents.filter(Boolean).flatMap(parent => {
      try { return [realpathSync(parent)]; } catch { return []; }
    });
    if (allowedParents.length && !parents.includes(dirname(real))) return undefined;
    return real;
  } catch {
    return undefined;
  }
}

export function resolveIntegrationBinDir(env = process.env, extraParents = []) {
  const ps = env.LOOM_TEST_PS_BACKEND || env.LOOM_TEST_PS;
  const fromPs = typeof ps === 'string' && isAbsolute(ps) && basename(ps) === 'ps' &&
    basename(dirname(ps)) === 'integration-bin' ? dirname(ps) : undefined;
  const candidate = env.LOOM_TEST_INTEGRATION_BIN || fromPs;
  if (!candidate) return undefined;
  const allowedParents = [
    ...extraParents,
    env.LOOM_TEST_FIXTURE_ROOT && dirname(env.LOOM_TEST_FIXTURE_ROOT),
    env.LOOM_WORKER_TMP,
    env.TMPDIR,
  ].filter(Boolean);
  return validateIntegrationBinDir(candidate, allowedParents);
}
