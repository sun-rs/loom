import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, mkdtempSync, spawnSync } from '../fixtures/test-process.mjs';
import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

function makeProject() {
  const dir = mkdtempSync(join(tmpdir(), 'loom-acct-cli-'));
  mkdirSync(join(dir, '.project', 'loomd'), { recursive: true });
  return dir;
}

const now = () => Date.parse('2026-11-26T15:00:00Z');
const sampleWindow = {
  id: 'codex-weekly',
  label: 'Weekly',
  kind: 'weekly',
  model: null,
  usedPercent: 58,
  windowMinutes: 10080,
  resetsAt: '2026-12-03T15:00:00.000Z',
  source: 'codex-rollout',
  observedAt: '2026-11-26T14:55:00.000Z',
};
const activeAccount = {
  cli: 'codex',
  accountMasked: 'c***@example.com',
  plan: 'pro',
  active: true,
  resetCredits: 2,
  resetCreditsEvidence: { source: 'codex-app-server', observedAt: '2026-11-26T14:53:00.000Z' },
  expiresAt: '2026-12-19T18:28:28.275Z',
  windows: [
    sampleWindow,
    {
      ...sampleWindow,
      id: 'codex-5h',
      label: '5h',
      kind: '5h',
      usedPercent: 20,
      windowMinutes: 300,
      resetsAt: '2026-11-26T17:30:00.000Z',
      observedAt: '2026-11-26T12:00:00.000Z',
    },
  ],
};
const inactiveAccount = {
  ...activeAccount,
  active: false,
  resetCredits: 0,
  expiresAt: '2026-12-26T18:28:28.275Z',
  windows: [{ ...sampleWindow, usedPercent: 12 }],
};
const sampleData = { version: 1, accounts: [activeAccount, inactiveAccount] };

