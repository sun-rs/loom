// Source: /Users/sun/Code/exp-relay/orca/test/codex.test.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseCodex } from './parse.mjs';

const record = (type, timestamp, payload) => ({ type, timestamp, payload });
const event = (type, timestamp, payload) => record('event_msg', timestamp, { type, ...payload });
const item = (type, timestamp, payload) => record('response_item', timestamp, { type, ...payload });
const user = (timestamp, text, id) => item('message', timestamp, {
  role: 'user', id, content: [{ type: 'input_text', text }],
});
const assistant = (timestamp, text, phase) => item('message', timestamp, {
  role: 'assistant', phase, content: [{ type: 'output_text', text }],
});
const modern = (timestamp, response_id, usage, fields) => record('token_usage_record', timestamp, {
  response_id, usage, ...fields,
});
const legacy = (timestamp, last_token_usage, total_token_usage) => event('token_count', timestamp, {
  info: { last_token_usage, total_token_usage },
});
const jsonl = (...records) => records.map(entry => JSON.stringify(entry)).join('\n');

function usage(calls = 0, inputTokens = 0, cachedInputTokens = 0, cacheWriteInputTokens = 0,
  outputTokens = 0, reasoningOutputTokens = 0) {
  return { calls, inputTokens, cachedInputTokens, cacheWriteInputTokens, outputTokens, reasoningOutputTokens };
}

function call(id, timestamp, ...counts) {
  const { calls, ...tokens } = usage(1, ...counts);
  return { id, timestamp, ...tokens };
}

function turn(index, id, startedAt, endedAt, status, reply, totals = usage(), calls = []) {
  return { index, id, startedAt, endedAt, status, reply, usage: totals, calls };
}

test('returns an exact empty session for empty input or records without a turn boundary', () => {
  const empty = { provider: 'codex', turns: [], lastReply: null, usage: usage() };
  assert.deepEqual(parseCodex(''), empty);
  assert.deepEqual(parseCodex('\uFEFF \r\n\t\n'), empty);
  assert.deepEqual(parseCodex(jsonl(
    null, 20, true, 'not an object', [], {},
    record('event_msg', 'invalid', null), record('response_item', 'invalid', []),
    record('session_meta', 'session', { id: 'session' }),
    record('turn_context', 'context', { turn_id: 'unused' }),
    record('compacted', 'compacted', { message: 'summary' }),
    assistant('orphan reply', 'orphan', 'final_answer'),
    modern('orphan usage', 'call', { input_tokens: 10 }),
    legacy('orphan snapshot', { input_tokens: 10 }, { input_tokens: 10 }),
    event('task_complete', 'orphan exit', { last_agent_message: 'orphan' }),
  )), empty);
});

test('reads BOM, CRLF, empty and corrupt lines, and a long final record without a trailing newline', () => {
  const reply = ` \t# 标题 🌌\r\n\n${'保留 **正文** 🧪\n'.repeat(20_000)}\n \t`;
  const lines = [
    `\uFEFF${jsonl(user('  original start time  ', '请求'))}`,
    '', '   ', 'null', '[]', '"response_item"', '{broken',
    jsonl(item('message', '  original reply time  ', {
      role: 'assistant',
      phase: 'final_answer',
      content: [
        { type: 'output_text', text: reply.slice(0, 1000) },
        { type: 'input_text', text: 'excluded' },
        null,
        { type: 'text', text: 12 },
        { type: 'text', text: reply.slice(1000) },
      ],
    })),
  ];
  const text = lines.join('\r\n');
  const expected = {
    provider: 'codex',
    turns: [turn(1, null, '  original start time  ', '  original reply time  ', 'completed', reply)],
    lastReply: reply,
    usage: usage(),
  };
  assert.deepEqual(parseCodex(text), expected);
  assert.deepEqual(parseCodex(`${text}\r\n{"type":"response_item","payload":`), expected);
});

