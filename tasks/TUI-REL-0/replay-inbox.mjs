import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { inbox } from '../../inbox/engine.mjs';
import { tui } from '../../inbox/tui.mjs';
import { replay } from './replay.mjs';

const experiment = process.argv[2];
if (!experiment) throw new Error('Supply a writable test directory for the simulated inbox state');
const parent = resolve(experiment);
mkdirSync(parent, { recursive: true });
const root = mkdtempSync(join(parent, 'replay-inbox-'));
try {
  const rows = replay().filter(row => row.path.startsWith('fixtures/') && row.expected === 'draft');
  for (const row of rows) {
    const cwd = join(root, randomUUID());
    mkdirSync(cwd);
    const text = readFileSync(new URL(row.path, import.meta.url), 'utf8');
    const pane = { address: 't1', cwd, pid: 1, created_ms: 1, state: 'live', turn: 0,
      labels: { 'loom-cli': row.provider }, status: { state: 'idle' } };
    let sends = 0;
    const transport = tui(cwd, async (command) => {
      if (command === 'get') return pane;
      if (command === 'read') return { text, how: 'screen', complete: true };
      if (command === 'send') { sends += 1; return { started: true }; }
      throw new Error(`Unexpected simulated command ${command}`);
    });
    const { binding, observation } = await transport.resolve(pane.address);
    const mail = inbox(cwd, transport);
    mail.enqueue({ id: randomUUID(), target: binding, mode: 'queue', requestedMode: 'queue',
      phase: 'queued', createdAt: Date.now(), text: 'simulated replay payload' });
    await mail.step();
    console.log(JSON.stringify({ file: row.path, adapter: row.actual, inbox: observation.state, sends }));
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
