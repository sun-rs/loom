import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fixturesDir = new URL('./fixtures/', import.meta.url);
const codexRolloutLines = readFileSync(new URL('codex-rollout.jsonl', fixturesDir), 'utf8')
  .trim().split('\n').map(line => JSON.parse(line));
const codexPush = JSON.parse(readFileSync(new URL('codex-app-server-push.json', fixturesDir), 'utf8'));
const claudePassive = JSON.parse(readFileSync(new URL('claude-passive.json', fixturesDir), 'utf8'));
const agyStatusline = JSON.parse(readFileSync(new URL('agy-statusline.json', fixturesDir), 'utf8'));
const agyStatusline1518 = JSON.parse(readFileSync(new URL('agy-statusline-1.5.18.json', fixturesDir), 'utf8'));

test('maskEmail masks local part while preserving domain and rejects non-emails', async () => {
  const { maskEmail } = await import('./passive.mjs');
  assert.equal(maskEmail(['chris', 'example.com'].join('@')), 'c***@example.com');
  assert.equal(maskEmail(['a', 'example.org'].join('@')), 'a***@example.org');
  assert.equal(maskEmail('not-an-email'), null);
  assert.equal(maskEmail(null), null);
});

test('parseCodexRolloutLine extracts token_count rate_limits and rejects untimed replay rows', async () => {
  const { parseCodexRolloutLine } = await import('./passive.mjs');
  const ctx = { cliVersion: '0.171.0', sessionId: 'codex-1', isReplay: true };
  const first = parseCodexRolloutLine(codexRolloutLines[0], ctx);
  assert.equal(first.length, 1);
  assert.equal(first[0].cli, 'codex');
  assert.equal(first[0].plan, 'pro');
  assert.equal(first[0].limit_id, 'codex');
  assert.equal(first[0].bucket, 'primary');
  assert.equal(first[0].used_percent, 58);
  assert.equal(first[0].window_minutes, 10080);
  assert.equal(first[0].resets_at, new Date(1796281200 * 1000).toISOString());
  assert.equal(first[0].source, 'codex-rollout');
  assert.equal(first[0].observed_at, '2026-11-26T10:00:00.000Z');

  const second = parseCodexRolloutLine(codexRolloutLines[1], ctx);
  assert.equal(second.length, 2);
  assert.deepEqual(second.map(o => o.bucket).sort(), ['primary', 'secondary']);

  const untimedReplay = parseCodexRolloutLine(codexRolloutLines[2], ctx);
  assert.deepEqual(untimedReplay, []);

  const assistantMsg = parseCodexRolloutLine(codexRolloutLines[3], { ...ctx, isReplay: false });
  assert.deepEqual(assistantMsg, []);
});

test('parseCodexPushNotification extracts account/rateLimits/updated with sequence metadata', async () => {
  const { parseCodexPushNotification } = await import('./passive.mjs');
  const observations = parseCodexPushNotification(codexPush, {
    cliVersion: '0.171.0',
    sessionId: 'codex-pipe-1',
    generation: 'gen-1',
    sequence: 42,
    observedAt: '2026-11-26T10:10:00.000Z',
  });
  assert.equal(observations.length, 2);
  const primary = observations.find(o => o.bucket === 'primary');
  assert.equal(primary.cli, 'codex');
  assert.equal(primary.plan, 'pro');
  assert.equal(primary.used_percent, 64);
  assert.equal(primary.window_minutes, 10080);
  assert.equal(primary.source, 'codex-app-server-push');
  assert.equal(primary.sequence, 42);
  assert.equal(primary.observed_at, '2026-11-26T10:10:00.000Z');
});

test('parseCodexPushNotification accepts a Codex 0.172.0 rate limit snapshot', async () => {
  const { parseCodexPushNotification } = await import('./passive.mjs');
  const { codex0172, versions } = JSON.parse(readFileSync(
    new URL('../../daemon/account-refresh/fixtures/b-class-responses.json', import.meta.url), 'utf8',
  ));
  // Use the observed RPC snapshot as the payload of a synthetic push notification.
  const push = {
    method: 'account/rateLimits/updated',
    params: { rateLimits: codex0172.rateLimitsRead.rateLimits },
  };
  const observedAt = '2026-11-26T16:37:09.728Z';
  const observations = parseCodexPushNotification(push, {
    cliVersion: versions.codex0172,
    observedAt,
  });
  assert.deepEqual(observations, [{
    cli: 'codex', source: 'codex-app-server-push', observed_at: observedAt,
    masked_account: null, plan: 'pro', limit_id: 'codex', bucket: 'primary',
    scope: 'account', used_percent: 67, window_minutes: 10080, resets_at: '2026-11-27T08:43:22.000Z',
  }]);
});

