import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { runtimeDirectory } from '../cli/project.mjs';
import { absoluteCommand } from '../runtimes/tui/transport.mjs';
import { readText, writeState } from './io.mjs';
import { managedCliPath, releaseRoot } from './release.mjs';

const exec = promisify(execFile);
const layoutPath = project => join(runtimeDirectory(project), 'layout.json');
const localState = () => join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'loom');
const readLayoutFile = path => JSON.parse(readText(path, 'null'));
export const readLayout = project => readLayoutFile(layoutPath(project));
export const visibleRoles = ['leader', 'auditor'];
const titleFor = role => role[0].toUpperCase() + role.slice(1);
const terminalId = /^t[0-9a-z]+$/;
const projectSlug = project => {
  const stem = basename(project).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (stem.slice(0, 13) || 'project') + '-' + createHash('sha256').update(project).digest('hex').slice(0, 8);
};

async function json(executable, args) {
  try {
    const { stdout } = await exec(executable, args, { timeout: 4_000, maxBuffer: 2 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch (error) {
    let detail;
    try { detail = JSON.parse(error.stderr || error.stdout).error; } catch { /* Transport failure. */ }
    throw Object.assign(new Error(`${basename(executable)} ${args.slice(0, args[0] === 'do' ? 2 : 1).join(' ')}: ${detail?.message ?? detail ?? error.code ?? 'unavailable'}`),
      { code: detail?.kind === 'not_found' ? 'not-found' : 'herdr-unavailable', cause: error });
  }
}

export async function herdrCommands({ optional = false } = {}) {
  const appOverride = process.env.LOOM_HERDR_APP_BIN;
  if (optional && (process.env.LOOM_HERDR_LAYOUT === '0' || process.env.NODE_TEST_CONTEXT && !appOverride)) return;
  let application;
  let core;
  try {
    application = await absoluteCommand(appOverride ?? 'herdr-app', 'herdr-app');
    core = await absoluteCommand('hc');
  } catch (error) {
    if (optional && error.code === 'ENOENT' && !appOverride) return;
    throw error;
  }
  return {
    core,
    async spaces() { return (await json(application, ['ls'])).spaces; },
    app: (command, args) => json(application, ['do', command, JSON.stringify(args)]),
    hc: (command, ...args) => json(core, [command, '--json', ...args]),
  };
}

const findPane = (tab, terminal) => tab?.terminals.find(item => item.terminal === terminal);
const sameTerminal = (a, b) => a.address === b.address && a.created_ms === b.created_ms && a.pid === b.pid;
const pauseProgram = role => [process.execPath, '-e',
  `console.log(${JSON.stringify(`Waiting for Loom ${titleFor(role)}`)}); setInterval(() => {}, 2147483647)`];

function panels(project, path, name, slug, roles, commands) {
  const get = terminal => commands.hc('get', terminal).catch(error => {
    if (error.code !== 'not-found') throw error;
  });
  let state;
  const load = () => state ??= readLayoutFile(path);
  const save = () => writeState(path, JSON.stringify(state, null, 2) + '\n');
  const labelsFor = tab => ({ 'herdr.space': state.space.id, 'herdr.tab': tab.id });
  const action = (command, args) => commands.app(command, args);
  async function findSpace() {
    return (await commands.spaces()).find(space => space.id === load()?.space.id && !space.machine);
  }

  async function ensureTabs() {
    const current = await findSpace();
    if (!current) {
      const [first] = roles;
      const created = await action('space.new', {
        name, folder: project, tab: titleFor(first), argv: pauseProgram(first), focus: false,
      });
      state = { space: { id: created.space, name }, tabs: {
        [first]: { id: created.tab, name: titleFor(first), placeholder: created.terminal },
      } };
      save();
    }
    for (const role of roles) {
      const tab = state.tabs[role];
      if (tab && (!current || current.tabs.some(item => item.id === tab.id))) continue;
      const created = await action('tab.new', {
        space: state.space.id, name: titleFor(role), folder: project, argv: pauseProgram(role), focus: false,
      });
      state.tabs[role] = { id: created.tab, name: titleFor(role), placeholder: created.terminal };
      save();
    }
    const visible = (await findSpace())?.tabs ?? [];
    for (const [index, role] of roles.entries()) {
      const id = state.tabs[role].id;
      const position = visible.findIndex(tab => tab.id === id);
      if (position >= 0 && position !== index) {
        await action('tab.move', { id, index: index + 1 });
        visible.splice(index, 0, ...visible.splice(position, 1));
      }
    }
    return state;
  }

  async function finishPlacement(role, terminal) {
    const tab = load().tabs[role];
    const deadline = Date.now() + 4_000;
    let visible;
    do {
      const current = (await findSpace())?.tabs.find(item => item.id === tab.id);
      if (findPane(current, terminal.address)) { visible = current; break; }
      await delay(100);
    } while (Date.now() < deadline);
    if (!visible) throw new Error(`Herdr did not place ${terminal.address} in the ${tab.name} tab`);
    let placed = await get(terminal.address);
    if (!placed || placed.state !== 'live' || !sameTerminal(terminal, placed)) {
      throw new Error(`hc terminal identity changed during placement: ${terminal.address}`);
    }
    // Herdr enables keep when it lays out a terminal. A replacement shell
    // would hide the original program's exit from Loom's holder binding.
    if (placed.keep) {
      await commands.hc('keep', placed.address, '--off');
      placed = await get(placed.address);
      if (!placed || placed.keep || placed.state !== 'live' || !sameTerminal(terminal, placed)) {
        throw new Error(`hc could not disable keep for ${terminal.address}`);
      }
    }
    const placeholder = findPane(visible, tab.placeholder);
    if (placeholder) {
      await action('pane.close', { pane: placeholder.pane });
      const retired = await get(placeholder.terminal);
      if (retired?.state === 'finished') await commands.hc('rm', retired.address);
    }
    if (tab.placeholder) { delete tab.placeholder; save(); }
    return placed;
  }

  function publish(role, terminal, addr) {
    const tab = load().tabs[role];
    Object.assign(tab, { terminal: terminal.address, hcName: terminal.name, createdAt: terminal.created_ms, ...(addr && { addr }) });
    save();
  }

  async function adopt(role, terminal, addr) {
    if (!terminalId.test(terminal.address) || terminal.state !== 'live') throw new Error('Adoption requires a live local hc terminal');
    const tab = load().tabs[role];
    const placement = labelsFor(tab);
    const visible = (await commands.spaces()).flatMap(space => space.tabs.map(item => ({ space, item })))
      .find(({ item }) => findPane(item, terminal.address));
    if (visible && (visible.space.id !== state.space.id || visible.item.id !== tab.id)) {
      throw new Error(`Terminal ${terminal.address} already has a pane outside the requested tab`);
    }
    if (tab.terminal && tab.terminal !== terminal.address && (await get(tab.terminal))?.state === 'live') {
      throw new Error(`The ${tab.name} tab already has a live terminal`);
    }
    if (!visible) {
      await commands.hc('label', terminal.address, ...Object.entries(placement).map(([key, value]) => `${key}=${value}`));
    }
    const placed = await finishPlacement(role, terminal);
    publish(role, placed, addr);
    return placed;
  }

  async function status(argv) {
    const tab = load().tabs.status;
    const previous = tab.terminal && await get(tab.terminal);
    if (previous?.state === 'live' && previous.created_ms === tab.createdAt) {
      await finishPlacement('status', previous);
      return state;
    }
    const name = slug + '-status';
    const labels = { ...labelsFor(tab), 'loom.status': path };
    const existing = await get(name);
    if (existing?.state === 'live' && existing.labels?.['loom.status'] !== path) {
      throw new Error(`hc name ${name} is already in use`);
    }
    let terminal = existing;
    if (terminal?.state !== 'live') {
      const started = await commands.hc('run', '--bg', '--no-parent', '--no-notify', '--name', name, '--cwd', project,
        ...Object.entries(labels).flatMap(([key, value]) => ['--label', `${key}=${value}`]), '--', ...argv);
      terminal = terminalId.test(started.address) && await get(started.address);
      if (terminal?.name !== name || terminal.labels?.['loom.status'] !== path || terminal.state !== 'live') {
        throw new Error(`hc did not confirm the new Status terminal ${started.address}`);
      }
    }
    if (terminal.labels?.['herdr.tab'] !== tab.id) await adopt('status', terminal);
    else publish('status', await finishPlacement('status', terminal));
    return state;
  }

  return { ensureTabs, finishPlacement, adopt, publish, get, status, labelsFor, load, save };
}

export function projectLayout(project, { connect = herdrCommands } = {}) {
  const path = layoutPath(project);
  const slug = projectSlug(project);
  let client;
  let layout;
  async function ensure(required) {
    client ??= await connect({ optional: !required });
    if (!client) return;
    layout ??= panels(project, path, `Loom ${basename(project)}`, slug, [...visibleRoles, 'status'], client);
    await layout.ensureTabs();
    const roster = join(localState(), 'herdr-projects');
    const registration = join(roster, createHash('sha256').update(project).digest('hex') + '.json');
    if (readLayoutFile(registration) !== project) {
      mkdirSync(roster, { recursive: true, mode: 0o700 });
      writeState(registration, JSON.stringify(project) + '\n');
    }
    return layout.status([managedCliPath(project), 'tui', '--project', project]);
  }

  return {
    ensure,
    async placement(row) {
      const state = await ensure(false);
      if (!state) return;
      const name = `${slug}-${row.role}`;
      const taken = await layout.get(name);
      const hcName = taken?.state === 'live' ? `${slug.slice(0, 15)}-${row.role}-${row.addr.slice(-8)}` : name;
      return { hcName, hcCommand: client.core, labels: { ...layout.labelsFor(state.tabs[row.role]), 'loom.session': row.addr } };
    },
    async place(row, terminal, pending) {
      if (!layout) await ensure(true);
      const placed = await layout.finishPlacement(row.role, terminal);
      if (!pending) layout.publish(row.role, placed, row.addr);
    },
    async publish(row, terminal) {
      if (!layout) await ensure(false);
      layout?.publish(row.role, terminal, row.addr);
    },
    async adopt(entries) {
      await ensure(true);
      for (const { row, terminal } of entries) await layout.adopt(row.role, terminal, row.addr);
      return layout.load();
    },
    clear(row) {
      if (!visibleRoles.includes(row.role)) return;
      const state = layout?.load() ?? readLayout(project);
      const tab = state?.tabs[row.role];
      if (tab?.addr !== row.addr) return;
      for (const key of ['addr', 'terminal', 'hcName', 'createdAt']) delete tab[key];
      if (layout) layout.save();
      else writeState(path, JSON.stringify(state, null, 2) + '\n');
    },
  };
}

export async function superLayout(project, terminalAddress, commands) {
  commands ??= await herdrCommands();
  const path = join(localState(), 'herdr-super.json');
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const layout = panels(project, path, 'Loom', 'loom-global', ['super', 'status'], commands);
  const terminal = await layout.get(terminalAddress);
  if (terminal?.state !== 'live') throw new Error('Specify a live local Super terminal');
  await layout.ensureTabs();
  await layout.adopt('super', terminal);
  const stateEnvironment = process.env.XDG_STATE_HOME ? [`XDG_STATE_HOME=${process.env.XDG_STATE_HOME}`] : [];
  return layout.status(['/usr/bin/env', ...stateEnvironment, process.execPath, join(releaseRoot, 'bin', 'loom'), 'tui', '--all']);
}

export function herdrProjects() {
  const roster = join(localState(), 'herdr-projects');
  let files;
  try { files = readdirSync(roster, { withFileTypes: true }); }
  catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return files.filter(file => file.isFile() && /^[0-9a-f]{64}\.json$/.test(file.name))
    .map(file => readLayoutFile(join(roster, file.name)))
    .filter(project => typeof project === 'string' && isAbsolute(project) && readLayout(project))
    .sort();
}
