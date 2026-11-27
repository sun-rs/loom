import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { providers } from '../cli/policy.mjs';
import { readText, writeState } from './io.mjs';

const superFields = new Set([
  'cli', 'model', 'effort', 'entry', 'accountDir', 'sessionId', 'transcriptPath',
  'hcAddress', 'cwd', 'lastOnlineAt', 'handoffPath', 'cleanExit', 'exitReason', 'ownerId', 'cliVersion', 'resumeOnUp',
]);
const projectFields = new Set(['dir', 'release', 'lastOnlineAt', 'lastShutdown']);
const configSuperFields = new Set(['resumeOnUp', 'cli', 'model', 'effort', 'entry', 'accountDir', 'cwd', 'handoffPath']);
const secretField = /(?:secret|token|password|passwd|apikey|api_key|credential|auth|cookie|bearer|private_key)/i;
const shutdownModes = new Set(['normal', 'abnormal']);

function userHome(env = process.env) {
  return env.HOME || homedir();
}

export function globalDir(env = process.env) {
  const dir = env.LOOM_GLOBAL_DIR || join(userHome(env), '.loom');
  if (!isAbsolute(dir)) throw new Error('LOOM_GLOBAL_DIR must be an absolute path');
  return resolve(dir);
}

export const globalRegistryPath = (env = process.env) => join(globalDir(env), 'global.json');
export const globalConfigPath = (env = process.env) => join(globalDir(env), 'config.json');
export const superDir = (env = process.env) => join(globalDir(env), 'super');
export const superLivePath = (env = process.env) => join(superDir(env), 'live.md');
export const superHandoffPath = (env = process.env) => join(superDir(env), 'handoff.md');

export function superHandoffReminder(env = process.env) {
  return `提醒：请更新 Super 交接单 ${superHandoffPath(env)}（≤60 行：在途项目、待决事项、最近裁决）。`;
}

export function resolveAccountDir(cli, env = process.env) {
  const home = userHome(env);
  if (cli === 'codex') return resolve(env.CODEX_HOME || join(home, '.codex'));
  if (cli === 'agy') {
    const base = env.ANTIGRAVITY_APP_DATA_DIR || join(env.GEMINI_HOME || join(home, '.gemini'), 'antigravity-cli');
    return resolve(base);
  }
  if (cli === 'claude') return resolve(env.CLAUDE_CONFIG_DIR || join(home, '.claude'));
  if (cli === 'opencode') return resolve(join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'opencode'));
  return null;
}

function checkAllowedKeys(object, allowed, scope) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) {
    throw new TypeError(`Expected an object for ${scope}`);
  }
  for (const key of Object.keys(object)) {
    if (secretField.test(key) || !allowed.has(key)) {
      throw new Error(`Global registry stores metadata only; disallowed field in ${scope}: ${key}`);
    }
  }
}

function textOrNull(value, name) {
  if (value == null) return null;
  if (typeof value !== 'string' || !value.trim() || /[\x00-\x1f\x7f]/.test(value)) {
    throw new TypeError(`Invalid metadata text for ${name}`);
  }
  return value.trim();
}

function pathOrNull(value, name) {
  const text = textOrNull(value, name);
  if (text === null) return null;
  if (!isAbsolute(text)) throw new TypeError(`Expected absolute path for ${name}`);
  return text;
}

function timestampOrNull(value, name) {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`Expected Unix ms timestamp for ${name}`);
  return value;
}

function normalizeSuper(raw, env) {
  if (raw == null) return null;
  checkAllowedKeys(raw, superFields, 'super');
  const cli = textOrNull(raw.cli, 'super.cli');
  if (cli !== null && !providers.includes(cli)) throw new TypeError(`Unknown super CLI: ${cli}`);
  return {
    cli,
    model: textOrNull(raw.model, 'super.model'),
    effort: textOrNull(raw.effort, 'super.effort'),
    entry: pathOrNull(raw.entry, 'super.entry'),
    accountDir: pathOrNull(raw.accountDir, 'super.accountDir'),
    sessionId: textOrNull(raw.sessionId, 'super.sessionId'),
    transcriptPath: pathOrNull(raw.transcriptPath, 'super.transcriptPath'),
    hcAddress: textOrNull(raw.hcAddress, 'super.hcAddress'),
    cwd: pathOrNull(raw.cwd, 'super.cwd'),
    lastOnlineAt: timestampOrNull(raw.lastOnlineAt, 'super.lastOnlineAt'),
    handoffPath: pathOrNull(raw.handoffPath, 'super.handoffPath') ?? superHandoffPath(env),
    cleanExit: raw.cleanExit === true,
    exitReason: textOrNull(raw.exitReason, 'super.exitReason'),
    ...(raw.ownerId != null && { ownerId: textOrNull(raw.ownerId, 'super.ownerId') }),
    ...(raw.cliVersion != null && { cliVersion: textOrNull(raw.cliVersion, 'super.cliVersion') }),
    ...(typeof raw.resumeOnUp === 'boolean' && { resumeOnUp: raw.resumeOnUp }),
  };
}

function normalizeProject(raw) {
  checkAllowedKeys(raw, projectFields, 'project');
  const dir = pathOrNull(raw.dir, 'project.dir');
  if (!dir) throw new TypeError('Project entry requires an absolute dir');
  const lastShutdown = raw.lastShutdown ?? 'abnormal';
  if (!shutdownModes.has(lastShutdown)) throw new TypeError(`Invalid project lastShutdown: ${lastShutdown}`);
  return {
    dir: resolve(dir),
    release: textOrNull(raw.release, 'project.release'),
    lastOnlineAt: timestampOrNull(raw.lastOnlineAt, 'project.lastOnlineAt'),
    lastShutdown,
  };
}

