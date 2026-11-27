import { resolve } from 'node:path';
import { hookSettings } from './hooks.mjs';

export const claudeApiEnvKeys = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];

export function launch({ model, effort, cwd, prompt, hookSink, statusLine, idleCompaction = false, allowNativeQuestions, extraArgs = [] } = {}) {
  if (!Array.isArray(extraArgs) || extraArgs.some(arg =>
    typeof arg !== 'string' || arg === '--' || arg === '--bare' || arg.startsWith('--bare='))) {
    throw new TypeError('extraArgs must be an array of Claude options');
  }
  // Orca b7fd7caa3: src/shared/agent-launch/permissions/tui-agent-permissions.ts (Claude YOLO preset).
  const argv = ['claude', ...extraArgs, '--dangerously-skip-permissions', '--setting-sources', '', '--strict-mcp-config'];
  if (allowNativeQuestions === false) argv.push('--disallowedTools', 'AskUserQuestion');
  if (model) argv.push('--model', model);
  if (effort) argv.push('--effort', effort);
  const settings = { skipDangerousModePermissionPrompt: true, idleCompaction, ...(statusLine && { statusLine }) };
  if (hookSink) Object.assign(settings, hookSettings(resolve(cwd ?? '.', hookSink)));
  argv.push('--settings', JSON.stringify(settings));
  if (prompt !== undefined && prompt !== '') argv.push('--', prompt);
  return { argv, env: {} };
}
