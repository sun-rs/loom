import assert from 'node:assert/strict';
import { test } from 'node:test';
import opencode, { miniDraft, projectMessages } from './index.mjs';

test('projects an OpenCode v2 export using the user marker and native idle outcome', () => {
  const sessionId = 'ses_test';
  const id = '1abccf55-3e45-4544-bcc4-ff080502948a';
  const data = { info: { id: sessionId }, messages: [
    { type: 'agent-switched', time: { created: 1 } },
    { type: 'user', id: 'msg1', time: { created: 2 }, text: `[loom:${id}]\nquestion` },
    { type: 'assistant', finish: 'tool-calls', time: { created: 3 }, content: [{ type: 'text', text: 'intermediate' }] },
    { type: 'assistant', finish: 'stop', time: { created: 4 }, content: [{ type: 'text', text: 'answer' }] },
    { type: 'idle', outcome: 'succeeded', time: { created: 5 } },
    { type: 'user', id: 'msg2', time: { created: 6 }, text: 'another question' },
    { type: 'assistant', finish: 'error', time: { created: 7 }, content: [] },
    { type: 'idle', outcome: 'failed', time: { created: 8 } },
  ] };
  assert.equal(projectMessages(data, 'other-id', '/test'), null);
  const rows = projectMessages(data, sessionId, '/test');
  assert.equal(rows[0].deliveryId, id);
  assert.equal(rows[1].last_assistant_message, 'answer');
  assert.equal(rows.at(-1).hook_event_name, 'StopFailure');
  assert.equal(opencode.transcript.parse(rows.map(row => JSON.stringify(row)).join('\n')).lastReply, 'answer');
  assert.equal(opencode.screen.classify('┃ Ask anything, / for commands, @ for context…\n\nloom · DeepSeek V4.1 Flash 1017 · DeepSeek · ctrl+p menu'), 'idle');
  assert.equal(opencode.screen.classify('┃\n\n🯧 esc interrupt · loom · DeepSeek V4.1 Flash 1017 · DeepSeek · ctrl+p menu'), 'busy');
  assert.equal(opencode.screen.classify('┃\n\n🯧 Press esc again to interrupt'), 'busy');
  assert.equal(miniDraft('┃ Ask anything, / for commands, @ for context…\n\nloom · DeepSeek V4.1 Flash 1017 · DeepSeek · ctrl+p menu'), '');
  assert.equal(miniDraft(`\n┃ [loom:${id}]\n┃ question\n\nloom · DeepSeek · OpenCode · ctrl+p menu`), `[loom:${id}]\nquestion`);
  assert.deepEqual(opencode.launch({ model: 'deepseek/deepseek-flash', sessionId }).argv.slice(-2), ['--model', 'deepseek/deepseek-flash']);
  assert.equal(opencode.hooks.normalize({ hook_event_name: 'StopFailure', is_interrupt: true, session_id: sessionId }).type, 'turn-end');
});
