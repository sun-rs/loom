import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { snapshot, test } from 'node:test';
import { stripVTControlCharacters } from 'node:util';
import { board, now, project } from '../tasks/TUI-STATUS-2/fixtures/board.mjs';
import { accountRows } from './status-accounts.mjs';
import { changedLines, meter, terminalColors, theme, truncate, widthOf, wrap } from './status-layout.mjs';
import { boardLines, statusTui } from './status-tui.mjs';

snapshot.setDefaultSnapshotSerializers([value => value]);

async function capture(width) {
  let output = '';
  await statusTui({ project, once: true }, {
    now: () => now, env: { COLUMNS: String(width), COLORTERM: 'truecolor' }, rpc: async () => board,
    input: { isTTY: true }, output: { isTTY: true, write: text => { output += text; } },
  });
  return output;
}

for (const width of [80, 100, 140]) {
  test(`--once plain text snapshot at ${width} columns`, async t => {
    const output = await capture(width);
    assert.doesNotMatch(output, /\x1b|pyramid inverted|Tool output share warning|herdr-tab-|aaaaaaaa-bbbb/i);
    assert.match(output, /warming up/);
    assert.match(output, /Claude\/GPT 周/);
    assert.match(output, /▕[█░]*│[█░]*▏.*59% used.*~ on pace/);
    assert.match(output, /66% used.*↑ ahead/);
    assert.match(output, /stale · data 3h03m old/);
    assert.match(output, /⟲3 reset credits/);
    assert.equal(output.split('\n').some(line => widthOf(line) > width), false);
    const roleTitles = output.split('\n').find(line => line.includes(' Leader '));
    assert.equal(roleTitles.includes(' Auditor '), width >= 100);
    t.assert.snapshot(output);
  });
}

test('layout wraps by word, measures CJK, and preserves whole emoji', () => {
  assert.equal(truncate('索引👩🏽‍💻XYZ', 7), '索引👩🏽‍💻…');
  assert.equal(truncate('索引👩🏽‍💻XYZ', 6), '索引…');
  assert.deepEqual(wrap('hello world 测试 👩🏽‍💻', 10), ['hello', 'world 测试', '👩🏽‍💻']);
  assert.deepEqual(wrap('ab superlongword', 7), ['ab supe', 'rlongwo', 'rd']);
  assert.deepEqual(wrap('👩🏽‍💻', 1), ['…']);
  assert.equal(meter(50, 6, theme(), { pace: 0 }), '▕│██░░░▏');
  assert.equal(meter(50, 6, theme(), { pace: 100 }), '▕███░░│▏');
});

test('palette honors NO_COLOR and writes only changed terminal rows', () => {
  const tty = { getColorDepth: () => 8 };
  assert.equal(terminalColors(tty, { NO_COLOR: '', COLORTERM: 'truecolor' }), 1);
  assert.equal(terminalColors(tty, { TERM: 'dumb', COLORTERM: 'truecolor' }), 1);
  assert.equal(terminalColors(tty, { COLORTERM: '24bit' }), 24);
  assert.equal(theme(8)('warn', 'test'), '\x1b[38;5;222mtest\x1b[0m');
  assert.equal(theme(24)('warn', 'test'), '\x1b[38;2;238;185;92mtest\x1b[0m');
  assert.equal(theme(1)('warn', 'test'), 'test');
  assert.equal(changedLines(['same', 'old', 'same', 'stale'], ['same', 'new', 'same']), '\x1b[2;1H\x1b[2Knew\x1b[4;1H\x1b[2K');
  assert.equal(changedLines(['same'], ['same']), '');
});

test('account data shows unknowns and protects the account label', () => {
  const unmasked = ['unsafe', 'example.test'].join('@');
  const document = { accounts: [{ cli: 'test', accountMasked: unmasked, windows: [
    { label: '5h', usedPercent: null, source: 'fixture', observedAt: null, resetsAt: null },
  ] }] };
  const text = accountRows(document, 80, now, theme()).map(line => line.text).join('\n');
  assert.equal(text.includes(unmasked), false);
  assert.match(text, /used % unknown.*reset unknown.*R refresh/);
  assert.match(boardLines(project, { board: { ...board, accounts: undefined } }, { now }).join('\n'),
    /Waiting for loom accounts snapshots/);
});

test('both cost signals appear after all three roles cross the sample floor', () => {
  const ready = structuredClone(board);
  ready.pyramids[0].byRole.leader.modelCalls = 3;
  ready.pyramids[0].byRole.worker.modelCalls = 3;
  const output = boardLines(project, { board: ready }, { now, width: 100 }).join('\n');
  assert.match(output, /consumption-pyramid/);
  assert.match(output, /senior-tool-output-share/);
  assert.doesNotMatch(output, /warming up/);
});

test('worker view shows warm retention, context, verdict and per-gate metrics', () => {
  const sample = { ...board, workers: [{ ...board.workers[0], state: 'idle-warm', contextPercent: 37, lastResultTag: 'DONE',
    retention: { remainingMs: 93_000 } }, { ...board.workers[1], state: 'closed', retention: {} }],
  workerMetrics: [{ gate: 'TEST', newSpawns: 2, revives: 1, closed: 1, ttl: 1, coldRevives: 1,
    coldRevivesMeasured: 1, coldReviveTokens: 150 }] };
  const workers = boardLines(project, { board: sample }, { page: 1, now, width: 100 }).join('\n');
  assert.match(workers, /idle-warm.*93s.*37%.*DONE/);
  assert.match(workers, /closed/);
  assert.match(workers, /TEST · new 2 · revived 1 · closed 1 · TTL offline 1 · cold 150 tokens/);
});

test('interactive tabs and keyboard selection open details with the full values', { timeout: 2000 }, async t => {
  const input = new PassThrough();
  const output = new PassThrough();
  Object.assign(input, { isTTY: true, isRaw: false, setRawMode(mode) { this.isRaw = mode; } });
  Object.assign(output, { isTTY: true, columns: 100, rows: 30, getColorDepth: () => 24 });
  let frames = '';
  let connected;
  const ready = new Promise(resolve => { connected = resolve; });
  output.on('data', chunk => {
    frames += chunk;
    if (frames.includes('online')) connected();
  });
  const key = (name, text = '') => {
    frames = '';
    input.emit('keypress', text, { name });
    return stripVTControlCharacters(frames);
  };
  const closed = statusTui({ project }, { input, output, rpc: async () => board, now: () => now, env: { NO_COLOR: '' } });
  t.after(() => { input.end(); });
  await ready;
  assert.doesNotMatch(frames, /\x1b\[\d+(?:;\d+)*m/);
  let emitted = key('return');
  assert.match(emitted, /herdr-tab-leader-12345/);
  assert.match(emitted, /aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/);
  assert.match(emitted, /\/fixture\/织布工程\/leader\/fixture.jsonl/);
  key('escape');
  assert.match(key('3', '3'), /\[3 Gates\]/);
  assert.match(key('return'), /完整门禁裁决第二行。/);
  key('escape');
  assert.match(key('2', '2'), /\[2 Workers\]/);
  key('down');
  emitted = key('return');
  assert.match(emitted, /bead0002-worker/);
  key('escape');
  assert.match(key(undefined, '?'), /1–5 \/ ←→.*Switch tabs/);
  key('q');
  await closed;
  assert.equal(input.isRaw, false);
});
