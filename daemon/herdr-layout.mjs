import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
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
    for (const output of [error.stderr, error.stdout]) {
      try { detail = JSON.parse(output).error; } catch { /* Try the other stream. */ }
      if (detail) break;
    }
    const message = detail?.message ?? detail ?? error.code ?? 'unavailable';
    const code = detail?.kind === 'not_found' ? 'not-found' :
      error.killed || detail?.kind === 'unavailable' || /^unavailable$/i.test(message) ? 'herdr-unavailable' : 'herdr-command-failed';
    throw Object.assign(new Error(`${basename(executable)} ${args.slice(0, args[0] === 'do' ? 2 : 1).join(' ')}: ${message}`),
      { code, cause: error });
  }
}

async function retry(operation) {
  for (const backoff of [100, 200, 400]) {
    try { return await operation(); }
    catch (error) {
      if (error.code !== 'herdr-unavailable') throw error;
      await delay(backoff);
    }
  }
  return operation();
}

export async function herdrCommands({ optional = false } = {}) {
  const appOverride = process.env.LOOM_HERDR_APP_BIN;
  if (process.env.LOOM_HERDR_LAYOUT === '0' ||
      process.env.NODE_TEST_CONTEXT !== undefined && !(appOverride && process.env.LOOM_HC_BIN)) {
    if (optional) return;
    throw Object.assign(new Error('Herdr layout is disabled in this process'), { code: 'herdr-disabled' });
  }
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
    async spaces() { return (await retry(() => json(application, ['ls']))).spaces; },
    app(command, args) {
      const invoke = () => json(application, ['do', command, JSON.stringify(args)]);
      return command.endsWith('.new') ? invoke() : retry(invoke);
    },
    hc(command, ...args) {
      const invoke = () => json(core, [command, '--json', ...args]);
      return command === 'run' ? invoke() : retry(invoke);
    },
  };
}

