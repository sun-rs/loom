import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { appendFile, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import xterm from '@xterm/headless';
import { encodeClaudeProjectPath } from '../adapters/claude/locate.mjs';
import { inbox, receipt } from '../inbox/engine.mjs';
import { wireText } from '../inbox/message.mjs';
import { tui } from '../inbox/tui.mjs';
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

async function setup(t, { afterPaste, firstEnter, announce, hidePart, collapsedScreen, feedback, transcript, agyWelcome } = {}) {
  const cwd = await mkdtemp(join(await realpath(tmpdir()), 'lpt-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const socket = join(cwd, 's');
  const sessionId = randomUUID();
  const incarnation = randomUUID();
  const hookSink = join(cwd, 'hooks.jsonl');
  const bookPath = join(cwd, 'requests.jsonl');
  const transcriptPath = join(cwd, `${sessionId}.jsonl`);
  const hook = fields => appendFile(hookSink, JSON.stringify({ cwd, session_id: sessionId, receivedAt: Date.now(), ...fields }) + '\n');
  if (!agyWelcome) await hook({ hook_event_name: 'SessionStart', ...(transcript && { transcript_path: transcriptPath }) });
  let draft = '';
  let overlay = false;
  let enterCount = 0;
  const provider = announce || feedback || agyWelcome ? providers.agy : providers.claude;
  const prompt = provider.id === 'agy' ? '>' : '❯';
  const writes = [];
  const events = new EventEmitter();
  const subscribe = (event, callback) => {
    events.on(event, callback);
    return { dispose: () => events.off(event, callback) };
  };
  const draw = () => {
    if (collapsedScreen && draft) {
      events.emit('data', Buffer.from('\x1b[2J\x1b[H' + collapsedScreen.trimEnd().replaceAll('\n', '\r\n')));
      return;
    }
    const displayed = hidePart && draft ? draft.slice(0, -1) : draft;
    const footer = announce && draft ? 'accept-edits · Gemini 4 Neon (Low)' : '? for shortcuts';
    const card = overlay ? '┃ Introducing Gemini 4 Neon\r\n┃ esc to dismiss\r\n' : '';
    const reenterFrame = ['held', 'question'].includes(firstEnter) && enterCount === 1;
    const caret = reenterFrame && draft ? `\x1b[2A\x1b[${draft.split('\n').at(-1).length + 3}G` : '';
    const question = firstEnter === 'question' && enterCount === 1 ?
      '\r\nEnter to select · Esc to cancel' : caret;
    const survey = feedback && enterCount ? "How's the CLI experience so far? Help us improve:\r\n[1] Good [2] Fine [3] Bad [0] Skip\r\n" : '';
    events.emit('data', Buffer.from(`\x1b[2J\x1b[H${card}${survey}──────────\r\n${prompt} ${displayed.replaceAll('\n', '\r\n  ')}\r\n──────────\r\n${footer}${question}`));
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
          if (enterCount !== 1 || !['held', 'discarded', 'question'].includes(firstEnter)) {
            const prompt = draft;
            if (agyWelcome) {
              void appendFile(transcriptPath, JSON.stringify({ source: 'USER_EXPLICIT', type: 'USER_INPUT', content: prompt,
                step_index: 1, timestamp: new Date().toISOString() }) + '\n').then(() =>
                hook({ hook_event_name: 'PreInvocation', prompt, transcript_path: transcriptPath }));
            } else {
              void hook({ hook_event_name: provider.id === 'agy' ? 'PreInvocation' : 'UserPromptSubmit', prompt })
                .then(() => feedback && hook({ hook_event_name: 'Stop', fullyIdle: true, executionNum: 1 }));
            }
          }
          if (enterCount !== 1 || firstEnter === undefined || firstEnter === 'discarded') draft = '';
        } else if (bytes === '0' && feedback) return; // Keep the survey painted to exercise the retry bound.
        else if (bytes === '\x1b' && overlay) overlay = false;
        else if (bytes === '\x15') draft = '';
        else draft += bytes;
        draw();
      },
      resize: draw,
      kill: () => events.emit('exit', { exitCode: 0 }),
    }),
  };
  const data = bytes => events.emit('data', Buffer.from(bytes));
  const terminal = await thinBackend({ pty, Terminal: xterm.Terminal, humanPauseMs: 400,
    cols: agyWelcome ? 80 : collapsedScreen?.split('\n', 1)[0].length ?? 180 }).launch({
    cwd, argv: [provider.id], env: {}, provider: provider.id, unset: [],
  });
  t.after(() => terminal.close());
  // Exercise holder-mode payload verification without adopting any past write.
  if (agyWelcome) terminal.provePaste = () => ({ status: 'unproven' });
  const bind = () => bindTuiSession(terminal, provider, {
    hookSink, evidenceRoot: cwd, cwd, bookPath, incarnation, requireNative: true,
  });
  let close = await listenControl(socket, bind(), incarnation);
  t.after(() => close());
  const account = (method, params) => requestControl(socket, method, params, incarnation);
  if (agyWelcome) return { terminal, account, writes, cwd, bookPath, data };
  draw();
  let ready;
  for (let attempt = 0; attempt < 40; attempt++) {
    ready = await account('state');
    if (ready.ready) break;
    await sleep(20);
  }
  assert.equal(ready.ready, true);
  return { terminal, writes, account, socket, bookPath, ready, incarnation, data, hook,
    appendTranscript: row => appendFile(transcriptPath, JSON.stringify({ sessionId, cwd, timestamp: new Date().toISOString(), ...row }) + '\n'),
    restartControl: async () => { await close(); close = await listenControl(socket, bind(), incarnation); } };
}

