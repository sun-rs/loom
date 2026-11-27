import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, mkdtempSync } from '../fixtures/test-process.mjs';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { headlessEvent } = JSON.parse(
  readFileSync(new URL('../adapters/accounts/fixtures/claude-passive.json', import.meta.url), 'utf8'),
);
const loomEntry = fileURLToPath(new URL('../bin/loom', import.meta.url));

function stubUnusedRuntimes(project) {
  // Keep loomd's real session tracking. Only the provider launch, Codex
  // classifiers, and TUI dependency are unreachable with the injected session.
  const modules = {
    '@botiverse/oar': 'oar.mjs',
    '@xterm/headless': 'xterm.mjs',
  };
  const unexpected = 'throw new Error("Unexpected runtime call in Claude wiring test")';
  writeFileSync(join(project, 'oar.mjs'), `
    export const antigravityRuntime = {}, claudeRuntime = {}, codexRuntime = {}, opencodeRuntime = {};
    export const appRequestKind = () => { ${unexpected}; };
    export const createRuntimeRegistry = () => ({ require() { ${unexpected}; } });
  `);
  writeFileSync(join(project, 'xterm.mjs'), `export default { Terminal: class { constructor() { ${unexpected}; } } };`);
  const codex = join(project, 'runtimes', 'codex');
  mkdirSync(codex, { recursive: true });
  writeFileSync(join(project, 'package.json'), '{"type":"module"}');
  writeFileSync(join(codex, 'failure.js'), `export function codexFailure() { ${unexpected}; }`);
  writeFileSync(join(codex, 'refusal.js'), `export function codexControlRefusal() { ${unexpected}; }`);
  return registerHooks({
    resolve(specifier, context, nextResolve) {
      if (!Object.hasOwn(modules, specifier)) return nextResolve(specifier, context);
      return { url: pathToFileURL(join(project, modules[specifier])).href, shortCircuit: true };
    },
  });
}

async function withClaudeFrame(t, cliVersion, verify) {
  const project = mkdtempSync(join(realpathSync(tmpdir()), 'loom-acct-wiring-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  mkdirSync(join(project, '.project'));
  writeFileSync(join(project, '.project', 'policy.json'), JSON.stringify({ preferred: [], deny: [] }));
  const transcript = join(project, 'session.jsonl');
  writeFileSync(transcript, '');
  const path = join(project, '.project', 'loomd', 'accounts.json');

  const tools = join(project, 'bin');
  mkdirSync(tools);
  symlinkSync('/usr/bin/git', join(tools, 'git'));
  const env = {
    HOME: project,
    XDG_CONFIG_HOME: project,
    PATH: tools,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    LOOM_DESKTOP_NOTIFY: '0',
    LOOM_HERDR_LAYOUT: '0',
  };
  // This test file runs in its own Node test process. Isolate loomd's
  // in-process startup too, including native callers of getenv.
  const hooks = stubUnusedRuntimes(project);
  const priorEnv = { ...process.env };
  for (const key of Object.keys(priorEnv)) delete process.env[key];
  Object.assign(process.env, env);
  try {
    const { createSupervisor } = await import('./supervisor.mjs');
    const records = [];
    let onFrame;
    const daemon = createSupervisor(project, {
      report: () => {},
      externalNotification: async () => {},
      now: () => Date.parse(headlessEvent.timestamp),
      sessionOptions: {
        open: async row => {
          assert.equal(row.cli, 'claude');
          const isSuper = row.role === 'super';
          return {
            id: isSuper ? 'claude-sess-super' : headlessEvent.session_id,
            cliVersion: isSuper ? '2.1.331' : cliVersion,
            nativeSessionFile: async () => transcript,
            status: () => ({ value: { kind: 'idle' } }),
            events: () => () => {},
            records: () => isSuper ? [] : records,
            rawEvents(observer) {
              if (isSuper) return () => {};
              onFrame = observer;
              return () => { onFrame = undefined; };
            },
          };
        },
      },
    });
    await daemon.handle('spawn', {
      role: 'leader', cli: 'claude', mode: 'headless', model: 'model', effort: 'high',
      cwd: project, project, prompt: 'Observe recorded rate-limit data',
    });

    const readState = () => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
    assert.deepEqual(readState().snapshots ?? [], [], 'no provider evidence has reached loomd yet');
    assert.deepEqual(readState().diagnostics ?? [], []);

    const frame = {
      kind: 'frame',
      sessionId: headlessEvent.session_id,
      agentPath: [],
      seq: 0,
      receivedAt: Date.parse(headlessEvent.timestamp),
      body: { type: headlessEvent.type, native: headlessEvent, events: [] },
    };
    records.push(frame);
    assert.equal(typeof onFrame, 'function', 'loomd must subscribe to raw Claude frames');
    await onFrame(frame);

    await verify(readState(), daemon, project);
  } finally {
    hooks.deregister();
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, priorEnv);
  }
  return { project, env };
}

test('loomd ingests a Claude headless event, persists it, and loom accounts reads it offline', async t => {
  const { project, env } = await withClaudeFrame(t, '2.1.331', ({ snapshots }) => {
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].source, 'claude-headless');
    assert.equal(snapshots[0].used_percent, 87);
  });

  // No RPC server is started. The CLI must open the snapshot produced above.
  const accounts = (...args) => execFileSync(process.execPath, [loomEntry, 'accounts', '--project', project, ...args], {
    cwd: project, env: { ...env, PATH: '' }, encoding: 'utf8', timeout: 10_000,
  });
  const data = JSON.parse(accounts('--json'));
  assert.equal(data.accounts.length, 1);
  assert.equal(data.accounts[0].cli, 'claude');
  assert.equal(data.accounts[0].windows.length, 1);
  const [window] = data.accounts[0].windows;
  assert.equal(window.kind, '5h');
  assert.equal(window.usedPercent, 87);
  assert.equal(window.resetsAt, headlessEvent.rate_limit_info.resetsAt);
  assert.equal(window.observedAt, headlessEvent.timestamp);
  assert.equal(window.source, 'claude-headless');
  assert.match(accounts(), /claude[^\r\n]*87%/i);
});

