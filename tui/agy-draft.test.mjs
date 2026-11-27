import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import xterm from '@xterm/headless';
import { AGENT_PROMPT_BRACKETED_PASTE_END, AGENT_PROMPT_BRACKETED_PASTE_START, submitComposer } from './agent-input.mjs';
import { draftExpectation, verifyDraft } from './composer-draft.mjs';
import { readGrid } from './pty-grid.mjs';

const captures = JSON.parse(readFileSync(new URL('../tasks/PILOT-FIX-3/agy-wrapped-drafts.json', import.meta.url)));
const pilot = JSON.parse(readFileSync(new URL('../tasks/DRAFT-HOLD-2/agy-pilot-frame.json', import.meta.url)));

async function rendered({ text, cols, rows, cursor }, provider = 'agy') {
  const grid = new xterm.Terminal({ cols, rows, allowProposedApi: true });
  try {
    const placeCaret = cursor ? `\x1b[${cursor.y + 1};${cursor.x + 1}H` : '';
    await new Promise(resolve => grid.write(text.replaceAll('\n', '\r\n') + placeCaret, resolve));
    return readGrid(grid, provider);
  } finally { grid.dispose(); }
}

test('the shared verifier uses Claude, Codex and OpenCode composer geometry', async () => {
  const capture = JSON.parse(readFileSync(new URL('../tasks/PILOT-FIX-4/claude-wrapped-draft.json', import.meta.url)));
  const claude = await rendered(capture, 'claude');
  assert.notEqual(claude.draft, capture.payload);
  const claudeExpected = draftExpectation(capture.payload);
  assert(verifyDraft(claude, claudeExpected));
  assert.equal(verifyDraft({ ...claude, draft: claude.draft.replace('only OK', 'only NO') }, claudeExpected), undefined);
  const id = '573ebc57-bf18-4936-940f-ed39b44f1dd3';
  const expected = draftExpectation(`[loom:${id}]\nhello world`);
  const codex = await rendered({ cols: 80, rows: 12,
    text: `› [loom:${id}]\n  hello\n  world\n  gpt-6.2-sol low · /test` }, 'codex');
  const openCodeFooters = ['loom · test · OpenCode · ctrl+p menu', 'loom · test · ctrl+p menu',
    'Press esc again to interrupt'];
  const openCodeDrafts = await Promise.all(openCodeFooters.map(footer => rendered({ cols: 80, rows: 12,
    text: `┃ [loom:${id}]\n┃ hello\n┃ world\n\n${footer}` }, 'opencode')));
  for (const frame of [codex, ...openCodeDrafts]) {
    assert(verifyDraft(frame, expected));
    assert.equal(verifyDraft({ ...frame, draft: frame.draft + ' edit' }, expected), undefined);
  }
  const idle = await rendered({ cols: 80, rows: 12, cursor: { x: 2, y: 0 },
    text: '┃ Ask anything, / for commands, @ for context…\n\nloom · test · ctrl+p menu' }, 'opencode');
  assert.equal(idle.draft, '');
  const placeholder = '┃ Ask anything, / for commands, @ for context…';
  const padded = await rendered({ cols: 80, rows: 12, cursor: { x: 2, y: 0 },
    text: placeholder.padEnd(93) + '\nloom · test · ctrl+p menu' }, 'opencode');
  assert.equal(padded.draft, '');
  const paintedRows = [`┃ [loom:${id}]`, '┃ hello world'].map(row => row.padEnd(79));
  const painted = await rendered({ cols: 80, rows: 12,
    text: [...paintedRows, '', openCodeFooters[0]].join('\n') }, 'opencode');
  assert(verifyDraft(painted, expected));
});

test('the agy capture verifies its wrapped draft and rejects an equal-length edit', async () => {
  const expected = draftExpectation(captures.full.payload);
  const sample = captures.full.frames[1];
  const original = await rendered(sample);
  assert.notEqual(original.draft, captures.full.payload);
  assert.equal(verifyDraft(original, expected).length, expected.normalized.length);
  const edited = await rendered({ ...sample, text: sample.text.replace('Checkpoint 14.', 'Checkpoint Q4.') });
  assert.equal(edited.draft.length, original.draft.length);
  assert.equal(verifyDraft(edited, expected), undefined);
});

test('xterm soft-wrap flags preserve a token that spans two physical rows', async () => {
  const id = '573ebc57-bf18-4936-940f-ed39b44f1dd3';
  const payload = `[loom:${id}]\n${'x'.repeat(110)}\nlast line`;
  const frame = await rendered({ cols: 80, rows: 12,
    text: `────────────\n> [loom:${id}]\n  ${'x'.repeat(110)}\n  last line\n────────────\naccept-edits · Gemini 4 Neon (Low)` });
  assert.equal(frame.draft, payload);
  assert(verifyDraft(frame, draftExpectation(payload)));
});

