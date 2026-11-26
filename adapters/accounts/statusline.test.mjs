import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const claudeFixture = JSON.parse(
  readFileSync(new URL('./fixtures/claude-passive.json', import.meta.url), 'utf8'),
).statuslinePayload;
const agyFixture = JSON.parse(readFileSync(new URL('./fixtures/agy-statusline.json', import.meta.url), 'utf8'));
const agyFixture1518 = JSON.parse(readFileSync(new URL('./fixtures/agy-statusline-1.5.18.json', import.meta.url), 'utf8'));

test('launch-scoped statusline settings for Claude and agy never modify global settings.json', async () => {
  const fakeHome = mkdtempSync(join(tmpdir(), 'loom-acct-sl-home-'));
  const workDir = mkdtempSync(join(tmpdir(), 'loom-acct-sl-cwd-'));
  try {
    const claudeDir = join(fakeHome, '.claude');
    mkdirSync(claudeDir, { recursive: true, mode: 0o700 });
    const globalSettingsPath = join(claudeDir, 'settings.json');
    const originalGlobal = JSON.stringify({ statusLine: { type: 'command', command: 'echo user-global' } }, null, 2);
    writeFileSync(globalSettingsPath, originalGlobal, 'utf8');

    const { createStatuslineSettings } = await import('./statusline.mjs');
    const { launch: claudeLaunch } = await import('../claude/launch.mjs');
    const { launch: agyLaunch } = await import('../agy/launch.mjs');

    const sinkPath = join(workDir, '.project', 'loomd', 'statusline-claude.jsonl');
    const claudeStatusLine = createStatuslineSettings({
      cli: 'claude',
      cliVersion: '2.1.331',
      sinkPath,
      sessionId: 'loom-claude-1',
      generation: 'gen-1',
      userCommand: 'echo user-global',
    });
    assert.equal(claudeStatusLine.statusLine.type, 'command');
    assert.ok(claudeStatusLine.statusLine.command.includes(sinkPath));

    const launchedClaude = claudeLaunch({
      cwd: workDir,
      statusLine: claudeStatusLine.statusLine,
    });
    const settingsIdx = launchedClaude.argv.indexOf('--settings');
    assert.ok(settingsIdx >= 0, 'Claude launch must pass --settings');
    const parsedClaudeSettings = JSON.parse(launchedClaude.argv[settingsIdx + 1]);
    assert.deepEqual(parsedClaudeSettings.statusLine, claudeStatusLine.statusLine);

    const agySink = join(workDir, '.project', 'loomd', 'statusline-agy.jsonl');
    const agyStatusLine = createStatuslineSettings({
      cli: 'agy',
      cliVersion: '1.5.17',
      sinkPath: agySink,
      sessionId: 'loom-agy-1',
      generation: 'gen-2',
      userCommand: 'echo agy-user',
    });
    const launchedAgy = agyLaunch({
      cwd: workDir,
      statusLine: agyStatusLine.statusLine,
    });
    const agySettingsIdx = launchedAgy.argv.indexOf('--settings');
    assert.ok(agySettingsIdx >= 0, 'agy launch must pass --settings');
    const parsedAgySettings = JSON.parse(launchedAgy.argv[agySettingsIdx + 1]);
    assert.deepEqual(parsedAgySettings.statusLine, agyStatusLine.statusLine);

    assert.equal(readFileSync(globalSettingsPath, 'utf8'), originalGlobal, 'global ~/.claude/settings.json must stay untouched');
  } finally {
    rmSync(fakeHome, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('runStatuslineWrapper chains user command unchanged, writes 0600 deduped sink, and survives sink failure', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'loom-acct-sl-wrap-'));
  try {
    const { runStatuslineWrapper } = await import('./statusline.mjs');
    const sinkPath = join(dir, 'sink.jsonl');
    const rawStdin = JSON.stringify(claudeFixture);
    const echoCmd = `${JSON.stringify(process.execPath)} -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{process.stdout.write('USER:'+d);process.stderr.write('ERR_OK');process.exit(0);})"`;
    const env = { HOME: dir, PATH: '', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

    const first = await runStatuslineWrapper({
      cli: 'claude',
      cliVersion: '2.1.331',
      sinkPath,
      sessionId: 'loom-claude-1',
      generation: 'gen-1',
      userCommand: echoCmd,
      stdin: rawStdin,
      cwd: dir,
      env,
    });
    assert.equal(first.exitCode, 0);
    assert.equal(first.stdout, `USER:${rawStdin}`);
    assert.equal(first.stderr, 'ERR_OK');
    assert.equal(statSync(sinkPath).mode & 0o777, 0o600);

    // Identical payload should be deduplicated
    await runStatuslineWrapper({
      cli: 'claude',
      cliVersion: '2.1.331',
      sinkPath,
      sessionId: 'loom-claude-1',
      generation: 'gen-1',
      userCommand: echoCmd,
      stdin: rawStdin,
      cwd: dir,
      env,
    });
    const lines = readFileSync(sinkPath, 'utf8').trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 1);

    // Even if sinkPath is unwritable (directory), user command still runs with exact exit code & output
    const badSink = join(dir, 'sink-is-dir');
    mkdirSync(badSink);
    const failingUserCmd = `${JSON.stringify(process.execPath)} -e "process.stdout.write('PASSTHROUGH');process.exit(7)"`;
    const fallback = await runStatuslineWrapper({
      cli: 'claude',
      cliVersion: '2.1.331',
      sinkPath: badSink,
      sessionId: 'loom-claude-1',
      generation: 'gen-1',
      userCommand: failingUserCmd,
      stdin: rawStdin,
      cwd: dir,
      env,
    });
    assert.equal(fallback.exitCode, 7);
    assert.equal(fallback.stdout, 'PASSTHROUGH');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const { cli, version, payload, quotaKey } of [
  { cli: 'Claude', version: '2.1.331', payload: claudeFixture, quotaKey: 'rate_limits' },
  { cli: 'agy', version: '1.5.17', payload: agyFixture, quotaKey: 'quotas' },
]) {
  test(`${cli} statusline tags valid unlisted versions and writes only a diagnostic for mismatched shapes`, async t => {
    const { runStatuslineWrapper } = await import('./statusline.mjs');
    const dir = mkdtempSync(join(tmpdir(), 'loom-acct-sl-rejected-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const provider = cli.toLowerCase();
    const sessionId = payload.session_id;
    const generation = 'gen-1';
    for (const [cliVersion, input] of [
      ['999.0.0', payload],
      [version, { ...payload, [quotaKey]: 'wrong-shape' }],
    ]) {
      const sinkPath = join(dir, `sink-${cliVersion}.jsonl`);
      const start = Date.now();
      await runStatuslineWrapper({
        cli: provider, cliVersion, sessionId, generation, sinkPath,
        stdin: JSON.stringify(input), cwd: dir,
        env: { HOME: dir, XDG_CONFIG_HOME: dir, PATH: '', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
      });
      const lines = readFileSync(sinkPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      assert.equal(lines.length, 1);
      const [{ observedAt, ...diagnostic }] = lines;
      assert.ok(Date.parse(observedAt) >= start && Date.parse(observedAt) <= Date.now());
      assert.equal(new Date(observedAt).toISOString(), observedAt);
      if (input === payload) {
        assert.ok(diagnostic.observations.length);
        assert.ok(diagnostic.observations.every(row => row.version_status === 'unverified'));
        assert.equal(diagnostic.diagnostics[0].reason, 'unverified-version');
      } else {
        assert.deepEqual(diagnostic, {
          cli: provider, status: 'unsupported', reason: 'unsupported-version-shape',
          cliVersion, source: `${provider}-statusline`, sessionId, generation,
        });
      }
    }
  });
}

test('agy 1.5.18 statusline wrapper writes parsed observations to sink', async t => {
  const { runStatuslineWrapper } = await import('./statusline.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'loom-acct-sl-agy1518-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sinkPath = join(dir, 'sink-1.5.18.jsonl');
  await runStatuslineWrapper({
    cli: 'agy',
    cliVersion: '1.5.18',
    sessionId: agyFixture1518.session_id,
    generation: 'gen-1518',
    sinkPath,
    stdin: JSON.stringify(agyFixture1518),
    cwd: dir,
    env: { HOME: dir, XDG_CONFIG_HOME: dir, PATH: '', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  });
  const lines = readFileSync(sinkPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].cli, 'agy');
  assert.equal(lines[0].status, undefined);
  assert.equal(lines[0].observations.length, 2);
  assert.ok(lines[0].observations.every(row => row.cli === 'agy' && row.source === 'agy-statusline'));
  assert.equal(lines[0].observations.find(row => row.limit_id === 'gemini-5h').used_percent, 49.64);
  assert.equal(lines[0].observations.find(row => row.limit_id === 'gemini-weekly').used_percent, 19.22);
});
