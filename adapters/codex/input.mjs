import {
  AGENT_PROMPT_BRACKETED_PASTE_START, AGENT_PROMPT_BRACKETED_PASTE_END, AGENT_PROMPT_POST_PASTE_SUBMIT_DELAY_MS,
} from '../../tui/agent-input.mjs';

export function plan(requested, steerCapability) {
  if (!['queue', 'steer', 'interrupt'].includes(requested)) {
    throw new RangeError(`Unknown Codex input mode: ${requested}`);
  }
  const mode = requested === 'steer' && steerCapability !== 'native' ? 'queue' : requested;
  const steps = [];
  if (mode === 'interrupt') steps.push({ type: 'key', key: 'esc', when: 'busy' });
  steps.push(mode === 'steer' ? { type: 'require', state: 'busy' } : { type: 'wait', state: 'idle' });
  steps.push({
    type: 'text',
    prefix: AGENT_PROMPT_BRACKETED_PASTE_START,
    suffix: AGENT_PROMPT_BRACKETED_PASTE_END,
    delayAfterMs: AGENT_PROMPT_POST_PASTE_SUBMIT_DELAY_MS,
  }, { type: 'key', key: 'enter' });
  return { mode, downgraded: mode !== requested, steps };
}