test('the scrolled capture needs a verified head and measures the full length from visible overlap', async () => {
  const { payload, frames } = captures.scrolled;
  const head = await rendered(frames[0]);
  const scrolled = await rendered(frames[1]);
  const first = verifyDraft(head, draftExpectation(payload.split('\n').slice(0, 10).join('\n')));
  const expectation = draftExpectation(payload);
  assert.equal(scrolled.scrolledDraft.hiddenRows, 10);
  assert.equal(verifyDraft(scrolled, expectation, first).length, expectation.normalized.length);
  assert.equal(verifyDraft(scrolled, expectation), undefined);
  assert.equal(verifyDraft(scrolled, expectation, { ...first, length: first.length - 1 }), undefined);
  const changedTail = await rendered({ ...frames[1], text: frames[1].text.replace('Checkpoint 18.', 'Checkpoint 19.') });
  assert.equal(verifyDraft(changedTail, expectation, first), undefined);
});

test('the agy transaction submits once and leaves a human-typed suffix in the composer', async () => {
  const { payload, frames } = captures.full;
  const readbacks = await Promise.all(frames.map(frame => rendered(frame)));
  for (const human of [false, true]) {
    const before = { draft: '', generation: 0, outputSequence: 0, humanSequence: 0, size: { rows: 120 },
      resizeSequence: 0, buffer: 'normal', bufferSequence: 0, writable: true, quietForMs: 150 };
    const writes = [];
    let frame = before;
    const outcome = await submitComposer(payload, { before, provider: 'agy', read: async () => frame,
      valid: previous => previous.generation === frame.generation, verify: async () => true,
      write(bytes) {
        writes.push(bytes);
        if (!bytes.startsWith(AGENT_PROMPT_BRACKETED_PASTE_START)) return;
        frame = { ...before, ...readbacks[writes.length - 1], generation: writes.length, outputSequence: writes.length };
        if (human && writes.length === 2) frame = { ...frame, humanSequence: 1, draft: frame.draft + ' human suffix' };
      },
    });
    const pasted = writes.filter(bytes => bytes.startsWith(AGENT_PROMPT_BRACKETED_PASTE_START))
      .map(bytes => bytes.slice(AGENT_PROMPT_BRACKETED_PASTE_START.length, -AGENT_PROMPT_BRACKETED_PASTE_END.length));
    assert.equal(pasted.join(''), payload);
    assert.equal(writes.filter(bytes => bytes === '\r').length, human ? 0 : 1);
    assert.equal(outcome.outcome, human ? 'human-or-exit-during-paste' : 'verified-normalized-draft');
  }
});

test('agy submits the 42-column pilot-2 draft even when its first paint already clips the marker', async () => {
  const size = pilot.size;
  const readbacks = await Promise.all(['first', 'final'].map(name => rendered({ ...size, ...pilot.frames[name] })));
  assert.deepEqual(readbacks.map(frame => frame.scrolledDraft?.hiddenRows), [9, 13]);
  for (const changed of [false, true]) {
    const before = { draft: '', generation: 0, outputSequence: 0, humanSequence: 0, size,
      resizeSequence: 0, buffer: 'normal', bufferSequence: 0, writable: true, quietForMs: 150 };
    let current = before;
    const writes = [];
    const outcome = await submitComposer(pilot.wire, { before, provider: 'agy', read: async () => current,
      valid: frame => frame === current, verify: async () => true,
      write(bytes) {
        writes.push(bytes);
        if (bytes === '\r') return;
        const painted = readbacks[writes.length - 1];
        const scrolledDraft = changed && writes.length === 2 ?
          { ...painted.scrolledDraft, tail: painted.scrolledDraft.tail.replace('count=2', 'count=3') } : painted.scrolledDraft;
        current = { ...before, ...painted, scrolledDraft, generation: writes.length, outputSequence: writes.length };
      },
    });
    assert.equal(outcome.accepted, !changed);
    assert.deepEqual(writes.map(bytes => Buffer.byteLength(bytes)), changed ? [530, 109] : [530, 109, 1]);
  }
});

