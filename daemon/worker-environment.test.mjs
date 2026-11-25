import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { sandboxNativeWorker, workerCodexArgs, workerEnvironment, workerGitWritePaths } from './worker-environment.mjs';

test('worker launch grants only its worktree Git metadata and private HOME, XDG and socket paths', t => {
  const project = mkdtempSync(join(realpathSync(tmpdir()), 'loom-worker-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const git = (...args) => execFileSync('/usr/bin/git', args, { cwd: project, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('-c', 'user.name=Loom', '-c', 'user.email=loom@example.invalid', 'commit', '--allow-empty', '-qm', 'base');
  const cwd = join(project, 'worker');
  git('worktree', 'add', '-qb', 'topic/worker', cwd);
  const common = join(project, '.git');
  const branch = join('refs', 'heads', 'topic', 'worker');
  const gitWrites = [join(common, 'worktrees', 'worker'), join(common, 'objects'),
    join(common, branch), join(common, branch) + '.lock', join(common, 'logs', branch)];
  assert.deepEqual(workerGitWritePaths(project, cwd), gitWrites);
  assert.deepEqual(workerGitWritePaths(project, project), []);

  const global = join(project, 'launcher.gitconfig');
  writeFileSync(global, '[user]\n\tname = Loom Test\n\temail = loom@example.invalid\n[credential]\n\thelper = fixture\n');
  const originalGlobal = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = global;
  t.after(() => {
    if (originalGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = originalGlobal;
  });
  const row = { role: 'worker', addr: `oar-${randomUUID()}`, cwd };
  const env = workerEnvironment(row);
  const sibling = workerEnvironment({ ...row, addr: `loom-${randomUUID()}` });
  for (const home of [env.HOME, sibling.HOME]) t.after(() => rmSync(dirname(home), { recursive: true, force: true }));
  assert.notEqual(env.HOME, sibling.HOME);
  assert.notEqual(env.TMPDIR, sibling.TMPDIR);
  assert.equal(env.GIT_CONFIG_GLOBAL, join(env.HOME, '.gitconfig'));
  assert.equal(readFileSync(env.GIT_CONFIG_GLOBAL, 'utf8'), '[user]\n\tname = "Loom Test"\n\temail = "loom@example.invalid"\n');
  assert.equal(env.XDG_RUNTIME_DIR, env.TMPDIR);
  for (const key of ['XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME']) {
    assert.equal(dirname(env[key]), env.HOME);
  }
  for (const dir of [env.HOME, env.TMPDIR]) assert.equal(lstatSync(dir).mode & 0o777, 0o700);
  const [, active, , permission, , feature] = workerCodexArgs(project, row, env);
  assert.match(active, /^default_permissions="loom-worker-/);
  assert.equal(feature, 'features.network_proxy=true');
  const writable = [...permission.matchAll(/"([^"]+)"="write"/g)].map(([, path]) => path);
  assert.deepEqual(writable, [cwd, env.HOME, env.TMPDIR, ...gitWrites]);
  assert.ok(permission.includes(`unix_sockets={"${env.TMPDIR}"="allow"}`));
  assert.match(permission, /allow_local_binding=false/);
  git('-C', cwd, 'switch', '--detach', '-q');
  assert.deepEqual(workerGitWritePaths(project, cwd), gitWrites.slice(0, 2));
});

test('macOS native workers can write their worktree and state without making the login home writable',
  { skip: process.platform !== 'darwin' }, t => {
    const project = mkdtempSync(join(realpathSync(tmpdir()), 'loom-native-worker-'));
    t.after(() => rmSync(project, { recursive: true, force: true }));
    const cwd = join(project, 'work');
    const login = { HOME: join(project, 'login') };
    const data = join(login.HOME, '.gemini', 'antigravity-cli');
    for (const path of [cwd, join(data, 'brain'), join(data, 'bin')]) mkdirSync(path, { recursive: true });
    const row = { role: 'worker', cli: 'agy', addr: `oar-${randomUUID()}`, cwd };
    const env = workerEnvironment(row);
    t.after(() => rmSync(dirname(env.HOME), { recursive: true, force: true }));
    const launch = sandboxNativeWorker(project, row, login, env, '/bin/sh');
    execFileSync(launch, ['-c', [
      'test "$HOME" = "$1" && : > "$2/work" && : > "$3/log" && : > "$4/brain/session" && : > "$4/bin/agentapi" &&',
      '! ( : > "$1/outside" ) 2>/dev/null && ! ( : > "$4/settings" ) 2>/dev/null && ! ( : > "$4/bin/other" ) 2>/dev/null',
    ].join(' '), 'loom-fixture', login.HOME, cwd, env.HOME, data], {
      cwd, env: { ...process.env, ...env, ...login }, stdio: 'pipe',
    });
    const pty = execFileSync(launch, ['-c', '/usr/bin/script -q "$1/pty" /bin/echo loom-pty-fixture',
      'loom-fixture', env.TMPDIR], { cwd, env: { ...process.env, ...env, ...login },
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 });
    assert.match(pty, /loom-pty-fixture/);
  });
