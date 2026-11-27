import { accessSync, constants, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';

export const codexFastArgs = fast => fast === undefined ? [] : ['-c', 'service_tier="' + (fast ? 'fast' : 'default') + '"'];
const protectedPath = /(?:^|[/\\])ccp(?:[/\\]|$)|claude-protected/i;
const executableError = (code, message) => Object.assign(new Error(message), { code });
export const missingExecutable = error => ['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code);

export function resolveNativeExecutable(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || /[\x00-\x1f\x7f]/.test(path)) {
    throw executableError('invalid-arguments', 'Native executable must be an absolute path');
  }
  const guard = candidate => {
    if (protectedPath.test(candidate)) throw executableError('protected-executable', 'CCP cannot be used as a native executable');
  };
  guard(path);
  const resolved = realpathSync(path);
  guard(resolved);
  if (!statSync(resolved).isFile()) throw executableError('EACCES', 'Native executable must be a regular file');
  accessSync(resolved, constants.X_OK);
  return resolved;
}

function firstNativeExecutable(candidates, { strict = false, claudeVersions } = {}) {
  for (const candidate of candidates) {
    try {
      const resolved = resolveNativeExecutable(candidate);
      if (claudeVersions && resolved !== candidate && dirname(resolved) !== claudeVersions) {
        throw executableError('protected-executable', 'Refusing a Claude symlink outside the native versions directory');
      }
      return resolved;
    } catch (error) {
      if (!(error.code === 'protected-executable' && !strict) && !missingExecutable(error)) throw error;
    }
  }
}

export function nativeClaude({ allowPathDiscovery = true, env = process.env, home = env.HOME || homedir(), strict = false } = {}) {
  const override = strict ? env.LOOM_CLAUDE_BIN ?? env.OAR_CLAUDE_BIN : env.LOOM_CLAUDE_BIN || env.OAR_CLAUDE_BIN;
  if (strict ? override != null : override) return resolveNativeExecutable(override);
  if (!isAbsolute(home)) throw executableError('invalid-arguments', 'Native executable home must be absolute');
  if (strict) home = realpathSync(home);
  const dir = join(home, '.local/share/claude/versions');
  if (strict) {
    try {
      if (realpathSync(dir) !== dir) throw executableError('protected-executable', 'Refusing a Claude symlink outside the native versions directory');
    } catch (error) { if (!missingExecutable(error)) throw error; }
  }
  let versions = [];
  try { versions = readdirSync(dir).filter(name => /^\d+\.\d+\.\d+$/.test(name)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  versions.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
  const path = allowPathDiscovery ? env.PATH?.split(delimiter).filter(isAbsolute) ?? [] : [];
  const binary = firstNativeExecutable([...versions.map(version => join(dir, version)),
    ...[join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', ...path].map(dir => join(dir, 'claude'))], { strict, ...(strict && { claudeVersions: dir }) });
  if (binary) return binary;
  throw executableError('ENOENT', 'Native Claude executable not found. Set LOOM_CLAUDE_BIN to its absolute path.');
}

export const workerBinaryKeys = Object.freeze({
  codex: 'OAR_CODEX_BIN', agy: 'OAR_ANTIGRAVITY_BIN', claude: 'OAR_CLAUDE_BIN', opencode: 'OAR_OPENCODE_BIN',
});

export function nativeWorkerExecutable(cli, { env = process.env, home = env.HOME || homedir(), strict = false } = {}) {
  if (!Object.hasOwn(workerBinaryKeys, cli)) throw new RangeError('Unknown worker provider');
  if (cli === 'claude') return nativeClaude({ allowPathDiscovery: false, env, home, strict });
  const overrideKey = `LOOM_${cli.toUpperCase()}_BIN`;
  const vendor = env[workerBinaryKeys[cli]];
  const override = strict ? env[overrideKey] ?? vendor : env[overrideKey] || vendor;
  if (strict ? override != null : override) return resolveNativeExecutable(override);
  if (!isAbsolute(home)) throw executableError('invalid-arguments', 'Native executable home must be absolute');
  const directories = [join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
  if (cli === 'opencode') directories.unshift(join(home, '.opencode', 'bin'));
  const candidates = directories.map(dir => join(dir, cli));
  if (cli === 'codex' && process.platform === 'darwin') candidates.push(
    '/Applications/ChatGPT.app/Contents/Resources/codex', '/Applications/Codex.app/Contents/Resources/codex');
  const binary = firstNativeExecutable(candidates, { strict });
  if (binary) return binary;
  throw executableError('ENOENT', `Native ${cli} executable not found. Set ${overrideKey} to its absolute path.`);
}

// Account probes use the shared native resolver without PATH discovery. A
// rejected default alias is reported directly to the operator.
export function resolveCliExecutable(cli, options) {
  return nativeWorkerExecutable(cli, { ...options, strict: true });
}
