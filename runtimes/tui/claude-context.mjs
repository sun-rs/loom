import { readText, writeState } from '../../daemon/io.mjs';

const [path, sessionId] = process.argv.slice(2);
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (Buffer.byteLength(input) > 128 * 1024) process.exit(0);
}

let payload;
try { payload = JSON.parse(input); } catch { process.exit(0); }
const context = payload?.context_window;
if (payload?.session_id === sessionId && Number.isFinite(context?.context_window_size) && context.context_window_size > 0) {
  const previous = JSON.parse(readText(path, 'null'));
  const measured = context.current_usage;
  const valid = value => Number.isFinite(value) && value >= 0;
  const input = [measured?.input_tokens, measured?.cache_read_input_tokens, measured?.cache_creation_input_tokens]
    .filter(valid).reduce((sum, value) => sum + value, 0);
  const inputTokens = input || (valid(context.total_input_tokens) && context.total_input_tokens > 0 ? context.total_input_tokens : null);
  const sample = { sessionId, contextWindow: context.context_window_size, inputTokens,
    percent: inputTokens !== null && valid(context.used_percentage) ? context.used_percentage : null };
  if (Object.entries(sample).some(([key, value]) => previous?.[key] !== value)) {
    writeState(path, JSON.stringify({ ...sample, at: Date.now() }) + '\n');
  }
}
