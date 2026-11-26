import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { pagerArgs, statusTui } from '../cli/status-tui.mjs';
import { herdrCommands, herdrProjects, projectLayout, readLayout, superLayout } from './herdr-layout.mjs';
import { deliveryBoard, gateBoard } from './status-board.mjs';

const fake = String.raw`
const { readFileSync, writeFileSync } = require('node:fs');
const { basename } = require('node:path');
const statePath = process.env.FAKE_HERDR_STATE;
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const [verb, ...args] = process.argv.slice(2);
const app = basename(process.argv[1]) === 'herdr-app';
const allocate = prefix => prefix + (++state.seq).toString(36);
const target = address => state.terminals.find(t => t.address === address) ??
  state.terminals.findLast(t => t.name === address && t.state === 'live') ??
  state.terminals.findLast(t => t.name === address);
const spaceFor = id => state.spaces.find(space => space.id === id);
const tabs = () => state.spaces.flatMap(space => space.tabs);
const visible = () => tabs().flatMap(tab => tab.terminals);
function place(terminal) {
  const space = spaceFor(terminal.labels['herdr.space']);
  if (space && !visible().some(item => item.terminal === terminal.address)) {
    let tab = space.tabs.find(item => item.id === terminal.labels['herdr.tab']);
    if (!tab) {
      tab = { id: allocate('tb'), name: String(space.tabs.length + 1), terminals: [] };
      space.tabs.push(tab);
    }
    tab.terminals.push({ terminal: terminal.address, pane: allocate('p') });
    terminal.keep = true;
  }
}
function launch(name, cwd, labels, argv) {
  const address = allocate('t');
  const terminal = { address, name, cwd, labels, argv, state: 'live', keep: false, created_ms: state.seq, pid: state.seq + 100 };
  state.terminals.push(terminal);
  place(terminal);
  return terminal;
}
function close(terminal) {
  terminal.state = 'finished';
  for (const space of [...state.spaces]) {
    for (const tab of space.tabs) tab.terminals = tab.terminals.filter(item => item.terminal !== terminal.address);
    space.tabs = space.tabs.filter(tab => tab.terminals.length);
    if (!space.tabs.length) state.spaces = state.spaces.filter(item => item !== space);
  }
}
function fail(kind) {
  writeFileSync(statePath, JSON.stringify(state));
  console.error(JSON.stringify({ error: kind === 'unavailable' ? kind : { kind, message: kind } }));
  process.exit(3);
}
function fault(command, when) {
  if (state.faults[0]?.command === command && state.faults[0]?.when === when) {
    fail(state.faults.shift().kind ?? 'unavailable');
  }
}
let result;
if (app && verb === 'ls') {
  fault('ls', 'before');
  result = { spaces: state.spaces };
}
else if (app) {
  const [command, raw] = args;
  const options = JSON.parse(raw);
  state.actions.push({ command, options });
  fault(command, 'before');
  if (command === 'space.new' || command === 'tab.new') {
    const space = command === 'space.new' ? { id: allocate('sp'), name: options.name, folder: options.folder, tabs: [] } : spaceFor(options.space);
    if (command === 'space.new') state.spaces.push(space);
    const tab = { id: allocate('tb'), name: options.tab ?? options.name, terminals: [] };
    space.tabs.push(tab);
    const terminal = launch(null, options.folder, { 'herdr.space': space.id, 'herdr.tab': tab.id }, options.argv);
    result = { space: space.id, tab: tab.id, terminal: terminal.address };
  } else if (command === 'pane.close') {
    close(target(visible().find(item => item.pane === options.pane).terminal));
  } else if (command === 'tab.rename') {
    tabs().find(tab => tab.id === options.id).name = options.name;
  } else if (command === 'tab.move') {
    const space = state.spaces.find(space => space.tabs.some(tab => tab.id === options.id));
    const previous = space.tabs.findIndex(tab => tab.id === options.id);
    space.tabs.splice(options.index - 1, 0, ...space.tabs.splice(previous, 1));
  } else if (command === 'tab.close' || command === 'space.close') {
    const panes = command === 'tab.close' ? tabs().find(tab => tab.id === options.id).terminals :
      spaceFor(options.id).tabs.flatMap(tab => tab.terminals);
    for (const pane of [...panes]) close(target(pane.terminal));
  } else fail('unsupported-app-command');
  fault(command, 'after');
} else if (verb === 'run') {
  const name = args[args.indexOf('--name') + 1];
  if (target(name)?.state === 'live') fail('name_taken');
  const labels = Object.fromEntries(args.flatMap((arg, i) => arg === '--label' ? [args[i + 1].split(/=(.*)/s, 2)] : []));
  const terminal = launch(name, args[args.indexOf('--cwd') + 1], labels, args.slice(args.indexOf('--') + 1));
  result = { address: terminal.address, name, state: 'live' };
} else {
  const [address, ...rest] = args.filter(arg => arg !== '--json');
  const terminal = target(address);
  if (!terminal) fail('not_found');
  if (verb === 'label') {
    Object.assign(terminal.labels, Object.fromEntries(rest.map(arg => arg.split(/=(.*)/s, 2))));
    place(terminal);
  } else if (verb === 'keep') terminal.keep = !rest.includes('--off');
  else if (verb === 'kill') close(terminal);
  else if (verb === 'rm') state.terminals = state.terminals.filter(item => item !== terminal);
  else if (verb !== 'get') fail('unsupported-hc-command');
  result = terminal;
}
fault(verb, 'after');
writeFileSync(statePath, JSON.stringify(state));
console.log(JSON.stringify(result ?? { ok: true }));
`;