test('uses explicit start and exit times, and prefers the complete event reply', () => {
  const fallback = '  回复\n```js\n42\n``` 🧪\t';
  const result = parseCodex(jsonl(
    event('task_started', 'first start', { turn_id: 'first', started_at: 100 }),
    user('user item time', 'implicit user', 'user-id'),
    event('user_message', 'mirrored time', { message: 'implicit user' }),
    assistant('phase final', 'a different reply', 'final_answer'),
    event('task_complete', 'first end', { turn_id: 'first', completed_at: 110, last_agent_message: fallback }),
    event('turn_started', 'second start', { turn_id: 'second' }),
    assistant('draft', 'draft'),
    assistant('second final', '正文 🧪', 'final_answer'),
    assistant('progress update', 'progress only', 'commentary'),
    event('agent_message', 'mirrored reply', { message: 'legacy candidate' }),
    event('turn_complete', 'second end', { turn_id: 'second', last_agent_message: '\t\n ' }),
    event('turn_started', undefined, { turn_id: 15, started_at: 120 }),
    event('task_complete', 125, { completed_at: 125 }),
  ));

  assert.deepEqual(result, {
    provider: 'codex',
    turns: [
      turn(1, 'first', 'first start', 'first end', 'completed', fallback),
      turn(2, 'second', 'second start', 'second end', 'completed', '正文 🧪'),
      turn(3, null, null, null, 'completed', null),
    ],
    lastReply: '正文 🧪',
    usage: usage(),
  });
});

test('coalesces opposite encodings of the same user message and preserves distinct user boundaries', () => {
  const result = parseCodex(jsonl(
    user('environment', ' \n<environment_context>context</environment_context>', 'ignored'),
    event('user_message', 'instructions', { message: '<user_instructions>rules</user_instructions>' }),
    item('message', 'system', { role: 'system' }),
    item('message', 'developer', { role: 'developer' }),
    event('user_message', 'first event', { message: '重复 🧪' }),
    record('turn_context', 'context between mirrors', { turn_id: 'not a boundary' }),
    user('first item', '重复 🧪', 'item-1'),
    assistant('first reply', '回复 1', 'final_answer'),
    user('second item', '重复 🧪', 'item-2'),
    event('user_message', 'second event', { id: 'event-id', message: '重复 🧪' }),
    assistant('second reply', '回复 2', 'final_answer'),
    event('user_message', 'third event', { message: 'same again' }),
    event('user_message', 'fourth event', { message: 'same again' }),
    user('fifth item', 'different text', 'item-5'),
  ));

  assert.deepEqual(result.turns, [
    turn(1, 'item-1', 'first event', 'first reply', 'completed', '回复 1'),
    turn(2, 'item-2', 'second item', 'second reply', 'completed', '回复 2'),
    turn(3, null, 'third event', null, 'incomplete', null),
    turn(4, null, 'fourth event', null, 'incomplete', null),
    turn(5, 'item-5', 'fifth item', null, 'incomplete', null),
  ]);
  assert.equal(result.lastReply, '回复 2');
});

test('keeps only eligible legacy assistant text and requires a completion or a subsequent user boundary', () => {
  const result = parseCodex(jsonl(
    user('first start', 'first'),
    assistant('old item', 'old text'),
    item('function_call', 'function call'),
    item('function_call_output', 'function output', { output: 'not eligible' }),
    event('agent_message', 'older event', { message: 'older reply' }),
    event('agent_message', 'commentary event', { phase: 'commentary', message: 'commentary only' }),
    item('reasoning', 'reasoning', { content: [{ type: 'text', text: 'not eligible' }] }),
    record('compacted', 'compaction', { message: 'not eligible', replacement_history: ['ignored'] }),
    user('second start', 'second'),
    assistant('second reply', '\n最后一段 🧪  '),
    event('task_complete', 'second end'),
    user('third start', 'third'),
    assistant('third reply', 'discarded'),
    item('custom_tool_call', 'custom tool call'),
    assistant('commentary', 'still in progress', 'commentary'),
    event('task_complete', 'third end'),
    user('fourth start', 'fourth'),
    event('agent_message', 'fourth reply', { message: 'discarded' }),
    event('exec_command_begin', 'legacy tool call'),
    user('fifth start', 'fifth'),
    event('agent_message', 'fifth reply', { message: 'a legacy candidate at EOF' }),
  ));

  assert.deepEqual(result.turns, [
    turn(1, null, 'first start', 'older event', 'completed', 'older reply'),
    turn(2, null, 'second start', 'second end', 'completed', '\n最后一段 🧪  '),
    turn(3, null, 'third start', 'third end', 'completed', null),
    turn(4, null, 'fourth start', null, 'incomplete', null),
    turn(5, null, 'fifth start', null, 'incomplete', null),
  ]);
  assert.equal(result.lastReply, '\n最后一段 🧪  ');
});

