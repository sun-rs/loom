import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { withClaudeTranscriptStops } from '../relay/sources.mjs';
import { createWatcher } from './index.mjs';
import { parseResetAt } from './reset.mjs';

const epoch = Date.parse('2026-11-24T18:00:00Z');
const fixture = (provider, path) => readFileSync(new URL(`../adapters/${provider}/fixtures/${path}.txt`, import.meta.url), 'utf8');
const idle = fixture('codex', 'live/idle');
const busy = fixture('codex', 'live/busy');
const picker = fixture('codex', 'live/picker');
const rate = fixture('codex', 'experiment/codex-rate-limit-synthetic');

function setup(t, { cli = 'codex', text = idle, ...options } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'loom-watch-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const eventFile = join(cwd, 'events.jsonl');
  const session = { addr: 't1', backend: 'tui', cli, cwd, startedAt: epoch - 10_000, endedAt: null, sessionId: 's1' };
  const terminal = { state: 'live', cwd, screen: 'exact', pid: 555, created_ms: session.startedAt };
  const f = { session, terminal, rows: [session], text, at: epoch, hooks: [], calls: [], queued: [], cwd };
  f.events = () => existsSync(eventFile) ? readFileSync(eventFile, 'utf8').trim().split('\n').map(JSON.parse) : [];
  f.advance = ms => { f.at += ms; };
  f.create = overrides => createWatcher({
    listSessions: () => f.rows, readHooks: () => f.hooks, eventFile,
    idleMs: 4_000, busyMs: 4_000, now: () => f.at,
    enqueue: message => {
      assert.equal(f.events().at(-1).phase, 'attempt');
      f.queued.push(message);
      return { id: 'queue-receipt' };
    },
    hc: async (command, addr, ...args) => {
      f.calls.push([command, addr, ...args]);
      if (command === 'get') return { ...f.terminal, address: addr };
      if (command === 'read') {
        return f.read ? f.read() : { complete: true, how: 'screen', text: f.text };
      }
      if (command === 'keys') return f.keys?.();
      if (command === 'send') return f.send?.();
      throw new Error(`Unexpected hc request: ${command}`);
    },
    ...options, ...overrides,
  });
  return f;
}

test('uses hc get and a visible screen only for live indexed TUI sessions', async t => {
  const f = setup(t);
  f.rows.push({ ...f.session, addr: 't2', backend: 'headless' }, { ...f.session, addr: 't3', endedAt: epoch },
    { ...f.session, addr: 't4', state: 'exited' }, { ...f.session, addr: 't5', cli: 'unknown' });
  const watcher = f.create();
  const poll = watcher.poll();
  assert.equal(watcher.poll(), poll);
  assert.deepEqual(await poll, [{ addr: 't1', screen: 'idle', state: 'idle' }]);
  assert.deepEqual(f.calls, [['get', 't1'], ['read', 't1', '--lines', '0']]);
  f.terminal.state = 'finished';
  f.calls.length = 0;
  assert.equal((await watcher.poll())[0].state, 'exited');
  assert.deepEqual(f.calls, [['get', 't1']]);
  assert.deepEqual(f.events(), []);
});

test('uses adapter fixtures for manual blockers and sends no keys', async t => {
  const f = setup(t);
  const watcher = f.create({ trustedCwds: [f.cwd] });
  const cases = [
    ['codex', 'live/picker', 'picker', 'picker'],
    ['claude', 'live-bypass', 'picker', 'picker'],
    ['claude', 'experiment-auth-fail-synthetic', 'auth-fail', 'auth'],
    ['agy', 'agy-auth-fail-synthetic', 'auth-fail', 'auth'],
    ['agy', 'agy-rate-limit-synthetic', 'rate-limit', 'rate-limit'],
    ['codex', 'orca/codex-model-capacity', 'rate-limit', 'rate-limit'],
  ];
  for (const [cli, path, screen, reason] of cases) {
    Object.assign(f.session, { cli });
    f.text = fixture(cli, path);
    assert.deepEqual((await watcher.poll())[0], { addr: 't1', screen, state: 'needs-you', reason });
  }
  assert.deepEqual(f.events().filter(event => event.type === 'stuck').map(event => event.reason), cases.map(row => row[3]));
  assert.ok(f.calls.every(([command]) => command === 'get' || command === 'read'));
});

