import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  globalDir, globalRegistryPath, listGlobalProjects, markProjectShutdown, markSuperCleanExit,
  readGlobalRegistry, registerGlobalProject, resolveAccountDir, superConfig, superHandoffPath,
  superHandoffReminder, superLivePath, updateSuperRecord, writeGlobalRegistry,
} from './global-registry.mjs';
import { createClaudeCcpBridge, defaultCcpClaudeEntry, validateCcpClaudeEntry } from './claude-ccp.mjs';
import { freshHandoffCommand, nativeResumeCapability } from './resume-capabilities.mjs';

function tempGlobal(t) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'loom-global-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { HOME: join(dir, 'home'), LOOM_GLOBAL_DIR: join(dir, 'loom-global') };
  mkdirSync(env.HOME, { recursive: true, mode: 0o700 });
  return { dir, env };
}

test('global registry honors LOOM_GLOBAL_DIR and defaults super.resumeOnUp to false', t => {
  const { env } = tempGlobal(t);
  assert.equal(globalDir(env), env.LOOM_GLOBAL_DIR);
  assert.equal(globalRegistryPath(env), join(env.LOOM_GLOBAL_DIR, 'global.json'));
  assert.equal(superLivePath(env), join(env.LOOM_GLOBAL_DIR, 'super', 'live.md'));
  assert.equal(superHandoffPath(env), join(env.LOOM_GLOBAL_DIR, 'super', 'handoff.md'));

  const initial = readGlobalRegistry(env);
  assert.equal(initial.version, 1);
  assert.equal(initial.super, null);
  assert.deepEqual(initial.projects, []);
  assert.equal(superConfig(env).resumeOnUp, false);

  const updated = updateSuperRecord({
    cli: 'codex', model: 'gpt-6.2-sol', effort: 'high',
    entry: '/usr/local/bin/codex', accountDir: '/tmp/codex-home',
    sessionId: '11111111-1111-4111-8111-111111111111', hcAddress: 't1a',
    cwd: '/tmp/work', lastOnlineAt: 1_700_000_000_000, cleanExit: false,
  }, env);
  assert.equal(updated.cli, 'codex');
  assert.equal(updated.handoffPath, superHandoffPath(env));
  assert.equal(updated.cleanExit, false);

  const closed = markSuperCleanExit('user-exit', env, 1_700_000_050_000);
  assert.equal(closed.cleanExit, true);
  assert.equal(closed.exitReason, 'user-exit');
  assert.equal(closed.lastOnlineAt, 1_700_000_050_000);

  registerGlobalProject('/tmp/proj-b', { release: 'rel-1', lastOnlineAt: 100, lastShutdown: 'abnormal' }, env);
  registerGlobalProject('/tmp/proj-a', { release: 'rel-2', lastOnlineAt: 200, lastShutdown: 'normal' }, env);
  markProjectShutdown('/tmp/proj-b', 'normal', env, 300);

  assert.deepEqual(listGlobalProjects(env), [
    { dir: '/tmp/proj-a', release: 'rel-2', lastOnlineAt: 200, lastShutdown: 'normal' },
    { dir: '/tmp/proj-b', release: 'rel-1', lastOnlineAt: 300, lastShutdown: 'normal' },
  ]);

  writeFileSync(join(env.LOOM_GLOBAL_DIR, 'config.json'), JSON.stringify({ super: { resumeOnUp: true, cli: 'codex' } }));
  assert.equal(superConfig(env).resumeOnUp, true);
  assert.equal(superConfig(env).cli, 'codex');

  const reminder = superHandoffReminder(env);
  assert.ok(!reminder.includes('\n'));
  assert.ok(reminder.includes(superHandoffPath(env)));
});

test('invariant [persistence] global.json stores metadata only and rejects credentials or secret fields', t => {
  const { env } = tempGlobal(t);
  assert.throws(() => updateSuperRecord({
    cli: 'codex', apiKey: 'sk-secret', token: 'tok',
  }, env), /metadata/i);
  assert.throws(() => writeGlobalRegistry({
    version: 1,
    super: { cli: 'codex', credentials: { auth: 'bad' } },
    projects: [],
  }, env), /metadata/i);

  updateSuperRecord({
    cli: 'codex', model: 'gpt-6.2-sol', effort: 'high',
    entry: '/usr/local/bin/codex', sessionId: '22222222-2222-4222-8222-222222222222',
    hcAddress: 't2b', lastOnlineAt: 1234, cleanExit: false,
  }, env);
  const raw = readFileSync(globalRegistryPath(env), 'utf8');
  assert.doesNotMatch(raw, /sk-secret|apiKey|token|credentials|auth\.json/i);
  assert.equal(JSON.parse(raw).super.hcAddress, 't2b');

  assert.equal(resolveAccountDir('codex', { HOME: env.HOME, CODEX_HOME: '/tmp/custom-codex' }), '/tmp/custom-codex');
  assert.equal(resolveAccountDir('codex', { HOME: env.HOME }), join(env.HOME, '.codex'));
  assert.equal(resolveAccountDir('agy', { HOME: env.HOME }), join(env.HOME, '.gemini', 'antigravity-cli'));
  assert.equal(resolveAccountDir('claude', { HOME: env.HOME }), join(env.HOME, '.claude'));
  assert.equal(resolveAccountDir('opencode', { HOME: env.HOME }), join(env.HOME, '.local', 'share', 'opencode'));
});