test('agy welcome without shortcuts delivers the queued compact handover exactly once', async t => {
  const f = await setup(t, { agyWelcome: true });
  const pane = { address: 't1', cwd: f.cwd, state: 'live', pid: 101, created_ms: Date.now(), status: { state: 'idle' } };
  const transport = tui(f.cwd, async command => {
    assert.equal(command, 'get');
    return pane;
  }, undefined, (_binding, method, params) => f.account(method, params));
  const mail = inbox(f.cwd, transport);
  const id = randomUUID();
  mail.enqueue({ id, target: { addr: pane.address, cwd: f.cwd, pid: pane.pid, createdAt: pane.created_ms,
    provider: 'agy', tui: { transport: 'holder-v3', bookPath: f.bookPath } }, createdAt: Date.now(),
  text: 'Read .project/replies/fixture.txt. Reply with its exact HANDOVER-ACK.', phase: 'queued', startup: true,
  mode: 'queue', requestedMode: 'queue' });
  const result = () => receipt(mail.messages.find(message => message.id === id));
  // agy 1.5.18 startup paint: bright-black placeholder at the caret, a
  // rule wider than the viewport, and no shortcut or model footer.
  const welcome = (hint, paint = '') => '\x1b[2J\x1b[HAntigravity CLI 1.5.18\r\n' + '─'.repeat(80) +
    `\r\n> ${paint}${hint}\x1b[0m\r\n` + '─'.repeat(200) + '\x1b[3;3H';
  const hint = 'Accept-edits mode: file edits auto-approved (shift+tab to cycle)';
  f.data(welcome(hint));
  await sleep(150);
  await mail.step();
  assert.equal(result().reason, 'waiting-writable');
  assert.deepEqual(f.writes, []);
  f.data(welcome(hint, '\x1b[90m'));
  await sleep(150);
  await mail.step();
  await mail.step();
  assert.equal(result().deliveryStatus, 'delivered', JSON.stringify(result()));
  assert.equal(f.writes.filter(bytes => bytes === '\r').length, 1);
});

