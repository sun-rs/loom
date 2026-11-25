import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import xterm from '@xterm/headless';
import { wireText } from '../inbox/message.mjs';
import { bindTuiSession } from './index.mjs';
import { controlHello, listenControl, requestControl } from './pty-control.mjs';
import { readGrid } from './pty-grid.mjs';
import { providers } from './providers.mjs';
import { readRequestBook } from './request-book.mjs';
import { thinBackend } from './thin.mjs';

test('Codex draft readback skips an empty paragraph placeholder and preserves indented spaces', async () => {
  const grid = new xterm.Terminal({ cols: 90, rows: 12, allowProposedApi: true });
  try {
    await new Promise(resolve => grid.write(
      '› first\r\n \r\n   \r\n  last\r\n \r\n  gpt-6.2-sol low · /test', resolve));
    assert.equal(readGrid(grid, 'codex').draft, 'first\n\n \nlast');
  } finally { grid.dispose(); }
});

async function setup(t, { afterPaste, firstEnter, announce, hidePart } = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'lpt-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const socket = join(cwd, 's');
  const sessionId = randomUUID();
  const incarnation = randomUUID();
  const hookSink = join(cwd, 'hooks.jsonl');
  const bookPath = join(cwd, 'requests.jsonl');
  const hook = fields => appendFile(hookSink, JSON.stringify({ cwd, session_id: sessionId, receivedAt: Date.now(), ...fields }) + '\n');
  await hook({ hook_event_name: 'SessionStart' });
  let draft = '';
  let overlay = false;
  let enterCount = 0;
  const provider = announce ? providers.agy : providers.claude;
  const prompt = announce ? '>' : '❯';
  const writes = [];
  const events = new EventEmitter();
  const subscribe = (event, callback) => {
    events.on(event, callback);
    return { dispose: () => events.off(event, callback) };
  };
  const draw = () => {
    const displayed = hidePart && draft ? draft.slice(0, -1) : draft;
    const footer = announce && draft ? 'accept-edits · Gemini 4 Neon (Low)' : '? for shortcuts';
    const card = overlay ? '┃ Introducing Gemini 4 Neon\r\n┃ esc to dismiss\r\n' : '';
    events.emit('data', Buffer.from(`\x1b[2J\x1b[H${card}──────────\r\n${prompt} ${displayed.replaceAll('\n', '\r\n  ')}\r\n──────────\r\n${footer}`));
  };
  const pty = {
    spawn: () => ({
      onData: callback => subscribe('data', callback),
      onExit: callback => subscribe('exit', callback),
      write(bytes) {
        writes.push(bytes);
        if (bytes.startsWith('\x1b[200~')) {
          draft = bytes.slice(6, -6);
          overlay = announce === true;
          afterPaste?.(terminal, data);
        } else if (bytes === '\r') {
          enterCount++;
          if (enterCount !== 1 || !['held', 'discarded'].includes(firstEnter)) {
            void hook({ hook_event_name: announce ? 'PreInvocation' : 'UserPromptSubmit', prompt: draft });
          }
          if (enterCount !== 1 || firstEnter === undefined || firstEnter === 'discarded') draft = '';
        } else if (bytes === '\x1b' && overlay) overlay = false;
        else if (bytes === '\x15') draft = '';
        else draft += bytes;
        draw();
      },
      resize: draw,
      kill: () => events.emit('exit', { exitCode: 0 }),
    }),
  };
  const data = bytes => events.emit('data', Buffer.from(bytes));
  const terminal = await thinBackend({ pty, Terminal: xterm.Terminal, humanPauseMs: 400 }).launch({
    cwd, argv: [provider.id], env: {}, provider: provider.id, unset: [],
  });
  t.after(() => terminal.close());
  const bind = () => bindTuiSession(terminal, provider, {
    hookSink, evidenceRoot: cwd, cwd, bookPath, incarnation, requireNative: true,
  });
  let close = await listenControl(socket, bind(), incarnation);
  t.after(() => close());
  const account = (method, params) => requestControl(socket, method, params, incarnation);
  draw();
  let ready;
  for (let attempt = 0; attempt < 40; attempt++) {
    ready = await account('state');
    if (ready.ready) break;
    await sleep(20);
  }
  assert.equal(ready.ready, true);
  return { terminal, writes, account, socket, bookPath, ready, incarnation, data,
    restartControl: async () => { await close(); close = await listenControl(socket, bind(), incarnation); } };
}