test('parseCodexRolloutLine accepts the supported rollout shape for Codex 0.172.0', async () => {
  const { parseCodexRolloutLine } = await import('./passive.mjs');
  const observations = parseCodexRolloutLine(codexRolloutLines[0], { cliVersion: '0.172.0', isReplay: true });
  assert.equal(observations.length, 1);
  assert.equal(observations[0].source, 'codex-rollout');
  assert.equal(observations[0].used_percent, 58);
});

test('parseClaudeRateLimitEvent converts 0..1 utilization ratio to percent and preserves reset on rejection', async () => {
  const { parseClaudeRateLimitEvent } = await import('./passive.mjs');
  const ctx = { cliVersion: '2.1.331', sessionId: 'claude-sess-root-1' };
  const warning = parseClaudeRateLimitEvent(claudePassive.headlessEvent, ctx);
  assert.equal(warning.length, 1);
  assert.equal(warning[0].cli, 'claude');
  assert.equal(warning[0].bucket, 'five_hour');
  assert.equal(warning[0].used_percent, 87);
  assert.equal(warning[0].window_minutes, 300);
  assert.equal(warning[0].resets_at, '2026-11-26T16:00:00.000Z');
  assert.equal(warning[0].source, 'claude-headless');

  const rejected = parseClaudeRateLimitEvent(claudePassive.headlessRejectedNoUtilization, ctx);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].bucket, 'seven_day_opus');
  assert.equal(rejected[0].used_percent, null);
  assert.equal(rejected[0].resets_at, '2026-12-02T17:00:00.000Z');
});

test('parseClaudeTranscriptLine parses root rate_limit_info and ignores sidechain or foreign session rows', async () => {
  const { parseClaudeTranscriptLine } = await import('./passive.mjs');
  const ctx = { cliVersion: '2.1.331', sessionId: 'claude-sess-root-1' };
  const root = parseClaudeTranscriptLine(claudePassive.transcriptRootRow, ctx);
  assert.equal(root.length, 1);
  assert.equal(root[0].bucket, 'seven_day');
  assert.equal(root[0].used_percent, 42);
  assert.equal(root[0].source, 'claude-transcript');
  assert.equal(root[0].observed_at, '2026-11-26T11:15:00.000Z');

  const sidechain = parseClaudeTranscriptLine(claudePassive.transcriptSidechainRow, ctx);
  assert.deepEqual(sidechain, []);

  const wrongSession = parseClaudeTranscriptLine(claudePassive.transcriptRootRow, { ...ctx, sessionId: 'other-session' });
  assert.deepEqual(wrongSession, []);
});

test('parseClaudeStatuslinePayload and parseAgyStatuslinePayload normalize window usage and resets', async () => {
  const { parseClaudeStatuslinePayload, parseAgyStatuslinePayload } = await import('./passive.mjs');
  const claudeObs = parseClaudeStatuslinePayload(claudePassive.statuslinePayload, {
    cliVersion: '2.1.331',
    sessionId: 'claude-sess-root-1',
    observedAt: '2026-11-26T12:00:00.000Z',
  });
  assert.equal(claudeObs.length, 2);
  const fiveHour = claudeObs.find(o => o.bucket === 'five_hour');
  assert.equal(fiveHour.used_percent, 18);
  assert.equal(fiveHour.resets_at, new Date(1795708800 * 1000).toISOString());
  assert.equal(fiveHour.source, 'claude-statusline');

  const agyObs = parseAgyStatuslinePayload(agyStatusline, {
    cliVersion: '1.5.17',
    sessionId: 'agy-sess-1',
    observedAt: '2026-11-26T12:00:00.000Z',
  });
  assert.equal(agyObs.length, 2);
  const gemini5h = agyObs.find(o => o.limit_id === 'gemini-5h');
  assert.equal(gemini5h.cli, 'agy');
  assert.equal(gemini5h.plan, 'google_ai_ultra');
  assert.equal(gemini5h.used_percent, 25.6);
  assert.equal(gemini5h.window_minutes, 300);
  assert.equal(gemini5h.model, 'Gemini Models');
  assert.equal(gemini5h.source, 'agy-statusline');
});