const findPane = (tab, terminal) => tab?.terminals.find(item => item.terminal === terminal);
const sameTerminal = (a, b) => a.address === b.address && a.created_ms === b.created_ms && a.pid === b.pid;
function panels(project, path, name, slug, roles, commands) {
  const get = terminal => commands.hc('get', terminal).catch(error => {
    if (error.code !== 'not-found') throw error;
  });
  let state;
  const load = () => state ??= readLayoutFile(path);
  const save = () => writeState(path, JSON.stringify(state, null, 2) + '\n');
  const findSpace = spaces => spaces.find(space => space.id === load()?.space.id && !space.machine);
  const namedTab = (role, space, terminal) => {
    const byName = space?.tabs.filter(tab => tab.name === titleFor(role)) ?? [];
    return byName.find(tab => findPane(tab, terminal)) ??
      space?.tabs.find(tab => tab.id === load().tabs[role]?.id) ?? byName[0];
  };
  const labelsFor = tab => ({ 'herdr.space': state.space.id, ...(tab && { 'herdr.tab': tab.id }) });
  const setLabels = (terminal, labels) => commands.hc('label', terminal.address,
    ...Object.entries(labels).map(([key, value]) => `${key}=${value}`));

  async function retirePlaceholder(address) {
    if (!address) return;
    const terminal = await get(address);
    if (terminal?.state === 'live') {
      if (terminal.keep) await commands.hc('keep', address, '--off');
      await commands.hc('kill', address);
    }
    if ((await get(address))?.state === 'finished') {
      await commands.hc('rm', address).catch(error => {
        if (error.code !== 'not-found') throw error;
      });
    }
  }

  async function order(space) {
    const tabs = [...space.tabs];
    let index = 0;
    for (const role of roles) {
      const id = namedTab(role, space)?.id;
      const position = tabs.findIndex(tab => tab.id === id);
      if (position < 0) continue;
      if (position !== index) {
        await commands.app('tab.move', { id, index: index + 1 });
        tabs.splice(index, 0, ...tabs.splice(position, 1));
      }
      index++;
    }
  }

  async function prepare(argv) {
    let current = findSpace(await commands.spaces());
    let placeholder;
    try {
      if (!current) {
        // space.new requires a program. The named Status process replaces this
        // temporary pane, and the unique tab title identifies a lost reply.
        const setup = `Loom setup ${randomUUID()}`;
        let attempted = false;
        async function recover() {
          for (const space of await commands.spaces()) {
            const tab = !space.machine && space.name === name && space.folder === project &&
              space.tabs.find(item => item.name === setup);
            if (tab) return { space: space.id, tab: tab.id, terminal: tab.terminals[0]?.terminal };
          }
        }
        const created = await retry(async () => {
          const recovered = attempted && await recover();
          if (recovered) return recovered;
          attempted = true;
          return commands.app('space.new', { name, folder: project, tab: setup, argv: ['/bin/sleep', '60'], focus: false });
        }).catch(async error => {
          if (error.code === 'herdr-unavailable') {
            const recovered = await recover();
            if (recovered) return recovered;
          }
          throw error;
        });
        placeholder = created.terminal;
        state = { space: { id: created.space, name }, tabs: { status: { id: created.tab, name: 'Status' } } };
        save();
      } else {
        const legacy = roles.filter(role => state.tabs[role]?.placeholder);
        for (const role of legacy) {
          await retirePlaceholder(state.tabs[role].placeholder);
          delete state.tabs[role].placeholder;
        }
        if (legacy.length) current = findSpace(await commands.spaces());
        for (const role of roles) {
          const old = state.tabs[role];
          const tab = namedTab(role, current);
          if (tab && old?.id !== tab.id) state.tabs[role] = { id: tab.id, name: titleFor(role) };
          if (!tab && old) delete state.tabs[role];
        }
        save();
      }
      await status(argv);
      return state;
    } finally {
      await retirePlaceholder(placeholder);
    }
  }

  async function disableKeep(terminal) {
    let placed = await get(terminal.address);
    if (placed?.state === 'live' && sameTerminal(terminal, placed) && placed.keep) {
      // A replacement shell would hide the original program's exit from Loom.
      await commands.hc('keep', placed.address, '--off');
      placed = await get(placed.address);
    }
    return placed;
  }

  async function finishPlacement(role, terminal, expected, attach = false) {
    let space, tab, placed;
    const title = titleFor(role);
    try {
      if (attach) {
        await setLabels(terminal, { ...labelsFor(expected), ...(!expected && { 'herdr.tab': '' }) }).catch(error => {
          if (error.code !== 'herdr-unavailable') throw error;
          // The Core may have applied the labels even without a reply.
        });
      }
      const deadline = Date.now() + 4_000;
      do {
        space = findSpace(await commands.spaces());
        tab = space?.tabs.find(item => findPane(item, terminal.address));
        if (tab) break;
        await delay(100);
      } while (Date.now() < deadline);
      if (!tab || expected && tab.id !== expected.id || !expected && tab.name !== title && !/^\d+$/.test(tab.name)) {
        throw new Error(`Herdr did not place ${terminal.address} in the ${title} tab`);
      }
      const rename = tab.name !== title;
      if (rename) {
        await commands.app('tab.rename', { id: tab.id, name: title });
        tab.name = title;
      }
      await order(space);
    } finally {
      placed = await disableKeep(terminal);
    }
    if (!placed || placed.keep || placed.state !== 'live' || !sameTerminal(terminal, placed)) {
      throw new Error(`hc could not confirm live placement with keep disabled for ${terminal.address}`);
    }
    if (load().tabs[role]?.id !== tab.id) state.tabs[role] = { id: tab.id, name: title };
    return placed;
  }

  function publish(role, terminal, addr, persist = true) {
    const tab = load().tabs[role];
    Object.assign(tab, { terminal: terminal.address, hcName: terminal.name, createdAt: terminal.created_ms, ...(addr && { addr }) });
    if (persist) save();
  }

  async function adopt(role, terminal) {
    if (!terminalId.test(terminal.address) || terminal.state !== 'live') throw new Error('Adoption requires a live local hc terminal');
    const spaces = await commands.spaces();
    const space = findSpace(spaces);
    const tab = namedTab(role, space, terminal.address);
    const visibleSpace = spaces.filter(item => !item.machine).find(item => item.tabs.some(t => findPane(t, terminal.address)));
    const visible = visibleSpace?.tabs.find(item => findPane(item, terminal.address));
    const unnamed = !tab && /^\d+$/.test(visible?.name) &&
      (await get(terminal.address))?.labels?.['herdr.space'] === state.space.id;
    if (visible && (visibleSpace.id !== state.space.id || (!unnamed && visible.id !== tab?.id))) {
      throw new Error(`Terminal ${terminal.address} already has a pane outside the requested tab`);
    }
    const record = load().tabs[role];
    if (record?.terminal && record.terminal !== terminal.address && (await get(record.terminal))?.state === 'live') {
      throw new Error(`The ${titleFor(role)} tab already has a live terminal`);
    }
    return finishPlacement(role, terminal, tab, !visible);
  }

  async function status(argv) {
    const tab = load().tabs.status;
    const previous = tab?.terminal && await get(tab.terminal);
    if (previous?.state === 'live' && previous.created_ms === tab.createdAt) {
      return adopt('status', previous);
    }
    const name = slug + '-status';
    const labels = { ...labelsFor(tab), 'loom.status': path };
    const terminal = await retry(async () => {
      const existing = await get(name);
      if (existing?.state === 'live') {
        if (existing.labels?.['loom.status'] !== path) throw new Error(`hc name ${name} is already in use`);
        return existing;
      }
      const started = await commands.hc('run', '--bg', '--no-parent', '--no-notify', '--name', name, '--cwd', project,
        ...Object.entries(labels).flatMap(([key, value]) => ['--label', `${key}=${value}`]), '--', ...argv);
      const confirmed = terminalId.test(started.address) && await get(started.address);
      if (confirmed?.name !== name || confirmed.labels?.['loom.status'] !== path || confirmed.state !== 'live') {
        throw new Error(`hc did not confirm the new Status terminal ${started.address}`);
      }
      return confirmed;
    });
    const attach = terminal.labels?.['herdr.space'] !== state.space.id;
    publish('status', await finishPlacement('status', terminal, tab, attach));
  }

  return { prepare, finishPlacement, adopt, publish, get, labelsFor, load, save };
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
    const state = await layout.prepare([managedCliPath(project), 'tui', '--project', project]);
    const roster = join(localState(), 'herdr-projects');
    const registration = join(roster, createHash('sha256').update(project).digest('hex') + '.json');
    if (readLayoutFile(registration) !== project) {
      mkdirSync(roster, { recursive: true, mode: 0o700 });
      writeState(registration, JSON.stringify(project) + '\n');
    }
    return state;
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
      const placed = await layout.finishPlacement(row.role, terminal, layout.load().tabs[row.role]);
      if (!pending) layout.publish(row.role, placed, row.addr);
    },
    async publish(row, terminal) {
      if (!layout) await ensure(false);
      layout?.publish(row.role, terminal, row.addr);
    },
    async adopt(entries) {
      await ensure(true);
      const placed = [];
      for (const { row, terminal } of entries) placed.push({ row, terminal: await layout.adopt(row.role, terminal) });
      for (const { row, terminal } of placed) layout.publish(row.role, terminal, row.addr, false);
      layout.save();
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
  const stateEnvironment = process.env.XDG_STATE_HOME ? [`XDG_STATE_HOME=${process.env.XDG_STATE_HOME}`] : [];
  await layout.prepare(['/usr/bin/env', ...stateEnvironment, process.execPath, join(releaseRoot, 'bin', 'loom'), 'tui', '--all']);
  layout.publish('super', await layout.adopt('super', terminal));
  return layout.load();
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
