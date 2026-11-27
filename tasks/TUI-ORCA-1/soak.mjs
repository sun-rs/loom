import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile, readdir, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { openNativeTui } from '../../runtimes/tui/transport.mjs';

const exec = promisify(execFile);
const { spawn } = createRequire(import.meta.url)('node-pty');
const hcCommand = '/Users/sun/.local/bin/hc';
const root = '/Users/sun/Code/exp-relay/tui-orca-1';
const profiles = {
  claude: ['/Users/sun/.local/bin/claude', 'sonnet'],
  codex: ['/opt/homebrew/Caskroom/codex/0.171.0/bin/codex', 'gpt-6.2-sol'],
  agy: ['/Users/sun/.local/bin/agy'],
};
const verification = process.argv.indexOf('--verify');
if (verification !== -1) {
  const directory = await realpath(process.argv[verification + 1]);
  assert(directory.startsWith(root + '/r-') || directory.startsWith(root + '/s-'));
  const clis = process.argv.slice(verification + 2);
  assert(clis.length && clis.every(cli => Object.hasOwn(profiles, cli)));
  for (const cli of clis) await verifyNativeRows(directory, cli);
  await new Promise(resolve => process.stdout.write('', resolve));
  process.exit(process.exitCode ?? 0);
}
const smoke = process.argv.includes('--smoke');
const selected = process.argv.slice(2).filter(value => value !== '--smoke');
assert(selected.every(cli => Object.hasOwn(profiles, cli)), 'Unknown CLI');
await mkdir(root, { recursive: true, mode: 0o700 });
const runDir = await mkdtemp(join(root, smoke ? 's-' : 'r-'));
console.log(runDir);

const childEnv = { ...process.env };
for (const key of ['HC_TERMINAL_ID', 'LOOM_ADDR']) delete childEnv[key];
const hc = async (...args) => JSON.parse((await exec(hcCommand, [...args, '--json'], {
  env: childEnv, timeout: 8_000, maxBuffer: 1024 * 1024,
})).stdout);
const stop = new AbortController();
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.once(signal, () => stop.abort(new Error(signal)));
}
const pause = ms => sleep(ms, undefined, { signal: stop.signal });

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function evidenceDirectory(cli) {
  return cli === 'codex' ? 'x' : cli[0];
}

