import test from 'node:test';
import assert from 'node:assert/strict';
import { printStatus } from './status.mjs';
import { boardLines } from './status-tui.mjs';

function captureConsole(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try { fn(); } finally { console.log = orig; }
  return lines.join('\n');
}

test('printStatus displays Accounts short line while preserving live quota-wait and auth-expired incidents untouched', () => {
  const output = captureConsole(() => printStatus({
    project: '/tmp/demo',
    running: true,
    stalledDeliveries: [],
    awaitingUser: [],
    sessionHealth: [
      {
        addr: 'loom-worker-1',
        role: 'worker',
        status: 'quota-wait',
        since: Date.parse('2026-11-26T14:20:00Z'),
        reason: '429 rate limit exceeded',
      },
      {
        addr: 'loom-worker-2',
        role: 'worker',
        status: 'auth-expired',
        since: Date.parse('2026-11-26T14:21:00Z'),
        reason: 'login required',
      },
    ],
    exits: [],
    suppressedReplies: [],
    sessions: [],
    waves: [],
    pendingContinuations: [],
    cards: [],
    blocked: [],
    notices: [],
    merges: [],
    rotations: [],
    rotationsToday: {},
    workerMetrics: [],
    rotationNotices: [],
    seniorTools: [],
    routing: { filtered: [] },
    cost: { rawTokens: 0, byRole: {}, usageByRole: {}, pyramid: { state: 'ok', inversions: [] }, missingSessions: 0 },
    accounts: [
      {
        cli: 'codex',
        accountMasked: 'a***@example.com',
        plan: 'pro',
        windows: [{ label: '5h', usedPercent: 58, resetsAt: '2026-12-03T07:00:00.000Z', stale: true }],
      },
    ],
  }));

  assert.ok(output.includes('Accounts ·'), 'printStatus must include Accounts short line');
  assert.ok(output.includes('a***@example.com'));
  assert.ok(output.includes('58%'));
  assert.ok(output.includes('Quota and authentication ·'), 'live Quota and authentication section must remain');
  assert.ok(output.includes('quota-wait'), 'stale account snapshot must never override live quota-wait');
  assert.ok(output.includes('auth-expired'), 'stale account snapshot must never override live auth-expired');
});

test('boardLines renders Accounts section in Status TUI and stays compatible with legacy boards lacking accounts', () => {
  const baseBoard = {
    roles: [],
    workers: [],
    delivery: { counts: { pending: 0 }, oldestAgeMs: null },
    gates: [],
    notifications: { count: 0, last: [] },
    pyramids: [],
    release: { id: 'rel-1', root: '/tmp/rel', cli: '/tmp/cli', warnings: [] },
  };

  // Legacy board without accounts must not throw
  const legacyLines = boardLines('/tmp/demo', { board: baseBoard });
  assert.ok(legacyLines.length > 0);

  // Board with accounts renders Accounts section
  const withAccounts = boardLines('/tmp/demo', {
    board: {
      ...baseBoard,
      accounts: { accounts: [
        {
          cli: 'claude',
          accountMasked: 'b***@fixture-mail-2.test',
          plan: 'max_5x',
          windows: [{ label: '5h', kind: '5h', usedPercent: 87, resetsAt: '2026-11-26T17:00:00.000Z', versionStatus: 'unverified' }],
        },
      ] },
    },
  }, { page: 4 }).join('\n');

  assert.ok(withAccounts.includes('Accounts'), 'Status TUI boardLines must render Accounts section');
  assert.ok(withAccounts.includes('b***@fixture-mail-2.test'));
  assert.ok(withAccounts.includes('87%'));
  assert.match(withAccounts, /unverified version/);
});
