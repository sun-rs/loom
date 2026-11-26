import { accessSync, constants, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';

export const codexFastArgs = fast => fast === undefined ? [] : ['-c', 'service_tier="' + (fast ? 'fast' : 'default') + '"'];
const protectedPath = /(?:^|[/\\])ccp(?:[/\\]|$)|claude-protected/i;
const executableError = (code, message) => Object.assign(new Error(message), { code });
export const missingExecutable = error => ['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code);

export function resolveNativeExecutable(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) {
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

function firstNativeExecutable(candidates) {
  for (const candidate of candidates) {
    try { return resolveNativeExecutable(candidate); }
    catch (error) {
      if (error.code !== 'protected-executable' && !missingExecutable(error)) throw error;
    }
  }
}

export function nativeClaude({ allowPathDiscovery = true } = {}) {
  const override = process.env.LOOM_CLAUDE_BIN || process.env.OAR_CLAUDE_BIN;
  if (override) return resolveNativeExecutable(override);
  const home = homedir();
  const dir = join(home, '.local/share/claude/versions');
  let versions = [];
  try { versions = readdirSync(dir).filter(name => /^\d+\.\d+\.\d+$/.test(name)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  versions.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
  const path = allowPathDiscovery ? process.env.PATH?.split(delimiter).filter(isAbsolute) ?? [] : [];
  const binary = firstNativeExecutable([...versions.map(version => join(dir, version)),
    ...[join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', ...path].map(dir => join(dir, 'claude'))]);
  if (binary) return binary;
  throw executableError('ENOENT', 'Native Claude executable not found. Set LOOM_CLAUDE_BIN to its absolute path.');
}

export const workerBinaryKeys = Object.freeze({
  codex: 'OAR_CODEX_BIN', agy: 'OAR_ANTIGRAVITY_BIN', claude: 'OAR_CLAUDE_BIN', opencode: 'OAR_OPENCODE_BIN',
});

export function nativeWorkerExecutable(cli) {
  if (!Object.hasOwn(workerBinaryKeys, cli)) throw new RangeError('Unknown worker provider');
  if (cli === 'claude') return nativeClaude({ allowPathDiscovery: false });
  const overrideKey = `LOOM_${cli.toUpperCase()}_BIN`;
  const override = process.env[overrideKey] || process.env[workerBinaryKeys[cli]];
  if (override) return resolveNativeExecutable(override);
  const home = homedir();
  const directories = [join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
  if (cli === 'opencode') directories.unshift(join(home, '.opencode', 'bin'));
  const candidates = directories.map(dir => join(dir, cli));
  if (cli === 'codex' && process.platform === 'darwin') candidates.push(
    '/Applications/ChatGPT.app/Contents/Resources/codex', '/Applications/Codex.app/Contents/Resources/codex');
  const binary = firstNativeExecutable(candidates);
  if (binary) return binary;
  throw executableError('ENOENT', `Native ${cli} executable not found. Set ${overrideKey} to its absolute path.`);
}
