import { createHmac, randomBytes } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { resolveCliExecutable, resolveNativeExecutable } from './executables.mjs';
import { RefreshFailure } from './account-refresh/process.mjs';
import { readProvider } from './account-refresh/providers.mjs';
import { verifiedAccountVersion } from '../adapters/accounts/versions.mjs';

const sources = {
  codex: 'codex-app-server', claude: 'claude-cli', agy: 'agy-cli', opencode: 'opencode-api',
};
const configKeys = {
  codex: ['CODEX_HOME'],
  claude: ['CLAUDE_CONFIG_DIR'],
  agy: ['ANTIGRAVITY_APP_DATA_DIR', 'GEMINI_HOME'],
  opencode: [],
};
const baseEnvKeys = [
  'HOME', 'PATH', 'TMPDIR', 'TMP', 'TEMP', 'TZ', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM',
  'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_RUNTIME_DIR',
];
const projectKeys = new WeakMap();
const defaultRefreshTimeoutMs = 50_000;
const safeRef = value => typeof value === 'string' && /^[a-z\d][a-z\d_.:-]{0,127}$/i.test(value);
const absolute = value => typeof value === 'string' && isAbsolute(value) && !/[\x00-\x1f\x7f]/.test(value);
const emailParts = value => typeof value === 'string' &&
  /^([a-z\d])[a-z\d._+%*-]*@([a-z\d-]+(?:\.[a-z\d-]+)+)$/i.exec(value.trim());

function loginDirectory(path) {
  if (!absolute(path)) return null;
  try {
    const resolved = realpathSync(path);
    if (statSync(resolved).isDirectory()) return resolved;
  } catch { /* An unavailable directory cannot safely select a login. */ }
  return null;
}

function selectAccounts(clis, accounts) {
  if (accounts == null) return clis.map(cli => ({ cli }));
  const profileRows = accounts.filter(row => clis.includes(row?.cli)).map(row => ({
    cli: row.cli, accountRef: safeRef(row.accountRef) ? row.accountRef : null,
    configDir: loginDirectory(row.configDir), active: typeof row.active === 'boolean' ? row.active : null,
  }));
  const byRef = Map.groupBy(profileRows, row => JSON.stringify([row.cli, row.accountRef]));
  const byDir = Map.groupBy(profileRows, row => JSON.stringify([row.cli, row.configDir]));
  return [...byRef.values()].map(rows => {
    const row = rows[0];
    const otherBindings = byDir.get(JSON.stringify([row.cli, row.configDir]));
    const valid = row.accountRef && row.configDir &&
      rows.every(other => other.configDir === row.configDir && other.active === row.active) &&
      otherBindings.every(other => other.accountRef === row.accountRef);
    return { ...row, invalid: !valid };
  });
}

function commandEnv(cli, env, profile) {
  // Only paths and basic process settings are inherited. The provider performs
  // its own authentication inside the selected login directory.
  const keys = [...baseEnvKeys, ...configKeys[cli]];
  const childEnv = Object.fromEntries(keys.filter(key => typeof env[key] === 'string').map(key => [key, env[key]]));
  for (const key of configKeys[cli]) {
    if (profile.configDir) childEnv[key] = profile.configDir;
    else if (childEnv[key] != null && !absolute(childEnv[key])) {
      throw new RefreshFailure('error', 'invalid-account-directory');
    }
  }
  if (cli === 'claude') {
    // Claude uses USER for its Keychain account and the storage directory for
    // its credential namespace. An explicit profile must use its own namespace.
    if (typeof env.USER === 'string') childEnv.USER = env.USER;
    const storageDir = env.CLAUDE_SECURESTORAGE_CONFIG_DIR;
    if (!profile.configDir && typeof storageDir === 'string') {
      // Claude treats an empty override as selecting its default namespace.
      if (storageDir && !absolute(storageDir)) {
        throw new RefreshFailure('error', 'invalid-account-directory');
      }
      childEnv.CLAUDE_SECURESTORAGE_CONFIG_DIR = storageDir;
    }
    childEnv.DISABLE_AUTOUPDATER = '1';
    childEnv.LC_ALL = 'C';
  }
  if (cli === 'opencode' && profile.configDir) {
    childEnv.XDG_CONFIG_HOME = join(profile.configDir, 'config');
    childEnv.XDG_DATA_HOME = join(profile.configDir, 'data');
    childEnv.XDG_CACHE_HOME = join(profile.configDir, 'cache');
    childEnv.XDG_STATE_HOME = join(profile.configDir, 'state');
  }
  return childEnv;
}

