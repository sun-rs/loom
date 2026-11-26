import assert from 'node:assert/strict';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createLiveness, returnedToShell } from './liveness.mjs';
import { providers } from '../tui/providers.mjs';
import { promptFrames } from '../adapters/prompt-fixtures.mjs';
import { screenPrompt } from '../adapters/prompt-state.mjs';

test('liveness distinguishes spinner repaint from native records, output, hooks and real screen changes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'll-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const transcriptPath = join(dir, 'session.jsonl');
  await writeFile(transcriptPath, '');
  const row = { addr: 'test', startedAt: 100, transcriptPath };
  let at = 100;
  const watch = createLiveness({ now: () => at, hangMs: 30 });
  const events = [];
  const frame = body => watch.observe(row, { events, state: 'busy', livenessScreen: { kind: 'busy', text: body } });
  await frame('✳ Thinking (0s)');
  at = 115;
  assert.equal((await frame('✶ Thinking (1s)')).health, undefined);
  at = 135;
  assert.equal((await frame('✻ Thinking (2s)')).health.status, 'silent-hang');
  at = 136;
  await appendFile(transcriptPath, '{"type":"system"}\n');
  assert.equal((await frame('✳ Thinking (3s)')).lastProgressAt, 136);
  at = 145;
  events.push({ type: 'usage', at, usage: { calls: 1, outputTokens: 5 } });
  assert.equal((await frame('✻ Thinking (4s)')).lastProgressAt, 145);
  at = 150;
  events.push({ hook_event_name: 'PostToolUse', receivedAt: at });
  assert.equal((await frame('✳ Thinking (5s)')).lastProgressAt, 150);
  at = 155;
  assert.equal((await frame('✻ Thinking (6s)\nMore output')).lastProgressAt, 155);
});

test('quota survives retries and resets only on real work, while a fresh auth failure alerts', async () => {
  let at = 100;
  const now = () => at;
  const row = { addr: 'test', startedAt: 100 };
  const events = [];
  const screen = { kind: 'rate-limit', text: 'HTTP 429 Too Many Requests. Retry after 60' };
  const snapshot = () => ({ events, livenessScreen: screen, state: 'busy', statusline: 'quota_exhausted' });
  const watch = createLiveness({ now });
  const initial = await watch.observe(row, snapshot());
  assert.deepEqual([initial.health.status, initial.health.since, initial.health.retryAt], ['quota-wait', 100, 60_100]);
  at = 200;
  events.push({ type: 'turn-start', at });
  const restarted = createLiveness({ now });
  assert.equal((await restarted.observe(row, snapshot(), initial)).health.since, 100);
  assert.equal((await restarted.observe(row, { ...snapshot(),
    livenessScreen: { kind: 'busy', text: '✳ Retrying (1s)' } })).health.since, 100);
  at = 240;
  events.push({ type: 'usage', at, usage: { outputTokens: 3 } });
  assert.equal((await restarted.observe(row, { ...snapshot(),
    livenessScreen: { kind: 'busy', text: '✳ Working (1s)' } })).health, undefined);
  assert.equal((await watch.observe(row, snapshot())).health, undefined);
  at = 250;
  events.push({ type: 'turn-end', at, outcome: { kind: 'failed', failure: 'auth' } });
  assert.equal((await restarted.observe(row, snapshot())).health.status, 'auth-expired');
});

test('polling freezes progress until the native shell tool returns', async () => {
  let at = 100;
  const row = { addr: 'test', startedAt: 100 };
  const events = [{ hook_event_name: 'PreToolUse', receivedAt: at, tool_use_id: 'p',
    tool_input: { command: 'for i in 1 2; do "$LOOM_BIN" state auditor; sleep 5; done' } }];
  const watch = createLiveness({ now: () => at });
  const frame = text => watch.observe(row, { events, state: 'busy', livenessScreen: { kind: 'busy', text } });
  await frame('Checking A');
  at = 150;
  const waiting = await frame('Checking B');
  assert.equal(waiting.health.status, 'waiting-poll');
  assert.equal(waiting.health.zeroProgressMs, 50);
  assert.equal(waiting.lastProgressAt, 100);
  events.push({ hook_event_name: 'PostToolUse', receivedAt: at, tool_use_id: 'p' });
  assert.equal((await frame('Finished shell')).health, undefined);
});

test('veteran native dialogs veto delivery and require exact safe key evidence', () => {
  for (const [cli, fixtures] of Object.entries(promptFrames)) {
    const { screen } = providers[cli];
    for (const [kind, frame, key] of fixtures) {
      assert.equal(screen.classify(frame), kind);
      assert.ok(screenPrompt(kind, frame));
      if (key) assert.equal(screen.dialogKeys(kind, frame)[0], key);
      if (kind === 'awaiting-user') assert.deepEqual(screen.dialogKeys(kind, frame), []);
    }
  }
  const wizard = promptFrames.agy[2][1];
  assert.deepEqual(providers.agy.screen.dialogKeys('overlay', wizard), []);
  assert.deepEqual(providers.claude.screen.dialogKeys('trust-dialog', promptFrames.claude[0][1]), ['down', 'enter']);
});

test('a shell-looking frame requires a matching foreground process and executable', async () => {
  const terminal = { pid: 10, foreground: { pid: 20 } };
  const lookup = executable => async pids => {
    assert.deepEqual(pids, [20, 10]);
    return new Map([[20, { pid: 20, ppid: 10, uid: process.getuid(), executable }]]);
  };
  assert.equal(await returnedToShell(terminal, 'fixture %', lookup('/bin/zsh')), true);
  assert.equal(await returnedToShell(terminal, 'fixture %', lookup('/bin/codex')), false);
});
