import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import agy from '../../adapters/agy/index.mjs';
import claude from '../../adapters/claude/index.mjs';
import codex from '../../adapters/codex/index.mjs';

const adapters = { agy, claude, codex };
const live = JSON.parse(readFileSync(new URL('./fixtures/manifest.json', import.meta.url), 'utf8'));

// Labels describe the frame's actual owner. An interrupted turn may already
// display an idle composer. A synthetic trust heading alone cannot aim a key.
const prior = {
  claude: {
    'experiment-auth-fail-synthetic.txt': 'auth-fail',
    'experiment-busy.txt': 'busy',
    'experiment-idle.txt': 'idle',
    'experiment-rate-limit-synthetic.txt': 'rate-limit',
    'experiment-trust-dialog-synthetic.txt': 'trust',
    'live-busy.txt': 'busy',
    'live-bypass.txt': 'picker',
    'live-idle.txt': 'idle',
    'live-interrupted.txt': 'interrupted',
    'live-model-picker.txt': 'picker',
    'live-trust.txt': 'trust',
  },
  codex: {
    'experiment/codex-auth-fail-synthetic.txt': 'auth-fail',
    'experiment/codex-busy.txt': 'busy',
    'experiment/codex-idle.txt': 'idle',
    'experiment/codex-rate-limit-synthetic.txt': 'rate-limit',
    'experiment/codex-tool-error.txt': 'idle',
    'experiment/codex-trust-dialog-synthetic.txt': 'trust',
    'live/busy.txt': 'busy',
    'live/idle.txt': 'idle',
    'live/interrupted.txt': 'interrupted',
    'live/picker.txt': 'picker',
    'live/queue.txt': 'busy',
    'live/steer.txt': 'busy',
    'live/trust.txt': 'trust',
    'orca/codex-model-capacity.txt': 'rate-limit',
  },
  agy: {
    'agy-auth-fail-synthetic.txt': 'auth-fail',
    'agy-busy.txt': 'busy',
    'agy-idle.txt': 'idle',
    'agy-rate-limit-synthetic.txt': 'rate-limit',
    'agy-sign-in-warning.txt': 'idle',
    'agy-trust-dialog.txt': 'trust',
  },
};

function read(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function samples() {
  const rows = live.map(row => ({ ...row, text: read(row.path) }));
  for (const [provider, files] of Object.entries(prior)) {
    for (const [file, expected] of Object.entries(files)) {
      const path = `../../adapters/${provider}/fixtures/${file}`;
      rows.push({ provider, expected, path, text: read(path), complete: true, how: 'screen' });
    }
  }
  const agyScreens = JSON.parse(read('../../adapters/agy/fixtures/live-screens.json'));
  for (const [kind, text] of Object.entries(agyScreens)) {
    rows.push({ provider: 'agy', expected: kind === 'trust-dialog' ? 'trust' : kind,
      path: `agy/live-screens.json#${kind}`, text, complete: true, how: 'screen' });
  }
  return rows;
}

export function replay() {
  return samples().map(({ provider, expected, path, text, complete, how }) => {
    const screen = adapters[provider].screen;
    const result = screen.inspect(complete && how === 'screen' ? text : '');
    const keys = screen.dialogKeys(result.kind, text);
    const writable = result.kind === 'idle' || (result.kind === 'busy' && screen.hasEmptyComposer(text));
    const expectedWritable = ['idle', 'interrupted', 'busy'].includes(expected);
    return { provider, expected, actual: result.kind, path, writable, keys,
      falseInput: writable && !expectedWritable,
      unknownWithKeys: result.kind === 'unknown' && (keys.length > 0 || !result.evidence),
    };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rows = replay();
  const matrix = {};
  for (const { expected, actual } of rows) {
    const counts = matrix[expected] ??= {};
    counts[actual] = (counts[actual] ?? 0) + 1;
  }
  console.log(JSON.stringify({ samples: rows.length, matrix,
    falseInput: rows.filter(row => row.falseInput), rows }, null, 2));
}
