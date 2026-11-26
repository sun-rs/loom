import { execFile } from 'node:child_process';
import { writeSync } from 'node:fs';
import { join } from 'node:path';
import { emitKeypressEvents } from 'node:readline';
import { PassThrough } from 'node:stream';
import { promisify } from 'node:util';
import { herdrProjects } from '../daemon/herdr-layout.mjs';
import { managedCliPath, releaseRoot } from '../daemon/release.mjs';
import { readAccounts } from '../daemon/accounts.mjs';
import { request } from '../daemon/rpc.mjs';
import { roles } from '../index/index.mjs';
import { managedProject } from './project.mjs';
import { duration } from './status-accounts.mjs';
import { splitInput } from './status-input.mjs';
import { changedLines, hitRegions, row, safe, terminalColors, theme, truncate } from './status-layout.mjs';
import { boardLines, boardView, overlayRows, pages } from './status-view.mjs';

export { boardLines };

const exec = promisify(execFile);
const refreshMs = 5_000;
const terminalEnter = '\x1b[?1049h\x1b[?25l\x1b[?1006h\x1b[?1000h\x1b[2J';
const terminalLeave = '\x1b[?1000l\x1b[?1006l\x1b[?25h\x1b[?1049l';
const scrollKeys = { down: 1, j: 1, up: -1, k: -1 };