async function fixture(t) {
  const project = mkdtempSync(join(realpathSync(tmpdir()), 'loom-layout-'));
  mkdirSync(join(project, '.project', 'loomd'), { recursive: true });
  const state = join(project, 'herdr.json');
  writeFileSync(state, JSON.stringify({ seq: 0, spaces: [], terminals: [], actions: [], faults: [] }));
  const env = { LOOM_HC_BIN: join(project, 'hc'), LOOM_HERDR_APP_BIN: join(project, 'herdr-app'),
    LOOM_HERDR_LAYOUT: '1', FAKE_HERDR_STATE: state, XDG_STATE_HOME: join(project, 'state') };
  const original = new Map(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(project, { recursive: true, force: true });
  });
  for (const path of [env.LOOM_HC_BIN, env.LOOM_HERDR_APP_BIN]) {
    writeFileSync(path, '#!' + process.execPath + '\n' + fake, { mode: 0o700 });
  }
  const commands = await herdrCommands();
  const layout = projectLayout(project);
  const inspect = () => JSON.parse(readFileSync(state, 'utf8'));
  const faults = (...entries) => writeFileSync(state, JSON.stringify({ ...inspect(), faults: entries }));
  async function launch(name, labels = {}) {
    const term = await commands.hc('run', '--bg', '--name', name, '--cwd', project,
      ...Object.entries(labels).flatMap(([key, value]) => ['--label', key + '=' + value]), '--', '/bin/sleep', '60');
    return commands.hc('get', term.address);
  }
  return { project, commands, layout, inspect, launch, faults };
}

test('project layout reuses ordered tabs and repairs deleted tabs and spaces without focusing them', async t => {
  const { project, commands, layout, inspect, launch } = await fixture(t);
  const first = structuredClone(await layout.ensure(true));
  const reopened = projectLayout(project);
  assert.deepEqual(await reopened.ensure(true), first);
  assert.deepEqual(herdrProjects(), [project]);
  const status = first.tabs.status;
  assert.equal((await commands.hc('get', status.hcName)).keep, false);
  const auditor = { role: 'auditor', addr: 'loom-auditor' };
  async function spawnAuditor() {
    const placement = await reopened.placement(auditor);
    await reopened.place(auditor, await launch(placement.hcName, placement.labels), false);
    return structuredClone(readLayout(project));
  }
  const before = await spawnAuditor();
  await commands.app('tab.close', { id: before.tabs.auditor.id, confirmed: true });
  const fixed = await spawnAuditor();
  assert.equal(fixed.space.id, first.space.id);
  assert.equal(fixed.tabs.status.terminal, status.terminal);
  assert.notEqual(fixed.tabs.auditor.id, before.tabs.auditor.id);
  assert.deepEqual(inspect().spaces[0].tabs.map(tab => tab.name), ['Auditor', 'Status']);
  await commands.app('space.close', { id: first.space.id, confirmed: true });
  const rebuilt = await reopened.ensure(true);
  assert.notEqual(rebuilt.space.id, first.space.id);
  assert.equal(rebuilt.tabs.status.hcName, status.hcName);
  assert.ok(inspect().actions.filter(item => ['space.new', 'tab.new'].includes(item.command))
    .every(({ options }) => options.focus === false));
  assert.equal(inspect().terminals.filter(term => term.state === 'live').length, 1);
});