test('settles an open turn on a new explicit start, and clears every reply on abort', () => {
  const result = parseCodex(jsonl(
    event('task_started', 'first start', { turn_id: 'first' }),
    event('task_started', 'second start', { turn_id: 'second' }),
    assistant('second reply', 'preserved', 'final_answer'),
    event('turn_started', 'third start', { turn_id: 'third' }),
    assistant('third reply', 'discarded', 'final_answer'),
    modern('third call', 'third-call', { output_tokens: 3, reasoning_output_tokens: 2 }),
    event('turn_aborted', 'third end', { turn_id: 'third', last_agent_message: 'discarded too' }),
    event('turn_started', 'fourth start', { turn_id: 'fourth' }),
    assistant('fourth reply', ' \n\t ', 'final_answer'),
  ));

  assert.deepEqual(result.turns, [
    turn(1, 'first', 'first start', null, 'incomplete', null),
    turn(2, 'second', 'second start', 'second reply', 'completed', 'preserved'),
    turn(3, 'third', 'third start', 'third end', 'interrupted', null,
      usage(1, 0, 0, 0, 3, 2), [call('third-call', 'third call', 0, 0, 0, 3, 2)]),
    turn(4, 'fourth', 'fourth start', 'fourth reply', 'completed', null),
  ]);
  assert.equal(result.lastReply, 'preserved');
  assert.deepEqual(result.usage, usage(1, 0, 0, 0, 3, 2));
});

test('uses the last valid modern record per response ID in first-seen position', () => {
  const totals = {
    input_tokens: 800,
    cached_input_tokens: 700,
    cache_write_input_tokens: 600,
    output_tokens: 500,
    reasoning_output_tokens: 400,
  };
  const result = parseCodex(jsonl(
    event('turn_started', 'start', { turn_id: 'modern turn' }),
    legacy('duplicate legacy record', totals),
    modern('first version', 'first', { input_tokens: 1 }),
    modern('second call', 'second', { input_tokens: 3 }, { turn_token_usage: totals, thread_token_usage: totals }),
    modern('ignored aggregate', 'aggregate', { total_tokens: 30 }, { turn_token_usage: totals }),
    modern('ignored invalid', 'invalid', {
      input_tokens: -1, cached_input_tokens: 1.1, cache_write_input_tokens: Number.MAX_SAFE_INTEGER + 1,
      output_tokens: '10', reasoning_output_tokens: true,
    }),
    modern('unidentified call', undefined, { input_tokens: 2, cache_write_input_tokens: -1 }),
    modern(15, null, { output_tokens: 2.5, reasoning_output_tokens: 0 }),
    modern('valid replacement', 'first', {
      input_tokens: 10, cached_input_tokens: 4, cache_write_input_tokens: 2,
      output_tokens: 6, reasoning_output_tokens: 3,
    }),
    modern('invalid replacement', 'first', { cached_input_tokens: null, output_tokens: '6' }),
    event('turn_complete', 'end', { turn_id: 'modern turn' }),
    event('turn_started', 'later start', { turn_id: 'later turn' }),
    modern('late record', 'late', { output_tokens: 4 }, { turn_id: 'modern turn' }),
  ));

  const expectedCalls = [
    call('first', 'valid replacement', 10, 4, 2, 6, 3),
    call('second', 'second call', 3),
    call(null, 'unidentified call', 2),
    call(null, null),
    call('late', 'late record', 0, 0, 0, 4),
  ];
  assert.deepEqual(result.turns, [
    turn(1, 'modern turn', 'start', 'end', 'completed', null, usage(5, 15, 4, 2, 10, 3), expectedCalls),
    turn(2, 'later turn', 'later start', null, 'incomplete', null),
  ]);
  assert.deepEqual(result.usage, usage(5, 15, 4, 2, 10, 3));
});