test('socket rejects a stale frame or a recent human draft without writing any automated bytes', async t => {
  const f = await setup(t);
  await assert.rejects(requestControl(f.socket, 'state'), /identity changed/);
  f.terminal.writeHuman('human draft');
  const denied = await f.account('submit', { id: randomUUID(), text: 'automated', generation: f.ready.host.generation });
  assert.deepEqual(denied, { kind: 'refused', code: 'human-active' });
  assert.deepEqual(f.writes, ['human draft']);
  assert.equal((await f.account('state')).screen.draft, 'human draft');
});

test('socket stops before Enter when human input lands after paste and never retries the same ID', async t => {
  const f = await setup(t, { afterPaste: terminal => terminal.writeHuman('human') });
  const id = randomUUID();
  const text = 'automated';
  const submit = await f.account('submit', { id, text, generation: f.ready.host.generation, timeoutMs: 50 });
  assert.equal(submit.kind, 'unconfirmed');
  assert.equal(submit.hostReceipt.outcome, 'human-or-exit-during-paste');
  assert.deepEqual(f.writes, [`\x1b[200~${wireText(id, text)}\x1b[201~`, 'human']);
  assert.ok((await f.account('state')).screen.draft.endsWith('human'));
  assert.equal((await f.account('confirmations', { id })).count, 0);
  await f.restartControl();
  assert.equal((await f.account('submit', { id, text })).kind, 'unconfirmed');
  assert.deepEqual(await f.account('submit', { id, text: 'different' }), { kind: 'refused', code: 'id-conflict' });
  assert.equal((await f.account('submit', { id: randomUUID(), text })).code, 'previous-input-unconfirmed');
  assert.equal(f.writes.length, 2);
  assert.equal(readRequestBook(f.bookPath).get(id).hostReceipt.accepted, false);
});

test('socket journals the native proof before returning confirmed and reuses the receipt on restart', async t => {
  const f = await setup(t);
  const id = randomUUID();
  const text = 'automatic';
  const submit = await f.account('submit', { id, text, generation: f.ready.host.generation, timeoutMs: 1500 });
  assert.equal(submit.kind, 'confirmed');
  assert.equal(submit.confirmation.hook, 1);
  assert.equal(readRequestBook(f.bookPath).get(id).confirmation.at, submit.confirmation.at);
  await f.restartControl();
  assert.equal((await f.account('submit', { id, text })).confirmation.count, 1);
  assert.equal(f.writes.filter(value => value === '\r').length, 1);
});

test('a later control client attaches to the same incarnation and sees its existing receipt', async t => {
  const f = await setup(t);
  const info = await controlHello(f.socket, f.incarnation);
  assert.equal(info.protocol, 1);
  assert.equal(info.incarnation, f.incarnation);
  assert.ok(info.methods.includes('submit'));
  await assert.rejects(controlHello(f.socket, randomUUID()), /identity changed/);
  const id = randomUUID();
  await f.account('submit', { id, text: 'automatic' });
  assert.equal((await requestControl(f.socket, 'confirmations', { id }, info.incarnation)).count, 1);
});

test('a repainted, unaccepted draft can receive one more Enter with no second paste', async t => {
  const f = await setup(t, { firstEnter: 'held' });
  const id = randomUUID();
  const result = await f.account('submit', { id, text: 'held input' });
  assert.equal(result.kind, 'confirmed');
  assert.equal(result.confirmation.count, 1);
  assert.equal(result.hostReceipt.resubmitted, true);
  assert.equal(f.writes.filter(value => value === '\r').length, 2);
  assert.equal(f.writes.filter(value => value.startsWith('\x1b[200~')).length, 1);
});

