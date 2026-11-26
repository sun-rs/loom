import { readFileSync } from 'node:fs';
import { readText } from '../daemon/io.mjs';

const [source, value] = process.argv.slice(2);
const event = JSON.parse(readFileSync(0, 'utf8'));
if (event.hook_event_name === 'SessionStart' && event.source === 'compact') {
  const additionalContext = source === 'file' ? readText(value) : value;
  if (additionalContext) console.log(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext },
  }));
}
