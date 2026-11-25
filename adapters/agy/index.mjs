import { launch } from './launch.mjs';
import { classify, dialogKeys, hasEmptyComposer } from './screen.mjs';
import { inspectScreen } from '../tui-screen.mjs';
import { normalize } from './hooks.mjs';
import { locate, parse, turnSummary } from './transcript.mjs';

function plan(requestedMode) {
  if (!['queue', 'steer', 'interrupt'].includes(requestedMode)) {
    throw new RangeError(`Unknown agy input mode: ${requestedMode}`);
  }
  const steps = [{ type: 'text' }, { type: 'key', key: 'enter' }];
  if (requestedMode === 'interrupt') steps.unshift({ type: 'key', key: 'esc' });
  return {
    mode: requestedMode === 'steer' ? 'queue' : requestedMode,
    downgraded: requestedMode === 'steer',
    steps,
  };
}

export const agy = {
  id: 'agy',
  capabilities: {
    steer: 'tui-queue',
    interrupt: true,
    resumeSamePane: true,
    hookInjection: 'project-file',
  },
  launch,
  screen: { classify, dialogKeys, hasEmptyComposer, inspect: text => inspectScreen(classify, text) },
  hooks: { normalize },
  transcript: { locate, parse, turnSummary },
  input: { plan },
};

export default agy;
