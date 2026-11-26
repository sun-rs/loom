import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { emitKeypressEvents } from 'node:readline';
import { promisify } from 'node:util';
import { herdrProjects } from '../daemon/herdr-layout.mjs';
import { managedCliPath, releaseRoot } from '../daemon/release.mjs';
import { request } from '../daemon/rpc.mjs';
import { roles } from '../index/index.mjs';
import { managedProject } from './project.mjs';
import { duration } from './status-accounts.mjs';
import { changedLines, row, safe, terminalColors, theme, truncate } from './status-layout.mjs';
import { boardLines, boardView, overlayRows, pages } from './status-view.mjs';

export { boardLines };

const exec = promisify(execFile);
const refreshMs = 5_000;
const scrollKeys = { down: 1, j: 1, up: -1, k: -1 };

function globalView(projects, snapshots, selected, error, paint, width) {
  const body = projects.map((project, index) => {
    const { board, error } = snapshots.get(project) ?? {};
    const parts = [project, error ? 'disconnected' : board ? 'online' : 'connecting'];
    if (board) {
      const { delivery } = board;
      parts.push(`${board.workers.length} workers`, `${board.notifications.count} Super notices`,
        Object.entries(delivery.counts).map(([key, count]) => `${key} ${count}`).join(' · '));
      if (delivery.oldestAgeMs != null) parts.push('oldest ' + duration(delivery.oldestAgeMs));
    }
    const line = safe(parts.filter(Boolean).join(' · '));
    return row(truncate(index === selected ? paint('selected', '› ' + line) : '  ' + line, width));
  });
  if (error) body.push(row(truncate(safe(error), width)));
  else if (!projects.length) body.push(row(truncate('No projects registered. Run loom up in a project.', width)));
  return { header: [row(paint('accent', 'Loom · All projects')), row()], body,
    footer: '↑↓ select  Enter open  r refresh  q quit  ? help' };
}

export function pagerArgs(mode, query, project) {
  const scoped = ['--project', project];
  if (mode === 'memory') return ['memory', 'search', ...scoped, '--', query];
  if (mode === 'grep') return ['hist', ...scoped, '--turns', '25', '--grep=' + query];
  return roles.includes(query) ? ['hist', ...scoped, '--role', query] : ['hist', ...scoped, '--', query];
}