test('real agy 1.5.18 startup bytes distinguish startup hints, unknown muted placeholders, and real user drafts', async () => {
  const { providers } = await import('./providers.mjs');
  const startup = JSON.parse(readFileSync(new URL('../tasks/ROT-AGY-2/agy-startup-frames.json', import.meta.url)));
  const replayBytes = async (cols, rows, bytes) => {
    const grid = new xterm.Terminal({ cols, rows, scrollback: 500, allowProposedApi: true });
    try {
      await new Promise(resolve => grid.write(bytes, resolve));
      return readGrid(grid, 'agy');
    } finally { grid.dispose(); }
  };

  // 1. Captured pilot-cell pty-Gi2J8U: empty statusLine footer before AND after paste.
  const gi = startup.pilotGi2J8U;
  const welcome = await replayBytes(gi.cols, gi.rows, gi.welcomeBytes);
  assert.equal(welcome.draft, '');
  assert.equal(providers.agy.screen.classify(welcome.composerText), 'idle');
  assert.equal(providers.agy.screen.hasEmptyComposer(welcome.composerText), true);
  const pasted = await replayBytes(gi.cols, gi.rows, gi.welcomeBytes + gi.afterPasteBytes + gi.asyncBannerBytes);
  assert.ok(pasted.draft.includes(`[loom:${gi.deliveryId}]`));
  assert.equal(providers.agy.screen.hasHeldComposer(pasted.vacantText), true);

  // 2. Live agy 1.5.18 with empty statusLine, Tip footer, and narrow 50-col truncated placeholder.
  for (const sample of [startup.statuslineEmpty, startup.statuslineTip, startup.narrow50]) {
    const before = await replayBytes(sample.cols, sample.rows, sample.welcomeBytes);
    assert.equal(before.draft, '');
    assert.equal(providers.agy.screen.classify(before.composerText), 'idle');
    assert.equal(providers.agy.screen.hasEmptyComposer(before.composerText), true);
    const after = await replayBytes(sample.cols, sample.rows, sample.welcomeBytes + sample.afterInputBytes);
    assert.match(after.draft, /hello from test/);
    assert.equal(providers.agy.screen.hasHeldComposer(after.vacantText), true);
  }

  // 3. Sign-in update needed + Tip + wrapped/unknown muted placeholders are not drafts; unknown hints are flagged.
  const signIn = '⚠ Sign-in update needed\r\n  ⎿  Your sign-in is missing permissions that are now required, so some requests may fail. Run /logout to sign in again.\r\n';
  const withSignIn = await replayBytes(120, 35,
    `\x1b[2J\x1b[H${signIn}${'─'.repeat(120)}\r\n\x1b[94m>\x1b[m \x1b[90mAccept-edits mode: file edits auto-approved (shift+tab to cycle)\x1b[m\r\n${'─'.repeat(120)}\r\nTip: Press esc to cancel\x1b[4;3H`);
  assert.equal(withSignIn.draft, '');
  assert.equal(providers.agy.screen.classify(withSignIn.composerText), 'idle');

  const unknownMuted = await replayBytes(100, 24,
    `\x1b[2J\x1b[HAntigravity CLI 1.6.0\r\n${'─'.repeat(100)}\r\n\x1b[94m>\x1b[m \x1b[90mAsk Antigravity anything or type /help\x1b[m\r\n${'─'.repeat(100)}\r\nNew: Try /fast mode\x1b[3;3H`);
  assert.equal(unknownMuted.draft, '');
  assert.equal(providers.agy.screen.classify(unknownMuted.composerText), 'idle');
  assert.deepEqual(unknownMuted.unknownHints, [
    { kind: 'composer-placeholder', text: 'Ask Antigravity anything or type /help' },
    { kind: 'footer-hint', text: 'New: Try /fast mode' },
  ]);

  const unknownDim = await replayBytes(100, 24,
    `\x1b[2J\x1b[HAntigravity CLI 1.6.0\r\n${'─'.repeat(100)}\r\n\x1b[94m>\x1b[m \x1b[2mType a prompt...\x1b[m\r\n${'─'.repeat(100)}\x1b[3;3H`);
  assert.equal(unknownDim.draft, '');
  assert.equal(providers.agy.screen.classify(unknownDim.composerText), 'idle');
  assert.deepEqual(unknownDim.unknownHints, [{ kind: 'composer-placeholder', text: 'Type a prompt...' }]);

  // Wrapped muted placeholder (42 cols) and torn paint before bottom rule (must not capture history/Sign-in as draft).
  const wrappedMuted = await replayBytes(42, 20,
    `\x1b[2J\x1b[HAntigravity CLI 1.5.18\r\n${'─'.repeat(42)}\r\n\x1b[94m>\x1b[m \x1b[90mAccept-edits mode: file edits auto-approved (shift+tab to cycle)\x1b[m\r\n${'─'.repeat(42)}\x1b[3;3H`);
  assert.equal(wrappedMuted.draft, '');
  assert.equal(providers.agy.screen.classify(wrappedMuted.composerText), 'idle');
  const tornPaint = await replayBytes(80, 20,
    `\x1b[2J\x1b[H${'─'.repeat(60)}\r\n> previous prompt\r\n${signIn}${'─'.repeat(80)}\r\n> `);
  assert.equal(tornPaint.draft, undefined);

  // 4. Real user-typed drafts (captured live bytes + default-fg text + /slash command at col 2) remain drafts.
  const typed = await replayBytes(startup.typedDraft120.cols, startup.typedDraft120.rows, startup.typedDraft120.bytes);
  assert.equal(typed.draft, startup.typedDraft120.expectedDraft);
  const slashHome = await replayBytes(100, 24,
    `\x1b[2J\x1b[H${'─'.repeat(100)}\r\n\x1b[94m>\x1b[m \x1b[94m/help\x1b[m\r\n${'─'.repeat(100)}\x1b[2;3H`);
  assert.equal(slashHome.draft, '/help');
  const plainSameText = await replayBytes(100, 24,
    `\x1b[2J\x1b[H${'─'.repeat(100)}\r\n> Accept-edits mode: file edits auto-approved (shift+tab to cycle)\r\n${'─'.repeat(100)}\x1b[2;3H`);
  assert.equal(plainSameText.draft, 'Accept-edits mode: file edits auto-approved (shift+tab to cycle)');
});
