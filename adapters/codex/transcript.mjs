import { turnActivity } from './activity.mjs';
import { promptPreview } from '../../lib/prompt-preview.mjs';
export { locate } from './locate.mjs';
export { parseCodex as parse } from './parse.mjs';

// Conversation rows as decoded by the former drivers/tui-hooks/codex/src/index.ts.
export function parseCodexTranscriptLine(row) {
  const payload = row?.payload;
  let item;
  if (row?.type === 'response_item') {
    item = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : row;
  } else if (row?.type === 'event_msg' && payload?.type === 'item_completed') {
    item = payload.item;
  }
  if (!item) return [];

  const type = String(item.type ?? '');
  let kind;
  if (['AgentMessage', 'agentMessage'].includes(type) || (type === 'message' && item.role === 'assistant')) {
    kind = 'assistant';
  } else if (['UserMessage', 'userMessage'].includes(type) || (type === 'message' && item.role === 'user')) {
    kind = 'user';
  } else return [];

  let text = typeof item.text === 'string' ? item.text : item.content;
  if (Array.isArray(text)) {
    text = text.map(part => {
      if (typeof part?.text === 'string') return part.text;
      return typeof part?.content === 'string' ? part.content : '';
    }).join('');
  }
  return typeof text === 'string' && text ? [{ kind, text, raw: item }] : [];
}

const statuses = { completed: '完成', interrupted: '中断', incomplete: '未完成' };

// UTF-8 bytes bound the token count for byte-level Codex tokenizers.
function capBytes(text, budget) {
  if (Buffer.byteLength(text) <= budget) return text;
  let clipped = '';
  let remaining = budget - Buffer.byteLength('…');
  for (const character of text) {
    remaining -= Buffer.byteLength(character);
    if (remaining < 0) break;
    clipped += character;
  }
  return clipped.trimEnd() + '…';
}

const compact = text => text.trim().replace(/\s+/gu, ' ');

export function turnSummary(session, n) {
  if (!Number.isInteger(n) || n < 1) return null;
  const turn = session?.turns?.[n - 1];
  if (!turn) return null;

  const activity = turnActivity.get(turn);
  const tools = Array.from(activity?.tools.values() ?? []);
  const names = Array.from(new Set(tools.map(tool => tool.name))).join('、');
  const lines = [`第 ${n} 轮 ${statuses[turn.status]}，工具 ${tools.length} 次` +
    (names ? `（${capBytes(names, 40)}）` : '')];

  const prompt = activity?.prompts.map(promptPreview).filter(Boolean).join(' / ');
  if (prompt) lines.push(`任务 ${capBytes(prompt, 86)}`);

  const failures = tools.filter(tool => tool.command && tool.exitCode !== null && tool.exitCode !== 0);
  if (failures.length) {
    const commands = failures.map(tool => `(${tool.exitCode}) ${compact(tool.command)}`).join('；');
    lines.push(`非零退出 ${capBytes(commands, 92)}`);
  }

  const firstParagraph = turn.reply?.trim().split(/\r?\n[ \t]*\r?\n/, 1)[0];
  if (firstParagraph) lines.push(`回复 ${capBytes(compact(firstParagraph), 113)}`);
  return capBytes(lines.join('\n'), 400);
}