export async function statusTui({ project, once }, { input = process.stdin, output = process.stdout, rpc = request,
  discover = herdrProjects, interval = refreshMs, now = Date.now, env = process.env } = {}) {
  const snapshots = new Map();
  let projects = [];
  let current = project;
  let selectedProject = 0;
  let page = 0;
  let selected;
  let offset = 0;
  let prompt;
  let overlay;
  let pagerRequest;
  let timer;
  let closed = false;
  let refreshing = false;
  let discoveryError;
  let previous = [];
  let bodyRows = 1;
  let items = [];
  const interactive = input.isTTY && output.isTTY && !once;
  const columns = () => Math.max(1, output.columns || Number.parseInt(env.COLUMNS, 10) || 80);

  function render({ reveal = false } = {}) {
    if (closed) return;
    const width = columns();
    const depth = interactive ? terminalColors(output, env) : 1;
    const paint = theme(depth);
    const options = { width, now: now(), page, selected, depth, interactive };
    if (!interactive) {
      const global = current ? undefined : globalView(projects, snapshots, -1, discoveryError, paint, width);
      const lines = current ? boardLines(current, snapshots.get(current), options) : [...global.header, ...global.body].map(line => line.text);
      output.write(lines.join('\n') + '\n');
      return;
    }

    let frame = current ? boardView(current, snapshots.get(current), options) :
      globalView(projects, snapshots, selectedProject, discoveryError, paint, width);
    items = frame.body.flatMap((line, index) => line.items.map(item => ({ ...item, index })));
    if (items.length && !items.some(item => item.id === selected)) {
      selected = items[0].id;
      frame = boardView(current, snapshots.get(current), { ...options, selected });
    }
    const height = output.rows || 24;
    const header = frame.header.slice(0, Math.max(0, height - 2));
    bodyRows = Math.max(1, height - header.length - 1);
    if (reveal) {
      const index = current ? items.find(item => item.id === selected)?.index : selectedProject;
      if (index != null) offset = Math.max(index - bodyRows + 1, Math.min(offset, index));
    }
    offset = Math.min(Math.max(0, offset), Math.max(0, frame.body.length - bodyRows));

    let body = frame.body.slice(offset, offset + bodyRows);
    let hints = frame.footer + (current && !project ? '  Esc projects' : '');
    if (overlay) {
      const layer = overlayRows(overlay, width, bodyRows, paint);
      body = layer.rows.slice(0, bodyRows);
      overlay.offset = layer.offset;
      hints = '↑↓ scroll  PgUp/PgDn page  Esc back  q quit';
    }
    if (prompt) hints = `${prompt.label} › ${prompt.text}`;
    const next = [...header, ...body].map(line => line.text);
    while (next.length < height - 1) next.push('');
    next[height - 1] = paint('muted', truncate(hints, width));
    const changes = changedLines(previous, next);
    previous = next;
    if (changes) output.write(changes);
  }

  async function refresh() {
    if (refreshing || closed) return;
    refreshing = true;
    clearTimeout(timer);
    try {
      projects = project ? [project] : discover();
      discoveryError = undefined;
    } catch (error) { discoveryError = error.message; }
    selectedProject = Math.min(selectedProject, Math.max(0, projects.length - 1));
    await Promise.all(projects.map(async directory => {
      try {
        const board = await rpc(directory, 'board', {}, { timeout: 3_000 });
        snapshots.set(directory, { board });
      } catch (error) {
        const previous = snapshots.get(directory);
        snapshots.set(directory, { ...previous, error: ['ENOENT', 'ECONNREFUSED', 'ECONNRESET', 'not-ready'].includes(error.code) ?
          'Waiting for loomd to reconnect.' : error.message });
      }
    }));
    refreshing = false;
    render();
    if (interactive && !closed) timer = setTimeout(refresh, interval);
  }

  if (!interactive) {
    await refresh();
    return 0;
  }

  const previousRaw = input.isRaw;
  emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();
  output.write('\x1b[?1049h\x1b[?25l\x1b[2J');

  return new Promise(resolve => {
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    function resize() {
      previous = [];
      output.write('\x1b[2J');
      render({ reveal: Boolean(current && offset === 0) });
    }
    function exit() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      pagerRequest?.abort();
      for (const signal of signals) process.off(signal, exit);
      output.off('resize', resize);
      input.off('keypress', keypress);
      input.off('end', exit);
      input.setRawMode(previousRaw);
      input.pause();
      output.write('\x1b[?25h\x1b[?1049l');
      resolve(0);
    }

    async function show(query) {
      const { label, mode } = prompt;
      prompt = undefined;
      overlay = { title: `${label} · ${query}`, lines: ['Loading…'], offset: 0 };
      render();
      const controller = pagerRequest = new AbortController();
      const [executable, ...cli] = managedProject(current) ? [managedCliPath(current)] : [process.execPath, join(releaseRoot, 'bin', 'loom')];
      try {
        const { stdout } = await exec(executable, [...cli, ...pagerArgs(mode, query, current)], {
          cwd: current, timeout: 10_000, maxBuffer: 1024 * 1024, signal: controller.signal,
        });
        if (!controller.signal.aborted) overlay.lines = stdout.trimEnd() ? stdout.trimEnd().split(/\r?\n/) : ['No results.'];
      } catch (error) {
        if (!controller.signal.aborted) overlay.lines = [error.stderr?.trim() || error.message];
      }
      if (pagerRequest === controller) pagerRequest = undefined;
      render();
    }

    function resetPage(next = 0) {
      page = next;
      offset = 0;
      selected = undefined;
    }

    function keypress(text, key = {}) {
      const { name } = key;
      const direction = scrollKeys[name];
      const pageScroll = name === 'pageup' ? -bodyRows : name === 'pagedown' ? bodyRows : 0;
      let reveal = false;
      if (key.ctrl && name === 'c') return exit();
      if (prompt) {
        if (name === 'escape') prompt = undefined;
        else if (name === 'return' && prompt.text.trim()) return void show(prompt.text.trim());
        else if (name === 'backspace') prompt.text = Array.from(prompt.text).slice(0, -1).join('');
        else if (text && !key.ctrl && !key.meta) prompt.text = (prompt.text + safe(text)).slice(0, 500);
      } else if (name === 'q') return exit();
      else if (overlay) {
        if (name === 'escape') {
          pagerRequest?.abort();
          overlay = undefined;
        } else if (pageScroll || direction) overlay.offset = Math.max(0, (overlay.offset ?? 0) + (pageScroll || direction));
      } else if (text === '?') {
        overlay = { title: 'Keys', modal: true, lines: [
          '1–5 / ←→  Switch tabs', '↑↓ / j k  Select a row', 'Enter  Open details or project',
          'Page Up/Down  Scroll', 'h  History · g  Grep · m  Memory',
          'r / R  Refresh snapshots', 'Esc  Back · q  Quit',
        ] };
      } else if (name === 'r') void refresh();
      else if (name === 'escape' && !project) {
        current = undefined;
        resetPage();
        reveal = true;
      } else if (!current && (direction || pageScroll || name === 'return')) {
        if (name === 'return') {
          current = projects[selectedProject];
          resetPage();
        } else selectedProject = Math.max(0, Math.min(projects.length - 1, selectedProject + (pageScroll || direction)));
        reveal = true;
      } else if (current && /^[1-5]$/.test(text ?? '') && !key.ctrl && !key.meta) resetPage(Number(text) - 1);
      else if (current && ['left', 'right'].includes(name)) resetPage((page + (name === 'right' ? 1 : -1) + pages.length) % pages.length);
      else if (name === 'return') {
        const item = items.find(item => item.id === selected);
        if (item && item.index >= offset && item.index < offset + bodyRows) overlay = { ...item, modal: true };
      } else if (pageScroll || (direction && !items.length)) {
        offset += pageScroll || direction;
        // Keep the selected row within the new viewport when there is one.
        const nearby = items.filter(item => item.index >= offset && item.index < offset + bodyRows);
        if (nearby.length && !nearby.some(item => item.id === selected)) selected = nearby[0].id;
      } else if (direction) {
        const index = items.findIndex(item => item.id === selected);
        const next = Math.max(0, Math.min(items.length - 1, index + direction));
        if (next === index) offset += direction;
        else {
          selected = items[next]?.id;
          reveal = true;
        }
      } else if (current && ['h', 'g', 'm'].includes(name)) {
        const [mode, label] = { h: ['history', 'History role, task or address'], g: ['grep', 'History grep'], m: ['memory', 'Memory search'] }[name];
        prompt = { mode, label, text: '' };
      }
      render({ reveal });
    }
    for (const signal of signals) process.on(signal, exit);
    output.on('resize', resize);
    input.on('keypress', keypress);
    input.on('end', exit);
    render();
    void refresh();
  });
}