test('loomd persists valid unverified Claude usage and notifies Super', async t => {
  await withClaudeFrame(t, '999.0.0', async ({ snapshots, diagnostics }, daemon, project) => {
    assert.equal(snapshots[0].used_percent, 87);
    assert.equal(snapshots[0].version_status, 'unverified');
    assert.equal(diagnostics.length, 1);
    const [{ generation, ...diagnostic }] = diagnostics;
    assert.deepEqual(diagnostic, {
      cli: 'claude', status: 'unverified', reason: 'unverified-version',
      cliVersion: '999.0.0', source: 'claude-headless',
      observedAt: headlessEvent.timestamp, sessionId: headlessEvent.session_id,
    });

    const { session: superSession } = await daemon.handle('spawn', {
      role: 'super', cli: 'claude', mode: 'headless', model: 'model', effort: 'high',
      cwd: project, project, prompt: 'Receive project notifications',
    });
    await daemon.tick();
    const { notifications } = await daemon.handle('notifications', { project }, superSession.addr);
    const notice = notifications.find(event => event.type === 'account-version-unverified');
    assert.equal(notice?.reason, 'unverified-version');
    assert.equal(notice.pushRoute, superSession.addr);
    const board = await daemon.handle('board', {});
    const { runAccounts } = await import('../cli/accounts.mjs');
    const cli = await runAccounts({ project });
    const readings = accounts => accounts.map(account => ({ ...account,
      windows: account.windows.map(({ stale, ...window }) => window),
    }));
    assert.deepEqual(readings(board.accounts.accounts), readings(cli.accounts));
    assert.equal(board.accounts.accounts[0].windows[0].versionStatus, 'unverified');
    const { boardLines } = await import('../cli/status-tui.mjs');
    assert.match(boardLines(project, { board }, { page: 4, width: 100 }).join('\n'), /unverified version/);

  });
});