function normalizeConfig(raw) {
  if (raw == null) return { super: { resumeOnUp: false } };
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Invalid global config');
  const superSection = raw.super ?? {};
  checkAllowedKeys(superSection, configSuperFields, 'config.super');
  return {
    super: {
      resumeOnUp: superSection.resumeOnUp === true,
      ...(superSection.cli != null && { cli: textOrNull(superSection.cli, 'config.super.cli') }),
      ...(superSection.model != null && { model: textOrNull(superSection.model, 'config.super.model') }),
      ...(superSection.effort != null && { effort: textOrNull(superSection.effort, 'config.super.effort') }),
      ...(superSection.entry != null && { entry: pathOrNull(superSection.entry, 'config.super.entry') }),
      ...(superSection.accountDir != null && { accountDir: pathOrNull(superSection.accountDir, 'config.super.accountDir') }),
      ...(superSection.cwd != null && { cwd: pathOrNull(superSection.cwd, 'config.super.cwd') }),
      ...(superSection.handoffPath != null && { handoffPath: pathOrNull(superSection.handoffPath, 'config.super.handoffPath') }),
    },
  };
}

function emptyRegistry() {
  return { version: 1, super: null, projects: [] };
}

export function readGlobalRegistry(env = process.env) {
  const path = globalRegistryPath(env);
  const raw = readText(path, null);
  if (raw === null) return emptyRegistry();
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.version !== 1) {
    throw new Error(`Invalid global registry at ${path}`);
  }
  const allowedTop = new Set(['version', 'super', 'projects', 'config']);
  checkAllowedKeys(parsed, allowedTop, 'global');
  const projects = Array.isArray(parsed.projects) ? parsed.projects.map(normalizeProject) : [];
  const deduped = [...new Map(projects.map(item => [item.dir, item])).values()].sort((a, b) => a.dir.localeCompare(b.dir, 'en'));
  return {
    version: 1,
    super: normalizeSuper(parsed.super, env),
    projects: deduped,
    ...(parsed.config !== undefined && { config: normalizeConfig(parsed.config) }),
  };
}

export function writeGlobalRegistry(data, env = process.env) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new TypeError('Expected a global registry object');
  const allowedTop = new Set(['version', 'super', 'projects', 'config']);
  checkAllowedKeys(data, allowedTop, 'global');
  const projects = Array.isArray(data.projects) ? data.projects.map(normalizeProject) : [];
  const normalized = {
    version: 1,
    super: normalizeSuper(data.super, env),
    projects: [...new Map(projects.map(item => [item.dir, item])).values()].sort((a, b) => a.dir.localeCompare(b.dir, 'en')),
    ...(data.config !== undefined && { config: normalizeConfig(data.config) }),
  };
  const path = globalRegistryPath(env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeState(path, JSON.stringify(normalized, null, 2) + '\n');
  return normalized;
}

export function superConfig(env = process.env) {
  const registry = readGlobalRegistry(env);
  const fileRaw = readText(globalConfigPath(env), null);
  const fileConfig = fileRaw === null ? { super: { resumeOnUp: false } } : normalizeConfig(JSON.parse(fileRaw));
  const regConfig = registry.config?.super ?? {};
  const resumeOnUp = typeof fileConfig.super.resumeOnUp === 'boolean' && fileRaw !== null
    ? fileConfig.super.resumeOnUp
    : typeof regConfig.resumeOnUp === 'boolean'
      ? regConfig.resumeOnUp
      : registry.super?.resumeOnUp === true;
  return {
    ...regConfig,
    ...fileConfig.super,
    resumeOnUp,
  };
}

export function updateSuperRecord(changes, env = process.env) {
  checkAllowedKeys(changes, superFields, 'super');
  const current = readGlobalRegistry(env);
  const merged = normalizeSuper({ ...(current.super ?? {}), ...changes }, env);
  writeGlobalRegistry({ ...current, super: merged }, env);
  return merged;
}

export function markSuperCleanExit(reason = 'normal', env = process.env, at = Date.now()) {
  const current = readGlobalRegistry(env);
  const next = normalizeSuper({
    ...(current.super ?? {}),
    cleanExit: true,
    exitReason: reason,
    lastOnlineAt: at,
  }, env);
  writeGlobalRegistry({ ...current, super: next }, env);
  return next;
}

export function registerGlobalProject(dir, { release = null, lastOnlineAt = Date.now(), lastShutdown = 'abnormal' } = {}, env = process.env) {
  const current = readGlobalRegistry(env);
  const canonical = resolve(dir);
  const existing = current.projects.find(item => item.dir === canonical);
  const next = normalizeProject({
    dir: canonical,
    release: release ?? existing?.release ?? null,
    lastOnlineAt: lastOnlineAt ?? existing?.lastOnlineAt ?? Date.now(),
    lastShutdown,
  });
  const projects = [...current.projects.filter(item => item.dir !== canonical), next];
  writeGlobalRegistry({ ...current, projects }, env);
  return next;
}

export function markProjectShutdown(dir, mode = 'normal', env = process.env, at = Date.now()) {
  if (!shutdownModes.has(mode)) throw new TypeError(`Invalid shutdown mode: ${mode}`);
  const current = readGlobalRegistry(env);
  const canonical = resolve(dir);
  const existing = current.projects.find(item => item.dir === canonical);
  const next = normalizeProject({
    dir: canonical,
    release: existing?.release ?? null,
    lastOnlineAt: at,
    lastShutdown: mode,
  });
  const projects = [...current.projects.filter(item => item.dir !== canonical), next];
  writeGlobalRegistry({ ...current, projects }, env);
  return next;
}

export function listGlobalProjects(env = process.env) {
  return readGlobalRegistry(env).projects;
}
