import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { sandboxNativeWorker, workerCodexArgs, workerEnvironment, workerGitWritePaths } from './worker-environment.mjs';
import { nestedSeatbeltLimited } from './sandbox-test-capability.mjs';
import { integrationPs, integrationProcessRows } from './integration-processes.mjs';

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
  const gitWrites = [join(common, 'worktrees', 'worker'), join(common, 'objects'), join(common, 'packed-refs.lock'),
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
  assert.equal(env.TMPPREFIX, join(env.TMPDIR, 'zsh'));
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
  assert.deepEqual(workerGitWritePaths(project, cwd), gitWrites.slice(0, 3));
});

test('integration permits limited worktree process listings and keeps the worker network policy', async t => {
  const cwd = mkdtempSync(join(realpathSync(tmpdir()), 'loom-integration-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const row = { role: 'worker', addr: `oar-${randomUUID()}`, cwd };
  const env = workerEnvironment(row);
  t.after(() => rmSync(dirname(env.HOME), { recursive: true, force: true }));
  assert.equal(await integrationPs(row, env), undefined);
  const profile = { ...row, integration: true };
  const bridge = await integrationPs(profile, env, process.env.PATH);
  t.after(bridge.close);
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)', 'private-fixture-argument']);
  t.after(() => child.kill());
  const run = (...args) => promisify(execFile)(bridge.env.LOOM_TEST_PS, args, { cwd, env: { ...process.env, ...env, ...bridge.env } });
  const { stdout } = await run('-p', String(child.pid), '-o', 'pid=,command=');
  assert.match(stdout, new RegExp(`^${child.pid} .*node`));
  assert.doesNotMatch(stdout, /private-fixture-argument/);
  await assert.rejects(run('-p', String(process.ppid), '-o', 'pid='), { code: 1 });
  await assert.rejects(run('-E'), { code: 2 });
  const baseline = workerCodexArgs(cwd, row, env)[3];
  const integration = workerCodexArgs(cwd, profile, env)[3];
  assert.equal(baseline.split('network=')[1], integration.split('network=')[1]);
  for (const profileArgs of [baseline, integration]) {
    assert.ok(profileArgs.includes(`"${join(homedir(), '.codex', 'auth.json')}"="deny"`));
    assert.ok(profileArgs.includes(`"${join(cwd, '.env')}"="deny"`));
  }
  assert.ok(integration.includes(`"${join(cwd, '.project')}"="read"`));
  assert.deepEqual(integrationProcessRows(new Map([[2, { pid: 2, ppid: 1, uid: 501 }],
    [3, { pid: 3, ppid: 2, uid: 501 }], [4, { pid: 4, ppid: 2, uid: 502 }]]), 1, 501).map(row => row.pid), [2, 3]);
});

test('macOS native workers can write their worktree and state without making the login home writable',
  { skip: process.platform !== 'darwin' || nestedSeatbeltLimited }, t => {
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

test('restricted worker runs zsh heredocs and commits with hooks without the shared packed-refs lock',
  { skip: process.platform !== 'darwin' || nestedSeatbeltLimited }, t => {
    const project = mkdtempSync(join(realpathSync(tmpdir()), 'loom-worker-refs-'));
    t.after(() => rmSync(project, { recursive: true, force: true }));
    const git = (...args) => execFileSync('/usr/bin/git', args, { cwd: project, stdio: 'pipe' });
    git('init', '-qb', 'main');
    git('config', 'user.name', 'Loom');
    git('config', 'user.email', 'loom@example.invalid');
    git('config', 'maintenance.auto', 'true');
    git('commit', '--allow-empty', '-qm', 'base');
    const cwd = join(project, 'work');
    git('worktree', 'add', '-qb', 'worker', cwd);
    git('pack-refs', '--all');
    const packed = join(project, '.git', 'packed-refs');
    const original = readFileSync(packed);
    writeFileSync(join(project, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nprintf ran > hook-proof\n', { mode: 0o755 });
    const login = { HOME: join(project, 'login') };
    mkdirSync(login.HOME);
    const row = { role: 'worker', cli: 'claude', addr: `oar-${randomUUID()}`, cwd };
    const env = workerEnvironment(row);
    t.after(() => rmSync(dirname(env.HOME), { recursive: true, force: true }));
    const launch = sandboxNativeWorker(project, row, login, env, '/bin/zsh');
    const result = spawnSync(launch, ['-fc', [
      'set -e', '/bin/cat > content <<\'END\'', 'here document', 'END',
      'test "$(/usr/bin/git config --get maintenance.auto)" = false',
      '/usr/bin/git add content', '/usr/bin/git commit -qm worker',
      'test "$(cat hook-proof)" = ran',
    ].join('\n')], { cwd, env: { ...process.env, ...env, ...login }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /packed-refs\.lock|temp file for here document/);
    assert.equal(readFileSync(join(cwd, 'content'), 'utf8'), 'here document\n');
    assert.deepEqual(readFileSync(packed), original);
    assert.equal(lstatSync(packed + '.lock', { throwIfNoEntry: false }), undefined);
  });
