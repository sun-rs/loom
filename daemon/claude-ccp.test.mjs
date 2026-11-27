import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { mkdtempSync } from '../fixtures/test-process.mjs';
import { control } from '../cli/control.mjs';
import { hostToolDenial } from '../lib/host-tool-guard.mjs';
import { openNativeTui } from '../runtimes/tui/transport.mjs';
import { nativeState } from '../tui/native.mjs';
import { providers } from '../tui/providers.mjs';
import {
  claudeCcpNotReady, createClaudeCcpBridge, defaultCcpClaudeEntry, isCcpClaudeEntry, validateCcpClaudeEntry,
} from './claude-ccp.mjs';
import { nativeClaude, resolveClaudeExecutable, resolveNativeExecutable } from './executables.mjs';
import { openOar } from './oar.mjs';
import { createSupervisor } from './supervisor.mjs';

function tempDir(t, prefix = 'loom-ccp-route-') {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function makeFakeCcp(home, body = '#!/bin/sh\nexit 0\n') {
  const ccpDir = join(home, 'ccp', 'bin');
  const binDir = join(home, '.local', 'bin');
  mkdirSync(ccpDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  const target = join(ccpDir, 'claude-protected');
  const entry = join(binDir, 'claude');
  writeFileSync(target, body, { mode: 0o700 });
  symlinkSync(target, entry);
  return { entry, target };
}

test('daemon/claude-ccp.mjs aligns with RESUME-1 contract and enforces CCP entry', async t => {
  const home = tempDir(t, 'loom-ccp-bridge-');
  const env = { HOME: home };
  const expected = defaultCcpClaudeEntry(env);
  assert.equal(expected, join(home, '.local', 'bin', 'claude'));
  assert.equal(isCcpClaudeEntry(expected, env), true);
  assert.equal(isCcpClaudeEntry(join(home, '.local', 'share', 'claude', 'versions', '2.1.331'), env), false);
  assert.equal(isCcpClaudeEntry('/usr/local/bin/claude', env), false);
  assert.equal(validateCcpClaudeEntry(expected, env), expected);
  assert.throws(() => validateCcpClaudeEntry(join(home, '.local', 'share', 'claude', 'versions', '2.1.331'), env),
    { code: 'ccp-required' });
  assert.throws(() => defaultCcpClaudeEntry({ HOME: home, LOOM_CLAUDE_CCP_BIN: join(home, '.local/share/claude/versions/2.1.331') }),
    { code: 'ccp-required' });
  assert.equal(claudeCcpNotReady('op').code, 'not-ready');

  const unready = createClaudeCcpBridge();
  assert.equal(unready.ready, false);
  await assert.rejects(unready.launchSuper({ entry: expected, env }), { code: 'not-ready' });
  await assert.rejects(unready.resumeSuper({ entry: expected, sessionId: randomUUID(), env }), { code: 'not-ready' });
  await assert.rejects(unready.resumeSession({ entry: expected, sessionId: randomUUID(), env }), { code: 'not-ready' });
  await assert.rejects(unready.resumeSession({ entry: join(home, '.local/share/claude/versions/2.1.331'), env }),
    { code: 'ccp-required' });

  const calls = [];
  const ready = createClaudeCcpBridge({
    ready: true,
    async resumeSession(request) { calls.push(request); return { ok: true }; },
  });
  assert.equal(ready.ready, true);
  await assert.rejects(ready.resumeSession({ entry: '/opt/native/claude', env }), { code: 'ccp-required' });
  await ready.resumeSession({ entry: expected, sessionId: randomUUID(), env });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].entry, expected);
});