for (const [cli, file, label, keys] of [
  ['codex', 'live/trust', '/isolated/workspace-trust', ['enter']],
  ['claude', 'live-trust', '<lab>/trust-repo', ['down', 'enter']],
  ['agy', 'agy-trust-dialog', '<FIXTURE_CWD>', ['enter']],
]) {
  test(`${cli} handles a confirmed trust frame once and journals the action`, async t => {
    const f = setup(t, { cli });
    f.text = fixture(cli, file).replace(label, f.cwd);
    let presses = 0;
    f.keys = () => {
      assert.equal(f.events().at(-1).phase, 'attempt');
      presses++;
    };
    const watcher = f.create({ trustedCwds: [f.cwd] });
    assert.equal((await watcher.poll())[0].state, 'recovering');
    assert.deepEqual(f.calls.filter(([command]) => command === 'keys'), [['keys', 't1', ...keys]]);
    assert.equal(f.calls.filter(([command]) => command === 'read').length, 2);
    await watcher.poll();
    const restarted = f.create({ trustedCwds: [f.cwd] });
    f.advance(15_000);
    assert.equal((await restarted.poll())[0].state, 'needs-you');
    await restarted.poll();
    assert.equal(presses, 1);
    assert.deepEqual(f.events().map(event => [event.type, event.phase]), [
      ['trust-accept', 'attempt'], ['trust-accept', 'submitted'], ['stuck', undefined],
    ]);
  });
}

test('requires an explicit matching cwd, a known cursor, and a live recheck before accepting trust', async t => {
  const f = setup(t);
  const trust = fixture('codex', 'live/trust').replace('/isolated/workspace-trust', f.cwd);
  f.text = trust;
  assert.equal((await f.create().poll())[0].state, 'needs-you');
  await f.create().poll();
  assert.equal(f.events().length, 1);

  const watcher = f.create({ trustedCwds: [f.cwd] });
  for (const text of [trust.replace(f.cwd, '/somewhere-else'), trust.replace('› 1.', '  1.').replace('  2.', '› 2.')]) {
    f.text = idle;
    await watcher.poll();
    f.text = text;
    assert.equal((await watcher.poll())[0].state, 'needs-you');
  }
  f.text = idle;
  await watcher.poll();
  let reads = 0;
  f.read = () => ({ complete: true, how: 'screen', text: reads++ === 0 ? trust : idle });
  assert.equal((await watcher.poll())[0].state, 'unknown');
  reads = 0;
  f.read = () => ({ complete: reads++ === 0, how: 'screen', text: trust });
  assert.equal((await watcher.poll())[0].state, 'needs-you');
  assert.ok(f.calls.every(([command]) => command !== 'keys'));
});

test('persists one alert across restart, preserves it on stale reads and rearms after recovery', async t => {
  const f = setup(t, { text: picker, superAddr: 't-super' });
  let watcher = f.create();
  await watcher.poll();
  await watcher.flush();
  const first = f.events()[0];
  watcher = f.create();
  await watcher.poll();
  f.read = () => ({ complete: false, how: 'history', text: idle });
  assert.equal((await watcher.poll())[0].state, 'needs-you');
  assert.equal(f.events().length, 1);
  f.read = undefined;
  f.text = idle;
  await watcher.poll();
  await watcher.poll();
  f.text = picker;
  await watcher.poll();
  await watcher.flush();
  const [alert, recovered, next] = f.events();
  assert.equal(alert.incidentId, recovered.incidentId);
  assert.notEqual(first.incidentId, next.incidentId);
  assert.deepEqual([alert.type, recovered.type, next.type], ['stuck', 'recovered', 'stuck']);
  assert.deepEqual(f.calls.filter(([cmd]) => cmd === 'send'), [
    ['send', 't-super', '[loom watch] t1 needs-you picker'],
    ['send', 't-super', '[loom watch] t1 recovered picker'],
    ['send', 't-super', '[loom watch] t1 needs-you picker'],
  ]);
});

