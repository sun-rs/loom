import { normalizeHook } from './hooks.mjs';
import { launch } from './launch.mjs';
import { locate } from './locate.mjs';
import { parseClaude } from './parse.mjs';
import { classify, dialogKeys, hasEmptyComposer, hasRunningBackgroundTask } from './screen.mjs';
import { inspectScreen } from '../tui-screen.mjs';
import { turnSummary } from './summary.mjs';

// Claude Code 2.1.322 on hc 0.1.22. See tasks/ADAPT-claude/RESULT.md for the observations.
const capabilities = Object.freeze({
  steer: 'tui-queue',
  interrupt: true,
  resumeSamePane: true,
  hookInjection: 'settings-arg',
});

function plan(mode) {
  const send = { type: 'text', submit: true };
  const wait = { type: 'wait', state: 'idle' };
  switch (mode) {
    case 'queue':
      return { mode, steps: [wait, send] };
    case 'steer':
      return { mode, delivery: capabilities.steer, requires: 'busy', fallback: 'queue', steps: [send] };
    case 'interrupt':
      return { mode, steps: [{ type: 'keys', keys: ['esc'] }, wait, send] };
    default:
      throw new RangeError(`Unknown Claude input mode: ${mode}`);
  }
}

export const claude = {
  id: 'claude',
  capabilities,
  launch,
  screen: { classify, dialogKeys, hasEmptyComposer, hasRunningBackgroundTask, inspect: text => inspectScreen(classify, text) },
  hooks: { normalize: normalizeHook },
  transcript: { locate, parse: parseClaude, turnSummary },
  input: { plan },
};

export default claude;
