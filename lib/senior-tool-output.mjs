import { estimateTokens } from './token-budget.mjs';
import { seniorToolCategory, shellCommands } from './senior-tool-guard.mjs';

export function seniorOutputCategory(name = '', command = '') {
  const commands = (shellCommands(command.replace(/\\\n/g, ' ')) ?? []).map(args => args.filter(arg => !/^[\w]+=.*/.test(arg)));
  if (commands.some(([cmd, ...args]) => /^(?:npm|npx|pnpm|yarn|bun|pytest|make|cargo|go|cmake|ninja|jest|vitest)$/.test(cmd ?? '') ||
      cmd === 'node' && args.some(arg => /--test|probe|\.test\.mjs/.test(arg)))) return 'test-build';
  if (/(?:read|search|grep|outline|glob)/i.test(name) || commands.some(([cmd]) => /^(?:grep|rg|cat|sed|head|tail|find|wc)$/.test(cmd ?? ''))) return 'read-search';
  if (commands.some(([cmd, ...args]) => cmd === 'git' && (args[0] === '-C' ? args.slice(2) : args)
    .some(arg => ['merge', 'rebase', 'cherry-pick', 'worktree'].includes(arg)))) return 'git-integration';
  if (commands.some(([cmd, sub]) => /(?:^|\/)(?:loom|\$LOOM_BIN|\$LOOM_NEW)$/.test(cmd ?? '') &&
      ['state', 'send', 'status'].includes(sub))) return 'loom-state-send';
  return 'other';
}

export function agyToolOutput(raw, cwd, project, { classifyGuard = true } = {}) {
  const output = [];
  const calls = [];
  const byStep = new Map();
  let queued = [];
  for (const row of raw) {
    const step = Number(row.step_index);
    if (Array.isArray(row.tool_calls) && row.tool_calls.length) {
      queued = row.tool_calls.map(({ name, args }) => {
        const cmd = args?.CommandLine ?? args?.command ?? '';
        const category = seniorOutputCategory(name, cmd);
        const denied = classifyGuard ? seniorToolCategory(name, args, cwd, project) : undefined;
        const call = { step, at: Date.parse(row.created_at), category, denied, name, cmd };
        calls.push(call);
        return call;
      });
      byStep.set(step, queued[0]);
    }
    if (typeof row.content !== 'string') continue;
    const at = Date.parse(row.created_at);
    if (row.type === 'GENERIC' && row.source === 'MODEL') {
      const tool = queued.shift();
      if (tool) {
        const task = /background task with task id: [^\s]+\/task-(\d+)\b/.exec(row.content);
        if (task) byStep.set(Number(task[1]), tool);
        output.push({ ...tool, at, step, text: row.content, source: 'tool' });
      }
    } else if (row.type === 'SYSTEM_MESSAGE') {
      const task = /sender=[^\s]+\/task-(\d+)\b/.exec(row.content);
      const tool = task && byStep.get(Number(task[1]));
      const category = tool?.category ?? (/Reminder: work efficiently/.test(row.content) ? 'efficiency-reminder' : 'other');
      output.push({ category, denied: tool?.denied, at, step, text: row.content, source: tool ? 'tool' : 'system' });
    }
  }
  return { output, calls };
}

export function sumOutputTokens(rows) {
  const categories = {};
  for (const { category, text } of rows) categories[category] = (categories[category] ?? 0) + estimateTokens(text);
  return categories;
}
