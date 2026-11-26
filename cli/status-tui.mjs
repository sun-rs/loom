import { execFile } from 'node:child_process';
import { basename, join } from 'node:path';
import { emitKeypressEvents } from 'node:readline';
import { promisify } from 'node:util';
import { herdrProjects } from '../daemon/herdr-layout.mjs';
import { managedCliPath, releaseRoot } from '../daemon/release.mjs';
import { request } from '../daemon/rpc.mjs';
import { roles } from '../index/index.mjs';
import { managedProject } from './project.mjs';

const exec = promisify(execFile);
const refreshMs = 5_000;
const safe = value => String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');

export function boardLines(project, { board, error } = {}) {
  const lines = [`Loom · ${project}${error ? ' · disconnected' : board ? ' · online' : ' · connecting'}`];
  if (error) lines.push(error);
  if (!board) return lines;
  const { layout, roles, workers, delivery, gates, notifications, pyramids, release } = board;
  if (layout) {
    lines.push('', `Herdr · ${layout.space.name} · ${layout.space.id}`);
    for (const slot of Object.values(layout.tabs)) {
      lines.push(`  ${slot.name} · ${slot.id} · ${slot.terminal ?? 'vacant'}${slot.hcName ? ' · ' + slot.hcName : ''}`);
    }
  }
  lines.push('', 'Roles');
  for (const role of roles) lines.push(`  ${role.role} · ${role.cli} · ${role.state} · ${role.addr}${role.awaitingHandover ? ' · awaiting handover' : ''}`);
  if (!roles.length) lines.push('  none');
  lines.push('', 'Delivery · ' + deliveryText(delivery));
  lines.push('', `Headless workers · ${workers.length}`);
  for (const worker of workers) lines.push(`  ${worker.task} · wave ${worker.wave} · ${worker.state} · ${worker.addr}`);
  lines.push('', 'Gates');
  for (const gate of gates) lines.push(`  ${gate.id}${gate.round != null ? ' · round ' + gate.round : ''} · ${gate.completedAt ? 'completed' : gate.phase}` +
    (gate.verdict ? ` · round ${gate.verdict.round} ${gate.verdict.line}` : ''));
  if (!gates.length) lines.push('  none');
  lines.push('', `Super notifications · ${notifications.count} pending`);
  for (const notice of notifications.last) lines.push(`  ${notice.type} · ${notice.text ?? ''}`);
  lines.push('', 'Cost pyramid (1h)');
  for (const pyramid of pyramids) lines.push(`  ${basename(pyramid.project)} · ${pyramid.state} · ${new Date(pyramid.sampledAt).toISOString()}` +
    pyramid.inversions.map(item => ` · ${item.higher} > ${item.lower} (${item.metric})`).join(''));
  if (!pyramids.length) lines.push('  awaiting sample');
  lines.push('', 'Release paths', `  loomd · ${release.id} · ${release.root}`, `  CLI · ${release.cli}`);
  if (release.active && release.active !== release.root) lines.push(`  active · ${release.active}`);
  for (const warning of release.warnings) lines.push(`  ${warning.role} · ${warning.reason}${warning.path ? ' · ' + warning.path : ''}`);
  return lines;
}

function deliveryText({ counts, oldestAgeMs }) {
  return Object.entries(counts).map(([key, count]) => `${key} ${count}`).join(' · ') +
    (oldestAgeMs === null ? '' : ` · oldest pending ${Math.floor(oldestAgeMs / 1000)}s`);
}

function globalLines(projects, snapshots, selected) {
  const lines = ['Loom · All projects', ''];
  if (!projects.length) lines.push('No projects registered. Run loom up in a project.');
  for (const [index, project] of projects.entries()) {
    const { board, error } = snapshots.get(project) ?? {};
    const parts = [index === selected ? '›' : ' ', project, error ? 'disconnected' : board ? 'online' : 'connecting'];
    if (board) parts.push(`${board.workers.length} workers`, `${board.notifications.count} Super notices`, deliveryText(board.delivery));
    lines.push(parts.join(' · '));
  }
  return lines;
}

export function pagerArgs(mode, query, project) {
  const scoped = ['--project', project];
  if (mode === 'memory') return ['memory', 'search', ...scoped, '--', query];
  if (mode === 'grep') return ['hist', ...scoped, '--turns', '25', '--grep=' + query];
  return roles.includes(query) ? ['hist', ...scoped, '--role', query] : ['hist', ...scoped, '--', query];
}