test('uses legacy snapshots across turns, ignores repeats, and starts a reset field at its new count', () => {
  const prefix = { input_tokens: 100, cached_input_tokens: 40, output_tokens: 15, reasoning_output_tokens: 5 };
  const reset = { input_tokens: 5, cached_input_tokens: 43, cache_write_input_tokens: 2, output_tokens: 21 };
  const result = parseCodex(jsonl(
    legacy('outside baseline', { input_tokens: 100 }, prefix),
    user('modern turn start', 'first'),
    modern('modern call', 'modern', { input_tokens: 12 }),
    legacy('shadowed legacy call', { input_tokens: 12 }, { ...prefix, input_tokens: 112 }),
    event('task_complete', 'modern turn end'),
    legacy('outside updated baseline', undefined, { ...prefix, input_tokens: 120, output_tokens: 17 }),
    user('legacy turn start', 'second'),
    modern('invalid modern record', 'ignored', { input_tokens: false }),
    legacy('snapshot difference', undefined, { ...prefix, input_tokens: 125, cached_input_tokens: 42, output_tokens: 20 }),
    legacy('duplicate snapshot', { input_tokens: 999 }, { ...prefix, input_tokens: 125, cached_input_tokens: 42, output_tokens: 20 }),
    legacy('reset input only', null, { ...reset, reasoning_output_tokens: 5 }),
    legacy('explicit last usage', {
      input_tokens: 9, cached_input_tokens: 3, cache_write_input_tokens: 1, output_tokens: 4,
      reasoning_output_tokens: 2,
    }, { input_tokens: 1000, cached_input_tokens: 50, cache_write_input_tokens: 3, output_tokens: 25 }),
    legacy('no snapshot 1', { input_tokens: 3, cached_input_tokens: -4, output_tokens: 1.2 }),
    legacy('no snapshot 2', { input_tokens: 3 }),
    legacy('invalid counts', { input_tokens: '3', output_tokens: -1 }),
    legacy('valid zero', { reasoning_output_tokens: 0 }),
    event('turn_aborted', 'legacy turn end'),
  ));

  assert.deepEqual(result.turns, [
    turn(1, null, 'modern turn start', 'modern turn end', 'completed', null,
      usage(1, 12), [call('modern', 'modern call', 12)]),
    turn(2, null, 'legacy turn start', 'legacy turn end', 'interrupted', null,
      usage(6, 25, 6, 3, 8, 2), [
        call(null, 'snapshot difference', 5, 2, 0, 3),
        call(null, 'reset input only', 5, 1, 2, 1),
        call(null, 'explicit last usage', 9, 3, 1, 4, 2),
        call(null, 'no snapshot 1', 3),
        call(null, 'no snapshot 2', 3),
        call(null, 'valid zero'),
      ]),
  ]);
  assert.deepEqual(result.usage, usage(7, 37, 6, 3, 8, 2));
});

test('derives a first legacy snapshot from zero, accepts safe integers, and gives valid modern zeros priority', () => {
  const result = parseCodex(jsonl(
    user('start first', 'first'),
    legacy('first snapshot', undefined, { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 0 }),
    user('start second', 'second'),
    legacy('legacy call', { input_tokens: 20 }),
    modern('valid modern zero', 'zero', { input_tokens: 0 }),
  ));

  assert.deepEqual(result.turns, [
    turn(1, null, 'start first', null, 'incomplete', null,
      usage(1, Number.MAX_SAFE_INTEGER), [call(null, 'first snapshot', Number.MAX_SAFE_INTEGER)]),
    turn(2, null, 'start second', null, 'incomplete', null,
      usage(1), [call('zero', 'valid modern zero')]),
  ]);
  assert.deepEqual(result.usage, usage(2, Number.MAX_SAFE_INTEGER));
});