test('a pending super notification does not delay observing other panes', async t => {
  const f = setup(t, { text: picker, superAddr: 't-super' });
  const watcher = f.create();
  const notification = Promise.withResolvers();
  f.send = () => notification.promise;
  await watcher.poll();
  f.rows.push({ ...f.session, addr: 't2' });
  assert.equal((await watcher.poll()).length, 2);
  notification.resolve();
  await watcher.flush();
  assert.equal(f.events().filter(event => event.type === 'stuck').length, 2);
});

test('idle-without-stop requires an open matching turn and recovers when its Stop arrives', async t => {
  const f = setup(t);
  const watcher = f.create();
  await watcher.poll();
  f.advance(60_000);
  await watcher.poll();
  assert.deepEqual(f.events(), []);

  f.hooks.push({ receivedAt: f.at, payload: { hook_event_name: 'UserPromptSubmit', session_id: 's1', turn_id: 'turn1' } });
  await watcher.poll();
  f.advance(3_999);
  f.hooks.push(
    { type: 'turn-end', addr: 't-other', sessionId: 's1', turn: 'turn1', at: f.at },
    { type: 'turn-end', addr: 't1', sessionId: 'other', turn: 'turn1', at: f.at },
    { type: 'turn-end', addr: 't1', sessionId: 's1', turn: 'other', at: f.at },
  );
  await watcher.poll();
  assert.deepEqual(f.events(), []);
  f.advance(1);
  assert.equal((await watcher.poll())[0].reason, 'idle-without-stop');
  await f.create().poll();
  assert.equal(f.events().filter(event => event.type === 'stuck').length, 1);
  const hooks = f.hooks;
  f.hooks = [];
  assert.equal((await f.create().poll())[0].state, 'needs-you');
  f.hooks = hooks;
  f.hooks.push({ receivedAt: f.at, payload: { hook_event_name: 'Stop', session_id: 's1', turn_id: 'turn1' } });
  await watcher.poll();
  assert.deepEqual(f.events().map(event => event.type), ['stuck', 'recovered']);
  assert.ok(f.calls.every(([command]) => command !== 'send'));
});

test('a matching Claude transcript boundary clears a persisted idle-without-stop incident', async t => {
  const f = setup(t, { cli: 'claude', text: fixture('claude', 'live-idle') });
  f.session.cwd = f.terminal.cwd = realpathSync(f.cwd);
  const transcript_path = join(f.session.cwd, 's1.jsonl');
  const prompt = 'manual Enter';
  f.hooks.push({ receivedAt: f.at, hook_event_name: 'UserPromptSubmit', session_id: 's1',
    prompt_id: 'p1', transcript_path, prompt });
  const transcript = row => appendFileSync(transcript_path, JSON.stringify({
    sessionId: 's1', cwd: f.session.cwd, timestamp: new Date(f.at).toISOString(), ...row,
  }) + '\n');
  transcript({ type: 'user', message: { content: prompt } });
  const create = () => f.create({ readHooks: session => withClaudeTranscriptStops(session, f.hooks, session.sessionId) });
  const watcher = create();
  await watcher.poll();
  f.advance(4_000);
  transcript({ type: 'system', subtype: 'stop_hook_summary' });
  assert.equal((await watcher.poll())[0].reason, 'idle-without-stop');
  f.advance(1);
  transcript({ type: 'system', subtype: 'turn_duration' });
  assert.equal((await create().poll())[0].state, 'idle');
  assert.deepEqual(f.events().map(event => event.type), ['stuck', 'recovered']);
});