test('running cli/loom.mjs directly emits accounts refresh JSON', () => {
  const project = makeProject();
  try {
    const entry = fileURLToPath(new URL('./loom.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [entry, 'accounts', '--refresh', '--json', '--project', project], {
      encoding: 'utf8',
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout, 'accounts must write JSON to stdout');
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.refreshUnavailable, true);
    assert.deepEqual(output.accounts, []);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('accounts --refresh prints each resolved executable in JSON and text only on refresh', async t => {
  const project = realpathSync(makeProject());
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const { refreshAccounts } = await import('../daemon/account-refresh.mjs');
  const { socketPath } = await import('./project.mjs');
  const executables = {};
  const expected = {};
  for (const cli of ['codex', 'claude', 'agy', 'opencode']) {
    expected[cli] = join(project, cli + '-stub');
    executables[cli] = join(project, cli);
    writeFileSync(expected[cli], '#!/bin/sh\nexit 2\n', { mode: 0o755 });
    symlinkSync(expected[cli], executables[cli]);
  }
  const refresh = await refreshAccounts({ executables, env: { HOME: project, PATH: '' } });
  const server = createServer(socket => socket.once('data', () => {
    socket.end(JSON.stringify({ ok: true, accounts: [], outcomes: refresh.outcomes,
      resolvedExecutables: refresh.resolvedExecutables }));
  }));
  await new Promise((resolve, reject) => server.once('error', reject).listen(socketPath(project), resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const run = (...flags) => promisify(execFile)(process.execPath, [
    fileURLToPath(new URL('./loom.mjs', import.meta.url)), 'accounts', '--project', project, ...flags,
  ]);
  const [json, text, snapshot] = await Promise.all([run('--refresh', '--json'), run('--refresh'), run('--json')]);
  assert.equal(JSON.parse(snapshot.stdout).resolvedExecutables, undefined);
  await t.test('JSON', () => assert.deepEqual(JSON.parse(json.stdout).resolvedExecutables, expected));
  await t.test('text', () => {
    for (const [cli, binary] of Object.entries(expected)) {
      assert.ok(text.stdout.split('\n').includes('可执行文件 · ' + cli + ' · ' + binary));
    }
  });
});

test('runAccounts without --refresh reads cached snapshots only and never invokes RPC', async () => {
  const project = makeProject();
  try {
    const { runAccounts } = await import('./accounts.mjs');
    let rpcCalled = 0;
    const result = await runAccounts(
      { project, json: true, refresh: false },
      {
        readAccounts: () => sampleData,
        request: async () => { rpcCalled += 1; throw new Error('RPC must not be called without --refresh'); },
      },
    );
    assert.equal(rpcCalled, 0);
    assert.equal(result.ok, true);
    assert.deepEqual(result.accounts, sampleData.accounts);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('runAccounts with --refresh calls accounts-refresh RPC once and degrades gracefully when daemon is offline', async () => {
  const project = makeProject();
  try {
    const { runAccounts } = await import('./accounts.mjs');
    const calls = [];
    const online = await runAccounts(
      { project, json: true, refresh: true },
      {
        readAccounts: () => sampleData,
        request: async (dir, cmd) => {
          calls.push([dir, cmd]);
          return { ok: true, accounts: sampleData.accounts, outcomes: { claude: { status: 'ok' } } };
        },
      },
    );
    assert.deepEqual(calls, [[project, 'accounts-refresh']]);
    assert.equal(online.ok, true);
    assert.equal(online.outcomes.claude.status, 'ok');
    assert.deepEqual(online.accounts, sampleData.accounts);

    const offline = await runAccounts(
      { project, json: true, refresh: true },
      {
        readAccounts: () => sampleData,
        request: async () => {
          const err = new Error('ENOENT');
          err.code = 'ENOENT';
          throw err;
        },
      },
    );
    assert.equal(offline.ok, true);
    assert.equal(offline.refreshUnavailable, true);
    assert.deepEqual(offline.accounts, sampleData.accounts);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('accounts JSON groups snapshots by identity and preserves account and model-window fields', async () => {
  const project = makeProject();
  try {
    const { createAccountStore } = await import('../daemon/accounts.mjs');
    const { runAccounts } = await import('./accounts.mjs');
    const store = createAccountStore(project, { now });
    const observation = {
      cli: 'codex',
      masked_account: activeAccount.accountMasked,
      account_ref: 'fixture-a',
      plan: 'pro',
      active: true,
      reset_credits: 2,
      expires_at: activeAccount.expiresAt,
      limit_id: 'codex',
      bucket: 'primary',
      scope: 'account',
      used_percent: 58,
      window_minutes: 10080,
      resets_at: sampleWindow.resetsAt,
      source: activeAccount.resetCreditsEvidence.source,
      observed_at: activeAccount.resetCreditsEvidence.observedAt,
    };
    const passiveObservation = {
      ...observation,
      reset_credits: null,
      source: sampleWindow.source,
      observed_at: sampleWindow.observedAt,
    };
    store.observe([
      observation,
      passiveObservation,
      { ...observation, account_ref: 'fixture-b', active: false, reset_credits: 0,
        expires_at: inactiveAccount.expiresAt, used_percent: 12 },
      { ...passiveObservation, bucket: 'secondary', used_percent: 20, window_minutes: 300,
        resets_at: activeAccount.windows[1].resetsAt },
      { ...observation, cli: 'claude', account_ref: 'fixture-claude', masked_account: 'b***@example.com',
        plan: 'max_5x', reset_credits: null, expires_at: null, limit_id: 'default', bucket: 'seven_day_fable',
        scope: 'model', model: 'Fable', used_percent: 0, source: 'claude-cli' },
      ...[['gemini', 'Gemini Models'], ['3p', 'Claude and GPT models']].flatMap(([id, model]) =>
        [['5h', 300], ['weekly', 10080]].map(([bucket, window_minutes]) => ({
          ...observation, cli: 'agy', account_ref: 'fixture-agy', masked_account: null,
          plan: null, active: null, reset_credits: null, expires_at: null, limit_id: `${id}-${bucket}`,
          bucket, scope: 'pool', model, used_percent: 0, window_minutes, resets_at: null, source: 'agy-cli',
        }))),
    ]);

    const result = await runAccounts({ project, json: true, refresh: false });
    const codex = result.accounts.filter(account => account.cli === 'codex');
    assert.equal(codex.length, 2, 'equal masked addresses must still have separate accounts');
    for (const expected of [activeAccount, inactiveAccount]) {
      const account = codex.find(item => item.active === expected.active);
      assert.ok(account);
      const { windows, resetCreditsEvidence, ...metadata } = expected;
      for (const [field, value] of Object.entries(metadata)) assert.equal(account[field], value, field);
      assert.equal(account.resetCreditsEvidence.source, resetCreditsEvidence.source);
      assert.equal(account.resetCreditsEvidence.observedAt, resetCreditsEvidence.observedAt);
      assert.deepEqual(account.windows.map(window => window.kind).sort(), windows.map(window => window.kind).sort());
    }

    const weekly = codex.find(account => account.active).windows.find(window => window.kind === 'weekly');
    assert.equal(typeof weekly.id, 'string');
    assert.ok(weekly.id.trim());
    assert.equal(typeof weekly.label, 'string');
    assert.ok(weekly.label.trim());
    for (const key of ['kind', 'model', 'usedPercent', 'windowMinutes', 'resetsAt', 'source', 'observedAt']) {
      assert.equal(weekly[key], sampleWindow[key], key);
    }
    const claude = result.accounts.find(account => account.cli === 'claude');
    assert.equal(claude.resetCredits, null);
    assert.equal(claude.expiresAt, null);
    assert.equal(claude.windows[0].kind, 'model');
    assert.equal(claude.windows[0].model, 'Fable');
    assert.equal(claude.windows[0].usedPercent, 0);

    const agy = result.accounts.find(account => account.cli === 'agy');
    assert.equal(agy.active, null);
    assert.equal(agy.accountMasked, null);
    assert.equal(agy.windows.length, 4);
    assert.equal(new Set(agy.windows.map(window => window.id)).size, 4);
    assert.deepEqual(
      agy.windows
        .map(window => [window.kind, window.model, window.windowMinutes])
        .sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]) || a[2] - b[2]),
      [
        ['model', 'Claude and GPT models', 300],
        ['model', 'Claude and GPT models', 10080],
        ['model', 'Gemini Models', 300],
        ['model', 'Gemini Models', 10080],
      ],
    );
    assert.ok(agy.windows.every(window => window.resetsAt === null));
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /account_ref|fixture-a|fixture-b/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('formatAccountsText puts each account and its time-marked meters on one line', async () => {
  const { formatAccountsText } = await import('./accounts.mjs');
  const options = { now, timeZone: 'UTC' };
  const text = formatAccountsText(sampleData, options);
  const rows = text.split('\n').filter(line => line.includes('c***@example.com'));
  assert.equal(rows.length, 2);
  const activeRow = rows.find(line => line.includes('使用中'));
  const inactiveRow = rows.find(line => !line.includes('使用中'));
  assert.ok(activeRow);
  assert.ok(inactiveRow);
  assert.match(activeRow, /codex\s*·\s*pro/i);
  assert.match(activeRow, /2h\s*30m/);
  assert.match(activeRow, /17:30/);
  assert.match(activeRow, /58%/);
  assert.match(activeRow, /20%/);
  assert.match(activeRow, /重置卡\s*2\b/);
  assert.match(inactiveRow, /重置卡\s*0\b/);
  assert.match(activeRow, /有效期.*2026-12-19/);
  assert.match(inactiveRow, /有效期.*2026-12-26/);
  assert.match(text, /数据\s*3\s*小时前.*用 --refresh 刷新/);

  const bars = [...activeRow.matchAll(/\[([█░│]+)\]/g)].map(match => match[1]);
  assert.equal(bars.length, 2);
  assert.equal([...inactiveRow.matchAll(/\[([█░│]+)\]/g)].length, 1);
  const fiveHourMeter = bars.find(bar => bar.indexOf('│') >= (bar.length - 1) / 3);
  assert.ok(fiveHourMeter, 'the five-hour window is halfway through its duration');
  const marker = fiveHourMeter.indexOf('│');
  assert.equal(fiveHourMeter.lastIndexOf('│'), marker);
  assert.ok(Math.abs(marker - (fiveHourMeter.length - 1) / 2) <= 1);
  assert.ok(Math.abs((fiveHourMeter.match(/█/g) ?? []).length - fiveHourMeter.length * 0.2) <= 1);
  const weeklyMeter = bars.find(bar => bar !== fiveHourMeter);
  assert.equal(weeklyMeter.indexOf('│'), 0, 'weekly window is near the start of its duration');
  assert.equal(weeklyMeter.lastIndexOf('│'), 0);
});

test('formatAccountsText offers manual refresh for missing and expired snapshots', async () => {
  const { formatAccountsText } = await import('./accounts.mjs');
  const options = { now, timeZone: 'UTC' };
  assert.match(formatAccountsText({ version: 1, accounts: [] }, options), /暂无快照.*用 --refresh 刷新/);
  const expired = {
    ...sampleWindow,
    resetsAt: '2026-11-26T14:59:00.000Z',
  };
  const text = formatAccountsText({ accounts: [{ ...activeAccount, windows: [expired] }] }, options);
  assert.match(text, /58%/);
  assert.match(text, /数据.*前.*用 --refresh 刷新/);
});

test('accounts distinguishes signed-out, unsupported-version, and stale evidence without guessing usage', async () => {
  const { formatAccountsText } = await import('./accounts.mjs');
  const staleWindow = { ...sampleWindow, observedAt: '2026-11-26T12:00:00.000Z', stale: true };
  const text = formatAccountsText({
    accounts: [{ ...activeAccount, windows: [staleWindow] }],
    outcomes: {
      claude: { status: 'not-signed-in' },
      agy: { status: 'unsupported', reason: 'unsupported-version-shape', version: '999.0.0' },
    },
  }, { now, timeZone: 'UTC' });
  const row = cli => text.split('\n').find(line => line.trim().toLowerCase().startsWith(cli)) ?? '';
  assert.match(row('claude'), /未登录/);
  assert.match(row('agy'), /该版本暂不支持解析/);
  assert.match(row('agy'), /999\.0\.0/);
  assert.doesNotMatch(row('claude'), /%|[█░│]/);
  assert.doesNotMatch(row('agy'), /%|[█░│]/);
  assert.match(row('codex'), /58%/);
  assert.match(row('codex'), /过期/);
});

test('formatAccountsText labels window metrics and reset credits with their own source and observation time', async () => {
  const { formatAccountsText } = await import('./accounts.mjs');
  const text = formatAccountsText({ accounts: [activeAccount] }, { now, timeZone: 'UTC' });
  assert.match(text, /58%.*codex-rollout.*14:55/);
  assert.match(text, /20%.*codex-rollout.*12:00/);
  assert.match(text, /重置卡\s*2\b.*codex-app-server.*14:53/);
});

test('formatAccountsText uses the local date for observed evidence and expiry across UTC midnight', async () => {
  const { formatAccountsText } = await import('./accounts.mjs');
  const evidence = { source: sampleWindow.source, observedAt: '2026-11-26T16:57:14.000Z' };
  const text = formatAccountsText({
    accounts: [{
      ...activeAccount,
      expiresAtEvidence: evidence,
      windows: [{ ...sampleWindow, ...evidence }],
    }],
  }, { now: () => Date.parse('2026-11-26T16:57:19.000Z'), timeZone: 'Asia/Shanghai' });
  assert.match(text, /有效期 2026-12-20 · codex-rollout · 2026-11-27 00:57/);
  assert.match(text, /58%.*codex-rollout · 2026-11-27 00:57/);
});

test('formatAccountsText dates cross-day resets and keeps same-day resets short', async () => {
  const { formatAccountsText } = await import('./accounts.mjs');
  const text = formatAccountsText({
    accounts: [{
      cli: 'codex',
      windows: [
        { ...sampleWindow, resetsAt: '2026-12-02T17:00:00.000Z' },
        { ...activeAccount.windows[1], resetsAt: '2026-11-26T17:00:00.000Z' },
      ],
    }],
  }, { now: () => Date.parse('2026-11-26T16:57:19.000Z'), timeZone: 'Asia/Shanghai' });
  assert.match(text, /Weekly · .* · 重置 12-03 01:00 · codex-rollout/);
  assert.match(text, /5h · .* · 重置 01:00 · codex-rollout/);
});