async function verifyNativeRows(directory, cli) {
  const lines = async path => (await readFile(path, 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
  const metrics = await lines(join(directory, cli, 'metrics.jsonl'));
  const stateDir = join(directory, evidenceDirectory(cli));
  const generations = (await readdir(stateDir)).filter(name => /^pty-[a-zA-Z0-9]+$/.test(name));
  const natives = (await Promise.all(generations.map(name => lines(join(stateDir, name, 'hooks.jsonl'))))).flat();
  const starts = natives.filter(row => row.hook_event_name === (cli === 'agy' ? 'PreInvocation' : 'UserPromptSubmit'));
  const counts = new Map();
  for (const row of starts) {
    if (row.deliveryId) counts.set(row.deliveryId, (counts.get(row.deliveryId) ?? 0) + 1);
  }
  const count = id => counts.get(id) ?? 0;
  const deliveries = metrics.filter(row => row.event === 'delivery');
  const drafts = metrics.filter(row => row.event === 'draft');
  const lost = deliveries.filter(row => count(row.id) === 0).length;
  const duplicates = deliveries.filter(row => count(row.id) > 1).length;
  const falseWrites = drafts.filter(row => count(row.id) > 0 || !row.retained).length;
  if (lost || duplicates || falseWrites) process.exitCode = 1;
  console.log(JSON.stringify({ cli, incarnations: generations.length, nativeStarts: starts.length,
    verified: deliveries.length - lost - duplicates, lost, duplicates, falseWrites }));
}

function details(state) {
  return {
    ready: state.ready, phase: state.phase, source: state.source, exit: state.exit,
    screen: state.screen?.kind, empty: state.screen?.empty, human: state.host?.humanActive,
    native: state.native?.phase, draft: state.screen?.draft === '' ? 'empty' :
      state.screen?.draft === undefined ? 'unknown' : 'present',
  };
}

async function until(read, accepts, timeout = 45_000, step = 250) {
  const deadline = performance.now() + timeout;
  do {
    stop.signal.throwIfAborted();
    const value = await read();
    if (accepts(value)) return value;
    if (performance.now() >= deadline) return value;
    await pause(step);
  } while (true);
}

async function run(cli) {
  const [command, model] = profiles[cli];
  const binary = cli === 'claude' ? command : await realpath(command);
  const cwd = join(runDir, cli);
  const stateDir = join(runDir, evidenceDirectory(cli));
  await Promise.all([mkdir(cwd, { mode: 0o700 }), mkdir(stateDir, { mode: 0o700 })]);
  const logPath = join(cwd, 'metrics.jsonl');
  const seed = process.env.LOOM_SOAK_SEED === undefined ? Buffer.from(randomUUID().slice(0, 8), 'hex').readUInt32BE() :
    Number(process.env.LOOM_SOAK_SEED);
  assert(Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffffffff, 'Expected an unsigned 32-bit soak seed');
  const random = seeded(seed);
  const integer = (min, max) => Math.floor(random() * (max - min + 1)) + min;
  const log = (event, data) => appendFile(logPath,
    JSON.stringify({ at: new Date().toISOString(), cli, event, ...data }) + '\n', { mode: 0o600 });
  const panes = [];
  const deliveries = [];
  let host;
  let attach;
  let sampling;
  let falseWrites = 0;
  let interrupts = 0;
  let resizes = 0;
  let recovered = false;
  let start;
  let failed;
  const samples = [];
  const text = 'Reply with exactly OK. Use no tools.';
  const state = () => host.readState();

  async function launch(previous) {
    const name = `tui-orca-1-${cli}-${randomUUID().slice(0, 8)}`;
    host = previous ? await previous.restart({ name }) : await openNativeTui({
      cli, cwd, stateDir, command, hcCommand, name, model, effort: 'low', boundTranscript: false,
      ...(cli === 'codex' && { extraArgs: ['--disable', 'memories'] }),
      env: { DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
      unset: ['HC_TERMINAL_ID', 'LOOM_ADDR', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT'],
    });
    panes.push(host);
    assert.equal(host.transport, 'loom-pty');
    const hello = await host.hello();
    assert.equal(hello.incarnation, host.binding.incarnation);
    await log('launch', { pane: host.id, command, incarnation: hello.incarnation, protocol: hello.protocol, warnings: host.warnings });
    const status = await host.status();
    attach = spawn(hcCommand, ['attach', host.id], { cwd, env: childEnv, cols: 124, rows: 36, name: 'xterm-256color' });
    attach.onData(() => {});
    await resize(124, 36, false);
    const initial = await until(state, value => value.ready || value.exit ||
      ['trust-dialog', 'permission', 'auth-fail', 'onboarding', 'picker'].includes(value.screen?.kind), 20_000);
    await log('startup', { pane: host.id, hc: status.status, ...details(initial),
      ...(!initial.ready && { tail: initial.screen?.text?.split('\n').filter(Boolean).slice(-10) }),
    });
    // The launch presets supply trust only through CLI options. A new persisted trust or login requires a person.
    assert(initial.ready, 'Native startup did not reach a writable composer');
  }

  async function resize(cols, rows, count = true) {
    attach.resize(cols, rows);
    const outer = await until(() => host.status(), value => value.cols === cols && value.rows === rows, 4_000, 100);
    assert.deepEqual([outer.cols, outer.rows], [cols, rows], 'hc did not apply resize');
    if (count) {
      const inner = await until(state, value => value.host?.size?.cols === cols && value.host?.size?.rows === rows, 4000, 100);
      assert.deepEqual(inner.host?.size, { cols, rows }, 'loom-pty did not apply resize');
      resizes++;
      await log('resize', { cols, rows });
    }
  }

  async function sample() {
    const pane = await host.status();
    if (pane.state !== 'live' || !Number.isSafeInteger(pane.pid)) return;
    const { stdout } = await exec('/bin/ps', ['-p', String(pane.pid), '-o', '%cpu=,rss=,time=']);
    const [cpu, rss, cpuTime] = stdout.trim().split(/\s+/);
    if (!rss || !Number.isFinite(Number(cpu))) return;
    const entry = { pane: host.id, cpu: Number(cpu), rssKiB: Number(rss), cpuTime };
    samples.push(entry);
    await log('sample', entry);
  }

  async function ready(timeout = 180_000) {
    const result = await until(state, value => value.ready || value.exit ||
      ['permission', 'auth-fail', 'error', 'rate-limit'].includes(value.screen?.kind), timeout, 375);
    if (!result.ready) {
      await log('stuck', { ...details(result), tail: result.screen?.text?.split('\n').filter(Boolean).slice(-12) });
      throw new Error('Terminal did not return to a writable composer');
    }
    return result;
  }

  async function deliver(index, kind = 'regular') {
    const id = randomUUID();
    const message = kind === 'interrupt' ? 'Write 250 numbered sentences about rain. Use no tools.' : text;
    const initiated = performance.now();
    const entry = { host, id, index, message, kind };
    deliveries.push(entry);
    let receipt;
    const deadline = performance.now() + 180_000;
    do {
      await ready(Math.max(0, deadline - performance.now()));
      receipt = await host.submit({ id, text: message, timeoutMs: 12_000 });
      if (!['frame-changed', 'human-active', 'busy', 'composer-not-proven-empty'].includes(receipt.code)) break;
      await pause(250);
    } while (performance.now() < deadline);
    const native = await host.confirmations(id);
    const latency = Math.round(performance.now() - initiated);
    await log('delivery', { pane: host.id, index, id, kind, latency, receipt, count: native.count });
    entry.confirmed = native.count === 1;
    assert.equal(native.count, 1, `Delivery ${index} (${kind}) has ${native.count} native confirmations`);
    if (index % 17 === 0) {
      const replay = await host.submit({ id, text: message, timeoutMs: 0 });
      assert.equal(replay.kind, 'confirmed');
      await log('duplicate-request', { id, result: replay.kind });
    }
    return id;
  }

  async function checkDraft() {
    await ready();
    const draft = 'human' + String(integer(100000, 999999));
    await hc('keys', host.id, ...draft);
    const typed = await until(state, value => value.screen?.draft === draft, 6_000);
    assert.equal(typed.screen?.draft, draft, 'hc draft unavailable');
    await pause(integer(1050, 2500)); // Also test after the keystroke inhibition window.
    const id = randomUUID();
    const result = await host.submit({ id, text, timeoutMs: 1000 });
    const retained = await state();
    const confirmation = await host.confirmations(id);
    const unsafe = retained.screen?.draft !== draft || confirmation.count > 0 || result.kind !== 'refused';
    if (unsafe) falseWrites++;
    await log('draft', { pane: host.id, id, result, retained: retained.screen?.draft === draft, native: confirmation.count });
    assert(!unsafe, 'Automatic delivery modified or submitted a human draft');
    await hc('keys', host.id, ...Array.from(draft, () => 'backspace'));
    await ready();
  }

  async function interrupt(index) {
    const id = await deliver(index, 'interrupt');
    const active = await until(state, value => value.native?.activeInputId === id &&
      value.screen?.kind === 'busy' && value.screen?.empty && !value.host?.humanActive, 12_000, 60);
    assert.equal(active.native?.activeInputId, id, 'Expected native turn never became interruptible');
    const interruptId = randomUUID();
    const sent = await until(() => host.interrupt({
      id: interruptId, turnAt: active.native.activeSince, sessionId: active.native.sessionId, timeoutMs: 6000,
    }), value => value.code !== 'frame-changed' && value.code !== 'human-active', 7000, 70);
    await log('interrupt', { pane: host.id, id, kind: sent.kind, source: sent.source, recovered: sent.recovered, code: sent.code });
    if (sent.kind === 'confirmed') interrupts++;
    const restored = `[loom:${id}]\nWrite 250 numbered sentences about rain. Use no tools.`;
    if (cli === 'claude' && sent.state?.screen?.draft === restored) {
      assert.equal((await state()).screen.draft, restored);
      await hc('keys', host.id, ...Array(9).fill('ctrl+u'), ...Array(9).fill('ctrl+k'));
      await log('interrupt-draft-cleared', { id });
    }
    await ready();
  }

  async function crash() {
    await ready();
    const outer = await host.status();
    assert.equal(outer.cwd, cwd);
    assert(outer.name.startsWith(`tui-orca-1-${cli}-`));
    const { stdout } = await exec('/usr/bin/pgrep', ['-P', String(outer.pid)]);
    const pids = stdout.trim().split(/\s+/).map(Number);
    assert(pids.every(Number.isSafeInteger));
    const { stdout: owned } = await exec('/bin/ps', ['-p', pids.join(','), '-o', 'pid=,ppid=,comm=']);
    const matches = owned.trim().split('\n').map(row => row.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/))
      .filter(row => row && +row[2] === outer.pid && [command, binary].includes(row[3]));
    assert.equal(matches.length, 1, 'Could not establish a unique owned native CLI PID');
    await sample();
    process.kill(+matches[0][1], 'SIGKILL');
    const ended = await host.waitExit({ timeoutMs: 7000 });
    await log('crash', { pane: host.id, ...details(ended) });
    assert.equal(ended.exit?.code, 137);
    await audit(host);
    try { attach.kill(); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    attach = undefined;
    const old = host;
    await launch(old);
    assert.notEqual(host.binding.incarnation, old.binding.incarnation);
    assert.notEqual(host.id, old.id);
    recovered = true;
    await log('recovered', { predecessor: old.id, pane: host.id });
  }

  async function audit(pane) {
    const { bookPath } = pane.binding;
    const content = await readFile(bookPath, 'utf8').catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return '';
    });
    const book = new Map(content.split('\n').filter(Boolean).map(line => {
      const { id, entry } = JSON.parse(line);
      return [id, entry];
    }));
    for (const item of deliveries.filter(item => item.host === pane)) {
      const current = await pane.confirmations(item.id).catch(() => book.get(item.id)?.confirmation);
      item.count = current?.count ?? 0;
      await log('audit', { pane: pane.id, id: item.id, count: item.count });
    }
  }

  try {
    await log('start', { seed, smoke });
    await launch();
    start = performance.now();
    await sample();
    sampling = setInterval(() => sample().catch(error => log('sample-error', { code: error.code, message: error.message })), 30_000);
    if (smoke) {
      await deliver(1);
      await checkDraft();
      await resize(112, 32);
      await interrupt(2);
      await crash();
      await deliver(3);
    } else {
      const interruptAt = new Set([integer(10, 20), integer(42, 52), integer(77, 92)]);
      const crashAt = integer(50, 68);
      const idleAt = integer(24, 38);
      for (let index = 1; index <= 100; index++) {
        const gap = random() < 0.08 ? integer(30_000, 300_000) : integer(0, 24_000);
        await log('gap', { index, ms: gap });
        if (index !== 1) await pause(gap);
        if (index === idleAt) {
          await ready();
          await log('idle-start');
          await pause(11 * 60 * 1000);
          await ready();
          await log('idle-end');
        }
        if (random() < 0.16) await checkDraft();
        if (random() < 0.2) await resize(integer(107, 150), integer(29, 47));
        if (interruptAt.has(index)) await interrupt(index);
        else await deliver(index);
        if (index === crashAt) await crash();
      }
      await ready();
      const remaining = 60 * 60 * 1000 - (performance.now() - start);
      if (remaining > 0) await pause(Math.max(remaining, 11 * 60 * 1000));
    }
    await ready();
    await sample();
  } catch (error) {
    failed = true;
    await log('failure', { message: error.message, code: error.code });
  } finally {
    clearInterval(sampling);
    try {
      try { attach?.kill(); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      if (host?.binding?.bookPath) await audit(host);
    } catch (error) {
      failed = true;
      await log('audit-error', { message: error.message });
    }
    for (const pane of panes) {
      try {
        const ended = await pane.close();
        assert.equal(ended.state, 'finished');
        await log('cleanup', { pane: pane.id, state: ended.state });
      } catch (error) {
        failed = true;
        await log('cleanup-error', { pane: pane.id, message: error.message });
      }
    }
  }
  const elapsedMs = start == null ? 0 : Math.round(performance.now() - start);
  const confirmed = deliveries.filter(item => item.count === 1).length;
  const lost = deliveries.filter(item => item.count === 0).length;
  const duplicates = deliveries.filter(item => item.count > 1).length;
  const latencies = (await readFile(logPath, 'utf8')).trim().split('\n').map(JSON.parse)
    .filter(row => row.event === 'delivery' && row.count === 1).map(row => row.latency);
  const mean = values => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
  const max = values => values.length ? Math.max(...values) : null;
  const summary = { elapsedMs, confirmed, lost, duplicates, falseWrites, interrupts, resizes, recovered,
    samples: samples.length, meanLatencyMs: mean(latencies), maxLatencyMs: max(latencies),
    maxCpu: max(samples.map(entry => entry.cpu)), maxRssKiB: max(samples.map(entry => entry.rssKiB)),
    pass: !failed && lost === 0 && duplicates === 0 && falseWrites === 0 && recovered &&
      (smoke ? confirmed === 3 && interrupts === 1 :
        confirmed >= 100 && interrupts === 3 && resizes > 0 && elapsedMs >= 3_600_000) };
  await log('summary', summary);
  console.log(JSON.stringify({ cli, ...summary }));
  return summary.pass;
}

const outcomes = await Promise.allSettled((selected.length ? selected : Object.keys(profiles)).map(run));
for (const outcome of outcomes) if (outcome.status === 'rejected') console.error(outcome.reason.message);
if (outcomes.some(outcome => outcome.status === 'rejected' || !outcome.value)) process.exitCode = 1;
