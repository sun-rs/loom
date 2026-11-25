import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import xterm from '@xterm/headless';
import { AGENT_PROMPT_BRACKETED_PASTE_END, AGENT_PROMPT_BRACKETED_PASTE_START, submitComposer } from './agent-input.mjs';
import { draftExpectation, verifyDraft } from './composer-draft.mjs';
import { readGrid } from './pty-grid.mjs';

const captures = JSON.parse(readFileSync(new URL('../tasks/PILOT-FIX-3/agy-wrapped-drafts.json', import.meta.url)));

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
  const idle = await rendered({ cols: 80, rows: 12,
    text: '┃ Ask anything, / for commands, @ for context…\n\nloom · test · ctrl+p menu' }, 'opencode');
  assert.equal(idle.draft, '');
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