test('busy spinner seconds do not count as output, while text and tool hooks do', async t => {
  const f = setup(t, { text: busy });
  const watcher = f.create();
  await watcher.poll();
  f.advance(3_900);
  f.text = busy.replace('Working (0s', 'Working (4s');
  await watcher.poll();
  f.advance(100);
  f.text = busy.replace('Working (0s', 'Working (5s');
  assert.equal((await watcher.poll())[0].reason, 'busy-without-output');
  await f.create().poll();
  f.advance(100);
  f.text = f.text.replace('• Working', '• Received fresh output\n• Working');
  assert.equal((await watcher.poll())[0].state, 'busy');
  f.advance(3_900);
  f.hooks.push({ type: 'tool', addr: 't1', sessionId: 's1', at: f.at });
  await watcher.poll();
  f.advance(100);
  await watcher.poll();
  assert.deepEqual(f.events().map(({ type, reason }) => [type, reason]), [
    ['stuck', 'busy-without-output'], ['recovered', 'busy-without-output'],
  ]);
});

test('native background task rows hold busy beyond the idle and busy timers', async t => {
  const rule = '─'.repeat(24);
  for (const [cli, text] of [
    ['agy', [rule, '>', rule, '● [00:03:00] npm test', rule, '? for shortcuts'].join('\n')],
    ['claude', ['✻ waiting on 1 command, 1 monitor · 2m 34s', rule, '❯', rule, '⏵⏵ accept edits on'].join('\n')],
  ]) {
    const f = setup(t, { cli, text });
    f.hooks.push({ type: 'turn-start', addr: 't1', sessionId: 's1', at: f.at });
    const watcher = f.create();
    for (let n = 0; n < 3; n++) {
      assert.equal((await watcher.poll())[0].state, 'busy');
      f.advance(5_000);
    }
    assert.deepEqual(f.events(), []);
    f.text = cli === 'agy' ? [rule, '>', rule, '? for shortcuts'].join('\n') :
      [rule, '❯', rule, '⏵⏵ accept edits on'].join('\n');
    assert.equal((await watcher.poll())[0].state, 'idle');
    f.advance(5_000);
    assert.equal((await watcher.poll())[0].reason, 'idle-without-stop');
  }
});

test('an agy non-idle Stop prevents idle-without-stop while native background work is recorded', async t => {
  const rule = '─'.repeat(24);
  const f = setup(t, { cli: 'agy', text: [rule, '>', rule, '? for shortcuts'].join('\n') });
  f.hooks.push({ receivedAt: f.at, hook_event_name: 'PreInvocation', conversationId: 's1', invocationNum: 0 });
  const watcher = f.create();
  await watcher.poll();
  f.advance(100);
  f.hooks.push({ receivedAt: f.at, hook_event_name: 'Stop', conversationId: 's1', executionNum: 0, fullyIdle: false });
  f.advance(60_000);
  assert.equal((await watcher.poll())[0].state, 'busy');
  assert.deepEqual(f.events(), []);
  f.hooks.push({ receivedAt: f.at, hook_event_name: 'Stop', conversationId: 's1', executionNum: 0, fullyIdle: true });
  assert.equal((await watcher.poll())[0].state, 'idle');
});

test('rate limit pins retry time and enqueues once across restarts', async t => {
  const f = setup(t, { text: `${rate}Retry-After: 60\n` });
  let watcher = f.create();
  const initial = (await watcher.poll())[0];
  assert.equal(initial.resetAt, epoch + 60_000);
  f.advance(59_999);
  watcher = f.create();
  await watcher.poll();
  assert.deepEqual(f.queued, []);
  f.advance(1);
  await watcher.poll();
  assert.equal(f.queued.length, 1);
  const [{ addr, mode, message }] = f.queued;
  assert.deepEqual({ addr, mode, message }, { addr: 't1', mode: 'queue', message: '继续' });
  f.advance(60_000);
  await f.create().poll();
  assert.equal(f.queued.length, 1);
  assert.equal(f.events().find(event => event.phase === 'queued').deliveryId, 'queue-receipt');
  f.text = idle;
  await watcher.poll();
  assert.deepEqual(f.events().map(event => [event.type, event.phase]), [
    ['stuck', undefined], ['resume', 'attempt'], ['resume', 'queued'], ['recovered', undefined],
  ]);
});