test('recovery dismisses one confirmed announcement and submits only an intact held draft', async t => {
  for (const hidePart of [false, true]) {
    const f = await setup(t, { announce: true, hidePart });
    const id = randomUUID();
    const text = 'first input';
    assert.equal((await f.account('submit', { id, text, timeoutMs: 100 })).kind, 'unconfirmed');
    const deadline = Date.now() + 1800;
    do {
      const state = await f.account('state');
      if (hidePart && state.blocker === 'draft-held') assert.equal(state.ready, false);
      if (f.writes.includes('\r')) break;
      await sleep(100);
    } while (Date.now() < deadline);
    assert.equal(f.writes.filter(value => value === '\x1b').length, 1);
    assert.equal(f.writes.filter(value => value === '\r').length, hidePart ? 0 : 1);
    assert.equal((await f.account('confirmations', { id })).count, hidePart ? 0 : 1);
    if (hidePart) {
      f.terminal.writeHuman('\r');
      await sleep(40);
      assert.equal((await f.account('confirmations', { id })).count, 1);
    }
  }
});

test('native confirmation vetoes another Enter even while the same draft is painted', async t => {
  const f = await setup(t, { firstEnter: 'confirmed' });
  const result = await f.account('submit', { id: randomUUID(), text: 'stale input paint' });
  assert.equal(result.kind, 'confirmed');
  assert.equal(f.writes.filter(value => value === '\r').length, 1);
});

test('urgent input can take an independently verified empty composer while a prior Enter remains unconfirmed', async t => {
  const f = await setup(t, { firstEnter: 'discarded' });
  const first = randomUUID();
  const second = randomUUID();
  assert.equal((await f.account('submit', { id: first, text: 'unknown delivery', timeoutMs: 150 })).kind, 'unconfirmed');
  const state = await f.account('state');
  assert.equal(state.urgentReady, true);
  assert.equal((await f.account('submit', { id: second, text: 'urgent delivery' })).code, 'previous-input-unconfirmed');
  const result = await f.account('submit', { id: second, text: 'urgent delivery', urgent: true });
  assert.equal(result.kind, 'confirmed');
  assert.equal(readRequestBook(f.bookPath).get(first).released, true);
  assert.equal((await f.account('confirmations', { id: first })).count, 0);
  assert.equal(f.writes.filter(value => value === '\r').length, 2);
});

test('resize during paste withholds Enter and the next ID can proceed after the abandoned draft is cleared', async t => {
  let first = true;
  const f = await setup(t, { afterPaste(terminal) {
    if (first) terminal.resize(100, 40);
    first = false;
  } });
  const id = randomUUID();
  const result = await f.account('submit', { id, text: 'abandoned' });
  assert.equal(result.hostReceipt.outcome, 'composer-changed-during-paste');
  assert.equal(f.writes.includes('\r'), false);
  f.terminal.writeHuman('\x15');
  await sleep(450);
  const state = await f.account('state');
  assert.equal(state.ready, true);
  assert.deepEqual(state.host.size, { cols: 100, rows: 40 });
  assert.equal((await f.account('submit', { id, text: 'abandoned' })).kind, 'unconfirmed');
  assert.equal((await f.account('submit', { id: randomUUID(), text: 'next input' })).kind, 'confirmed');
});

test('switching to the alternate buffer invalidates a draft even if it is painted there', async t => {
  const f = await setup(t, { afterPaste: (_terminal, data) => data('\x1b[?1049h') });
  const result = await f.account('submit', { id: randomUUID(), text: 'buffer changed' });
  assert.equal(result.hostReceipt.outcome, 'composer-changed-during-paste');
  assert.equal(f.writes.includes('\r'), false);
  assert.equal((await f.account('state')).host.buffer, 'alternate');
});

test('split OSC titles can veto a stale idle hook, and an idle title cannot authorize a draft', async t => {
  const f = await setup(t);
  f.data('\x1b]0;');
  f.data('◐ Claude Code\x07');
  await sleep(140);
  const working = await f.account('state');
  assert.equal(working.host.title, 'busy');
  assert.equal(working.ready, false);
  f.terminal.writeHuman('some draft');
  f.data('\x1b]2;✳ Claude Code\x1b\\');
  await sleep(450);
  const idle = await f.account('state');
  assert.equal(idle.host.title, 'idle');
  assert.equal(idle.ready, false);
  assert.equal(idle.screen.draft, 'some draft');
});