function makeObservations(data, profile, observedAt, secret, unverified) {
  const { cli } = profile;
  const match = emailParts(data.email);
  const maskedAccount = match ? match[1] + '***@' + match[2] : null;
  const identity = data.identity ? cli + ':' + data.identity :
    match && !data.email.includes('*') ? data.email.trim().toLowerCase() : null;
  const accountRef = profile.accountRef ?? (identity && createHmac('sha256', secret).update(identity).digest('hex'));
  const evidence = {
    cli, source: sources[cli], observed_at: observedAt,
    ...(unverified && { cli_version: unverified.version, version_status: 'unverified' }),
    ...(accountRef && { account_ref: accountRef }),
    ...(!profile.accountRef && { generation: 'refresh:' + cli }),
    masked_account: maskedAccount, plan: data.plan ?? null,
    active: profile.configDir ? profile.active : data.active ?? null,
    reset_credits: data.resetCredits ?? null, expires_at: data.expiresAt ?? null,
  };
  // An account read can establish metadata even when no quota windows exist.
  const windows = data.windows.length || ![evidence.masked_account, evidence.active, evidence.expires_at,
    evidence.reset_credits].some(value => value != null) ? data.windows : [{}];
  return windows.map(window => ({
    ...evidence, limit_id: null, bucket: null, scope: null, model: null,
    used_percent: null, window_minutes: null, resets_at: null, ...window,
  }));
}

function resolveRefreshExecutable(cli, executables, env) {
  try {
    const binary = executables && Object.hasOwn(executables, cli) ?
      resolveNativeExecutable(executables[cli]) : resolveCliExecutable(cli, { env });
    return { binary };
  } catch (error) {
    return { status: error.code === 'protected-executable' ? 'rejected' : error.code === 'ENOENT' ? 'not-found' : 'invalid-cli-executable' };
  }
}

export async function refreshAccounts({
  executables, env = process.env, timeoutMs = defaultRefreshTimeoutMs, now = Date.now, providers, accounts,
  lastAttempts = new Map(), minRefreshIntervalMs = 60_000, secret, signal,
} = {}) {
  const startedAt = Number(now());
  const refreshed_at = new Date(startedAt).toISOString();
  const interval = Number.isFinite(minRefreshIntervalMs) && minRefreshIntervalMs > 0 ? minRefreshIntervalMs : 60_000;
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, 2_147_483_647) : defaultRefreshTimeoutMs;
  const clis = [...new Set(providers ?? Object.keys(executables ?? sources))]
    .filter(cli => Object.hasOwn(sources, cli));
  const selected = selectAccounts(clis, accounts);
  const selectedClis = new Set(selected.map(profile => profile.cli));
  const resolutions = new Map([...selectedClis].map(cli => [cli, resolveRefreshExecutable(cli, executables, env)]));
  const resolvedExecutables = Object.fromEntries(Object.keys(sources).map(cli => {
    const result = resolutions.get(cli);
    return [cli, result?.binary ?? result?.status ?? 'not-selected'];
  }));
  if (!secret) {
    if (!projectKeys.has(lastAttempts)) projectKeys.set(lastAttempts, randomBytes(32));
    secret = projectKeys.get(lastAttempts);
  }

  const results = await Promise.all(selected.map(async profile => {
    const { cli, accountRef } = profile;
    const info = { cli, ...(accountRef && { accountRef }) };
    const attemptKey = JSON.stringify([cli, accountRef ?? null]);
    const last = lastAttempts.get(attemptKey);
    if (last != null && startedAt - last < interval) {
      return { outcome: { ...info, status: 'cooldown' }, observations: [] };
    }
    lastAttempts.set(attemptKey, startedAt);
    const ctx = { cli, configDir: profile.configDir, startedAt, deadline: performance.now() + timeout, version: null, signal };
    try {
      if (profile.invalid) throw new RefreshFailure('error', 'invalid-account-directory');
      const { binary } = resolutions.get(cli);
      if (!binary) throw new RefreshFailure('error', 'invalid-cli-executable');
      ctx.env = commandEnv(cli, env, profile);
      const data = await readProvider[cli](binary, ctx);
      const observedAt = new Date(now()).toISOString();
      const unverified = verifiedAccountVersion(cli, ctx.version) ? undefined : { version: ctx.version };
      return {
        outcome: { ...info, status: 'ok', version: ctx.version, ...(unverified && { versionStatus: 'unverified' }) },
        observations: makeObservations(data, profile, observedAt, secret, unverified),
      };
    } catch (error) {
      const { status, reason } = error instanceof RefreshFailure ? error : { status: 'error' };
      return { outcome: { ...info, status, ...(reason && { reason }), version: ctx.version }, observations: [] };
    }
  }));

  const counts = new Map();
  const outcomes = Object.fromEntries(results.map(({ outcome }) => {
    const ordinal = (counts.get(outcome.cli) ?? 0) + 1;
    counts.set(outcome.cli, ordinal);
    return [ordinal === 1 ? outcome.cli : outcome.cli + ':' + ordinal, outcome];
  }));
  return { ok: true, refreshed_at, outcomes, resolvedExecutables,
    observations: results.flatMap(result => result.observations) };
}
