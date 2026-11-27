import assert from 'node:assert/strict';
import { mkdtempSync, spawnSync } from '../fixtures/test-process.mjs';
import { readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { rotationReason } from '../daemon/role-budget.mjs';
import { providers } from '../tui/providers.mjs';
import { rootEvents, sessionContext } from './session-context.mjs';

test('window-based rotation is explicit and distinguishes input from occupancy and successful compactions', () => {
  const point = { gate: 'G1', wakes: 100, inputTokens: 600, contextWindow: 1000, percent: 90, compactions: 1 };
  const reason = (roles, overrides) => rotationReason({ roles }, 'leader', { ...point, ...overrides });
  assert.equal(reason({}), undefined);
  assert.equal(reason({ leader: { maxContextTokens: 599 } }), 'context-limit');
  assert.equal(reason({ leader: { maxContextTokens: 600 } }), undefined);
  assert.equal(reason({ leader: { maxContextFraction: 0.6 } }), 'context-window');
  assert.equal(reason({ leader: { maxContextFraction: 0.6 } }, { inputTokens: 599 }), undefined);
  assert.equal(reason({ leader: { maxContextFraction: 0.6 } }, { contextWindow: null }), undefined);
  assert.equal(reason({ leader: { minRemainingAfterCompaction: 0.15 } }), 'post-compaction');
  assert.equal(reason({ leader: { minRemainingAfterCompaction: 0.15 } }, { compactions: 0 }), undefined);
  assert.equal(reason({ leader: { minRemainingAfterCompaction: 0.15 } }, { percent: 85 }), undefined);
  assert.equal(reason({ leader: { rotateAt: 'gate' } }), 'gate');
  assert.equal(reason({ leader: { rotateAt: 'gate' } }, { gate: undefined }), undefined);
});

test('Codex uses the native window and records the first reading after each compaction', () => {
  const session = { cli: 'codex', model: 'gpt-6.2-sol', sessionId: 'root' };
  const raw = [
    { at: 100_000, payload: { type: 'task_started', model_context_window: 1000 } },
    { at: 110_000, payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 900, total_tokens: 980 } } } },
    { at: 120_000, payload: { type: 'context_compacted' } },
    { at: 130_000, payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 200, total_tokens: 250 } } } },
    { at: 150_000, type: 'compacted' },
  ];
  const events = rootEvents(session, [
    { at: 121_000, type: 'compaction_ended', sessionId: 'root', outcome: { kind: 'completed' } },
    { at: 160_000, type: 'compaction_ended', sessionId: 'root', outcome: { kind: 'failed' } },
    { at: 160_000, agent_id: 'child', sessionId: 'root', usage: { context: { tokens: 999, contextWindow: 900 } } },
  ]);
  const metrics = sessionContext(session, { raw }, { events });
  assert.deepEqual(metrics, { tokens: null, inputTokens: null, contextWindow: 1000, percent: null,
    windowSource: 'codex-rollout', compactions: 2, afterCompaction: [
      { at: 120_000, sampledAt: 130_000, percent: 25, contextWindow: 1000, windowSource: 'codex-rollout' },
      { at: 150_000, sampledAt: null, percent: null, contextWindow: null, windowSource: null },
    ] });
});

test('agy prefers native ACP usage and only falls back for a known model', () => {
  const history = { raw: [{ model_name: 'gemini-4-neon-medium' }],
    items: [{ turn: { calls: [{ timestamp: 25, inputTokens: 170_000 }] } }] };
  const row = { cli: 'agy', model: 'gemini-4-neon', sessionId: 'root' };
  const fallback = sessionContext(row, history);
  assert.deepEqual([fallback.contextWindow, fallback.windowSource, fallback.inputTokens], [512_000, 'model-table', 170_000]);
  const native = sessionContext(row, history, { events: [{ at: 26, usage: { context: { tokens: 180_000, contextWindow: 300_000 } } }] });
  assert.deepEqual([native.contextWindow, native.windowSource, native.inputTokens, native.percent], [300_000, 'agy-acp', 170_000, 60]);
  const unknown = sessionContext({ cli: 'agy', model: 'custom' });
  assert.equal(unknown.contextWindow, null);
});

test('Claude derives context telemetry from transcript calls without injecting statusLine under CCP', async t => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'loom-ctx-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "it's context.json");
  const { argv, sessionId } = await providers.claude.start({ cwd: root, hookSink: join(root, 'events.jsonl'), contextStatusPath: path });
  assert.equal(argv.includes('--settings'), false, 'Claude under CCP must not inject statusLine in --settings');

  // Verify the standalone statusline recorder still validates payloads if invoked directly,
  // and that sessionContext measures Claude occupancy from native transcript call usage.
  const recorder = new URL('../runtimes/tui/claude-context.mjs', import.meta.url).pathname;
  const data = { session_id: sessionId, unused: 'ignored metadata', context_window: {
    context_window_size: 200_000, used_percentage: 20,
    current_usage: { input_tokens: 10_000, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 10_000 },
  } };
  const run = value => spawnSync(process.execPath, [recorder, path, sessionId], { input: JSON.stringify(value) });
  assert.equal(run({ ...data, session_id: 'other' }).status, 0);
  assert.throws(() => readFileSync(path), { code: 'ENOENT' });
  assert.equal(run(data).status, 0);
  const statusline = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(Object.keys(statusline), ['sessionId', 'contextWindow', 'inputTokens', 'percent', 'at']);
  const sample = sessionContext({ cli: 'claude', model: 'claude-sonnet-5-5', sessionId }, {}, { statusline });
  assert.deepEqual([sample.contextWindow, sample.windowSource, sample.inputTokens, sample.percent], [200_000, 'claude-statusline', 40_000, 20]);

  const fromTranscript = sessionContext(
    { cli: 'claude', model: 'claude-sonnet-5-5', sessionId },
    {
      raw: [{ type: 'assistant', timestamp: '2026-11-27T10:00:00Z', message: { model: 'claude-sonnet-5-5' } }],
      items: [{ turn: { calls: [{ timestamp: '2026-11-27T10:00:00Z', inputTokens: 250_000 }] } }],
    },
  );
  assert.deepEqual(
    [fromTranscript.contextWindow, fromTranscript.windowSource, fromTranscript.inputTokens, fromTranscript.percent],
    [1_000_000, 'model-table', 250_000, 25],
  );
});
