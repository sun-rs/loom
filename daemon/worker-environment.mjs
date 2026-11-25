import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { inDirectory } from '../cli/project.mjs';
import { readText } from './io.mjs';

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

export function workerEnvironment(row) {
  if (row.role !== 'worker') return {};
  const id = workerAddress.exec(row.addr)?.[1];
  if (!id) throw new Error('Invalid worker address');
  // Keep the temp prefix short enough for a Unix-domain socket pathname.
  const root = privateDirectory(join(realpathSync('/tmp'), `lw-${id}`));
  const home = privateDirectory(join(root, 'h'));
  const tmp = privateDirectory(join(root, 't'));
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
  return { HOME: home, TMPDIR: tmp, TMP: tmp, TEMP: tmp,
    GIT_CONFIG_GLOBAL: gitConfig,
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
  const paths = [dir, objects];
  if (!branch) return paths;
  if (git(cwd, 'rev-parse', '--show-ref-format') === 'reftable') {
    throw new Error('A shared reftable cannot grant writes to one worker branch');
  }
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
  const entries = Object.entries(filesystem).map(([key, value]) => `${quote(key)}=${quote(value)}`).join(',');
  const network = 'enabled=true,allow_local_binding=false,enable_socks5=false,allow_upstream_proxy=false,' +
    `proxy_url="http://127.0.0.1:0",unix_sockets={${quote(env.TMPDIR)}="allow"}`;
  return ['-c', `default_permissions=${quote(name)}`, '-c',
    `permissions.${name}={filesystem={${entries}},network={${network}}}`, '-c', 'features.network_proxy=true'];
}