test('Claude CCP bridge requires CCP entry, returns not-ready by default, and supports stubbed CCP-ROUTE-1', async t => {
  const { env } = tempGlobal(t);
  const expected = defaultCcpClaudeEntry(env);
  assert.equal(expected, join(env.HOME, '.local', 'bin', 'claude'));

  assert.throws(() => validateCcpClaudeEntry(join(env.HOME, '.local', 'share', 'claude', 'versions', '2.1.331'), env),
    { code: 'ccp-required' });
  assert.throws(() => validateCcpClaudeEntry('/usr/local/bin/claude', env), { code: 'ccp-required' });
  assert.equal(validateCcpClaudeEntry(expected, env), expected);

  const unready = createClaudeCcpBridge();
  await assert.rejects(unready.launchSuper({ entry: expected, env }), { code: 'not-ready' });
  await assert.rejects(unready.resumeSuper({ entry: expected, sessionId: '11111111-1111-4111-8111-111111111111', env }), { code: 'not-ready' });
  await assert.rejects(unready.resumeSession({ entry: expected, sessionId: '11111111-1111-4111-8111-111111111111', env }), { code: 'not-ready' });
  await assert.rejects(unready.resumeSession({ entry: join(env.HOME, '.local', 'share', 'claude', 'versions', '2.1.331'), env }),
    { code: 'ccp-required' });

  const calls = [];
  const stub = createClaudeCcpBridge({
    ready: true,
    async resumeSession(request) { calls.push(request); return { ok: true, via: 'ccp-stub' }; },
  });
  await assert.rejects(stub.resumeSession({ entry: '/opt/native/claude', env }), { code: 'ccp-required' });
  const ok = await stub.resumeSession({ entry: expected, sessionId: '11111111-1111-4111-8111-111111111111', env });
  assert.deepEqual(ok, { ok: true, via: 'ccp-stub' });
  assert.equal(calls.length, 1);
});

test('fixed-version resume capabilities classify codex, agy, opencode, and claude with handoff fallback commands', () => {
  const project = '/tmp/demo';
  const baseRow = { addr: 'loom-11111111-1111-4111-8111-111111111111', role: 'leader', cwd: project,
    sessionId: '22222222-2222-4222-8222-222222222222' };

  assert.equal(nativeResumeCapability({ cli: 'codex', backend: 'tui', cliVersion: '0.172.0', project, row: baseRow }).supported, true);
  assert.equal(nativeResumeCapability({ cli: 'codex', backend: 'headless', cliVersion: '0.171.0', project, row: baseRow }).supported, true);

  assert.equal(nativeResumeCapability({ cli: 'agy', backend: 'tui', cliVersion: '1.5.18', project, row: baseRow }).supported, true);
  const agyOld = nativeResumeCapability({ cli: 'agy', backend: 'tui', cliVersion: '1.4.0', project, row: baseRow });
  assert.equal(agyOld.supported, false);
  assert.equal(agyOld.status, 'unsupported');
  assert.match(agyOld.reason, /无法原生续接/);
  assert.match(agyOld.freshCommand, /loom spawn leader/);

  assert.equal(nativeResumeCapability({ cli: 'opencode', backend: 'headless', cliVersion: '2.3.0', project,
    row: { ...baseRow, sessionId: 'ses_abc123' } }).supported, true);
  const opencodeTui = nativeResumeCapability({ cli: 'opencode', backend: 'tui', cliVersion: '2.3.0', project,
    row: { ...baseRow, sessionId: 'ses_abc123' } });
  assert.equal(opencodeTui.supported, false);
  assert.equal(opencodeTui.status, 'unsupported');
  assert.match(opencodeTui.reason, /无法原生续接/);
  assert.match(opencodeTui.freshCommand, /loom spawn leader/);

  const claudeUnready = nativeResumeCapability({ cli: 'claude', backend: 'tui', project, row: baseRow });
  assert.equal(claudeUnready.supported, false);
  assert.equal(claudeUnready.status, 'not-ready');
  assert.equal(claudeUnready.viaCcp, true);

  const workerCmd = freshHandoffCommand(project, {
    addr: 'oar-1', role: 'worker', task: 'T1', wave: 'W1', cwd: join(project, 'wt'),
  }, { workerHandoff: { path: join(project, '.project', 'handoff.md') } });
  assert.match(workerCmd, /loom spawn worker/);
  assert.match(workerCmd, /--task T1/);
  assert.match(workerCmd, /--wave W1/);
});
