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

const pageText = (page, width, options = {}) => boardLines(project, { board }, { page, now, width, ...options }).join('\n');

for (const width of [80, 120, 200]) {
  test(`--once plain text snapshot at ${width} columns`, async t => {
    const output = await capture(width);
    const workers = pageText(1, width);
    const gates = pageText(2, width);
    const notices = pageText(3, width);
    const cost = pageText(4, width);
    assert.doesNotMatch(output, /\x1b|herdr-tab-|aaaaaaaa-bbbb|索引|gate-cell-smoke|Claude\/GPT 周|refused 11/i);
    assert.match(output, /Health · 3 项待处理/);
    assert.match(output, /Workers · 2 active · 1 idle · 1 released/);
    assert.match(output, /38%.*1234abcd/);
    assert.match(output, /≈52%/);
    assert.match(workers, /W2-TUI-17.*bead0002/);
    assert.match(workers, /释放于 8m.*claude·sonnet.*DONE/);
    assert.doesNotMatch(workers, /已释放任务|Ended fixture|oar-bead/);
    assert.match(gates, /gate-cell-smoke-042 +2 +\[PASS\][^\n]*\n[^\n]*回归用例通过/);
    assert.match(gates, /gate-cell-smoke-042 +1 +\[REJECT\]/);
    assert.match(gates, /gate-cell-rollout-043 +2 +Pending +Auditor/);
    assert.doesNotMatch(gates, /received/);
    assert.match(notices, /1m ago +Decision +需要决定[\s\S]*2m ago +Info +投递回复 +Auditor +Read[\s\S]*7m ago +Alert +投递停滞/);
    assert.match(notices, /×3/);
    assert.match(notices, /4 routine delivery receipts/);
    assert.doesNotMatch(notices, /Pyramid inverted|Tool output share warning/i);
    assert.match(cost, /warming up/);
    assert.match(cost, /Claude\/GPT 周/);
    assert.match(cost, /▕[█░]*│[█░]*▏.*59% used.*~ on pace/);
    assert.match(cost, /66% used.*↑ ahead/);
    assert.match(cost, /stale · data 3h03m old/);
    assert.match(cost, /⟲3 reset credits/);
    const pages = [output, workers, gates, notices, cost];
    assert.equal(pages.every(page => page.split('\n').every(line => widthOf(line) <= width)), true);
    const roleTitles = output.split('\n').find(line => line.includes(' Leader '));
    assert.equal(roleTitles.includes(' Auditor '), width >= 100);
    t.assert.snapshot(pages.join('\n\n'));
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
  assert.match(boardLines(project, { board: { ...board, accounts: undefined } }, { now, page: 4 }).join('\n'),
    /Waiting for loom accounts snapshots/);
});

test('both cost signals appear after all three roles cross the sample floor', () => {
  const ready = structuredClone(board);
  ready.pyramids[0].byRole.leader.modelCalls = 3;
  ready.pyramids[0].byRole.worker.modelCalls = 3;
  const output = boardLines(project, { board: ready }, { page: 3, now, width: 100 }).join('\n');
  assert.match(output, /成本金字塔/);
  assert.match(output, /工具输出占比/);
  assert.doesNotMatch(output, /warming up/);
});

test('the Notices tab also filters routine receipts from older board snapshots', () => {
  const legacy = { ...board, notifications: { count: 2, last: [
    { type: 'super-delivery-receipt', at: now, text: 'Legacy routine receipt' },
    { type: 'super-delivery-receipt', reason: 'refused', at: now - 60_000, text: 'Delivery refused' },
  ] } };
  const output = boardLines(project, { board: legacy }, { now, page: 3 }).join('\n');
  assert.match(output, /Super notices · 2/);
  assert.match(output, /1m ago +Alert +投递失败.*Delivery refused/);
  assert.doesNotMatch(output, /Legacy routine receipt/);
});

test('worker view shows warm retention, context, verdict and per-gate metrics', () => {
  const sample = { ...board, workers: [{ ...board.workers[0], state: 'idle-warm', contextPercent: 37, lastResultTag: 'DONE',
    retention: { remainingMs: 93_000 } }, { ...board.workers[1], state: 'closed', retention: {} }],
  workerMetrics: [{ gate: 'TEST', newSpawns: 2, revives: 1, closed: 1, ttl: 1, coldRevives: 1,
    coldRevivesMeasured: 1, coldReviveTokens: 150 }] };
  const workers = boardLines(project, { board: sample }, { page: 1, now, width: 100, showEnded: true }).join('\n');
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
  const closed = statusTui({ project }, { input, output, rpc: async () => ({ ...board, attention: [] }), now: () => now, env: { NO_COLOR: '' } });
  t.after(() => { input.end(); });
  await ready;
  assert.doesNotMatch(frames, /\x1b\[\d+(?:;\d+)*m/);
  let emitted = key('return');
  assert.match(emitted, /herdr-tab-leader-12345/);
  assert.match(emitted, /aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/);
  assert.match(emitted, /\/fixture\/织布工程\/leader\/fixture.jsonl/);
  key('escape');
  assert.match(key('3', '3'), /\[3 Gates\]/);
  key('down');
  assert.match(key('return'), /完整门禁裁决第二行。/);
  assert.match(stripVTControlCharacters(frames), /gate-042.full.md/);
  key('escape');
  assert.match(key('2', '2'), /\[2 Workers\]/);
  key('down');
  emitted = key('return');
  assert.match(emitted, /oar-bead0002-0000-4000-8000-000000000002/);
  key('escape');
  assert.match(key(undefined, '?'), /1–5 \/ ←→ or click.*Switch tabs/);
  key('q');
  await closed;
  assert.equal(input.isRaw, false);
  assert.match(frames, /\x1b\[\?1000l\x1b\[\?1006l/);
});


test('Board empty state and worker history expose the right scope', () => {
  const healthy = { ...board, attention: [] };
  const summary = boardLines(project, { board: healthy }, { now, width: 80 }).join('\n');
  assert.match(summary, /一切正常/);
  assert.doesNotMatch(summary, /refused 11/);
  const workers = pageText(1, 80, { showEnded: true });
  assert.match(workers, /released.*BLOCKED/);
  assert.match(workers, /ended.*FAILED/);
});

test('fragmented mouse reports select tabs and rows, open details and scroll', { timeout: 3000 }, async t => {
  const input = new PassThrough();
  const output = new PassThrough();
  Object.assign(input, { isTTY: true, isRaw: false, setRawMode(mode) { this.isRaw = mode; } });
  Object.assign(output, { isTTY: true, columns: 120, rows: 24 });
  const extended = { ...board, workers: [...board.workers, ...Array.from({ length: 30 }, (_, i) => ({
    task: 'Wheel worker ' + String(i + 1).padStart(2, '0'), addr: 'extra-worker-' + i, state: 'busy',
    wave: 'W2-TUI-17', cli: 'codex', model: 'sol', startedAt: now - 1000,
  }))] };
  let frames = '';
  let connected;
  const ready = new Promise(resolve => { connected = resolve; });
  output.on('data', chunk => {
    frames += chunk;
    if (frames.includes('online')) connected();
  });
  const closed = statusTui({ project }, { input, output, rpc: async () => extended, now: () => now, env: { NO_COLOR: '' } });
  t.after(() => { input.end(); });
  await ready;
  assert.match(frames, /\x1b\[\?1006h\x1b\[\?1000h/);
  const yOf = (page, value) => boardLines(project, { board: extended }, { page, now, width: 120 })
    .findIndex(line => line.includes(value)) + 1;
  const click = (x, y, code = 0, suffix = 'M') => input.write(`\x1b[<${code};${x};${y}${suffix}`);

  frames = '';
  const areas = yOf(0, 'Workers · 32 active');
  assert.ok(areas > 0 && areas < 24);
  input.write('\x1b');
  input.write(`[<0;5;${areas}M`);
  assert.match(frames, /\[2 Workers\]/);
  const y = yOf(1, 'bead0002');
  frames = '';
  click(10, y);
  assert.match(frames, /› /);
  assert.doesNotMatch(frames, /oar-bead0002/);
  click(10, y, 0, 'm');
  assert.doesNotMatch(frames, /oar-bead0002/);
  click(10, y);
  assert.match(frames, /oar-bead0002-0000-4000-8000-000000000002/);
  input.write('\x1b');
  await new Promise(resolve => setTimeout(resolve, 60));
  frames = '';
  click(10, y, 65);
  assert.match(frames, /Wheel worker (?:1[4-9]|2\d)/);

  frames = '';
  click(26, 4);
  assert.match(frames, /\[3 Gates\]/);
  const verdict = yOf(2, '回归用例通过');
  click(12, verdict);
  input.write('\r');
  assert.match(frames, /完整门禁裁决第二行。/);
  input.write('q');
  await closed;
  assert.match(frames, /\x1b\[\?1000l\x1b\[\?1006l/);
  assert.equal(input.isRaw, false);
});

test('Status TUI highlights unconfined host workers on Board, Workers and detail views', async () => {
  const { boardView } = await import('./status-view.mjs');
  const withUnconfined = structuredClone(board);
  withUnconfined.workers.push(
    { task: 'HOST-DEF', addr: 'oar-dead0001-0000-4000-8000-000000000001', state: 'working', wave: 'W-HOST',
      cli: 'agy', model: 'neon', startedAt: now - 1000, workerTier: 'host' },
    { task: 'HOST-UNC', addr: 'oar-dead0002-0000-4000-8000-000000000002', state: 'working', wave: 'W-HOST',
      cli: 'agy', model: 'neon', startedAt: now - 1000, workerTier: 'host', unconfined: true },
  );
  const summary = boardLines(project, { board: withUnconfined }, { page: 0, now, width: 120 }).join('\n');
  assert.match(summary, /1 unconfined/);
  const workersPage = boardLines(project, { board: withUnconfined }, { page: 1, now, width: 120 }).join('\n');
  assert.match(workersPage, /\[host\] HOST-DEF/);
  assert.match(workersPage, /\[host\/unconfined\] HOST-UNC/);
  const view = boardView(project, { board: withUnconfined }, { page: 1, now, width: 120 });
  const item = view.body.flatMap(line => line.items ?? []).find(entry => entry?.id === 'worker:oar-dead0002-0000-4000-8000-000000000002');
  assert.ok(item);
  assert.deepEqual(item.fields.find(([label]) => label === 'Tier'), ['Tier', 'host/unconfined']);
});
