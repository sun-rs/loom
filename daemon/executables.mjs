import { accessSync, constants, lstatSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { defaultCcpClaudeEntry, nativeClaudeVersionsPattern, validateCcpClaudeEntry } from './claude-ccp.mjs';

export const codexFastArgs = fast => fast === undefined ? [] : ['-c', 'service_tier="' + (fast ? 'fast' : 'default') + '"'];
const protectedPath = /(?:^|[/\\])ccp(?:[/\\]|$)|claude-protected/i;
export const defaultClaudeEntry = defaultCcpClaudeEntry();
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

function validateClaudeEntry(path, { env = process.env, home } = {}) {
  const effectiveEnv = home && !env.HOME ? { ...env, HOME: home } : env;
  const normalized = validateCcpClaudeEntry(path, effectiveEnv);
  // The CCP entry is deliberately treated as an opaque command. Never
  // realpath it to execute its target, and never fall back to native versions.
  const node = lstatSync(normalized);
  if (!node.isFile() && !node.isSymbolicLink()) {
    throw executableError('ccp-required', 'Claude must be launched through the CCP entry');
  }
  accessSync(normalized, constants.X_OK);
  const target = node.isSymbolicLink() ? readlinkSync(normalized) : '';
  if (target && nativeClaudeVersionsPattern.test(target)) {
    throw executableError('ccp-required', 'Claude entry must route through CCP rather than a direct native version binary');
  }
  const defaultPath = join(effectiveEnv.HOME || homedir(), '.local', 'bin', 'claude');
  if (normalized !== defaultPath && !effectiveEnv.LOOM_TEST_FIXTURE_ROOT &&
      !protectedPath.test(normalized) && !protectedPath.test(target)) {
    throw executableError('ccp-required', 'Configured LOOM_CLAUDE_CCP_BIN must point to a CCP entry');
  }
  return normalized;
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

export function nativeClaude({ env = process.env, home } = {}) {
  const effectiveEnv = home && !env.HOME ? { ...env, HOME: home } : env;
  const override = effectiveEnv.LOOM_CLAUDE_BIN ?? effectiveEnv.OAR_CLAUDE_BIN;
  return validateClaudeEntry(override ?? defaultCcpClaudeEntry(effectiveEnv), { env: effectiveEnv });
}

export const workerBinaryKeys = Object.freeze({
  codex: 'OAR_CODEX_BIN', agy: 'OAR_ANTIGRAVITY_BIN', claude: 'OAR_CLAUDE_BIN', opencode: 'OAR_OPENCODE_BIN',
});

export function nativeWorkerExecutable(cli, { env = process.env, home = env.HOME || homedir(), strict = false } = {}) {
  if (!Object.hasOwn(workerBinaryKeys, cli)) throw new RangeError('Unknown worker provider');
  if (cli === 'claude') return nativeClaude({ env, home });
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

// Account probes use the shared resolver without PATH discovery. Claude must
// resolve to its CCP entry; other CLIs reject CCP paths.
export function resolveCliExecutable(cli, options) {
  return nativeWorkerExecutable(cli, { ...options, strict: true });
}

export const resolveClaudeExecutable = (path, options) => validateClaudeEntry(path, options);