test('learns a later reset once and journals a failed queue attempt without retrying', async t => {
  const f = setup(t, { text: rate });
  let attempts = 0;
  const watcher = f.create({ enqueue: () => { attempts++; throw new Error('unavailable'); } });
  await watcher.poll();
  f.advance(1_000);
  f.text = `${rate}Retry-After: 1\n`;
  await watcher.poll();
  f.advance(1_000);
  await watcher.poll();
  await f.create().poll();
  assert.equal(attempts, 1);
  assert.equal(f.queued.length, 0);
  assert.deepEqual(f.events().map(event => [event.type, event.phase]), [
    ['stuck', undefined], ['rate-limit-reset', undefined], ['resume', 'attempt'], ['resume', 'failed'],
  ]);
});

test('an early return to idle reports recovery but preserves a scheduled resume across restart', async t => {
  const f = setup(t, { text: `${rate}Retry-After: 60\n` });
  const watcher = f.create();
  await watcher.poll();
  f.advance(1_000);
  f.text = idle;
  assert.equal((await watcher.poll())[0].state, 'idle');
  assert.equal(f.events().at(-1).type, 'recovered');
  assert.deepEqual(f.queued, []);
  f.advance(59_000);
  await f.create().poll();
  await f.create().poll();
  assert.equal(f.queued.length, 1);
  assert.equal(f.events().filter(event => event.type === 'recovered').length, 1);
});

test('avoids resuming an earlier rate-limit edge after a new turn or terminal exit', async t => {
  const f = setup(t, { text: `${rate}Retry-After: 1\n` });
  const watcher = f.create();
  await watcher.poll();
  f.advance(10);
  f.hooks.push({ type: 'turn-start', addr: 't1', sessionId: 's1', turn: 8, at: f.at });
  f.advance(1_000);
  await watcher.poll();
  f.terminal.state = 'finished';
  await watcher.poll();
  assert.deepEqual(f.queued, []);
  assert.deepEqual(f.events().map(event => event.type), ['stuck', 'closed']);
});

test('parses reset dates for 429 and quota messages without inventing a deadline', () => {
  assert.equal(parseResetAt('Error: HTTP 429\nRetry-After: Wed, 25 Nov 2026 02:00:00 GMT', epoch),
    Date.parse('2026-11-25T02:00:00Z'));
  assert.equal(parseResetAt('429 Too Many Requests. Reset at 2026-11-25T03:20:54+08:00', epoch),
    Date.parse('2026-11-24T19:20:54Z'));
  assert.equal(parseResetAt('HTTP 429. x-ratelimit-reset: 1795545000', epoch), 1795545000000);
  assert.equal(parseResetAt('Quota exceeded. Resets in 2h35m41s', epoch), epoch + 9_341_000);
  assert.equal(parseResetAt('You’ve hit your limit · resets 3am (Asia/Shanghai)', epoch),
    Date.parse('2026-11-24T19:00:00Z'));
  assert.equal(parseResetAt('Rate limit reached. Try again at Nov 25, 2026 3:30 PM (Europe/Paris)', epoch),
    Date.parse('2026-11-25T14:30:00Z'));
  assert.equal(parseResetAt(fixture('codex', 'orca/codex-model-capacity'), epoch), null);
  assert.equal(parseResetAt('HTTP 429\n› tell me about retry after 30 seconds', epoch), null);
});