export async function statusTui({ project, once }, { input = process.stdin, output = process.stdout, rpc = request,
  discover = herdrProjects, interval = refreshMs } = {}) {
  const snapshots = new Map();
  let projects = [];
  let current = project;
  let selected = 0;
  let offset = 0;
  let prompt;
  let pager;
  let pagerRequest;
  let timer;
  let closed = false;
  let refreshing = false;
  let discoveryError;
  const interactive = input.isTTY && output.isTTY && !once;

  function lines() {
    if (pager) return [pager.title, '', ...pager.lines];
    if (current) return boardLines(current, snapshots.get(current));
    const global = globalLines(projects, snapshots, interactive ? selected : -1);
    if (discoveryError) global.push('', discoveryError);
    return global;
  }

  const pageSize = () => Math.max(1, (output.rows || 24) - 2);
  function render() {
    if (closed) return;
    const content = lines().map(safe);
    if (!interactive) return output.write(content.join('\n') + '\n');
    const width = Math.max(1, (output.columns || 80) - 1);
    const screen = content.flatMap(line => {
      const chars = Array.from(line);
      return chars.length ? Array.from({ length: Math.ceil(chars.length / width) },
        (_, index) => chars.slice(index * width, (index + 1) * width).join('')) : [''];
    });
    offset = Math.min(Math.max(0, offset), Math.max(0, screen.length - pageSize()));
    const hints = prompt ? `${prompt.label} › ${prompt.text}` : pager ? '↑/↓ or Page Up/Down · Esc back · q quit' :
      current ? '↑/↓ scroll · h history · g grep · m memory · r refresh · q quit' + (project ? '' : ' · Esc projects') :
        '↑/↓ select · Enter open · r refresh · q quit';
    output.write('\x1b[H\x1b[2J' + [...screen.slice(offset, offset + pageSize()), '', safe(hints).slice(0, width)].join('\r\n'));
  }

  async function refresh() {
    if (refreshing || closed) return;
    refreshing = true;
    clearTimeout(timer);
    try {
      projects = project ? [project] : discover();
      discoveryError = undefined;
    } catch (error) { discoveryError = error.message; }
    selected = Math.min(selected, Math.max(0, projects.length - 1));
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
  output.write('\x1b[?1049h\x1b[?25l');

  return new Promise(resolve => {
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    function exit() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      pagerRequest?.abort();
      for (const signal of signals) process.off(signal, exit);
      output.off('resize', render);
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
      pager = { title: `${label} · ${query}`, lines: ['Loading…'] };
      offset = 0;
      render();
      const controller = pagerRequest = new AbortController();
      const [executable, ...cli] = managedProject(current) ? [managedCliPath(current)] : [process.execPath, join(releaseRoot, 'bin', 'loom')];
      try {
        const { stdout } = await exec(executable, [...cli, ...pagerArgs(mode, query, current)], {
          cwd: current, timeout: 10_000, maxBuffer: 1024 * 1024, signal: controller.signal,
        });
        if (!controller.signal.aborted) pager.lines = stdout.trimEnd().split(/\r?\n/).filter((line, index, rows) => line || rows.length > 1);
        if (!controller.signal.aborted && !pager.lines.length) pager.lines = ['No results.'];
      } catch (error) {
        if (!controller.signal.aborted) pager.lines = [error.stderr?.trim() || error.message];
      }
      if (pagerRequest === controller) pagerRequest = undefined;
      render();
    }

    function keypress(text, key = {}) {
      const { name } = key;
      if (key.ctrl && name === 'c') return exit();
      if (prompt) {
        if (name === 'escape') prompt = undefined;
        else if (name === 'return' && prompt.text.trim()) return void show(prompt.text.trim());
        else if (name === 'backspace') prompt.text = Array.from(prompt.text).slice(0, -1).join('');
        else if (text && !key.ctrl && !key.meta) prompt.text = (prompt.text + safe(text)).slice(0, 500);
      } else if (name === 'q') return exit();
      else if (name === 'escape' && pager) {
        pagerRequest?.abort();
        pager = undefined;
        offset = 0;
      } else if (name === 'escape' && !project) {
        current = undefined;
        offset = 0;
      } else if (!current && ['down', 'j', 'up', 'k', 'return'].includes(name)) {
        if (name === 'return') { current = projects[selected]; offset = 0; }
        else {
          selected = Math.max(0, Math.min(projects.length - 1, selected + (['down', 'j'].includes(name) ? 1 : -1)));
          offset = Math.max(0, selected + 3 - pageSize());
        }
      } else if (['down', 'j', 'up', 'k', 'pagedown', 'pageup'].includes(name)) {
        offset += ({ down: 1, j: 1, up: -1, k: -1, pagedown: pageSize(), pageup: -pageSize() })[name];
      } else if (!pager && current && ['h', 'g', 'm'].includes(name)) {
        const [mode, label] = { h: ['history', 'History role, task or address'], g: ['grep', 'History grep'], m: ['memory', 'Memory search'] }[name];
        prompt = { mode, label, text: '' };
      } else if (name === 'r') void refresh();
      render();
    }
    for (const signal of signals) process.on(signal, exit);
    output.on('resize', render);
    input.on('keypress', keypress);
    input.on('end', exit);
    render();
    void refresh();
  });
}
