import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { main } from '../../../daemon/main.mjs';
import { eventPath } from '../../../daemon/io.mjs';
import { deliveryId } from '../../../inbox/message.mjs';
import { realHc } from './real-hc.mjs';

const project = process.argv[2];
const idleScreens = Object.fromEntries(Object.entries({ codex: 'codex-idle', claude: 'claude-idle', agy: 'agy-idle-good' })
  .map(([provider, path]) => [provider, readFileSync(new URL(`../../TUI-REL-0/fixtures/${path}.txt`, import.meta.url), 'utf8')]));
const persist = join(project, 'panes.json');
const readPanes = () => JSON.parse(readFileSync(persist, 'utf8'));
const putPanes = panes => writeFileSync(persist, JSON.stringify(panes));
function get(addr) {
  return readPanes().find(pane => pane.address === addr);
}

const fixtureHc = {
  async openPane(job, row) {
    const panes = readPanes();
    const terminal = { address: 't' + (panes.length + 1), loom: row.addr, sessionId: randomUUID(), state: 'live',
      created_ms: Date.now(), status_ms: Date.now(), turn: 0, pid: 200 + panes.length,
      cwd: row.cwd, provider: row.cli, status: { state: 'idle' } };
    panes.push(terminal);
    putPanes(panes);
    appendFileSync(eventPath(project, row.addr), JSON.stringify({ cwd: project, session_id: terminal.sessionId,
      receivedAt: terminal.created_ms, hook_event_name: 'SessionStart' }) + '\n', { flush: true });
    return { terminal };
  },
  async getPane(job, row) { return row.pane ? get(row.pane) : readPanes().find(pane => pane.loom === row.addr); },
  async callHc(command, addr, ...args) {
    const panes = readPanes();
    const terminal = panes.find(pane => pane.address === addr);
    if (!terminal) throw Object.assign(new Error('No such fixture pane'), { kind: 'not_found' });
    if (command === 'get') return terminal;
    if (command === 'read') return { text: terminal.frame ?? idleScreens[terminal.provider], complete: true, how: 'screen' };
    if (command === 'kill') {
      terminal.state = 'finished';
      terminal.finished_ms = Date.now();
      putPanes(panes);
      return terminal;
    }
    if (command !== 'send') throw new Error('Unexpected hc fixture command: ' + command);
    const [text] = args;
    const id = deliveryId(text);
    const body = text.split('\n').slice(1).join('\n');
    const turn = ++terminal.turn;
    const at = Date.now();
    const common = { receivedAt: at, cwd: project, session_id: terminal.sessionId, turn_id: String(turn) };
    const start = { ...common, hook_event_name: 'UserPromptSubmit', ...(body === 'NO MARKER' ? {} : { deliveryId: id }) };
    const final = { ...common, hook_event_name: 'Stop', last_assistant_message: 'OK ' + body };
    const path = eventPath(project, terminal.loom);
    appendFileSync(join(project, 'native-deliveries.jsonl'), JSON.stringify({ backend: 'tui', session: terminal.sessionId, text }) + '\n', { flush: true });
    appendFileSync(path, JSON.stringify(start) + '\n' + JSON.stringify(final) + '\n', { flush: true });
    terminal.status_ms = at;
    terminal.status = { state: 'done' };
    putPanes(panes);
    return terminal;
  },
};

await main(['--project', project], { pollInterval: process.env.LOOM_REAL_HC ? 100 : 2,
  sessionOptions: process.env.LOOM_REAL_HC ? realHc : fixtureHc,
  ...(process.env.LOOM_TEST_WATCH_MS && { watchOptions: { busyMs: Number(process.env.LOOM_TEST_WATCH_MS) } }) });
