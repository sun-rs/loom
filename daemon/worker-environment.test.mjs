import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { workerCodexArgs, workerEnvironment, workerGitWritePaths } from './worker-environment.mjs';

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
