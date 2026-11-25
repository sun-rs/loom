import assert from 'node:assert/strict';
import test from 'node:test';
import { protocolEvents } from './events.mjs';
import { spawnHeadless } from './index.mjs';

function fixture(cli, nativeReply = () => null) {
  const events = [];
  const exits = [];
  const map = protocolEvents({
    addr: 'worker', sessionId: 'native', cli, nativeReply,
    write: event => events.push(event), exited: at => exits.push(at),
  });
  let seq = 0;
  const event = (kind, data) => map({ sessionId: 'native', agentPath: [], seq: ++seq, receivedAt: seq * 100, kind, ...data });
  const end = outcome => event('turn_ended', { outcome });
  return { events, event, end, exits };
}

test('Codex sends root turn boundaries, final text and deduplicated token increments', () => {
  const { events, event, end, exits } = fixture('codex');
  event('turn_active', { agentPath: ['child'] });
  event('turn_active');
  event('text_delta', { phase: 'commentary', text: 'Working' });
  event('text_delta', { phase: 'final_answer', messageId: 'final', text: '完成\n' });
  event('text_delta', { phase: 'final_answer', messageId: 'final', text: '\n🧵 ' });
  const usage = { tokens: { input: 20, output: 4, cacheRead: 7, reasoning: 1 } };
  event('usage', { usage });
  event('usage', { usage });
  end({ kind: 'completed' });
  event('turn_active');
  event('text_delta', { sessionId: 'other', phase: 'final_answer', text: 'Foreign' });
  event('usage', { usage: { tokens: { input: 40, output: 5, cacheRead: 10, reasoning: 1 } } });
  end({ kind: 'aborted' });
  event('exited');

  assert.deepEqual(events.map(e => [e.type, e.turn]), [
    ['turn-start', 1], ['usage', 1], ['turn-end', 1],
    ['turn-start', 2], ['usage', 2], ['turn-end', 2],
  ]);
  assert.equal(events[2].finalReply, '完成\n\n🧵 ');
  assert.equal(events[5].finalReply, null);
  assert.deepEqual(events[1].usage, { inputTokens: 20, outputTokens: 4, cachedInputTokens: 7, reasoningOutputTokens: 1 });
  assert.deepEqual(events[4].usage, { inputTokens: 20, outputTokens: 1, cachedInputTokens: 3 });
  assert.equal(events[2].eventId, 'worker:8:turn-end');
  assert.deepEqual(exits, [1300]);
});

test('agy uses native reply and marks a repeated quota block once', () => {
  const { events, event, end } = fixture('agy', turn => turn === 3 ? ' 原生回复\n' : null);
  event('usage', { usage: { context: { tokens: 4 } } });
  end({ kind: 'failed', failure: 'quota' });
  end({ kind: 'failed', failure: 'rate_limited' });
  event('text_delta', { text: 'progress' });
  event('tool_call_started');
  event('text_delta', { text: 'streamed' });
  event('usage', { usage: { total: { input: 10, output: 2, cacheWrite: 3 } } });
  end({ kind: 'completed' });
  end({ kind: 'failed', failure: 'quota' });

  assert.deepEqual(events.filter(e => e.type === 'stuck').map(e => e.reason), ['rate-limit', 'rate-limit']);
  assert.deepEqual(events.filter(e => e.type === 'turn-start').map(e => e.turn), [1, 2, 3, 4]);
  assert.deepEqual(events.filter(e => e.type === 'turn-end').map(e => e.finalReply), [null, null, ' 原生回复\n', null]);
  assert.deepEqual(events.find(e => e.type === 'usage').usage, { inputTokens: 10, outputTokens: 2, cacheWriteInputTokens: 3 });
});

test('restricted CLI names are rejected before opening a session', async () => {
  await assert.rejects(spawnHeadless({
    cli: 'claude', cwd: '.', project: 'demo', task: 'T1', wave: 'W1', prompt: 'test',
  }), /Expected codex or agy/);
});
