import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Unmasked input exists only as generated data for the masking regression.
const codexEmail = ['alice.tester', 'example.com'].join('@');
const claudeEmail = ['bob.tester', 'example.com'].join('@');
const fixtures = JSON.parse(
  readFileSync(new URL('./account-refresh/fixtures/b-class-responses.json', import.meta.url), 'utf8'),
);

function makeStub(dir, name, jsBody) {
  const file = join(dir, name);
  const version = fixtures.versions[name];
  const probe = version
    ? `if (process.argv.slice(2).join(' ') === '--version') { console.log(${JSON.stringify(version)}); process.exit(0); }`
    : '';
  writeFileSync(file, `#!${process.execPath}\n${probe}\n${jsBody}\n`, 'utf8');
  chmodSync(file, 0o755);
  return file;
}

function isolatedEnv(dir) {
  return { HOME: dir, XDG_CONFIG_HOME: dir, PATH: '', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
}

function makeClaudeCcpStub(home, jsBody) {
  const ccpDir = join(home, 'ccp/bin');
  const binDir = join(home, '.local/bin');
  mkdirSync(ccpDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  const target = makeStub(ccpDir, 'claude-protected', `
    if (process.argv.slice(2).join(' ') === '--version') { console.log(${JSON.stringify(fixtures.versions.claude)}); process.exit(0); }
    ${jsBody}
  `);
  const entry = join(binDir, 'claude');
  symlinkSync(target, entry);
  return entry;
}

test('resolveCliExecutable accepts absolute executable paths and rejects relative paths', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'loom-acct-exec-'));
  try {
    const { resolveCliExecutable } = await import('./executables.mjs');
    const stub = makeStub(dir, 'codex-stub', 'process.exit(0);');
    assert.equal(resolveCliExecutable('codex', { env: { LOOM_CODEX_BIN: stub } }), stub);
    assert.throws(
      () => resolveCliExecutable('codex', { env: { LOOM_CODEX_BIN: 'codex' } }),
      /absolute/i,
    );
    assert.throws(
      () => resolveCliExecutable('agy', { env: { LOOM_AGY_BIN: './agy' } }),
      /absolute/i,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Claude resolution and refresh require the CCP entry and never fall back to native versions', async t => {
  const home = mkdtempSync(join(realpathSync(tmpdir()), 'loom-acct-claude-ccp-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const versions = join(home, '.local/share/claude/versions');
  const sentinel = join(home, 'native-ran');
  mkdirSync(versions, { recursive: true });
  const native = makeStub(versions, '2.1.331', `
    require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, '');
    process.exit(2);
  `);
  const entry = makeClaudeCcpStub(home, `
    const fx = ${JSON.stringify(fixtures.claude)};
    const command = process.argv[2];
    console.log(JSON.stringify(command === 'auth' ? fx.authStatus : fx.usageJson));
  `);

  const { resolveCliExecutable } = await import('./executables.mjs');
  const { refreshAccounts } = await import('./account-refresh.mjs');
  const result = await refreshAccounts({ providers: ['claude'], env: isolatedEnv(home) });
  const resolved = resolveCliExecutable('claude', { home, env: isolatedEnv(home) });
  assert.deepEqual(
    { resolved, status: result.outcomes.claude.status, nativeRan: existsSync(sentinel) },
    { resolved: entry, status: 'ok', nativeRan: false },
  );
  assert.equal(resolveCliExecutable('claude', { home, env: {} }), entry);
  assert.throws(() => resolveCliExecutable('claude', { home, env: { ...isolatedEnv(home), LOOM_CLAUDE_BIN: native } }),
    { code: 'ccp-required' });
});

test('Claude resolution rejects direct native version symlinks and non-CCP overrides with ccp-required', async t => {
  const home = mkdtempSync(join(realpathSync(tmpdir()), 'loom-acct-claude-link-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const bin = join(home, '.local/bin');
  const versions = join(home, '.local/share/claude/versions');
  const sentinel = join(home, 'native-ran');
  mkdirSync(bin, { recursive: true });
  mkdirSync(versions, { recursive: true });
  const native = makeStub(versions, '2.1.331', `
    require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, '');
  `);
  const link = join(bin, 'claude');
  symlinkSync(native, link);

  const { resolveCliExecutable } = await import('./executables.mjs');
  const { refreshAccounts } = await import('./account-refresh.mjs');
  const result = await refreshAccounts({ providers: ['claude'], env: isolatedEnv(home) });
  assert.equal(result.outcomes.claude.reason, 'invalid-cli-executable');
  assert.equal(result.resolvedExecutables.claude, 'rejected');
  assert.equal(existsSync(sentinel), false);
  assert.throws(() => resolveCliExecutable('claude', { home, env: isolatedEnv(home) }),
    { code: 'ccp-required' });

  const external = makeStub(home, 'claude-direct', 'process.exit(2);');
  unlinkSync(link);
  assert.throws(() => resolveCliExecutable('claude', { home, env: { ...isolatedEnv(home), LOOM_CLAUDE_BIN: external } }),
    { code: 'ccp-required' });
});

test('non-Claude refresh providers reject protected CCP realpaths while Claude rejects native versions', async t => {
  const { resolveCliExecutable } = await import('./executables.mjs');
  const { refreshAccounts } = await import('./account-refresh.mjs');
  const { readProvider } = await import('./account-refresh/providers.mjs');
  for (const cli of ['codex', 'agy', 'opencode']) {
    for (const target of ['CcP/stub', 'ClAuDe-PrOtEcTeD']) {
      await t.test(cli + ' rejects ' + target, async t => {
        const home = mkdtempSync(join(realpathSync(tmpdir()), 'loom-acct-guard-'));
        t.after(() => rmSync(home, { recursive: true, force: true }));
        const bin = join(home, '.local/bin');
        const sentinel = join(home, 'invocations');
        mkdirSync(bin, { recursive: true });
        mkdirSync(join(home, 'CcP'));
        const wrapper = makeStub(home, target, `
          require('node:fs').appendFileSync(${JSON.stringify(sentinel)}, 'ran\\n');
          process.exit(2);
        `);
        const link = join(bin, cli);
        symlinkSync(wrapper, link);
        const readOriginal = readProvider[cli];
        const read = t.mock.method(readProvider, cli, (binary, ctx) => {
          // Allow only the temporary target to run, even if resolution regresses to a host path.
          assert.equal(binary, wrapper);
          return readOriginal(binary, ctx);
        });
        const env = isolatedEnv(home);
        const override = { ...env, ['LOOM_' + cli.toUpperCase() + '_BIN']: link };
        for (const options of [{ env }, { env: override }, { env, executables: { [cli]: link } }]) {
          const result = await refreshAccounts({ providers: [cli], ...options });
          assert.equal(existsSync(sentinel), false);
          assert.equal(result.outcomes[cli].reason, 'invalid-cli-executable');
          assert.equal(result.resolvedExecutables?.[cli], 'rejected');
        }
        assert.equal(read.mock.callCount(), 0);
        for (const candidateEnv of [env, override]) {
          assert.throws(() => resolveCliExecutable(cli, { env: candidateEnv }), { code: 'protected-executable' });
        }
      });
    }
  }
  await t.test('claude rejects native version binary and requires CCP entry', async t => {
    const home = mkdtempSync(join(realpathSync(tmpdir()), 'loom-acct-claude-guard-'));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const versions = join(home, '.local/share/claude/versions');
    const sentinel = join(home, 'invocations');
    mkdirSync(versions, { recursive: true });
    const native = makeStub(versions, '2.1.331', `
      require('node:fs').appendFileSync(${JSON.stringify(sentinel)}, 'ran\\n');
      process.exit(2);
    `);
    const env = isolatedEnv(home);
    const override = { ...env, LOOM_CLAUDE_BIN: native };
    for (const options of [{ env: override }, { env, executables: { claude: native } }]) {
      const result = await refreshAccounts({ providers: ['claude'], ...options });
      assert.equal(existsSync(sentinel), false);
      assert.equal(result.outcomes.claude.reason, 'invalid-cli-executable');
      assert.equal(result.resolvedExecutables?.claude, 'rejected');
    }
    assert.throws(() => resolveCliExecutable('claude', { env: override }), { code: 'ccp-required' });
  });
});

test('refreshAccounts gives a provider at least 45 seconds by default', async t => {
  const home = mkdtempSync(join(tmpdir(), 'loom-acct-default-timeout-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const agy = makeStub(home, 'agy-stub', 'process.exit(2);');
  const { readProvider } = await import('./account-refresh/providers.mjs');
  const { refreshAccounts } = await import('./account-refresh.mjs');
  const read = t.mock.method(readProvider, 'agy', async () => ({ windows: [] }));

  const before = performance.now();
  const result = await refreshAccounts({ executables: { agy }, env: isolatedEnv(home) });
  assert.equal(result.outcomes.agy.status, 'ok');
  assert.equal(read.mock.callCount(), 1);
  const { deadline } = read.mock.calls[0].arguments[1];
  assert.ok(deadline >= before + 45_000, `default provider budget was ${deadline - before} ms`);
});

test('refreshAccounts calls each B-class CLI once with absolute paths, zero polling, no write RPCs, and masks emails', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'loom-acct-refresh-'));
  const logFile = join(dir, 'invocations.jsonl');
  try {
    const { refreshAccounts } = await import('./account-refresh.mjs');

    const codexStub = makeStub(dir, 'codex', `
      const fs = require('node:fs');
      const readline = require('node:readline');
      const fx = ${JSON.stringify(fixtures.codex)};
      const log = ${JSON.stringify(logFile)};
      fs.appendFileSync(log, JSON.stringify({ cli: 'codex', argv: process.argv.slice(2) }) + '\\n');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        if (!line.trim()) return;
        const msg = JSON.parse(line);
        fs.appendFileSync(log, JSON.stringify({ cli: 'codex-rpc', method: msg.method }) + '\\n');
        if (msg.method === 'account/rateLimitResetCredit/consume') {
          process.stderr.write('FORBIDDEN WRITE METHOD CALLED');
          process.exit(99);
        }
        if (msg.method === 'initialize') {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { userAgent: 'codex-stub/${fixtures.versions.codex}' } }) + '\\n');
        } else if (msg.method === 'account/read') {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { ...fx.accountRead, account: { ...fx.accountRead.account, email: ${JSON.stringify(codexEmail)} } } }) + '\\n');
        } else if (msg.method === 'account/rateLimits/read') {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: fx.rateLimitsRead }) + '\\n');
        }
      });
    `);

    const claudeStub = makeClaudeCcpStub(dir, `
      const fs = require('node:fs');
      const fx = ${JSON.stringify(fixtures.claude)};
      const args = process.argv.slice(2);
      fs.appendFileSync(${JSON.stringify(logFile)}, JSON.stringify({ cli: 'claude', argv: args }) + '\\n');
      if (args[0] === 'auth' && args[1] === 'status') {
        process.stdout.write(JSON.stringify({ ...fx.authStatus, email: ${JSON.stringify(claudeEmail)} }) + '\\n');
      } else if (args.includes('/usage')) {
        process.stdout.write(JSON.stringify(fx.usageJson) + '\\n');
      } else {
        process.exit(2);
      }
    `);

    const agyStub = makeStub(dir, 'agy', `
      const fs = require('node:fs');
      const fx = ${JSON.stringify(fixtures.agy)};
      const args = process.argv.slice(2);
      fs.appendFileSync(${JSON.stringify(logFile)}, JSON.stringify({ cli: 'agy', argv: args }) + '\\n');
      if (args.includes('/usage') && args.includes('--output-format')) {
        process.stdout.write(JSON.stringify(fx.usageJson) + '\\n');
      } else {
        process.exit(2);
      }
    `);

    const opencodeStub = makeStub(dir, 'opencode', `
      const fs = require('node:fs');
      const fx = ${JSON.stringify(fixtures.opencode)};
      const args = process.argv.slice(2);
      fs.appendFileSync(${JSON.stringify(logFile)}, JSON.stringify({ cli: 'opencode', argv: args }) + '\\n');
      process.stdout.write(JSON.stringify(fx.noGoData) + '\\n');
    `);

    const res = await refreshAccounts({
      executables: { codex: codexStub, claude: claudeStub, agy: agyStub, opencode: opencodeStub },
      env: isolatedEnv(dir),
      now: () => Date.parse('2026-11-26T14:30:19Z'),
      timeoutMs: 10_000,
    });

    assert.equal(res.ok, true);
    assert.equal(res.outcomes.codex.status, 'ok');
    assert.equal(res.outcomes.claude.status, 'ok');
    assert.equal(res.outcomes.agy.status, 'ok');
    assert.equal(res.outcomes.opencode.status, 'unsupported');
    assert.ok(!res.observations.some(o => o.cli === 'opencode'));

    // Verify zero raw emails anywhere in result
    const serialized = JSON.stringify(res);
    assert.ok(!serialized.includes(codexEmail), 'raw codex email must be masked');
    assert.ok(!serialized.includes(claudeEmail), 'raw claude email must be masked');
    assert.ok(serialized.includes('a***@example.com'));
    assert.ok(serialized.includes('b***@example.com'));

    const codexWindow = res.observations.find(o => o.cli === 'codex');
    assert.equal(codexWindow.reset_credits, 2);
    assert.equal(codexWindow.active, true);

    // Verify agy remaining_fraction -> used_percent and epoch-0 reset_time -> null
    const agyGeminiWeekly = res.observations.find(o => o.cli === 'agy' && o.limit_id === 'gemini-weekly');
    assert.ok(agyGeminiWeekly);
    assert.ok(Math.abs(agyGeminiWeekly.used_percent - 13.57) < 0.1);
    assert.equal(agyGeminiWeekly.window_minutes, 10080);
    assert.equal(agyGeminiWeekly.model, 'Gemini Models');
    assert.deepEqual(
      res.observations.filter(o => o.cli === 'agy').map(o => [o.limit_id, o.model, o.window_minutes]).sort(),
      [
        ['3p-5h', 'Claude and GPT models', 300],
        ['3p-weekly', 'Claude and GPT models', 10080],
        ['gemini-5h', 'Gemini Models', 300],
        ['gemini-weekly', 'Gemini Models', 10080],
      ],
    );

    const claudeFable = res.observations.find(o => o.cli === 'claude' && o.bucket === 'seven_day_fable');
    assert.ok(claudeFable);
    assert.equal(claudeFable.model, 'Fable');
    assert.equal(claudeFable.used_percent, 0);
    assert.equal(claudeFable.expires_at, fixtures.claude.authStatus.loginExpiresAt);

    const agyUnused = res.observations.find(o => o.cli === 'agy' && o.limit_id === '3p-weekly');
    assert.ok(agyUnused);
    assert.equal(agyUnused.used_percent, 0);
    assert.equal(agyUnused.resets_at, null, '1970-01-01T00:00:00Z unused reset_time must normalize to null');

    // Verify invocation counts & forbidden write method never called
    const calls = readFileSync(logFile, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.equal(calls.filter(c => c.cli === 'codex').length, 1);
    assert.equal(calls.filter(c => c.cli === 'codex-rpc' && c.method === 'account/rateLimits/read').length, 1);
    assert.equal(calls.filter(c => c.cli === 'codex-rpc' && c.method === 'account/rateLimitResetCredit/consume').length, 0);
    assert.equal(calls.filter(c => c.cli === 'agy').length, 1);
    assert.equal(calls.filter(c => c.cli === 'opencode').length, 1);
    assert.equal(calls.filter(c => c.cli === 'claude' && c.argv.includes('/usage')).length, 1);
    assert.equal(calls.filter(c => c.cli === 'claude' && c.argv[0] === 'auth').length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refreshAccounts accepts the Codex 0.172.0 host response fixture', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'loom-acct-codex-0172-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { refreshAccounts } = await import('./account-refresh.mjs');
  const version = fixtures.versions.codex0172;
  const observedAt = '2026-11-26T16:37:09.728Z';
  const replies = {
    initialize: { userAgent: 'codex-stub/' + version },
    'account/read': fixtures.codex0172.accountRead,
    'account/rateLimits/read': fixtures.codex0172.rateLimitsRead,
  };
  const codex = makeStub(dir, 'codex-0172', `
    const readline = require('node:readline');
    const replies = ${JSON.stringify(replies)};
    readline.createInterface({ input: process.stdin }).on('line', line => {
      const { id, method } = JSON.parse(line);
      if (Object.hasOwn(replies, method)) console.log(JSON.stringify({ id, result: replies[method] }));
    });
  `);
  const result = await refreshAccounts({
    executables: { codex },
    env: isolatedEnv(dir),
    now: () => Date.parse(observedAt),
  });
  assert.deepEqual(result.outcomes.codex, { cli: 'codex', status: 'ok', version });
  assert.equal(result.observations.length, 1);
  const [weekly] = result.observations;
  assert.equal(weekly.masked_account, 'c***@example.com');
  assert.match(weekly.account_ref, /^[a-f0-9]{64}$/);
  assert.equal(weekly.plan, 'pro');
  assert.equal(weekly.active, true);
  assert.equal(weekly.reset_credits, 3);
  assert.equal(weekly.limit_id, 'codex');
  assert.equal(weekly.bucket, 'primary');
  assert.equal(weekly.used_percent, 67);
  assert.equal(weekly.window_minutes, 10080);
  assert.equal(weekly.resets_at, '2026-11-27T08:43:22.000Z');
});

test('refreshAccounts isolates partial provider failures and rejects non-zero model turns', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'loom-acct-partial-'));
  try {
    const { refreshAccounts } = await import('./account-refresh.mjs');

    const badCodex = makeStub(dir, 'codex', 'process.stderr.write("SYNTHETIC_STDERR_MARKER"); process.exit(1);');
    const goodAgy = makeStub(dir, 'agy', `process.stdout.write(${JSON.stringify(JSON.stringify(fixtures.agy.usageJson))} + '\\n');`);
    const badTurnClaude = makeClaudeCcpStub(dir, `
      const args = process.argv.slice(2);
      if (args[0] === 'auth') process.stdout.write(${JSON.stringify(JSON.stringify(fixtures.claude.authStatus))} + '\\n');
      else process.stdout.write(JSON.stringify({ ...${JSON.stringify(fixtures.claude.usageJson)}, num_turns: 1 }) + '\\n');
    `);

    const res = await refreshAccounts({
      executables: { codex: badCodex, agy: goodAgy, claude: badTurnClaude },
      env: isolatedEnv(dir),
      now: () => Date.parse('2026-11-26T14:30:19Z'),
      timeoutMs: 10_000,
    });

    assert.equal(res.outcomes.agy.status, 'ok');
    assert.ok(res.observations.some(o => o.cli === 'agy'));
    assert.notEqual(res.outcomes.codex.status, 'ok');
    assert.ok(!JSON.stringify(res).includes('SYNTHETIC_STDERR_MARKER'), 'raw stderr must never leak');
    assert.notEqual(res.outcomes.claude.status, 'ok', 'num_turns > 0 must be rejected');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refreshAccounts reads independent login directories and cools down each account separately', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'loom-acct-profiles-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const profiles = ['current', 'other'].map((accountRef, index) => {
    const configDir = join(dir, accountRef);
    mkdirSync(configDir);
    return { cli: 'claude', accountRef, configDir, active: index === 0 };
  });
  const log = join(dir, 'calls.jsonl');
  const claude = makeClaudeCcpStub(dir, `
    const { appendFileSync } = require('node:fs');
    const args = process.argv.slice(2);
    const config = process.env.CLAUDE_CONFIG_DIR;
    const fx = ${JSON.stringify(fixtures.claude)};
    appendFileSync(${JSON.stringify(log)}, JSON.stringify({ config, args }) + '\\n');
    if (args.join(' ') === 'auth status --json') {
      console.log(JSON.stringify(fx.authStatus));
    } else if (args.includes('/usage') && args.includes('--no-session-persistence')) {
      console.log(JSON.stringify(fx.usageJson));
    } else {
      process.exit(2);
    }
  `);
  const { refreshAccounts } = await import('./account-refresh.mjs');
  let time = Date.parse(fixtures.recordedAt);
  const env = { ...isolatedEnv(dir), CLAUDE_CONFIG_DIR: profiles[0].configDir };
  const options = {
    executables: { claude }, env, now: () => time, timeoutMs: 10_000,
    lastAttempts: new Map(), minRefreshIntervalMs: 60_000,
  };
  const refresh = async accounts => {
    writeFileSync(log, '');
    const result = await refreshAccounts({ ...options, accounts });
    const calls = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    return { result, calls };
  };
  const first = await refresh([profiles[0]]);
  time += 30_000;
  const second = await refresh(profiles);
  time += 30_000;
  const third = await refresh(profiles);

  for (const [{ result, calls }, profile] of [[first, profiles[0]], [second, profiles[1]], [third, profiles[0]]]) {
    assert.ok(result.observations.length > 0);
    assert.deepEqual(new Set(result.observations.map(o => o.account_ref)), new Set([profile.accountRef]));
    assert.ok(result.observations.every(o => o.active === profile.active));
    assert.ok(calls.every(call => call.config === profile.configDir));
    assert.equal(calls.filter(call => call.args.includes('/usage')).length, 1);
    assert.deepEqual(calls.filter(call => call.args[0] === 'auth').map(call => call.args),
      [['auth', 'status', '--json']]);
    assert.ok(calls.filter(call => call.args.join(' ') === '--version').length <= 1);
  }
  assert.equal(env.CLAUDE_CONFIG_DIR, profiles[0].configDir);
});

test('refreshAccounts tags structurally valid newer versions and omits incompatible payloads', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'loom-acct-versions-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { refreshAccounts } = await import('./account-refresh.mjs');
  for (const [version, payload] of [
    ['999.0.0', fixtures.agy.usageJson_1_5_18],
    ['999.0.0', { ...fixtures.agy.usageJson_1_5_18, command: { name: 'usage', data: { groups: {} } } }],
  ]) {
    const agy = makeStub(dir, 'versioned-agy', `
      if (process.argv.includes('--version')) console.log(${JSON.stringify(version)});
      else if (process.argv.includes('/usage')) process.stdout.write(${JSON.stringify(JSON.stringify(payload))});
      else process.exit(2);
    `);
    const result = await refreshAccounts({ executables: { agy }, env: isolatedEnv(dir), timeoutMs: 10_000 });
    assert.equal(result.outcomes.agy.version, version);
    if (payload === fixtures.agy.usageJson_1_5_18) {
      assert.equal(result.outcomes.agy.status, 'ok');
      assert.equal(result.outcomes.agy.versionStatus, 'unverified');
      assert.ok(result.observations.length);
      assert.ok(result.observations.every(row => row.version_status === 'unverified' && row.cli_version === version));
    } else {
      assert.equal(result.outcomes.agy.status, 'unsupported');
      assert.equal(result.outcomes.agy.reason, 'unsupported-version-shape');
      assert.deepEqual(result.observations, []);
    }
  }
});

test('refreshAccounts accepts agy 1.5.18 recorded fixture alongside 1.5.17', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'loom-acct-agy-1518-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { refreshAccounts } = await import('./account-refresh.mjs');
  const agy = makeStub(dir, 'agy-1518', `
    if (process.argv.includes('--version')) console.log(${JSON.stringify(fixtures.versions.agy1518)});
    else if (process.argv.includes('/usage')) process.stdout.write(${JSON.stringify(JSON.stringify(fixtures.agy.usageJson_1_5_18))} + '\\n');
    else process.exit(2);
  `);
  const result = await refreshAccounts({
    executables: { agy },
    env: isolatedEnv(dir),
    now: () => Date.parse('2026-11-26T16:33:32Z'),
    timeoutMs: 10_000,
  });
  assert.equal(result.outcomes.agy.status, 'ok');
  assert.equal(result.observations.length, 4);
  const geminiWeekly = result.observations.find(o => o.limit_id === 'gemini-weekly');
  const gemini5h = result.observations.find(o => o.limit_id === 'gemini-5h');
  const thirdPartyWeekly = result.observations.find(o => o.limit_id === '3p-weekly');
  assert.equal(geminiWeekly.used_percent, 19.22);
  assert.equal(geminiWeekly.window_minutes, 10080);
  assert.equal(geminiWeekly.resets_at, '2026-12-03T07:02:03.000Z');
  assert.equal(gemini5h.used_percent, 49.64);
  assert.equal(gemini5h.window_minutes, 300);
  assert.equal(gemini5h.resets_at, '2026-11-26T17:02:03.000Z');
  assert.equal(thirdPartyWeekly.used_percent, 0);
  assert.equal(thirdPartyWeekly.resets_at, null);
});

test('refreshAccounts preserves Claude’s native login selectors for the default account', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'loom-acct-claude-env-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { ...isolatedEnv(dir), USER: 'fixture-user', CLAUDE_SECURESTORAGE_CONFIG_DIR: dir };
  const claude = makeClaudeCcpStub(dir, `
    const fx = ${JSON.stringify(fixtures.claude)};
    if (process.env.USER !== 'fixture-user' || process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR !== ${JSON.stringify(dir)}) {
      console.log(JSON.stringify(fx.authLoggedOut));
      process.exit(1);
    }
    console.log(JSON.stringify(process.argv[2] === 'auth' ? fx.authStatus : fx.usageJson));
  `);
  const { refreshAccounts } = await import('./account-refresh.mjs');
  const result = await refreshAccounts({ executables: { claude }, env, now: () => Date.parse(fixtures.recordedAt) });
  assert.deepEqual(result.outcomes.claude, { cli: 'claude', status: 'ok', version: '2.1.331' });
  assert.deepEqual(result.observations.map(row => row.used_percent), [10, 8, 0]);
});

test('refreshAccounts reports a signed-out Claude without attempting usage', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'loom-acct-signed-out-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = join(dir, 'calls.jsonl');
  const claude = makeClaudeCcpStub(dir, `
    const args = process.argv.slice(2);
    require('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
    if (args.join(' ') !== 'auth status --json') process.exit(2);
    console.log(${JSON.stringify(JSON.stringify(fixtures.claude.authLoggedOut))});
  `);
  const { refreshAccounts } = await import('./account-refresh.mjs');
  const result = await refreshAccounts({ executables: { claude }, env: isolatedEnv(dir), timeoutMs: 10_000 });
  assert.equal(result.outcomes.claude.status, 'not-signed-in');
  assert.deepEqual(result.observations, []);
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)),
    [['auth', 'status', '--json']]);
});