test('parseAgyStatuslinePayload accepts agy 1.5.18 fixture and tags valid unlisted versions', async () => {
  const { parseAgyStatuslinePayload } = await import('./passive.mjs');
  const agyObs = parseAgyStatuslinePayload(agyStatusline1518, {
    cliVersion: '1.5.18',
    sessionId: 'agy-sess-1518',
    observedAt: '2026-11-26T16:33:32.000Z',
  });
  assert.equal(agyObs.length, 2);
  const gemini5h = agyObs.find(o => o.limit_id === 'gemini-5h');
  const geminiWeekly = agyObs.find(o => o.limit_id === 'gemini-weekly');
  assert.equal(gemini5h.used_percent, 49.64);
  assert.equal(gemini5h.window_minutes, 300);
  assert.equal(geminiWeekly.used_percent, 19.22);
  assert.equal(geminiWeekly.window_minutes, 10080);

  assertVersionObservation(parseAgyStatuslinePayload, agyStatusline1518, {
    cli: 'agy', cliVersion: '999.0.0', source: 'agy-statusline',
    observedAt: '2026-11-26T16:33:32.000Z', sessionId: 'agy-sess-1518',
  }, true);
});

function assertVersionObservation(parse, input, { cli, cliVersion, source, observedAt, ...identity }, unverified = false) {
  const diagnostics = [];
  const observations = parse(input, {
    cliVersion, observedAt, ...identity,
    observeAccountDiagnostics: batch => diagnostics.push(...batch),
  });
  if (unverified) {
    assert.ok(observations.length, source);
    assert.ok(observations.every(row => row.version_status === 'unverified' && row.cli_version === (cliVersion ?? null)));
  } else assert.deepEqual(observations, [], source);
  assert.deepEqual(diagnostics, [{
    cli, status: unverified ? 'unverified' : 'unsupported',
    reason: unverified ? 'unverified-version' : 'unsupported-version-shape',
    cliVersion: cliVersion ?? null, source, observedAt, ...identity,
  }]);
}

test('Codex rollout and push tag unlisted versions and reject mismatched shapes', async () => {
  const { parseCodexRolloutLine, parseCodexPushNotification } = await import('./passive.mjs');
  const rollout = codexRolloutLines[0];
  const badRollout = { ...rollout, payload: { ...rollout.payload, rate_limits: 'wrong-shape' } };
  const badPush = { ...codexPush, params: { ...codexPush.params, rateLimits: 'wrong-shape' } };
  const cases = [
    [parseCodexRolloutLine, rollout, badRollout, 'codex-rollout', rollout.timestamp],
    [parseCodexPushNotification, codexPush, badPush, 'codex-app-server-push', '2026-11-26T10:10:00.000Z'],
  ];
  for (const [parse, goodShape, badShape, source, observedAt] of cases) {
    for (const [cliVersion, input] of [['999.0.0', goodShape], ['0.171.0', badShape]]) {
      assertVersionObservation(parse, input, { cli: 'codex', cliVersion, source, observedAt, accountRef: 'fixture-codex' }, input === goodShape);
    }
  }
});

test('Claude headless and transcript tag unlisted versions and reject mismatched shapes', async () => {
  const { parseClaudeRateLimitEvent, parseClaudeTranscriptLine } = await import('./passive.mjs');
  const cases = [
    [parseClaudeRateLimitEvent, claudePassive.headlessEvent, 'claude-headless'],
    [parseClaudeTranscriptLine, claudePassive.transcriptRootRow, 'claude-transcript'],
  ];
  for (const [parse, row, source] of cases) {
    for (const [cliVersion, input] of [
      ['999.0.0', row],
      ['2.1.331', { ...row, rate_limit_info: 'wrong-shape' }],
    ]) {
      assertVersionObservation(parse, input, {
        cli: 'claude', cliVersion, source, observedAt: row.timestamp, sessionId: 'claude-sess-root-1',
      }, input === row);
    }
  }
});

test('a recognized quota event with no version reports unverified usage', async () => {
  const { parseCodexPushNotification } = await import('./passive.mjs');
  assertVersionObservation(parseCodexPushNotification, codexPush, {
    cli: 'codex', source: 'codex-app-server-push', observedAt: '2026-11-26T10:10:00.000Z', generation: 'gen-1',
  }, true);
});
