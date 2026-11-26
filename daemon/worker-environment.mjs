import { execFileSync } from 'node:child_process';
import { chmodSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { inDirectory } from '../cli/project.mjs';
import { readText, writeState } from './io.mjs';

const workerAddress = /^(?:oar|loom)-([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/;
const gitOverrides = ['GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE'];

function privateDirectory(path) {
  try { mkdirSync(path, { mode: 0o700 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const node = lstatSync(path);
  if (!node.isDirectory() || node.uid !== process.getuid() || (node.mode & 0o077) || realpathSync(path) !== path) {
    throw new Error('Worker environment directory must be private');
  }
  return path;
}

export function workerTemporary(row) {
  if (row.role !== 'worker') return {};
  const id = workerAddress.exec(row.addr)?.[1];
  if (!id) throw new Error('Invalid worker address');
  // Keep the temp prefix short enough for a Unix-domain socket pathname.
  const parent = process.env.LOOM_WORKER_TMP;
  const root = privateDirectory(parent && inDirectory(parent, row.cwd) ?
    join(parent, `w-${id.replaceAll('-', '').slice(0, 24)}`) : join(realpathSync('/tmp'), `lw-${id}`));
  return { root, tmp: privateDirectory(join(root, 't')), parent };
}

export function workerEnvironment(row) {
  if (row.role !== 'worker') return {};
  const { root, tmp, parent } = workerTemporary(row);
  const home = privateDirectory(join(root, 'h'));
  const gitConfig = join(home, '.gitconfig');
  // Retain only the commit identity normally found through the launcher HOME.
  // A worktree's own config still takes precedence.
  if (!lstatSync(gitConfig, { throwIfNoEntry: false })) {
    const identity = ['user.name', 'user.email'].flatMap(key => {
      const value = git(row.cwd, 'config', '--global', '--get', key);
      return value ? [`\t${key.slice(5)} = ${quote(value)}`] : [];
    });
    try {
      writeFileSync(gitConfig, ['[user]', ...identity, ''].join('\n'), { flag: 'wx', mode: 0o600 });
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  // Zsh uses TMPPREFIX for heredocs, independently of TMPDIR.
  return { HOME: home, TMPDIR: tmp, TMP: tmp, TEMP: tmp, LOOM_WORKER_TMP: parent ?? tmp,
    TMPPREFIX: join(tmp, 'zsh'), ZDOTDIR: home,
    GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'maintenance.auto', GIT_CONFIG_VALUE_0: 'false',
    XDG_CONFIG_HOME: privateDirectory(join(home, 'config')), XDG_CACHE_HOME: privateDirectory(join(home, 'cache')),
    XDG_DATA_HOME: privateDirectory(join(home, 'data')), XDG_STATE_HOME: privateDirectory(join(home, 'state')),
    XDG_RUNTIME_DIR: tmp };
}

export function workerProviderEnvironment(row) {
  if (row.role !== 'worker') return {};
  const nativeHome = {
    codex: ['CODEX_HOME', '.codex'],
    claude: ['CLAUDE_CONFIG_DIR', '.claude'],
    agy: ['ANTIGRAVITY_APP_DATA_DIR', '.gemini/antigravity-cli'],
  }[row.cli];
  return nativeHome ? { [nativeHome[0]]: process.env[nativeHome[0]] || join(homedir(), nativeHome[1]) } : {};
}

export function workerNativeLogin(row) {
  if (row.role !== 'worker' || process.platform !== 'darwin') return;
  // The macOS native login can depend on the original HOME and on whether a
  // config override was present. The actual session runs under Seatbelt.
  if (row.cli === 'claude') return {
    HOME: homedir(), CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR || null,
  };
  if (row.cli === 'agy') return {
    HOME: homedir(), GEMINI_HOME: process.env.GEMINI_HOME || null,
    ANTIGRAVITY_APP_DATA_DIR: process.env.ANTIGRAVITY_APP_DATA_DIR || null,
  };
}

const shellWord = value => "'" + value.replaceAll("'", "'\\''") + "'";

export function sandboxNativeWorker(project, row, login, isolated, command) {
  const agy = row.cli === 'agy';
  const configured = agy
    ? login.ANTIGRAVITY_APP_DATA_DIR ?? join(login.GEMINI_HOME ?? join(login.HOME, '.gemini'), 'antigravity-cli')
    : login.CLAUDE_CONFIG_DIR ?? join(login.HOME, '.claude');
  if (![command, login.HOME, configured].every(isAbsolute)) throw new Error('Worker login paths must be absolute');
  let data = configured;
  try { data = realpathSync(configured); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (inDirectory(row.cwd, realpathSync(login.HOME)) || inDirectory(row.cwd, data) || inDirectory(data, row.cwd)) {
    throw new Error('Worker launch requires an absolute native executable and a worktree separate from login state');
  }
  const state = (agy ? ['brain', 'conversations', 'log'] : ['projects', 'sessions']).flatMap(name => {
    // Grant only native-generated state directories, without following aliases
    // into the login store or granting write access to its top level.
    const path = join(data, name);
    try { return realpathSync(path) === path && lstatSync(path).isDirectory() ? [path] : []; }
    catch (error) { if (error.code !== 'ENOENT') throw error; return []; }
  });
  const writes = [row.cwd, isolated.HOME, isolated.TMPDIR, ...workerGitWritePaths(project, row.cwd), ...state];
  const agentapi = join(data, 'bin', 'agentapi');
  // agy rewrites this generated shell shim when it initializes its command tool.
  let helper;
  if (agy) {
    try {
      if (realpathSync(dirname(agentapi)) === dirname(agentapi)) {
        const file = lstatSync(agentapi, { throwIfNoEntry: false });
        if (!file || file.isFile()) helper = agentapi;
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const policy = ['(version 1)', '(allow default)', '(deny file-write*)', '(allow file-write* (literal "/dev/null"))',
    '(allow file-write-data (literal "/dev/ptmx") (regex #"^/dev/ttys[0-9]+$"))',
    ...(helper ? [`(allow file-write* (literal ${quote(helper)}))`] : []),
    ...writes.map(path => `(allow file-write* (subpath ${quote(path)}))`),
    ...(row.integration ? [`(deny file-write* (subpath ${quote(join(project, '.project'))}) (subpath ${quote(join(row.cwd, '.project'))}))`] : []),
  ].join('\n');
  const launch = join(dirname(isolated.HOME), 'native');
  writeState(launch, `#!/bin/sh\nexec /usr/bin/sandbox-exec -p ${shellWord(policy)} ${shellWord(command)} "$@"\n`);
  chmodSync(launch, 0o700);
  return launch;
}

function git(cwd, ...args) {
  const env = { ...process.env };
  for (const key of gitOverrides) delete env[key];
  try {
    return execFileSync('/usr/bin/git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000 }).replace(/\r?\n$/, '');
  } catch (error) {
    if (error.status === 128 || error.status === 1) return;
    throw error;
  }
}

function ensureRefPath(common, path) {
  let current = common;
  for (const part of relative(common, dirname(path)).split(sep)) {
    current = join(current, part);
    try { mkdirSync(current); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (!lstatSync(current).isDirectory()) throw new Error('Git ref parent is not a real directory');
  }
  const existing = lstatSync(path, { throwIfNoEntry: false });
  if (existing && !existing.isFile()) throw new Error('Git ref path must be a regular file');
}

export function workerGitWritePaths(project, cwd) {
  const dir = git(cwd, 'rev-parse', '--absolute-git-dir');
  const common = git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  if (!dir || !common || dir === common || dirname(dir) !== join(common, 'worktrees') ||
      common !== git(project, 'rev-parse', '--path-format=absolute', '--git-common-dir')) return [];
  const top = git(cwd, 'rev-parse', '--show-toplevel');
  if (!inDirectory(project, top) || readText(join(dir, 'gitdir'), '').trimEnd() !== join(top, '.git')) return [];
  const objects = join(common, 'objects');
  for (const path of [dir, objects]) {
    if (realpathSync(path) !== path || !lstatSync(path).isDirectory()) throw new Error('Git writable path must be a real directory');
  }
  const branch = git(cwd, 'symbolic-ref', '--quiet', 'HEAD');
  if (git(cwd, 'rev-parse', '--show-ref-format') === 'reftable') {
    if (!branch) return [dir, objects];
    throw new Error('A shared reftable cannot grant writes to one worker branch');
  }
  // Git versions that lock packed refs when removing per-worktree root refs
  // (such as AUTO_MERGE) need only the temporary lock during commit cleanup.
  const packedLock = join(common, 'packed-refs.lock');
  const lock = lstatSync(packedLock, { throwIfNoEntry: false });
  if (lock && (!lock.isFile() || lock.nlink !== 1)) {
    throw new Error('Git packed-refs lock path must be a regular file');
  }
  const paths = [dir, objects, packedLock];
  if (!branch) return paths;
  if (!branch.startsWith('refs/heads/') || git(cwd, 'check-ref-format', branch) === undefined) {
    throw new Error('Invalid worker branch ref');
  }
  const ref = join(common, branch);
  const reflog = join(common, 'logs', branch);
  for (const path of [ref, `${ref}.lock`, reflog]) {
    ensureRefPath(common, path);
    paths.push(path);
  }
  return paths;
}

const quote = value => JSON.stringify(value).replaceAll('\x7f', '\\u007f');

export function workerCodexArgs(project, row, env) {
  const name = `loom-worker-${workerAddress.exec(row.addr)[1]}`;
  const writes = [row.cwd, env.HOME, env.TMPDIR, ...workerGitWritePaths(project, row.cwd)];
  const filesystem = { ':root': 'read', ...Object.fromEntries(writes.map(path => [path, 'write'])) };
  for (const entry of ['.git', '.agents', '.codex', '.aws']) filesystem[join(row.cwd, entry)] = 'read';
  if (row.integration) for (const root of new Set([row.cwd, project])) filesystem[join(root, '.project')] = 'read';
  // These rules apply to Codex tools. The native client keeps its normal
  // provider home for authentication, separate from the shell environment.
  const home = homedir();
  const protectedPaths = [
    join(home, '.codex', 'auth.json'), join(home, '.codex', 'memories'),
    join(workerProviderEnvironment({ ...row, cli: 'codex' }).CODEX_HOME, 'auth.json'),
    join(home, '.claude', '.credentials.json'), join(home, '.claude.json'),
    join(home, '.gemini', 'oauth_creds.json'), join(home, '.gemini', 'antigravity-cli', 'antigravity-oauth-token'),
    join(home, '.local', 'share', 'opencode', 'auth.json'), join(home, 'Library', 'Keychains'),
    join(home, '.ssh'), join(home, '.aws', 'credentials'), join(home, '.loom-next', 'provider-homes'),
    join(row.cwd, '.env'), join(row.cwd, '.codex', 'auth.json'), join(row.cwd, '.aws', 'credentials'),
  ];
  for (const path of protectedPaths) if (isAbsolute(path)) filesystem[path] = 'deny';
  const entries = Object.entries(filesystem).map(([key, value]) => `${quote(key)}=${quote(value)}`).join(',');
  const network = 'enabled=true,allow_local_binding=false,enable_socks5=false,allow_upstream_proxy=false,' +
    `proxy_url="http://127.0.0.1:0",unix_sockets={${quote(env.TMPDIR)}="allow"}`;
  return ['-c', `default_permissions=${quote(name)}`, '-c',
    `permissions.${name}={filesystem={${entries}},network={${network}}}`, '-c', 'features.network_proxy=true'];
}
