import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function makeProject() {
  const dir = mkdtempSync(join(tmpdir(), 'loom-acct-store-'));
  mkdirSync(join(dir, '.project', 'loomd'), { recursive: true });
  return dir;
}

test('readAccounts returns empty snapshots when accounts.json is absent', async () => {
  const project = makeProject();
  try {
    const { readAccounts } = await import('./accounts.mjs');
    const data = readAccounts(project, { now: () => Date.parse('2026-11-26T15:00:00Z') });
    assert.equal(data.version, 1);
    assert.deepEqual(data.snapshots, []);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('createAccountStore persists snapshots, disambiguates colliding masked emails, and strips account_ref from public reads', async () => {
  const project = makeProject();
  try {
    const { accountStaleMs, createAccountStore, readAccounts, accountsPath } = await import('./accounts.mjs');
    assert.equal(accountStaleMs, 7_200_000);
    let nowMs = Date.parse('2026-11-26T15:00:00Z');
    const store = createAccountStore(project, { now: () => nowMs });

    store.observe([
      {
        cli: 'codex',
        masked_account: 'c***@fixture-mail-1.test',
        account_ref: 'ref-acct-1',
        plan: 'pro',
        limit_id: 'codex',
        bucket: 'primary',
        scope: 'account',
        used_percent: 58,
        window_minutes: 10080,
        resets_at: '2026-12-03T07:00:00.000Z',
        source: 'codex-rollout',
        observed_at: '2026-11-26T14:50:00.000Z',
      },
      {
        cli: 'codex',
        masked_account: 'c***@fixture-mail-1.test',
        account_ref: 'ref-acct-2',
        plan: 'pro',
        limit_id: 'codex',
        bucket: 'primary',
        scope: 'account',
        used_percent: 12,
        window_minutes: 10080,
        resets_at: '2026-12-03T07:00:00.000Z',
        source: 'codex-rollout',
        observed_at: '2026-11-26T14:55:00.000Z',
      },
    ]);

    const raw = JSON.parse(readFileSync(accountsPath(project), 'utf8'));
    assert.equal(raw.version, 1);
    assert.equal(raw.snapshots.length, 2, 'distinct account_ref with same masked_account must not collide');

    const pub = readAccounts(project, { now: () => nowMs });
    assert.equal(pub.snapshots.length, 2);
    for (const snap of pub.snapshots) {
      assert.equal(Object.hasOwn(snap, 'account_ref'), false, 'public JSON must omit internal account_ref');
      assert.equal(snap.stale, false);
    }

    // Advance 1 hour (age 1h5m-1h10m <= 2h default threshold) -> still fresh
    nowMs += 3_600_000;
    const oneHourPub = readAccounts(project, { now: () => nowMs });
    assert.ok(oneHourPub.snapshots.every(s => s.stale === false));

    // Advance another 1 hour (age 2h5m-2h10m > 2h default threshold) -> stale becomes true
    nowMs += 3_600_000;
    const stalePub = readAccounts(project, { now: () => nowMs });
    assert.ok(stalePub.snapshots.every(s => s.stale === true));
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('createAccountStore preserves other buckets on partial update, rejects older reset cycles, and never wipes on empty observe', async () => {
  const project = makeProject();
  try {
    const { createAccountStore, readAccounts } = await import('./accounts.mjs');
    const nowMs = Date.parse('2026-11-26T15:00:00Z');
    const store = createAccountStore(project, { now: () => nowMs });

    store.observe([
      {
        cli: 'claude',
        masked_account: 'b***@fixture-mail-2.test',
        account_ref: 'ref-claude-1',
        plan: 'max_5x',
        limit_id: 'default',
        bucket: 'five_hour',
        scope: 'account',
        used_percent: 40,
        window_minutes: 300,
        resets_at: '2026-11-26T17:00:00.000Z',
        source: 'claude-cli',
        observed_at: '2026-11-26T14:50:00.000Z',
      },
      {
        cli: 'claude',
        masked_account: 'b***@fixture-mail-2.test',
        account_ref: 'ref-claude-1',
        plan: 'max_5x',
        limit_id: 'default',
        bucket: 'seven_day',
        scope: 'account',
        used_percent: 15,
        window_minutes: 10080,
        resets_at: '2026-12-02T17:00:00.000Z',
        source: 'claude-cli',
        observed_at: '2026-11-26T14:50:00.000Z',
      },
    ]);

    // Partial update for five_hour only -> seven_day preserved
    store.observe([
      {
        cli: 'claude',
        masked_account: 'b***@fixture-mail-2.test',
        account_ref: 'ref-claude-1',
        plan: 'max_5x',
        limit_id: 'default',
        bucket: 'five_hour',
        scope: 'account',
        used_percent: 55,
        window_minutes: 300,
        resets_at: '2026-11-26T17:00:00.000Z',
        source: 'claude-headless',
        observed_at: '2026-11-26T14:55:00.000Z',
      },
    ]);

    // Older reset cycle or older timestamp must be rejected
    store.observe([
      {
        cli: 'claude',
        masked_account: 'b***@fixture-mail-2.test',
        account_ref: 'ref-claude-1',
        plan: 'max_5x',
        limit_id: 'default',
        bucket: 'five_hour',
        scope: 'account',
        used_percent: 99,
        window_minutes: 300,
        resets_at: '2026-11-26T12:00:00.000Z',
        source: 'claude-transcript',
        observed_at: '2026-11-26T14:59:00.000Z',
      },
    ]);

    // Empty observe must not clear existing snapshots
    store.observe([]);

    const pub = readAccounts(project, { now: () => nowMs });
    assert.equal(pub.snapshots.length, 2);
    assert.equal(pub.snapshots.find(s => s.bucket === 'five_hour').used_percent, 55);
    assert.equal(pub.snapshots.find(s => s.bucket === 'seven_day').used_percent, 15);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

const passiveWindow = {
  cli: 'codex',
  account_ref: 'fixture-codex',
  masked_account: 'c***@example.com',
  plan: 'pro',
  limit_id: 'codex',
  bucket: 'primary',
  scope: 'account',
  used_percent: 58,
  window_minutes: 300,
  resets_at: '2026-11-26T17:00:00.000Z',
  source: 'codex-rollout',
  observed_at: '2026-11-26T14:50:00.000Z',
};

test('version rejection persists separately and preserves the previous window numbers and evidence', async t => {
  const project = makeProject();
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const { accountsPath, createAccountStore } = await import('./accounts.mjs');
  const options = { now: () => Date.parse('2026-11-26T15:00:00Z') };
  const store = createAccountStore(project, options);
  store.observe([passiveWindow]);
  const diagnostic = {
    cli: 'codex', status: 'unsupported', reason: 'unsupported-version-shape',
    cliVersion: '999.0.0', source: 'codex-app-server-push',
    observedAt: '2026-11-26T14:59:00.000Z', accountRef: passiveWindow.account_ref,
  };
  store.observeDiagnostics([diagnostic]);

  const { snapshots, diagnostics } = JSON.parse(readFileSync(accountsPath(project), 'utf8'));
  assert.deepEqual(diagnostics, [diagnostic]);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].used_percent, passiveWindow.used_percent);
  assert.equal(snapshots[0].source, passiveWindow.source);
  assert.equal(snapshots[0].observed_at, passiveWindow.observed_at);

  const { accounts } = createAccountStore(project, options).read();
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].windows.length, 1);
  const [window] = accounts[0].windows;
  assert.equal(window.usedPercent, passiveWindow.used_percent);
  assert.equal(window.source, passiveWindow.source);
  assert.equal(window.observedAt, passiveWindow.observed_at);
});

test('fresh passive evidence takes precedence over a newer on-demand reading until it becomes stale', async t => {
  const project = makeProject();
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const { createAccountStore } = await import('./accounts.mjs');
  let time = Date.parse('2026-11-26T15:00:00Z');
  const store = createAccountStore(project, { now: () => time, staleMs: 3_600_000 });
  const refreshed = { ...passiveWindow, source: 'codex-app-server', used_percent: 70 };
  store.observe([passiveWindow]);
  store.observe([{ ...refreshed, observed_at: '2026-11-26T14:59:00.000Z' }]);
  const readWindow = () => store.read().accounts[0].windows[0];
  assert.equal(readWindow().usedPercent, passiveWindow.used_percent);
  assert.equal(readWindow().source, passiveWindow.source);
  assert.equal(readWindow().observedAt, passiveWindow.observed_at);
  assert.equal(readWindow().stale, false);

  time += 3_600_000;
  store.observe([{ ...refreshed, observed_at: new Date(time).toISOString() }]);
  assert.equal(readWindow().usedPercent, refreshed.used_percent);
  assert.equal(readWindow().source, refreshed.source);
  assert.equal(readWindow().observedAt, new Date(time).toISOString());
  assert.equal(readWindow().stale, false);
});

test('quota and auth incidents override replayed usage for the affected account only', async t => {
  const project = makeProject();
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const { createAccountStore, readAccounts } = await import('./accounts.mjs');
  const now = () => Date.parse('2026-11-26T15:00:00Z');
  const store = createAccountStore(project, { now });
  const authWindow = { ...passiveWindow, account_ref: 'fixture-auth', masked_account: 'a***@example.com' };
  const unaffected = { ...passiveWindow, account_ref: 'fixture-other', masked_account: 'o***@example.com' };
  const since = '2026-11-26T14:55:00.000Z';
  const reset = '2026-11-26T17:05:00.000Z';
  const observations = [passiveWindow, authWindow, unaffected];
  store.observe(observations);
  store.observeIncidents([
    { cli: 'codex', account_ref: passiveWindow.account_ref, status: 'quota-wait',
      limit_id: passiveWindow.limit_id, bucket: passiveWindow.bucket, resets_at: reset, observed_at: since },
    { cli: 'codex', account_ref: authWindow.account_ref, status: 'auth-expired', observed_at: since },
  ]);
  store.observe(observations.map(item => ({ ...item, observed_at: '2026-11-26T14:54:00.000Z' })));

  const { accounts } = readAccounts(project, { now });
  const account = observation => accounts.find(item => item.accountMasked === observation.masked_account);
  const window = account(passiveWindow).windows[0];
  assert.equal(window.status, 'quota-wait');
  assert.equal(window.usedPercent, null);
  assert.equal(window.resetsAt, reset);
  assert.equal(window.source, 'runtime-error');
  assert.equal(window.observedAt, since);
  assert.equal(account(authWindow).status, 'auth-expired');
  assert.equal(account(authWindow).windows[0].usedPercent, null);
  assert.equal(account(unaffected).windows[0].usedPercent, unaffected.used_percent);
});