test('uses aggregate-only legacy snapshots for deduplication without treating totals as call counts', () => {
  const result = parseCodex(jsonl(
    event('turn_started', 'start', { turn_id: 'legacy' }),
    legacy('first', { output_tokens: 2 }, { total_tokens: 2 }),
    legacy('duplicate', { output_tokens: 2 }, { total_tokens: 2 }),
    legacy('aggregate only', undefined, { total_tokens: 3 }),
    assistant('tail', '旧版回复'),
    event('turn_started', 'next start', { turn_id: 'next' }),
  ));

  assert.deepEqual(result, {
    provider: 'codex',
    turns: [
      turn(1, 'legacy', 'start', 'tail', 'completed', '旧版回复',
        usage(1, 0, 0, 0, 2), [call(null, 'first', 0, 0, 0, 2)]),
      turn(2, 'next', 'next start', null, 'incomplete', null),
    ],
    lastReply: '旧版回复',
    usage: usage(1, 0, 0, 0, 2),
  });
});

test('matches the public Codex fixture across all five turns and eight model calls', () => {
  const fixture = readFileSync(new URL('./fixtures/experiment/codex.jsonl', import.meta.url), 'utf8');
  const timestamp = time => `2026-11-24T14:${time}Z`;
  const longReply = [
    '1. 🧪 样本已就绪。',
    '2. 🧪 命令已执行。',
    '3. 🧪 首行编号为 001。',
    '4. 🧪 末行编号为 220。',
    '5. 🧪 共输出 220 行。',
    '6. 🧪 每行带有编号。',
    '7. 🧪 字母按顺序排列。',
    '8. 🧪 数字从零排到九。',
    '9. 🧪 三位编号保留前导零。',
    '10. 🧪 每行使用相同格式。',
    '11. 🧪 命令正常退出。',
    '12. 🧪 操作在当前目录完成。',
    '13. 🧪 命令仅输出文本。',
    '14. 🧪 文件未被修改。',
    '15. 🧪 未访问外部信息。',
    '16. 🧪 短句编号到此结束。',
    '',
    '长输出样本结束 🧪',
  ].join('\n');
  const lastReply = '预期的文件不存在错误已记录 🍃';

  assert.deepEqual(parseCodex(fixture), {
    provider: 'codex',
    turns: [
      turn(1, '<ID_002>', timestamp('24:12.978'), timestamp('24:19.303'), 'completed', '星河样本已读取 🌌',
        usage(2, 39634, 14080, 0, 73), [
          call('<ID_007>', timestamp('24:17.468'), 19749, 7040, 0, 61),
          call('<ID_010>', timestamp('24:19.284'), 19885, 7040, 0, 12),
        ]),
      turn(2, '<ID_011>', timestamp('25:03.420'), timestamp('25:13.419'), 'completed', longReply,
        usage(2, 40354, 39680, 0, 305), [
          call('<ID_016>', timestamp('25:07.431'), 20020, 19840, 0, 102),
          call('<ID_019>', timestamp('25:13.416'), 20334, 19840, 0, 203),
        ]),
      turn(3, '<ID_020>', timestamp('25:52.740'), timestamp('26:13.239'), 'interrupted', null,
        usage(1, 20612, 20096, 0, 71), [call('<ID_025>', timestamp('25:55.774'), 20612, 20096, 0, 71)]),
      turn(4, '<ID_027>', timestamp('26:28.898'), timestamp('26:32.789'), 'completed', '中断后已恢复 ✅',
        usage(1, 20805, 20352, 0, 10), [call('<ID_030>', timestamp('26:32.784'), 20805, 20352, 0, 10)]),
      turn(5, '<ID_031>', timestamp('30:04.122'), timestamp('30:10.579'), 'completed', lastReply,
        usage(2, 41915, 41472, 0, 82), [
          call('<ID_036>', timestamp('30:08.667'), 20889, 20608, 0, 68),
          call('<ID_039>', timestamp('30:10.574'), 21026, 20864, 0, 14),
        ]),
    ],
    lastReply,
    usage: usage(8, 163320, 135680, 0, 541),
  });
});
