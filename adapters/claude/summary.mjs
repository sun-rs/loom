import { promptPreview } from '../../lib/prompt-preview.mjs';

const statusLabels = { completed: '已完成', interrupted: '已中断', incomplete: '未完成' };

// Count UTF-8 bytes so the budget is conservative for a byte-based tokenizer.
function truncate(text, maxBytes) {
  if (Buffer.byteLength(text) <= maxBytes) return text;
  let prefix = '';
  let bytes = Buffer.byteLength('…');
  for (const character of text) {
    bytes += Buffer.byteLength(character);
    if (bytes > maxBytes) break;
    prefix += character;
  }
  return `${prefix}…`;
}

export function turnSummary(session, n) {
  if (!Number.isSafeInteger(n) || n < 1) return null;
  const turn = session?.turns?.[n - 1];
  if (!turn) return null;

  const tools = turn.tools ?? [];
  const counts = new Map();
  const failed = [];
  let command;
  for (const tool of tools) {
    const name = tool.name ?? '未知';
    counts.set(name, (counts.get(name) ?? 0) + 1);
    if (!tool.command) continue;
    const shellText = tool.command.replace(/\s+/g, ' ');
    if (Number.isSafeInteger(tool.exitCode) && tool.exitCode !== 0) failed.push(`[${tool.exitCode}] ${shellText}`);
    else command ??= shellText;
  }
  const prompt = turn.prompts?.map(promptPreview).filter(Boolean).join(' / ') || '—';
  const distribution = [...counts].map(([name, count]) => `${name}×${count}`).join('，');
  const firstParagraph = turn.reply?.trim().split(/\r?\n[^\S\r\n]*\r?\n/, 1)[0] || '—';
  const lines = [
    `第 ${turn.index} 轮 ${statusLabels[turn.status] ?? turn.status}`,
    `任务 ${truncate(prompt, 65)}`,
    `工具 ${tools.length} 次${distribution ? ` ${truncate(distribution, 48)}` : ''}`,
    `非零退出 ${failed.length} 条${failed.length ? ` ${truncate(failed.join(' / '), 75)}` : ''}`,
  ];
  if (command) lines.push(`命令 ${truncate(command, 50)}`);
  const prefix = `${lines.join('\n')}\n回复 `;
  return prefix + truncate(firstParagraph, 400 - Buffer.byteLength(prefix));
}