test('agy 1.5.18 with empty statusLine footer delivers first handover without draft-held', async t => {
  const startup = JSON.parse(await readFile(new URL('../tasks/ROT-AGY-2/agy-startup-frames.json', import.meta.url), 'utf8'));
  const gi = startup.pilotGi2J8U;
  const cwd = await mkdtemp(join(await realpath(tmpdir()), 'lpt-rot2-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const socket = join(cwd, 's');
  const sessionId = randomUUID();
  const incarnation = randomUUID();
  const hookSink = join(cwd, 'hooks.jsonl');
  const bookPath = join(cwd, 'requests.jsonl');
  const transcriptPath = join(cwd, `${sessionId}.jsonl`);
  const writes = [];
  const events = new EventEmitter();
  const subscribe = (event, callback) => {
    events.on(event, callback);
    return { dispose: () => events.off(event, callback) };
  };
  const pty = {
    spawn: () => ({
      onData: callback => subscribe('data', callback),
      onExit: callback => subscribe('exit', callback),
      write(bytes) {
        writes.push(bytes);
        if (bytes.startsWith('\x1b[200~')) {
          events.emit('data', Buffer.from(gi.afterPasteBytes));
        } else if (bytes === '\r') {
          void appendFile(transcriptPath, JSON.stringify({ source: 'USER_EXPLICIT', type: 'USER_INPUT', content: gi.wire,
            step_index: 1, timestamp: new Date().toISOString() }) + '\n').then(() =>
            appendFile(hookSink, JSON.stringify({ cwd, session_id: sessionId, receivedAt: Date.now(),
              hook_event_name: 'PreInvocation', prompt: gi.wire, transcript_path: transcriptPath }) + '\n'));
        }
      },
      resize() {},
      kill: () => events.emit('exit', { exitCode: 0 }),
    }),
  };
  const terminal = await thinBackend({ pty, Terminal: xterm.Terminal, cols: gi.cols, rows: gi.rows, humanPauseMs: 400 }).launch({
    cwd, argv: ['agy'], env: {}, provider: 'agy', unset: [],
  });
  t.after(() => terminal.close());
  terminal.provePaste = () => ({ status: 'unproven' });
  const close = await listenControl(socket, bindTuiSession(terminal, providers.agy, {
    hookSink, evidenceRoot: cwd, cwd, bookPath, incarnation, requireNative: true,
  }), incarnation);
  t.after(() => close());
  const account = (method, params) => requestControl(socket, method, params, incarnation);

  events.emit('data', Buffer.from('\x1b[2J\x1b[H' + gi.welcomeBytes));
  await sleep(150);
  const pane = { address: 't-rot2', cwd, state: 'live', pid: 102, created_ms: Date.now(), status: { state: 'idle' } };
  const transport = tui(cwd, async () => pane, undefined, (_binding, method, params) => account(method, params));
  const mail = inbox(cwd, transport);
  mail.enqueue({ id: gi.deliveryId, target: { addr: pane.address, cwd, pid: pane.pid, createdAt: pane.created_ms,
    provider: 'agy', tui: { transport: 'holder-v3', bookPath } }, createdAt: Date.now(),
  text: gi.prompt, phase: 'queued', startup: true, mode: 'queue', requestedMode: 'queue' });
  await mail.step();
  await mail.step();
  const status = receipt(mail.messages.find(message => message.id === gi.deliveryId));
  assert.equal(status.deliveryStatus, 'delivered', JSON.stringify(status));
  assert.equal(writes.filter(bytes => bytes === '\r').length, 1);
});

test('agy treats unknown muted placeholders and unknown non-interactive footers as non-drafts and logs once', async t => {
  const cwd = await mkdtemp(join(await realpath(tmpdir()), 'lpt-rot2-hint-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const socket = join(cwd, 's');
  const incarnation = randomUUID();
  const hookSink = join(cwd, 'hooks.jsonl');
  const bookPath = join(cwd, 'requests.jsonl');
  const logs = [];
  const events = new EventEmitter();
  const subscribe = (event, callback) => {
    events.on(event, callback);
    return { dispose: () => events.off(event, callback) };
  };
  const pty = {
    spawn: () => ({
      onData: callback => subscribe('data', callback),
      onExit: callback => subscribe('exit', callback),
      write() {},
      resize() {},
      kill: () => events.emit('exit', { exitCode: 0 }),
    }),
  };
  const terminal = await thinBackend({ pty, Terminal: xterm.Terminal, cols: 120, rows: 35, humanPauseMs: 400 }).launch({
    cwd, argv: ['agy'], env: {}, provider: 'agy', unset: [],
  });
  t.after(() => terminal.close());
  const close = await listenControl(socket, bindTuiSession(terminal, providers.agy, {
    hookSink, evidenceRoot: cwd, cwd, bookPath, incarnation, requireNative: true,
    report: message => logs.push(message),
  }), incarnation);
  t.after(() => close());
  const account = (method, params) => requestControl(socket, method, params, incarnation);

  events.emit('data', Buffer.from(`\x1b[2J\x1b[HAntigravity CLI 1.6.0\r\n${'─'.repeat(120)}\r\n\x1b[94m>\x1b[m \x1b[90mAsk Antigravity anything\x1b[m\r\n${'─'.repeat(120)}\r\nNew: Try /fast mode\x1b[3;3H`));
  await sleep(150);
  const firstUnknown = await account('state');
  const secondUnknown = await account('state');
  assert.equal(firstUnknown.ready, true);
  assert.equal(secondUnknown.ready, true);
  assert.equal(firstUnknown.screen.draft, '');
  assert.equal(logs.length, 2);
  assert.match(logs[0], /unknown composer-placeholder.*Ask Antigravity anything/);
  assert.match(logs[1], /unknown footer-hint.*New: Try \/fast mode/);

  events.emit('data', Buffer.from(`\x1b[2J\x1b[H${'─'.repeat(120)}\r\n> user draft\r\n${'─'.repeat(120)}\x1b[2;13H`));
  await sleep(150);
  const userDraft = await account('state');
  assert.equal(userDraft.ready, false);
  assert.equal(userDraft.screen.draft, 'user draft');
});

test('an agy feedback survey after a native turn sends only Skip once', async t => {
  const f = await setup(t, { feedback: true });
  assert.equal((await f.account('submit', { id: randomUUID(), text: 'first' })).kind, 'confirmed');
  let state;
  for (let i = 0; i < 20; i++) {
    state = await f.account('state');
    if (f.writes.includes('0')) break;
    await sleep(35);
  }
  assert(state.native.turnSequence > 0);
  assert.equal(state.blocker, 'overlay');
  await sleep(1050);
  assert.equal((await f.account('state')).blocker, 'overlay');
  assert.deepEqual(f.writes.slice(1), ['\r', '0']);
});

test('Claude releases an idle composer when the bound root transcript records turn_duration', async t => {
  const f = await setup(t, { transcript: true });
  const id = randomUUID();
  assert.equal((await f.account('submit', { id, text: 'first' })).kind, 'confirmed');
  assert.equal((await f.account('state')).native.phase, 'busy');
  await f.appendTranscript({ type: 'user', message: { content: wireText(id, 'first') } });
  await f.appendTranscript({ type: 'assistant', message: { stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id: 'cd', name: 'Bash', input: { command: 'cd .project' } }] } });
  await f.appendTranscript({ type: 'user', cwd: '/fixture/.project',
    message: { content: [{ type: 'tool_result', tool_use_id: 'cd', content: '' }] } });
  await f.appendTranscript({ type: 'assistant', cwd: '/fixture/.project',
    message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Fixture final' }] } });
  await f.appendTranscript({ type: 'system', subtype: 'stop_hook_summary', cwd: '/fixture/.project' });
  await f.appendTranscript({ type: 'system', subtype: 'turn_duration', isSidechain: true });
  assert.equal((await f.account('state')).native.phase, 'busy');
  await f.appendTranscript({ type: 'system', subtype: 'turn_duration', cwd: '/fixture/.project' });
  const ended = (await f.account('state')).native;
  assert.equal(ended.phase, 'idle');
  assert.equal(ended.source, 'transcript');
  let state;
  for (let i = 0; i < 20; i++) {
    state = await f.account('state');
    if (state.ready) break;
    await sleep(20);
  }
  assert.equal(state.ready, true);
});

test('hookless Claude resume delivers with the context-saving footer and blocks busy frames and dialogs', async t => {
  const cwd = await mkdtemp(join(await realpath(tmpdir()), 'lpt-resume-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const sessionId = randomUUID();
  const id = randomUUID();
  const resumedAt = Date.now() - 1_000;
  const bound = { sessionId, cwd, evidenceRoot: cwd, boundTranscript: true, requireNative: true };
  const append = (path, type, fields, at = Date.now()) => appendFile(path,
    JSON.stringify({ sessionId, timestamp: new Date(at).toISOString(), type, ...fields }) + '\n');
  const bucket = configDir => join(configDir, 'projects', encodeClaudeProjectPath(cwd));
  const configDir = join(cwd, 'resumed');
  await mkdir(bucket(cwd), { recursive: true });
  await mkdir(bucket(configDir), { recursive: true });
  const oldPath = join(bucket(cwd), `${sessionId}.jsonl`);
  const newPath = join(bucket(configDir), `${sessionId}.jsonl`);
  const rule = '─'.repeat(74);
  const idle = `${rule}\n❯\u00a0\n${rule}\n  ⏵⏵ bypass permissions on · install gh for PR status\n` +
    '                                  new task? /clear to save 433.4k tokens';
  let screen = idle;
  let writes = 0;
  const terminal = {
    read: async () => ({ text: screen, draft: '', writable: true, quietForMs: 500 }),
    async writeIf(input, _state, verify) {
      assert.equal(await verify(await this.read()), true);
      writes++;
      await append(newPath, 'user', { message: { content: input } });
      return { accepted: true, submittedAt: Date.now() };
    },
  };
  const prior = { message: { content: wireText(id, 'continued work') } };
  await append(oldPath, 'user', prior, resumedAt - 1);
  const old = bindTuiSession(terminal, providers.claude, { ...bound, configDir: cwd });
  assert.equal((await old.readState()).native.transcriptPath, oldPath);
  assert.equal((await old.confirmations(id)).count, 1);
  await append(newPath, 'user', prior, resumedAt - 1);
  const live = bindTuiSession(terminal, providers.claude, { ...bound, configDir, resumedAt });
  await append(oldPath, 'user', prior);
  assert.equal((await live.readState()).native.transcriptPath, newPath);
  assert.equal((await live.confirmations(id)).count, 0);

  const submit = () => live.submit({ id, text: 'continued work', timeoutMs: 100 });
  await append(newPath, 'user', { message: { content: 'current turn' } });
  assert.deepEqual(await submit(), { kind: 'refused', code: 'busy' });
  await append(newPath, 'assistant', { message: { content: 'current reply' } });
  await append(newPath, 'system', { subtype: 'turn_duration' });
  screen = `✻ Thinking…\n${idle}`;
  assert.deepEqual(await submit(), { kind: 'refused', code: 'busy' });
  screen = `${idle}\nSelect model\n❯ 1. Default\nEnter to set as default · s to use this session only · Esc to cancel`;
  assert.deepEqual(await submit(), { kind: 'refused', code: 'picker' });
  screen = `${idle}\nUnknown overlay footer`;
  assert.deepEqual(await submit(), { kind: 'refused', code: 'composer-not-proven-empty' });
  assert.equal(writes, 0);

  screen = idle;
  const sent = await submit();
  assert.equal(sent.kind, 'confirmed', JSON.stringify(sent));
  assert.equal(sent.confirmation.source, 'transcript');
  assert.equal((await submit()).confirmation.count, 1);
  assert.equal(writes, 1);
});

test('Claude idle compaction leaves the idle composer writable without creating a turn', async t => {
  const f = await setup(t, { transcript: true });
  const fixture = await readFile(new URL('../adapters/claude/fixtures/live-idle-compaction.jsonl', import.meta.url), 'utf8');
  const rows = fixture.trimEnd().split('\n').map(JSON.parse);
  const first = randomUUID();
  assert.equal((await f.account('submit', { id: first, text: 'first' })).kind, 'confirmed');
  const before = (await f.account('state')).native;
  await f.hook({ hook_event_name: 'PreCompact', prompt_id: 'compact-prompt' });
  assert.equal((await f.account('state')).native.phase, 'compacting');
  await f.hook({ hook_event_name: 'PostCompact', prompt_id: 'compact-prompt' });
  const during = (await f.account('state')).native;
  assert.equal(during.phase, 'busy');
  assert.equal(during.activeInputId, first);
  assert.equal(during.turnSequence, before.turnSequence);

  await f.appendTranscript({ type: 'user', message: { content: 'first' } });
  await f.appendTranscript({ type: 'assistant', message: { content: 'Fixture final' } });
  await f.appendTranscript({ type: 'system', subtype: 'turn_duration' });
  assert.equal((await f.account('state')).native.phase, 'idle');
  await f.hook({ hook_event_name: 'PreCompact', prompt_id: 'compact-prompt' });
  for (const row of rows.slice(0, -1)) await f.appendTranscript(row);
  await f.hook({ hook_event_name: 'PostCompact', prompt_id: 'compact-prompt' });
  assert.equal((await f.account('state')).native.phase, 'idle');
  await f.appendTranscript(rows.at(-1));
  await f.restartControl();
  const after = await f.account('state');
  assert.equal(after.native.phase, 'idle');
  assert.equal(after.native.turnSequence, before.turnSequence);
  assert.equal((await f.account('confirmations', { id: '00000000-0000-0000-0000-000000000001' })).count, 0);
  const second = await f.account('submit', { id: randomUUID(), text: 'after compaction', deferMs: 1000 });
  assert.equal(second.kind, 'confirmed');
});

test('a native Claude approval vetoes an idle-looking composer before paste or Enter', async t => {
  const f = await setup(t);
  await f.hook({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
  const state = await f.account('state');
  assert.equal(state.screen.kind, 'idle');
  assert.equal(state.userPrompt.kind, 'awaiting-approval');
  assert.equal(state.userPrompt.source, 'native');
  assert.equal(state.ready, false);
  const refused = await f.account('submit', { id: randomUUID(), text: 'held' });
  assert.deepEqual(refused, { kind: 'refused', code: 'awaiting-approval' });
  assert.deepEqual(f.writes, []);
  await f.hook({ hook_event_name: 'PostToolUse', tool_name: 'Bash' });
  await f.hook({ hook_event_name: 'Stop' });
  assert.equal((await f.account('submit', { id: randomUUID(), text: 'after approval' })).kind, 'confirmed');
});

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

test('Claude submits its matching collapsed paste once and holds a mismatched line count', async t => {
  const captured = await readFile(new URL('../tasks/PILOT-FIX-2/claude-collapsed-paste.txt', import.meta.url), 'utf8');
  for (const [screen, shouldSubmit] of [[captured, true], [captured.replace('+6 lines', '+5 lines'), false]]) {
    const f = await setup(t, { collapsedScreen: screen, firstEnter: 'held' });
    const id = randomUUID();
    const text = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'].join('\n');
    const sent = await f.account('submit', { id, text, timeoutMs: 50 });
    assert.equal(sent.kind, 'unconfirmed');
    assert.equal(sent.hostReceipt.outcome, shouldSubmit ? 'verified-collapsed-paste' : 'draft-unverified');
    await sleep(1250);
    assert.equal((await f.account('state')).blocker, 'draft-held');
    assert.equal(f.writes.filter(bytes => bytes === '\r').length, shouldSubmit ? 1 : 0);
  }
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
  assert.equal(result.hostReceipt.outcome, 're-enter');
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

test('a Claude question that appears after Enter vetoes re-enter while the draft is still visible', async t => {
  const f = await setup(t, { firstEnter: 'question' });
  const id = randomUUID();
  assert.equal((await f.account('submit', { id, text: 'leave the selection alone', timeoutMs: 1700 })).kind, 'unconfirmed');
  assert.equal((await f.account('state')).screen.kind, 'permission');
  assert.equal(f.writes.filter(value => value === '\r').length, 1);
});