test('successor shares the role tab, keeps the predecessor record until acknowledged, and remains alone after retirement', async t => {
  const { project, commands, layout, launch, inspect } = await fixture(t);
  const old = { role: 'leader', addr: 'loom-old' };
  const oldPlacement = await layout.placement(old);
  const previous = await launch(oldPlacement.hcName, oldPlacement.labels);
  await layout.place(old, previous, false);
  const next = { role: 'leader', addr: 'loom-12345678' };
  const placement = await layout.placement(next);
  assert.equal(placement.labels['herdr.tab'], readLayout(project).tabs.leader.id);
  assert.notEqual(placement.hcName, oldPlacement.hcName);
  const candidate = await launch(placement.hcName, placement.labels);
  await layout.place(next, candidate, true);
  const tab = () => inspect().spaces[0].tabs.find(item => item.id === placement.labels['herdr.tab']);
  assert.equal(tab().terminals.length, 2);
  assert.equal(readLayout(project).tabs.leader.terminal, previous.address);
  await layout.publish(next, candidate);
  await commands.hc('kill', previous.address);
  layout.clear(old);
  assert.deepEqual(tab().terminals.map(pane => pane.terminal), [candidate.address]);
  assert.equal(readLayout(project).tabs.leader.terminal, candidate.address);
  assert.equal((await commands.hc('get', candidate.address)).keep, false);
});

test('explicit adoption preserves process identity and keeps the separate global Status and Super tabs', async t => {
  const { project, commands, layout, launch, inspect } = await fixture(t);
  const leader = await launch('existing-leader');
  const auditor = await launch('existing-auditor');
  const worker = await launch('still-hidden');
  const pairs = [{ row: { role: 'leader', addr: 'old-leader' }, terminal: leader },
    { row: { role: 'auditor', addr: 'old-auditor' }, terminal: auditor }];
  const state = await layout.adopt(pairs);
  for (const { row, terminal } of pairs) {
    const updated = await commands.hc('get', terminal.address);
    assert.equal(updated.pid, terminal.pid);
    assert.equal(updated.created_ms, terminal.created_ms);
    assert.equal(updated.keep, false);
    assert.equal(state.tabs[row.role].hcName, terminal.name);
  }
  assert.deepEqual((await commands.hc('get', worker.address)).labels, {});
  const superTerminal = await launch('existing-super');
  const global = await superLayout(project, superTerminal.address, commands);
  assert.equal(global.space.name, 'Loom');
  assert.notEqual(global.space.id, state.space.id);
  assert.equal(global.tabs.super.terminal, superTerminal.address);
  assert.deepEqual(inspect().terminals.find(term => term.address === global.tabs.status.terminal).argv.slice(-2), ['tui', '--all']);
  await assert.rejects(superLayout(project, leader.address, commands), /already has a pane/);
});

test('adoption reconciles lost create and label acknowledgements and reuses an unrecorded tab by name', async t => {
  const { project, commands, layout, inspect, launch, faults } = await fixture(t);
  const leader = await launch('existing-leader');
  const auditor = await launch('existing-auditor');
  const pairs = [{ row: { role: 'leader', addr: 'loom-leader' }, terminal: leader },
    { row: { role: 'auditor', addr: 'loom-auditor' }, terminal: auditor }];
  faults({ command: 'space.new', when: 'after' }, { command: 'ls', when: 'before' },
    { command: 'label', when: 'after' }, { command: 'ls', when: 'before' });
  const first = structuredClone(await layout.adopt(pairs));
  const path = join(project, '.project', 'loomd', 'layout.json');
  delete first.tabs.auditor;
  writeFileSync(path, JSON.stringify(first));
  const recovered = await projectLayout(project).adopt(pairs);
  assert.equal(recovered.tabs.auditor.terminal, auditor.address);
  assert.deepEqual(inspect().spaces.map(space => space.tabs.map(tab => tab.name)), [['Leader', 'Auditor', 'Status']]);
  assert.equal(inspect().actions.filter(({ command }) => command === 'space.new').length, 1);
  assert.equal(inspect().terminals.length, 3);
  assert.equal((await commands.hc('get', leader.address)).keep, false);
  assert.equal((await commands.hc('get', auditor.address)).keep, false);
});

