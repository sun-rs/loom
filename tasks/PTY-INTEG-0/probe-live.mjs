import { execFile, spawn } from 'node:child_process';
import { appendFile, mkdir, open, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { request } from '../../daemon/rpc.mjs';
import { controlTui } from '../../runtimes/tui/transport.mjs';

const exec = promisify(execFile);
const repo = fileURLToPath(new URL('../../', import.meta.url));
const root = '/Users/sun/Code/exp-relay/pty-integ-0';
const profiles = {
  claude: { role: 'leader', model: 'sonnet', effort: 'low', agent: 'claude-code' },
  codex: { role: 'auditor', model: 'gpt-6.2-sol', effort: 'low', agent: 'codex' },
  agy: { role: 'super', model: 'Gemini 3.8 Flash', effort: 'low', agent: 'antigravity' },
};
const [label = 'live', provider] = process.argv.slice(2);
const suffix = randomUUID().slice(0, 6);
const project = join(root, `${label}-${suffix}`);
await mkdir(project, { mode: 0o700 });
await mkdir(join(project, 'tmp'), { mode: 0o700 });
const log = async (cli, test, data) => appendFile(join(project, 'results.jsonl'),
  JSON.stringify({ cli, test, at: new Date().toISOString(), ...data }) + '\n');
const file = await open(join(project, 'loomd.log'), 'w', 0o600);
const childEnv = { ...process.env, TMPDIR: join(project, 'tmp'), LOOM_DESKTOP_NOTIFY: '0' };
delete childEnv.HC_TERMINAL_ID;
delete childEnv.LOOM_ADDR;
const loomd = spawn(process.execPath, [join(repo, 'bin/loomd'), '--project', project],
  { cwd: project, env: childEnv, stdio: ['ignore', file.fd, file.fd] });
await file.close();
const ownPanes = new Set();
const hc = async (command, ...args) => JSON.parse((await exec('hc', [command, '--json', ...args],
  { env: childEnv, timeout: 5500, maxBuffer: 2 * 1024 * 1024 })).stdout);
const loom = async (...args) => JSON.parse((await exec(join(repo, 'bin/loom'), [...args, '--project', project],
  { cwd: project, env: childEnv, timeout: 30_000 })).stdout);
async function until(read, predicate, timeout = 12_000) {
  const end = Date.now() + timeout;
  let result;
  do {
    result = await read();
    if (predicate(result)) return result;
    await sleep(120);
  } while (Date.now() < end);
  return result;
}
function frame(state) {
  return { ready: state.ready, phase: state.phase, screen: state.screen?.kind,
    empty: state.screen?.empty, human: state.host?.humanActive, exit: state.exit,
    draft: state.screen?.draft === undefined ? 'unknown' : state.screen.draft ? 'present' : 'empty',
    native: state.native && { phase: state.native.phase, source: state.native.source, sessionId: state.native.sessionId } };
}

async function run(cli) {
  const { role, model, effort, agent } = profiles[cli];
  const cwd = join(project, cli);
  await mkdir(cwd);
  // The native prompt only asks for a short response in this empty workspace.
  const prompt = 'Reply with only PTY-INTEG-0 OK. Do not use tools.';
  const opened = await loom('spawn', role, '--cwd', cwd, '--mode', 'tui', '--cli', cli, '--model', model, '--effort', effort, prompt);
  const { addr, pane } = opened.session;
  ownPanes.add(pane);
  await hc('label', pane, `pty-integ-0=${pane}`);
  const job = () => readFile(join(project, '.project', 'loomd', 'sessions', addr + '.json'), 'utf8').then(JSON.parse);
  const control = async (method, params) => controlTui((await job()).tui, method, params);
  const state = () => request(project, 'state', { target: addr });
  const status = () => hc('get', pane);
  const initial = await until(() => control('state'), value => value.ready || value.exit ||
    ['trust-dialog', 'onboarding', 'permission', 'error'].includes(value.screen?.kind), 8000);
  const paneStatus = await status();
  const wrapperAt = paneStatus.argv.findIndex(arg => arg.endsWith('/tui/loom-pty'));
  await log(cli, 'cold', { addr, pane, transport: opened.transport, wrapper: paneStatus.argv[wrapperAt],
    command: paneStatus.argv[wrapperAt + 1], agent: paneStatus.status?.app, state: frame(initial) });
  const ls = async () => {
    const list = await hc('ls', '--label', `pty-integ-0=${pane}`);
    return (Array.isArray(list) ? list : list.terminals)?.find(value => value.address === pane);
  };
  const initialList = await ls();
  await log(cli, 'hc-cold', { agent: initialList?.agent, status: initialList?.status });
  if (!initial.ready && initial.screen?.kind !== 'busy') {
    // Only read the last lines of our own screen for startup diagnosis.
    await log(cli, 'startup-blocked', { screen: initial.screen?.text?.split('\n').filter(Boolean).slice(-12) });
    if (cli === 'codex' && initial.screen?.text?.includes('f2 to view')) {
      await hc('keys', pane, 'f2');
      await sleep(350);
      const diagnostic = await control('state');
      await log(cli, 'codex-warning', { screen: diagnostic.screen?.text?.split('\n').filter(Boolean).slice(-12) });
    }
    return;
  }
  const ids = [opened.deliveryId];
  const draftOnly = label.startsWith('draft-');
  for (let i = 2; i <= (draftOnly ? 1 : 5); i++) {
    const id = randomUUID();
    const receipt = await loom('send', addr, '--id', id, prompt + ` Sequence ${i}.`);
    ids.push(id);
    await log(cli, 'queued', { receipt });
  }
  const firstRun = await until(async () => {
    const current = await state();
    const terminal = await status();
    return { current, terminal };
  }, ({ current }) => ids.every(id => current.deliveries.some(r => r.id === id &&
    ['answered', 'refused'].includes(r.deliveryStatus))), 115_000);
  const receipts = [];
  for (const id of ids) receipts.push({ receipt: firstRun.current.deliveries.find(value => value.id === id),
    native: await control('confirmations', { id }).catch(() => null) });
  await log(cli, draftOnly ? 'first' : 'five', { receipts, state: firstRun.current.state, badge: firstRun.terminal.status });
  const entry = await ls();
  await log(cli, 'hc-ls', { expected: agent, agent: entry?.status?.app ?? entry?.agent, status: entry?.status?.state ?? entry?.status });
  if (!receipts.every(item => item.native?.count === 1)) {
    const last = await control('state').catch(() => null);
    if (last) await log(cli, 'delivery-blocked', { state: frame(last), screen: last.screen?.text?.split('\n').filter(Boolean).slice(-12) });
    if (cli === 'codex' && last?.screen?.text?.includes('f2 to view')) {
      await hc('keys', pane, 'f2');
      await sleep(350);
      const diagnostic = await control('state');
      await log(cli, 'codex-warning', { screen: diagnostic.screen?.text?.split('\n').filter(Boolean).slice(-12) });
    }
    return;
  }
  if (!draftOnly) {
    // A longer text-only turn provides enough time to observe a native active turn.
    const runId = randomUUID();
    const continued = randomUUID();
    await loom('send', addr, '--id', runId, 'Write 250 numbered sentences about rain. Use no tools.');
    const busy = await until(state, value => value.state === 'busy' && value.deliveries.some(item =>
      item.id === runId && item.deliveryStatus === 'delivered'), 12_000);
    if (busy.state === 'busy' && busy.deliveries.some(item => item.id === runId && item.deliveryStatus === 'delivered')) {
      const active = await ls();
      await log(cli, 'hc-working', { agent: active?.agent, status: active?.status });
      await loom('send', addr, '--mode', 'interrupt', '--id', continued, prompt);
      const resume = await until(state, value => value.deliveries.some(item => item.id === continued &&
        ['answered', 'delivered', 'uncertain', 'refused'].includes(item.deliveryStatus)), 24_000);
      await log(cli, 'interrupt-continue', { receipt: resume.deliveries.find(item => item.id === continued),
        native: await control('confirmations', { id: continued }).catch(() => null) });
    } else {
      await log(cli, 'interrupt-unavailable', { state: busy.state });
    }
  }
  const idle = await until(() => control('state'), value => value.ready, 25_000);
  if (!idle.ready) {
    await log(cli, 'not-idle', { state: frame(idle), screen: idle.screen?.text?.split('\n').filter(Boolean).slice(-8) });
    return;
  }
  const draft = 'ptyhuman';
  await hc('keys', pane, ...draft);
  const draftFrame = await until(() => control('state'), value => value.screen.draft?.includes(draft));
  const draftId = randomUUID();
  await loom('send', addr, '--id', draftId, prompt);
  await sleep(1500);
  const retained = await control('state');
  await log(cli, 'human-draft', { typed: draftFrame.screen.draft === draft, retained: retained.screen.draft === draft,
    native: await control('confirmations', { id: draftId }), receipt: (await state()).deliveries.find(value => value.id === draftId) });
}

try {
  await until(() => request(project, 'daemon-status').catch(() => false), value => value?.running);
  await Promise.all((provider ? [provider] : Object.keys(profiles)).map(cli =>
    run(cli).catch(error => log(cli, 'error', { message: error.message, output: error.stdout }))));
} finally {
  await Promise.all([...ownPanes].map(async pane => {
    const before = await hc('get', pane);
    if (before.state !== 'finished') await hc('kill', pane);
    const after = await hc('get', pane);
    await log(null, 'cleanup', { pane, state: after.state });
  }));
  if (loomd.exitCode === null) {
    await request(project, 'daemon-stop').catch(() => loomd.kill());
    await new Promise(resolve => loomd.once('exit', resolve));
  }
}
console.log(project);