function globalView(projects, snapshots, selected, error, paint, width) {
  const body = projects.map((project, index) => {
    const { board, error } = snapshots.get(project) ?? {};
    const parts = [project, error ? 'disconnected' : board ? 'online' : 'connecting'];
    if (board) {
      const { delivery } = board;
      parts.push(`${board.workers.filter(worker => worker.endedAt == null).length} workers`, `${board.notifications.count} Super notices`,
        Object.entries(delivery.counts).map(([key, count]) => `${key} ${count}`).join(' · '));
      if (delivery.oldestAgeMs != null) parts.push('oldest ' + duration(delivery.oldestAgeMs));
    }
    const line = safe(parts.filter(Boolean).join(' · '));
    return row(truncate(index === selected ? paint('selected', '› ' + line) : '  ' + line, width), { id: 'project:' + project, project, index });
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
  let showEnded = false;
  let hitMap = [];
  let lastClick;
  const interactive = input.isTTY && output.isTTY && !once;
  const columns = () => Math.max(1, output.columns || Number.parseInt(env.COLUMNS, 10) || 80);

  function render({ reveal = false } = {}) {
    if (closed) return;
    const width = columns();
    const depth = interactive ? terminalColors(output, env) : 1;
    const paint = theme(depth);
    const options = { width, now: now(), page, selected, showEnded, depth, interactive };
    if (!interactive) {
      const global = current ? undefined : globalView(projects, snapshots, -1, discoveryError, paint, width);
      const lines = current ? boardLines(current, snapshots.get(current), options) : [...global.header, ...global.body].map(line => line.text);
      output.write(lines.join('\n') + '\n');
      return;
    }

    let frame = current ? boardView(current, snapshots.get(current), options) :
      globalView(projects, snapshots, selectedProject, discoveryError, paint, width);
    items = frame.body.flatMap((line, index) => line.items.map(item => ({ ...item, index })));
    if (current && items.length && !items.some(item => item.id === selected)) {
      selected = (items.find(item => !item.toggle) ?? items[0]).id;
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
    const visible = [...header, ...body];
    hitMap = visible.map(line => hitRegions(line, width));
    const next = visible.map(line => line.text);
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
        snapshots.set(directory, { board, ...(!board.accounts && { offlineAccounts: readAccounts(directory, { now }) }) });
      } catch (error) {
        const previous = snapshots.get(directory);
        snapshots.set(directory, { ...previous, offlineAccounts: readAccounts(directory, { now }), error: ['ENOENT', 'ECONNREFUSED', 'ECONNRESET', 'not-ready'].includes(error.code) ?
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
  const keyboard = new PassThrough();
  emitKeypressEvents(keyboard);

  return new Promise((resolve, reject) => {
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'];
    const inputParser = splitInput(bytes => keyboard.write(bytes), mouse, () => keypress('\x1b', { name: 'escape' }));
    let restored = false;
    function resize() {
      previous = [];
      output.write('\x1b[2J');
      render({ reveal: Boolean(current && offset === 0) });
    }

    function restore(sync = false) {
      if (restored) return;
      restored = true;
      try { input.setRawMode(previousRaw); } catch { /* The input TTY can already be gone. */ }
      try {
        if (sync && Number.isInteger(output.fd)) writeSync(output.fd, terminalLeave);
        else output.write(terminalLeave);
      } catch { /* The output TTY can already be gone. */ }
    }
    const emergencyRestore = () => restore(true);

    function cleanup() {
      closed = true;
      clearTimeout(timer);
      pagerRequest?.abort();
      for (const signal of signals) process.off(signal, exit);
      process.off('exit', emergencyRestore);
      process.off('uncaughtExceptionMonitor', emergencyRestore);
      output.off('resize', resize);
      input.off('data', inputParser.write);
      input.off('keypress', keypress);
      input.off('end', exit);
      keyboard.off('keypress', keypress);
      keyboard.destroy();
      inputParser.close();
      input.pause();
      restore();
    }
    function exit() {
      if (closed) return;
      cleanup();
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
      lastClick = undefined;
    }

    function toggleWorkers() {
      showEnded = !showEnded;
      resetPage(page);
    }

    function openItem(item) {
      if (item.toggle) toggleWorkers();
      else if (item.page != null) resetPage(item.page);
      else if (item.project) {
        current = item.project;
        resetPage();
      } else overlay = { ...item, modal: true };
    }

    function scroll(delta) {
      if (overlay) {
        overlay.offset = Math.max(0, (overlay.offset ?? 0) + delta);
        return;
      }
      offset = Math.max(0, offset + delta);
      const nearby = items.find(item => item.index >= offset && item.index < offset + bodyRows);
      if (nearby && !items.some(item => item.id === selected && item.index >= offset && item.index < offset + bodyRows)) {
        if (current) selected = nearby.id;
        else selectedProject = nearby.index;
      }
    }

    function mouse({ button, x, y, press }) {
      if (closed || prompt || !press || x < 1 || y < 1) return;
      if (button === 64 || button === 65) {
        lastClick = undefined;
        scroll(button === 64 ? -3 : 3);
        render();
        return;
      }
      if (overlay || button !== 0) return;
      const hit = hitMap[y - 1]?.find(hit => x >= hit.from && x <= hit.to);
      if (!hit) {
        lastClick = undefined;
        return;
      }
      const { item } = hit;
      if (item.page != null || item.toggle) openItem(item);
      else {
        const time = performance.now();
        if (lastClick?.id === item.id && time - lastClick.time <= 400) {
          lastClick = undefined;
          openItem(item);
        } else {
          lastClick = { id: item.id, time };
          if (item.project) selectedProject = item.index;
          else selected = item.id;
        }
      }
      render();
    }

    function keypress(text, key = {}) {
      const { name } = key;
      lastClick = undefined;
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
        } else if (pageScroll || direction) scroll(pageScroll || direction);
      } else if (text === '?') {
        overlay = { title: 'Keys', modal: true, lines: [
          '1–5 / ←→ or click  Switch tabs', '↑↓ / j k / click  Select a row', 'Enter / double-click  Open details',
          'Wheel / Page Up/Down  Scroll', 'a  Toggle inactive workers', 'h  History · g  Grep · m  Memory',
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
      else if (current && pages[page] === 'Workers' && name === 'a') toggleWorkers();
      else if (name === 'return') {
        const item = items.find(item => item.id === selected);
        if (item && item.index >= offset && item.index < offset + bodyRows) openItem(item);
      } else if (pageScroll || (direction && !items.length)) {
        scroll(pageScroll || direction);
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
    process.on('exit', emergencyRestore);
    process.on('uncaughtExceptionMonitor', emergencyRestore);
    output.on('resize', resize);
    input.on('keypress', keypress);
    input.on('end', exit);
    keyboard.on('keypress', keypress);
    try {
      input.setRawMode(true);
      output.write(terminalEnter);
      input.on('data', inputParser.write);
      input.resume();
      render();
      void refresh();
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