test('Claude executable resolution requires CCP entry, forbids realpath/native fallback, and keeps other CLIs unchanged', async t => {
  const home = tempDir(t, 'loom-ccp-exec-');
  const { entry } = makeFakeCcp(home);
  const versions = join(home, '.local', 'share', 'claude', 'versions');
  mkdirSync(versions, { recursive: true });
  const native = join(versions, '2.1.331');
  const sentinel = join(home, 'native-ran');
  writeFileSync(native, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(sentinel)}, '1');\n`, { mode: 0o700 });

  // Claude returns the symlink entry itself (never realpath to ccp/bin/claude-protected).
  assert.equal(nativeClaude({ env: { HOME: home } }), entry);
  assert.equal(resolveClaudeExecutable(entry, { env: { HOME: home } }), entry);

  // Direct native Claude binary and non-CCP overrides are rejected with ccp-required.
  assert.throws(() => resolveClaudeExecutable(native, { env: { HOME: home } }), { code: 'ccp-required' });
  assert.throws(() => nativeClaude({ env: { HOME: home, LOOM_CLAUDE_BIN: native } }), { code: 'ccp-required' });
  assert.throws(() => nativeClaude({ env: { HOME: home, OAR_CLAUDE_BIN: native } }), { code: 'ccp-required' });
  assert.throws(() => nativeClaude({ env: { HOME: home, LOOM_CLAUDE_CCP_BIN: native } }), { code: 'ccp-required' });

  // Outside test harness (no LOOM_TEST_FIXTURE_ROOT), a non-CCP LOOM_CLAUDE_CCP_BIN is also rejected.
  const plainBin = join(home, 'plain-claude');
  writeFileSync(plainBin, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  assert.throws(() => nativeClaude({ env: { HOME: home, LOOM_CLAUDE_CCP_BIN: plainBin } }), { code: 'ccp-required' });

  // Direct symlink ~/.local/bin/claude -> ~/.local/share/claude/versions/2.1.331 is rejected.
  const badHome = tempDir(t, 'loom-ccp-directlink-');
  mkdirSync(join(badHome, '.local', 'bin'), { recursive: true });
  symlinkSync(native, join(badHome, '.local', 'bin', 'claude'));
  assert.throws(() => nativeClaude({ env: { HOME: badHome } }), { code: 'ccp-required' });

  // OAR rejects non-CCP Claude before executing it.
  const prevHome = process.env.HOME;
  const prevClaude = process.env.LOOM_CLAUDE_BIN;
  process.env.HOME = home;
  process.env.LOOM_CLAUDE_BIN = native;
  t.after(() => {
    process.env.HOME = prevHome;
    if (prevClaude === undefined) delete process.env.LOOM_CLAUDE_BIN;
    else process.env.LOOM_CLAUDE_BIN = prevClaude;
  });
  await assert.rejects(openOar({ addr: `oar-${randomUUID()}`, role: 'worker', cli: 'claude', runtimeId: 'claude', cwd: home }, home),
    { code: 'ccp-required' });
  assert.equal(existsSync(sentinel), false);

  // Non-Claude native resolution still rejects CCP paths.
  assert.throws(() => resolveNativeExecutable(entry), { code: 'protected-executable' });

  // Host tool guard requires CCP entry for Claude and refuses native version binary.
  const guardEnv = {
    HOME: home, LOOM_HOST_GUARD: '1', LOOM_HOST_EXPIRES: String(Date.now() + 60_000),
    LOOM_HOST_PROJECT: home, LOOM_HOST_ADDR: `oar-${randomUUID()}`,
  };
  assert.equal(hostToolDenial('Bash', { command: `${entry} --version` }, guardEnv), undefined);
  assert.match(hostToolDenial('Bash', { command: `${native} --version` }, guardEnv), /CCP/i);
});

test('loom spawn auditor --resume-session resumes via CCP with --resume, no hooks, and rejects non-CCP', async t => {
  const project = tempDir(t, 'loom-ccp-resume-');
  mkdirSync(join(project, '.project'), { recursive: true });
  writeFileSync(join(project, '.project', 'policy.json'), JSON.stringify({
    preferred: [{ cli: 'claude', model: 'claude-sonnet-5-5', effort: 'high', mode: 'tui' }],
    deny: [],
  }));
  const launched = [];
  const sessionId = randomUUID();
  const { entry } = makeFakeCcp(project, `#!${process.execPath}
if (process.argv.includes('--version')) { console.log('2.1.331 (Claude Code)'); process.exit(0); }
process.exit(0);
`);
  const fakeHc = join(project, 'hc');
  const argvLog = join(project, 'argv.json');
  writeFileSync(fakeHc, `#!${process.execPath}
import { writeFileSync } from 'node:fs';
const [verb, ...args] = process.argv.slice(2);
if (verb === 'run') {
  const argv = args.slice(args.indexOf('--') + 1);
  writeFileSync(${JSON.stringify(argvLog)}, JSON.stringify(argv));
  console.log(JSON.stringify({ address: 't1', name: args[args.indexOf('--name') + 1], state: 'live', cwd: ${JSON.stringify(project)}, pid: process.pid, created_ms: Date.now() }));
} else if (verb === 'get') {
  console.log(JSON.stringify({ address: 't1', name: args[0], state: 'live', cwd: ${JSON.stringify(project)}, pid: process.pid, created_ms: Date.now() }));
} else if (verb === 'kill') {
  console.log(JSON.stringify({ state: 'finished' }));
} else {
  process.exit(2);
}
`, { mode: 0o700 });

  const prevHome = process.env.HOME;
  const prevClaudeBin = process.env.LOOM_CLAUDE_BIN;
  const prevCcpBin = process.env.LOOM_CLAUDE_CCP_BIN;
  process.env.HOME = project;
  delete process.env.LOOM_CLAUDE_BIN;
  delete process.env.LOOM_CLAUDE_CCP_BIN;
  t.after(() => {
    process.env.HOME = prevHome;
    if (prevClaudeBin === undefined) delete process.env.LOOM_CLAUDE_BIN;
    else process.env.LOOM_CLAUDE_BIN = prevClaudeBin;
    if (prevCcpBin === undefined) delete process.env.LOOM_CLAUDE_CCP_BIN;
    else process.env.LOOM_CLAUDE_CCP_BIN = prevCcpBin;
  });

  // Direct transport launch with resume must launch CCP entry (never realpath), pass --resume <sessionId>,
  // omit hooks/settings, and never clear or overwrite proxy env vars.
  await openNativeTui({
    cli: 'claude', cwd: project, stateDir: join(project, '.project', 'pty'), hcCommand: fakeHc,
    resume: sessionId, model: 'claude-sonnet-5-5', effort: 'high', previous: { transport: 'plain-hc' },
    env: { HTTP_PROXY: 'http://bad', ANTHROPIC_BASE_URL: 'http://bad' },
  });
  const rawArgv = JSON.parse(readFileSync(argvLog, 'utf8'));
  const entryIndex = rawArgv.indexOf(entry);
  assert.ok(entryIndex >= 0, `expected CCP entry ${entry} in argv: ${JSON.stringify(rawArgv)}`);
  const envPrefix = rawArgv.slice(0, entryIndex);
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'ANTHROPIC_BASE_URL']) {
    assert.equal(envPrefix.some((arg, i) => arg === '-u' && envPrefix[i + 1] === key), false, `must not unset ${key}`);
    assert.equal(envPrefix.some(arg => arg.startsWith(`${key}=`)), false, `must not overwrite ${key}`);
  }
  const capturedArgv = rawArgv.slice(entryIndex);
  assert.equal(capturedArgv[0], entry);
  assert.equal(capturedArgv[capturedArgv.indexOf('--resume') + 1], sessionId);
  assert.equal(capturedArgv.includes('--settings'), false);
  assert.equal(capturedArgv.includes('--setting-sources'), false);
  assert.equal(capturedArgv.includes('--strict-mcp-config'), false);

  // Daemon spawn --resume-session works without prompt and forwards resumeNativeId to openPane.
  let mockPane;
  const supervisor = createSupervisor(project, {
    sessionOptions: {
      async openPane(job, row) {
        launched.push({ role: row.role, cli: row.cli, sessionId: row.sessionId, resumeNativeId: job.resumeNativeId, prompt: job.prompt });
        mockPane = { address: 't1', name: 'loom-auditor', cwd: project, pid: process.pid, created_ms: Date.now(), state: 'live' };
        return {
          terminal: mockPane,
          nativeId: job.resumeNativeId,
        };
      },
      async getPane() {
        return mockPane;
      },
    },
  });

  // Rejects non-CCP override with ccp-required before launching.
  process.env.LOOM_CLAUDE_BIN = join(project, '.local/share/claude/versions/2.1.331');
  await assert.rejects(
    supervisor.handle('spawn', { role: 'auditor', cwd: project, 'resume-session': sessionId }, undefined, { external: true }),
    { code: 'ccp-required' },
  );
  assert.equal(launched.length, 0);
  delete process.env.LOOM_CLAUDE_BIN;

  // Rejects invalid arguments (worker role or non-UUID).
  await assert.rejects(
    control('spawn', ['worker', '--cwd', project, '--project', project, '--task', 'T1', '--wave', 'W1', '--resume-session', sessionId]),
    { code: 'invalid-arguments' },
  );
  await assert.rejects(
    control('spawn', ['auditor', '--cwd', project, '--project', project, '--resume-session', 'not-a-uuid']),
    { code: 'invalid-arguments' },
  );

  // Valid resume-session without prompt succeeds and records original sessionId.
  const resumed = await supervisor.handle('spawn', { role: 'auditor', cwd: project, 'resume-session': sessionId }, undefined, { external: true });
  assert.equal(resumed.session.role, 'auditor');
  assert.equal(resumed.session.sessionId, sessionId);
  assert.equal(resumed.resumedSessionId, sessionId);
  assert.equal(resumed.deliveryId, undefined);
  assert.equal(launched.length, 1);
  assert.equal(launched[0].resumeNativeId, sessionId);
  assert.equal(launched[0].prompt, undefined);

  // Resumed nativeState ignores historical pre-resume turns and confirms only post-resume turns.
  const configDir = join(project, '.claude');
  const bucket = join(configDir, 'projects', project.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(bucket, { recursive: true });
  const transcriptPath = join(bucket, `${sessionId}.jsonl`);
  const oldDelivery = randomUUID();
  const newDelivery = randomUUID();
  const resumedAt = Date.parse('2026-11-27T12:00:00.000Z');
  writeFileSync(transcriptPath, [
    { type: 'user', sessionId, cwd: project, uuid: 'old-u', timestamp: '2026-11-27T11:00:00.000Z', message: { role: 'user', content: `[loom:${oldDelivery}]\nold` } },
    { type: 'assistant', sessionId, cwd: project, uuid: 'old-a', timestamp: '2026-11-27T11:00:05.000Z', message: { id: 'old-m', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'OLD' }] } },
    { type: 'system', subtype: 'turn_duration', sessionId, cwd: project, uuid: 'old-s', timestamp: '2026-11-27T11:00:06.000Z', isSidechain: false, isMeta: false },
  ].map(row => JSON.stringify(row) + '\n').join(''));
  const state = nativeState(providers.claude, {
    cwd: project, configDir, evidenceRoot: project, sessionId, hookSink: join(project, 'no-hooks.jsonl'),
    boundTranscript: true, resumedAt,
  });
  assert.equal((await state.read()).phase, undefined);
  assert.equal(state.confirmations(oldDelivery).count, 0);

  writeFileSync(transcriptPath, [
    { type: 'user', sessionId, cwd: project, uuid: 'new-u', timestamp: '2026-11-27T12:00:05.000Z', message: { role: 'user', content: `[loom:${newDelivery}]\nnew` } },
    { type: 'assistant', sessionId, cwd: project, uuid: 'new-a', timestamp: '2026-11-27T12:00:08.000Z', message: { id: 'new-m', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'RESUMED OK' }] } },
    { type: 'system', subtype: 'turn_duration', sessionId, cwd: project, uuid: 'new-s', timestamp: '2026-11-27T12:00:09.000Z', isSidechain: false, isMeta: false },
  ].map(row => JSON.stringify(row) + '\n').join(''), { flag: 'a' });
  const after = await state.read();
  assert.equal(after.phase, 'idle');
  assert.equal(state.confirmations(newDelivery).count, 1);
  assert.equal(state.confirmations(oldDelivery).count, 0);
});
