export const claudeApiEnvKeys = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];
export const claudeNetworkEnvKeys = [
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'ANTHROPIC_BASE_URL',
];

export function launch({ model, effort, fast, prompt, allowNativeQuestions, extraArgs = [] } = {}) {
  if (!Array.isArray(extraArgs) || extraArgs.some(arg =>
    typeof arg !== 'string' || arg === '--' || arg === '--bare' || arg.startsWith('--bare='))) {
    throw new TypeError('extraArgs must be an array of Claude options');
  }
  // CCP owns Claude's protected settings file. Loom deliberately does not
  // pass hooks, setting sources, or strict MCP flags through that boundary.
  const argv = ['claude', ...extraArgs, '--dangerously-skip-permissions'];
  if (allowNativeQuestions === false) argv.push('--disallowedTools', 'AskUserQuestion');
  if (model) argv.push('--model', model);
  if (effort) argv.push('--effort', effort);
  // CCP currently permits only its own `fastMode` setting. The session
  // transcript is the source of turn and delivery evidence for all other
  // Loom features.
  if (fast !== undefined) argv.push('--settings', JSON.stringify({ fastMode: Boolean(fast) }));
  if (prompt !== undefined && prompt !== '') argv.push('--', prompt);
  return { argv, env: {} };
}