test('C3 account refresh shows Claude windows and persists OpenCode usage unavailability', async t => {
  const project = mkdtempSync(join(realpathSync(tmpdir()), 'loom-acct-c3-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const hooks = stubUnusedRuntimes(project);
  const { createSupervisor } = await import('./supervisor.mjs').finally(() => hooks.deregister());
  const { refreshAccounts } = await import('./account-refresh.mjs');
  const { formatAccountsText, runAccounts } = await import('../cli/accounts.mjs');

  // Replay the fields consumed from the redacted C3 host probe. Only stubs run.
  const claudeDir = join(project, '.local/share/claude/versions');
  mkdirSync(claudeDir, { recursive: true });
  const claude = join(claudeDir, '2.1.331');
  const opencode = join(project, 'opencode');
  const auth = {
    loggedIn: true, authMethod: 'claude.ai', email: 'b***@example.com',
    subscriptionType: 'max', planTier: 'max_5x', loginExpiresAt: '2026-12-19T18:28:28.275Z',
  };
  const usage = {
    type: 'result', subtype: 'success', is_error: false, local_command: 'usage',
    num_turns: 0, duration_api_ms: 0, total_cost_usd: 0,
    result: [
      'You are currently using your subscription to power your Claude Code usage',
      '',
      'Current session: 26% used · resets Nov 26 at 12pm (America/New_York)',
      'Current week (all models): 10% used · resets Dec 2 at 12pm (America/New_York)',
      'Current week (Fable): 0% used · resets Dec 2 at 12pm (America/New_York)',
      '',
      "What's contributing to your usage?",
      '  90%  Review sessions active over many hours',
    ].join('\n'),
  };
  const writeStub = (file, responses) => {
    writeFileSync(file, `#!/bin/sh\nexec "${process.execPath}" "$0.cjs" "$@"\n`, { mode: 0o755 });
    writeFileSync(file + '.cjs', `
      const response = ${JSON.stringify(responses)}[process.argv.slice(2).join(' ')];
      if (response === undefined) process.exit(2);
      console.log(response);
    `);
  };
  writeStub(claude, {
    '--version': '2.1.331 (Claude Code)',
    'auth status --json': JSON.stringify(auth),
    '-p /usage --no-session-persistence --output-format json': JSON.stringify(usage),
  });
  const openCodeUsage = '--standalone api GET /api/experimental/usage/limits';
  const openCodeResponses = {
    '--version': 'opencode v2.3.0',
    [openCodeUsage]: JSON.stringify({ location: { directory: project }, data: null }),
  };
  writeStub(opencode, openCodeResponses);
  const observedAt = '2026-11-26T16:37:09.728Z';
  let at = Date.parse(observedAt);
  const now = () => at;
  const daemon = createSupervisor(project, {
    now,
    accountOptions: {
      executables: { claude, opencode },
      refresh: options => refreshAccounts({ ...options, env: { HOME: project, PATH: '' } }),
    },
  });
  const refreshed = await daemon.handle('accounts-refresh', { project }, undefined, { external: true });
  assert.equal(refreshed.outcomes.claude.status, 'ok');
  assert.equal(refreshed.outcomes.opencode.status, 'unsupported');
  assert.equal(refreshed.outcomes.opencode.reason, 'usage-unavailable');
  const view = await runAccounts({ project });
  assert.deepEqual(view.accounts.map(account => account.cli), ['claude']);
  const [account] = view.accounts;
  assert.equal(account.accountMasked, auth.email);
  assert.equal(account.expiresAt, auth.loginExpiresAt);
  assert.deepEqual(account.windows.map(window => [window.model, window.usedPercent, window.resetsAt]), [
    [null, 26, '2026-11-26T17:00:00.000Z'],
    [null, 10, '2026-12-02T17:00:00.000Z'],
    ['Fable', 0, '2026-12-02T17:00:00.000Z'],
  ]);
  assert.deepEqual(view.diagnostics, [{
    cli: 'opencode', status: 'unsupported', reason: 'usage-unavailable', cliVersion: 'v2.3.0',
    source: 'opencode-api', observedAt,
  }]);
  assert.deepEqual(refreshed.diagnostics, view.diagnostics);
  const text = formatAccountsText(view, { now, timeZone: 'UTC' });
  assert.match(text, /^claude .*26%/m);
  assert.match(text, /^opencode · 用量不可用 · opencode-api/m);
  assert.equal(formatAccountsText(refreshed, { now, timeZone: 'UTC' }).split('\n')
    .filter(line => line.startsWith('opencode')).length, 1);
  const { notifications } = await daemon.handle('notifications', { project });
  assert.ok(!notifications.some(event => event.type === 'account-version-unsupported'));

  at += 60_000;
  writeStub(opencode, {
    ...openCodeResponses,
    [openCodeUsage]: JSON.stringify({
      location: { directory: project },
      data: { workspace: { id: 'fixture-workspace' }, budgets: [
        { id: 'monthly', limit: 10, spent: 2, resetsAt: Date.parse('2026-12-01T00:00:00Z') },
      ] },
    }),
  });
  const recovered = await daemon.handle('accounts-refresh', { project }, undefined, { external: true });
  assert.equal(recovered.outcomes.opencode.status, 'ok');
  const fresh = await runAccounts({ project });
  assert.equal(fresh.accounts.find(account => account.cli === 'opencode').windows[0].usedPercent, 20);
  assert.equal(fresh.diagnostics, undefined);
});
