import { launch } from './launch.mjs';
import { normalize } from './hooks.mjs';
import { plan } from './input.mjs';
import { classify, dialogKeys, hasEmptyComposer } from './screen.mjs';
import { inspectScreen } from '../tui-screen.mjs';
import { locate, parse, turnSummary } from './transcript.mjs';

const capabilities = Object.freeze({
  steer: 'native',
  interrupt: true,
  resumeSamePane: true,
  hookInjection: 'cli-flag',
});

export const codex = {
  id: 'codex',
  capabilities,
  launch,
  screen: { classify, dialogKeys, hasEmptyComposer, inspect: text => inspectScreen(classify, text) },
  hooks: { normalize },
  transcript: { locate, parse, turnSummary },
  input: { plan: mode => plan(mode, capabilities.steer) },
};

export default codex;
