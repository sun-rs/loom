import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function makeProject(policy = { preferred: [], deny: [] }) {
  const dir = mkdtempSync(join(tmpdir(), 'loom-acct-notif-'));
  mkdirSync(join(dir, '.project', 'loomd'), { recursive: true });
  writeFileSync(join(dir, '.project', 'policy.json'), JSON.stringify(policy, null, 2), 'utf8');
  return dir;
}

test('policy accounts.warningPercent defaults to 85 and validates range 0..100', async () => {
  const projectDefault = makeProject();
  const projectCustom = makeProject({ preferred: [], deny: [], accounts: { warningPercent: 75 } });
  const projectInvalid = makeProject({ preferred: [], deny: [], accounts: { warningPercent: 120 } });
  try {
    const policyMod = await import('../cli/policy.mjs');
    assert.equal(typeof policyMod.accountWarningPercent, 'function', 'accountWarningPercent must be exported');
    assert.equal(policyMod.accountWarningPercent(projectDefault), 85);
    assert.equal(policyMod.accountWarningPercent(projectCustom), 75);
    assert.throws(() => policyMod.readPolicy(projectInvalid), /warningPercent|accounts/i);
  } finally {
    rmSync(projectDefault, { recursive: true, force: true });
    rmSync(projectCustom, { recursive: true, force: true });
    rmSync(projectInvalid, { recursive: true, force: true });
  }
});

test('passive structural rejection enters the project notification queue for Super', async t => {
  const project = makeProject();
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const { createAccountStore } = await import('./accounts.mjs');
  const { projectNotifications } = await import('./notifications.mjs');
  const observedAt = '2026-11-26T14:59:00.000Z';
  const now = () => Date.parse(observedAt);
  const store = createAccountStore(project, { now });
  const notifications = projectNotifications(project, now);
  store.observeDiagnostics([{
    cli: 'agy', status: 'unsupported', reason: 'unsupported-version-shape',
    cliVersion: '999.0.0', source: 'agy-statusline', observedAt, accountRef: 'fixture-agy',
  }]);

  const pending = store.pendingWarnings();
  assert.equal(pending.length, 1);
  notifications.add(...pending);
  store.ackWarnings(pending.map(event => event.id));

  const delivered = [];
  await notifications.push(batch => {
    delivered.push(...batch);
    return 'managed-super';
  });
  assert.equal(delivered.length, 1);
  const [event] = delivered;
  assert.equal(event.type, 'account-version-unsupported');
  assert.equal(event.reason, 'unsupported-version-shape');
  assert.equal(event.cli, 'agy');
  assert.equal(event.cliVersion, '999.0.0');
  assert.match(event.text, /结构不匹配/);
  assert.doesNotMatch(JSON.stringify(event), /fixture-agy/, 'Super notification must omit internal account identity');
  assert.equal(projectNotifications(project, now).list(project)[0].pushRoute, 'managed-super');
});

test('account-quota-warning fires once per window/reset cycle, re-alerts on next cycle, and skips unknown reset or stale samples', async () => {
  const project = makeProject({ preferred: [], deny: [], accounts: { warningPercent: 85 } });
  try {
    const { createAccountStore } = await import('./accounts.mjs');
    const { projectNotifications } = await import('./notifications.mjs');
    const nowMs = Date.parse('2026-11-26T15:00:00Z');
    const store = createAccountStore(project, { now: () => nowMs });
    const notifications = projectNotifications(project, () => nowMs);

    // 1. Below threshold -> no warning
    store.observe([{
      cli: 'claude',
      masked_account: 'b***@fixture-mail-2.test',
      account_ref: 'ref-c1',
      plan: 'max_5x',
      limit_id: 'default',
      bucket: 'five_hour',
      scope: 'account',
      used_percent: 80,
      window_minutes: 300,
      resets_at: '2026-11-26T17:00:00.000Z',
      source: 'claude-headless',
      observed_at: '2026-11-26T14:55:00.000Z',
    }], { warningPercent: 85 });
    assert.equal(store.pendingWarnings().length, 0);

    // 2. Crosses 85% -> emits exactly 1 warning with deterministic ID
    store.observe([{
      cli: 'claude',
      masked_account: 'b***@fixture-mail-2.test',
      account_ref: 'ref-c1',
      plan: 'max_5x',
      limit_id: 'default',
      bucket: 'five_hour',
      scope: 'account',
      used_percent: 88,
      window_minutes: 300,
      resets_at: '2026-11-26T17:00:00.000Z',
      source: 'claude-headless',
      observed_at: '2026-11-26T14:57:00.000Z',
    }], { warningPercent: 85 });
    const firstWarnings = store.pendingWarnings();
    assert.equal(firstWarnings.length, 1);
    assert.equal(firstWarnings[0].type, 'account-quota-warning');
    assert.ok(firstWarnings[0].text.includes('b***@fixture-mail-2.test'));
    notifications.add(...firstWarnings);
    store.ackWarnings(firstWarnings.map(w => w.id));
    assert.equal(store.pendingWarnings().length, 0);

    // 3. Higher usage in SAME reset cycle -> deduplicated (no second warning)
    store.observe([{
      cli: 'claude',
      masked_account: 'b***@fixture-mail-2.test',
      account_ref: 'ref-c1',
      plan: 'max_5x',
      limit_id: 'default',
      bucket: 'five_hour',
      scope: 'account',
      used_percent: 94,
      window_minutes: 300,
      resets_at: '2026-11-26T17:00:00.000Z',
      source: 'claude-headless',
      observed_at: '2026-11-26T14:59:00.000Z',
    }], { warningPercent: 85 });
    assert.equal(store.pendingWarnings().length, 0, 'same window and reset cycle must be deduplicated');

    // 4. Unknown resets_at or stale sample -> no warning
    store.observe([
      {
        cli: 'agy',
        masked_account: null,
        account_ref: 'ref-a1',
        plan: null,
        limit_id: 'gemini-5h',
        bucket: '5h',
        scope: 'pool',
        used_percent: 95,
        window_minutes: 300,
        resets_at: null,
        source: 'agy-cli',
        observed_at: '2026-11-26T14:59:00.000Z',
      },
      {
        cli: 'codex',
        masked_account: 'a***@example.com',
        account_ref: 'ref-x1',
        plan: 'pro',
        limit_id: 'codex',
        bucket: 'primary',
        scope: 'account',
        used_percent: 92,
        window_minutes: 10080,
        resets_at: '2026-12-03T07:00:00.000Z',
        source: 'codex-rollout',
        observed_at: '2026-11-26T10:00:00.000Z', // 5 hours old -> stale
      },
    ], { warningPercent: 85 });
    assert.equal(store.pendingWarnings().length, 0);

    // 5. New reset cycle -> emits a new warning and survives store reload
    store.observe([{
      cli: 'claude',
      masked_account: 'b***@fixture-mail-2.test',
      account_ref: 'ref-c1',
      plan: 'max_5x',
      limit_id: 'default',
      bucket: 'five_hour',
      scope: 'account',
      used_percent: 90,
      window_minutes: 300,
      resets_at: '2026-11-26T22:00:00.000Z',
      source: 'claude-headless',
      observed_at: '2026-11-26T15:00:00.000Z',
    }], { warningPercent: 85 });
    const reloaded = createAccountStore(project, { now: () => nowMs });
    assert.equal(reloaded.pendingWarnings().length, 1, 'pending_warnings must persist across restarts');
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
