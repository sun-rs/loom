import { chmodSync, lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { runtimeDirectory } from '../cli/project.mjs';
import { prepareJournal, writeState } from './io.mjs';
import { hostWritePaths } from './host-grants.mjs';
import { workerExecutableLog } from './worker-executables.mjs';
import { workerProviderEnvironment, workerTemporary } from './worker-environment.mjs';

export function hostWorkerEnvironment(project, row) {
  const { tmp } = workerTemporary(row);
  const provider = workerProviderEnvironment(row);
  return { ...provider, HOME: homedir(), TMPDIR: tmp, TMP: tmp, TEMP: tmp,
    TMPPREFIX: join(tmp, 'zsh'), GIT_OPTIONAL_LOCKS: '0',
    LOOM_HOST_GUARD: '1', LOOM_HOST_PROJECT: project, LOOM_HOST_ADDR: row.addr,
    LOOM_HOST_EXPIRES: String(row.hostGrant.expiresAt), ...(row.cli === 'codex' && { CODEX_SQLITE_HOME: provider.CODEX_HOME, CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: '1' }) };
}

export function hostWriteBoundary(project, row, env, executable) {
  if (process.platform !== 'darwin' || !lstatSync('/usr/bin/sandbox-exec', { throwIfNoEntry: false })) return executable;
  const logs = [workerExecutableLog(project, row.addr)];
  for (const log of logs) prepareJournal(log);
  const codex = env.CODEX_HOME;
  const claude = env.CLAUDE_CONFIG_DIR;
  const agy = env.ANTIGRAVITY_APP_DATA_DIR;
  const opencode = join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'opencode');
  const state = {
    codex: codex && ['sessions', 'tmp', 'shell_snapshots', 'thread-writer-locks'].map(name => join(codex, name)),
    claude: claude && ['projects', 'sessions', 'logs'].map(name => join(claude, name)),
    agy: agy && ['brain', 'conversations', 'log'].map(name => join(agy, name)),
    opencode: ['log', 'storage'].map(name => join(opencode, name)),
  }[row.cli] ?? [];
  const scopedState = state.filter(path => isAbsolute(path) && lstatSync(path, { throwIfNoEntry: false })?.isDirectory() && realpathSync(path) === path);
  const localWrites = [row.cwd, env.TMPDIR, ...hostWritePaths(project, row.hostGrant.write), ...scopedState];
  const installationId = codex && join(codex, 'installation_id');
  // Reopening the logged-in Codex state avoids a cold backfill of unrelated rollouts.
  const codexDb = row.cli === 'codex' && isAbsolute(codex ?? '') ? ['state_5', 'logs_2', 'memories_1', 'queue_1', 'goals_1']
    .flatMap(name => ['', '-shm', '-wal', '-journal'].map(suffix => join(codex, `${name}.sqlite${suffix}`))) : [];
  const fileWrites = ['/dev/null', ...logs,
    ...(row.cli === 'codex' && installationId && lstatSync(installationId, { throwIfNoEntry: false })?.isFile() &&
      realpathSync(installationId) === installationId ? [installationId] : []),
    ...(row.cli === 'agy' && agy ? [join(agy, 'bin', 'agentapi')] : []),
    ...(row.cli === 'opencode' ? ['opencode.db', 'opencode.db-shm', 'opencode.db-wal'].map(name => join(opencode, name)) : [])];
  const quote = path => JSON.stringify(path);
  const policy = ['(version 1)', '(allow default)', '(deny file-write*)',
    ...localWrites.map(path => `(allow file-write* (subpath ${quote(path)}))`),
    `(deny file-write* (subpath ${quote(runtimeDirectory(project))}) (subpath ${quote(join(project, '.project'))}))`,
    ...fileWrites.map(path => `(allow file-write-data (literal ${quote(path)}))`),
    ...codexDb.map(path => `(allow file-write* (literal ${quote(path)}))`),
  ].join('\n');
  const shell = argument => "'" + argument.replaceAll("'", "'\\''") + "'";
  const launcher = join(dirname(env.TMPDIR), 'host-native');
  writeState(launcher, `#!/bin/sh\nexec /usr/bin/sandbox-exec -p ${shell(policy)} ${shell(executable)} "$@"\n`);
  chmodSync(launcher, 0o700);
  return launcher;
}