test('failed setup removes its placeholder and failed placement disables keep before a retry', async t => {
  const { layout, inspect, launch, faults } = await fixture(t);
  faults({ command: 'run', when: 'after', kind: 'invalid' });
  await assert.rejects(layout.ensure(true), /invalid/);
  assert.ok(inspect().terminals.every(term => term.name));
  await layout.ensure(true);
  const leader = await launch('existing-leader');
  const pairs = [{ row: { role: 'leader', addr: 'loom-leader' }, terminal: leader }];
  faults({ command: 'tab.rename', when: 'before', kind: 'invalid' });
  await assert.rejects(layout.adopt(pairs), /invalid/);
  assert.equal(inspect().terminals.find(term => term.address === leader.address).keep, false);
  assert.equal((await layout.adopt(pairs)).tabs.leader.terminal, leader.address);
});

test('test processes require both fake Herdr executables even for mandatory layouts', async () => {
  const original = process.env.LOOM_HC_BIN;
  delete process.env.LOOM_HC_BIN;
  try {
    await assert.rejects(herdrCommands(), { code: 'herdr-disabled' });
    assert.equal(await herdrCommands({ optional: true }), undefined);
  } finally {
    if (original !== undefined) process.env.LOOM_HC_BIN = original;
  }
});

test('the board reports delivery states and the latest verified verdict across gate rounds', () => {
  const base = { createdAt: 3_000, phase: 'queued', target: { addr: 't1' } };
  const observed = new Map([['t2', { awaitingUser: true }]]);
  assert.deepEqual(deliveryBoard([base, { ...base, typedAt: 4_000 }, { ...base, stalledAt: 9_000 }, { ...base, phase: 'refused' },
    { ...base, target: { addr: 't2' }, createdAt: 500 }, { ...base, received: { at: 9_000 } }], observed, 10_000), {
    counts: { queued: 1, typed: 1, stalled: 1, refused: 1, 'awaiting-user': 1 }, oldestAgeMs: 9_500,
  });
  const packet = { ...base, gateId: 'G1', gatePacket: 'gate.md' };
  const [gate] = gateBoard([{ ...packet, gateRound: 1, completion: { at: 4_000, body: 'PASS\nVerified' } },
    { ...packet, gateRound: 2, completion: { at: 5_000, body: 'REJECT', unconfirmed: true } },
    { ...packet, gateRound: 2, completion: { at: 5_500, body: 'NOREPLY' } }],
    [{ type: 'gate-completed', gate: 'G1', at: 6_000 }]);
  assert.deepEqual([gate.round, gate.verdict.tag, gate.verdict.round, gate.completedAt], [2, 'PASS', 1, 6_000]);
  assert.equal(gate.verdict.text, 'PASS\nVerified');
  assert.equal(gate.packet, 'gate.md');
});

test('status TUI reconnects with read-only board requests and passes pager queries as data', { timeout: 5_000 }, async () => {
  const input = new PassThrough();
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = mode => { input.isRaw = mode; };
  const output = new PassThrough();
  output.isTTY = true;
  const project = '/private/tmp/project';
  let calls = 0;
  let frames = '';
  output.on('data', chunk => {
    frames += chunk;
    if (frames.includes('loomd new')) input.emit('keypress', 'q', { name: 'q' });
  });
  await statusTui({ project }, { input, output, interval: 5, async rpc(directory, command) {
    assert.deepEqual([directory, command], [project, 'board']);
    if (++calls === 2) throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' });
    return { roles: [], workers: [], delivery: { counts: {}, oldestAgeMs: null }, gates: [],
      notifications: { count: 0, last: [] }, pyramids: [],
      release: { id: calls === 1 ? 'old' : 'new', root: '/release', cli: '/cli', warnings: [] } };
  } });
  assert.equal(calls, 3);
  assert.match(frames, /online[^\r\n]*loomd old[\s\S]*disconnected[^\r\n]*loomd old[\s\S]*online[^\r\n]*loomd new/);
  assert.equal(frames.split('\x1b[2J').length - 1, 1);
  assert.equal(input.isRaw, false);
  assert.deepEqual(pagerArgs('history', 'leader', project), ['hist', '--project', project, '--role', 'leader']);
  assert.equal(pagerArgs('history', '--task-literal', project).at(-2), '--');
  assert.equal(pagerArgs('grep', 'two words', project).at(-1), '--grep=two words');
  assert.deepEqual(pagerArgs('memory', '-- literal', project).slice(-2), ['--', '-- literal']);
});
