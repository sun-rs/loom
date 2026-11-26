import { parseClaude } from '../../adapters/claude/parse.mjs';
import { parseCodex } from '../../adapters/codex/parse.mjs';
import { turnActivity } from '../../adapters/codex/activity.mjs';

const interpreter = /(?:^|[\n;&|]\s*)(?:\/[^\s;&|]+\/)?(?:bash|sh|zsh|node|python(?:3(?:\.\d+)?)?)\s+(?:-|[^\s;&|]+\.(?:sh|js|mjs|cjs|py)\b)/;
const replName = /^(?:REPL|(?:code_mode[.:/])?exec)$/i;

// Pass one isolated run's native transcript. The result contains counts and
// elapsed time only. The caller records setup, the checker and path review.
export function nativeMetrics(vendor, text) {
  if (vendor !== 'claude' && vendor !== 'codex') throw new RangeError('Expected claude or codex');
  const claude = vendor === 'claude';
  const { turns, usage } = (claude ? parseClaude : parseCodex)(text);
  const calls = turns.flatMap(turn => turn.calls);
  const tools = turns.flatMap(turn => claude ? turn.tools : [...(turnActivity.get(turn)?.tools.values() ?? [])]);
  const isRepl = tool => claude ? /^REPL$/i.test(tool.name) : replName.test(tool.name);
  const start = Date.parse(turns.at(0)?.startedAt);
  const end = Date.parse(turns.at(-1)?.endedAt);
  return {
    modelRequests: calls.length || null,
    inputTokens: calls.length ? usage.inputTokens : null,
    cachedTokens: calls.length ? usage.cachedInputTokens : null,
    cacheWriteTokens: calls.length ? usage.cacheWriteInputTokens : null,
    outputTokens: calls.length ? usage.outputTokens : null,
    peakContextTokens: calls.length ? calls.reduce((peak, call) => Math.max(peak, call.inputTokens), 0) : null,
    toolCalls: turns.length ? tools.length : null,
    replCalls: turns.length ? tools.filter(isRepl).length : null,
    scriptCalls: turns.length ? tools.filter(tool => isRepl(tool) || interpreter.test(tool.command ?? '')).length : null,
    nativeWallMs: Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null,
  };
}
