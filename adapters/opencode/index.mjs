import { deliveryId } from '../../inbox/message.mjs';

const iso = value => typeof value === 'number' ? new Date(value).toISOString() : value ?? null;
const time = value => typeof value === 'number' ? value : Date.parse(value);
const textOf = parts => (parts ?? []).filter(part => part.type === 'text' && !part.synthetic)
  .map(part => part.text).filter(Boolean).join('\n');

export function projectMessages(data, sessionId, cwd) {
  if (data.info?.id !== sessionId || !Array.isArray(data.messages)) return null;
  const rows = [];
  let turn;
  let reply;
  for (const entry of data.messages) {
    const at = time(entry.time?.created);
    if (!Number.isFinite(at)) continue;
    if (entry.type === 'user') {
      turn = { cwd, session_id: sessionId, turn_id: entry.id, deliveryId: deliveryId(entry.text) };
      reply = undefined;
      rows.push({ ...turn, receivedAt: at, hook_event_name: 'UserPromptSubmit' });
    } else if (turn && entry.type === 'assistant') {
      reply = entry.finish === 'stop' ? textOf(entry.content) : undefined;
    } else if (turn && entry.type === 'idle') {
      const failed = entry.outcome !== 'succeeded';
      rows.push({ ...turn, receivedAt: at, hook_event_name: failed ? 'StopFailure' : 'Stop',
        is_interrupt: /abort|cancel|interrupt/i.test(entry.outcome ?? ''),
        last_assistant_message: failed ? undefined : reply, error: failed });
      turn = undefined;
    }
  }
  return rows;
}

function parse(text) {
  const byId = new Map();
  for (const line of text.split('\n').filter(Boolean)) {
    const row = JSON.parse(line);
    const id = row.turnId ?? row.turn_id;
    if (!id) continue;
    if (row.type === 'turn-start' || row.hook_event_name === 'UserPromptSubmit') {
      byId.set(id, { id, index: byId.size + 1, startedAt: iso(row.receivedAt ?? row.at), endedAt: null,
        status: 'incomplete', reply: null, usage: {}, calls: [] });
    }
    const turn = byId.get(id);
    if (turn && (row.type === 'turn-end' || ['Stop', 'StopFailure'].includes(row.hook_event_name))) {
      turn.endedAt = iso(row.receivedAt ?? row.at);
      turn.reply = row.finalReply ?? row.last_assistant_message ?? null;
      turn.status = row.outcome?.kind === 'aborted' || row.is_interrupt ? 'interrupted' :
        row.outcome?.kind === 'failed' || row.error ? 'incomplete' : 'completed';
    }
  }
  const turns = [...byId.values()];
  return { provider: 'opencode', turns, lastReply: turns.findLast(turn => turn.reply)?.reply ?? null, usage: {} };
}

function launch({ model, effort, sessionId }) {
  const variant = effort ? `${model}#${effort}` : model;
  return {
    argv: ['opencode', 'mini', '--standalone', '--session', sessionId, '--agent', 'loom', '--model', variant],
    env: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ default_agent: 'loom', agents: { loom: { mode: 'primary', model: variant } } }) },
  };
}

const miniMenuFooter = / · ctrl\+p menu\s*$/i;
const interruptFooter = /Press esc again to interrupt\s*$/i;
export const miniHint = 'Ask anything, / for commands, @ for context…';
export const isMiniComposerFooter = line => miniMenuFooter.test(line) || interruptFooter.test(line);

function classify(text) {
  const lines = text.trim().split('\n').map(line => line.trim()).filter(Boolean);
  const footer = lines.at(-1) ?? '';
  const prompt = lines.at(-2) ?? '';
  if (/^(?:[!✗]\s*)?(?:HTTP 429|rate limit(?:ed)?|quota exceeded)\b/i.test(prompt)) return 'rate-limit';
  if (/^(?:[!✗]\s*)?(?:no credentials|not authenticated|unauthorized)\b/i.test(prompt)) return 'auth-fail';
  if (/\besc interrupt · /i.test(footer) || interruptFooter.test(footer)) return 'busy';
  if (miniMenuFooter.test(footer)) {
    const current = lines.slice(Math.max(0, lines.findLastIndex(line => /^›\s/.test(line))));
    if (current.some(line => /^Free usage limit reached\b/i.test(line))) return 'rate-limit';
    if (/^┃(?:\s|$)/.test(prompt) && ['', miniHint].includes(prompt.slice(1).trim())) return 'idle';
  }
  return 'unknown';
}

export function miniDraft(text) {
  const lines = text.trimEnd().split('\n').map(line => line.trimEnd());
  if (!isMiniComposerFooter(lines.pop() ?? '')) return;
  while (lines.at(-1) === '') lines.pop();
  const first = lines.findLastIndex(line => !/^┃(?: |$)/.test(line));
  if (lines.length <= first + 1) return;
  const draft = lines.slice(first + 1).map(line => line.replace(/^┃ ?/, '')).join('\n');
  return draft === miniHint ? '' : draft;
}

export default {
  id: 'opencode', launch,
  capabilities: { steer: 'none', interrupt: true, resumeSamePane: true },
  screen: { classify, dialogKeys: () => [] },
  hooks: { normalize: row => ({
    type: row.is_interrupt ? 'turn-end' :
      { UserPromptSubmit: 'turn-start', Stop: 'turn-end', StopFailure: 'stop-failure' }[row.hook_event_name],
    sessionId: row.session_id,
  }) },
  transcript: { parse, turnSummary: ({ turns }, index) => `回复 ${turns[index - 1]?.reply ?? '无'}` },
  input: { plan: mode => ({ mode: mode === 'steer' ? 'queue' : mode,
    steps: [...(mode === 'interrupt' ? [{ type: 'key', key: 'esc' }, { type: 'key', key: 'esc' }] : []), { type: 'text' }, { type: 'key', key: 'enter' }] }) },
};
