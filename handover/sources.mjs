import { execFile } from 'node:child_process';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { stripAnsiAndControl } from '../adapters/agy/lib/classify-screen.mjs';
import { workers } from '../relay/project.mjs';
import { regularPath } from './transcript.mjs';

const run = promisify(execFile);
const missing = error => error.code === 'ENOENT' || error.code === 'ENOTDIR';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export const unavailable = '不可用';
export const oneLine = value => stripAnsiAndControl(typeof value === 'string' ? value : '').replace(/\s+/gu, ' ').trim();

export function clip(text, limit) {
  const bytes = Buffer.from(text);
  if (bytes.length <= limit) return text;
  let end = limit - Buffer.byteLength('…');
  if (end < 0) return '';
  while ((bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString('utf8').trimEnd() + '…';
}

export function time(value) {
  const at = typeof value === 'string' ? Date.parse(value) : value;
  return Number.isFinite(at) && Math.abs(at) <= 8.64e15 ? at : -Infinity;
}

function shortTime(value) {
  const at = time(value);
  return at === -Infinity ? '' : new Date(at).toISOString().slice(0, 16) + 'Z';
}

async function textAt(path) {
  if (await regularPath(path) === path) return readFile(path, 'utf8');
  return null;
}

async function jsonAt(path) {
  const text = await textAt(path);
  if (text !== null) return JSON.parse(text);
}

async function list(dir) {
  try {
    if (await realpath(dir) !== dir) throw new Error('linked source directory');
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

function limited(rows, format, count = 4) {
  return rows.length > count ? [...rows.slice(0, count).map(format), `另有 ${rows.length - count} 项`] : rows.map(format);
}

export async function workerLines(root) {
  const text = await textAt(join(root, 'workers.md'));
  if (text === null) return unavailable;
  const rows = workers(text.replace(/\|\s*(claude|codex|agy)\([^|\r\n]*\)\s*\|/g, '| $1 |'));
  const active = rows.filter(row => row.status === 'dispatched');
  const lines = limited(active, row => [row.id, row.addr, row.status, row.wave].filter(Boolean).join(' '));
  return lines.length ? lines.join('\n') : '无';
}

export async function waveLines(root) {
  const state = await jsonAt(join(root, 'relay', 'state.json'));
  if (!object(state) || (!object(state.waves) && !object(state.wave) && !Array.isArray(state.outbox))) return unavailable;
  const waves = Object.entries(state.waves ?? {}).filter(([, wave]) => Array.isArray(wave?.members));
  if (Array.isArray(state.wave?.members) && !waves.some(([key]) => key === 'legacy')) waves.push(['legacy', state.wave]);
  waves.sort(([, a], [, b]) => Number(!!a.closed) - Number(!!b.closed) || time(b.deadline ?? b.at) - time(a.deadline ?? a.at));
  const lines = limited(waves, ([key, wave]) => [
    oneLine(wave.id ?? key.replace(/^wave:/, '')), wave.closed ? 'closed' : 'open', `${wave.members.length} 人`,
    Number.isFinite(wave.deadline) ? `截止 ${shortTime(wave.deadline)}` : '',
  ].filter(Boolean).join(' '));
  if (state.outbox?.length) lines.unshift(`relay 待结算批次 ${state.outbox.length}`);
  return lines.join('\n') || '无';
}

const addrOf = value => typeof value === 'string' ? value : value?.addr;
const messageId = message => message.id ?? message.deliveryId;
const pending = new Set(['queued', 'pending', 'sending', 'stopping', 'stopped', 'uncertain']);
const delivered = new Set(['received', 'delivered', 'steered', 'interrupted']);

export async function inboxLines(root, addresses) {
  if (!addresses.size) return `${unavailable}（角色地址缺失）`;
  const dir = join(root, 'inbox');
  const incoming = join(dir, 'incoming');
  const names = await list(incoming);
  const messages = new Map();
  for (const entry of names ?? []) {
    if (!entry.isFile() || !/^\d+-[0-9a-f-]{36}\.json$/.test(entry.name)) continue;
    // Relay may ingest and remove this request while the brief reads it.
    const row = await jsonAt(join(incoming, entry.name)).catch(error => {
      if (!missing(error)) throw error;
    });
    if (row && messageId(row)) messages.set(messageId(row), row);
  }
  const state = await jsonAt(join(dir, 'state.json'));
  if (state === undefined ? !names : !Array.isArray(state?.messages)) return unavailable;
  for (const row of state?.messages ?? []) if (row && messageId(row)) messages.set(messageId(row), row);
  const replies = new Set([...messages.values()].map(row => row.replyTo).filter(Boolean));
  const rows = [];
  for (const row of messages.values()) {
    const from = addrOf(row.from);
    const to = addrOf(row.target ?? row.to ?? row.addr);
    const inbound = addresses.has(to);
    const outbound = addresses.has(from);
    const phase = row.phase ?? row.status;
    if (!inbound && !outbound) continue;
    let state;
    if (pending.has(phase)) state = phase === 'uncertain' || row.issue === 'uncertain' ? '待确认' : '待投';
    if (delivered.has(phase) && !row.replyTo && !replies.has(messageId(row)) && !row.completion?.body) state = '未回复';
    if (state) rows.push({ row, from, to, state });
  }
  rows.sort((a, b) => time(b.row.createdAt ?? b.row.at) - time(a.row.createdAt ?? a.row.at));
  return limited(rows, ({ row, from, to, state }) => clip([
    state, `${oneLine(from) || '外部'}→${oneLine(to) || '未知'}`, oneLine(row.text ?? row.message ?? row.body) || messageId(row),
  ].join(' '), 155)).join('\n') || '无';
}

export async function watchLines(root) {
  const text = await textAt(join(root, 'watch', 'events.jsonl'));
  if (text === null) return unavailable;
  const rows = text.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
  const resolved = new Set(rows.filter(row => row?.type === 'recovered' || row?.type === 'closed').map(row => row.incidentId).filter(Boolean));
  const alerts = rows.filter(row => row?.type === 'stuck').sort((a, b) => time(b.at) - time(a.at));
  return limited(alerts, row => [shortTime(row.at), oneLine(row.addr), oneLine(row.reason) || '原因未知',
    resolved.has(row.incidentId) ? '已结束' : '',
  ].filter(Boolean).join(' ')).join('\n') || '无';
}

export async function evidenceLines(root) {
  const dir = join(root, 'evidence');
  const entries = await list(dir);
  if (!entries) return unavailable;
  const rows = [];
  let unreadable = false;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const path = join(dir, entry.name);
    try {
      const card = await jsonAt(path);
      if (!object(card) || !['claims', 'findings', 'mismatches', 'status'].some(key => Object.hasOwn(card, key))) {
        unreadable = true;
        continue;
      }
      const raw = card.mismatches ?? (card.claims ?? card.findings)?.filter(item => item?.status === 'MISMATCH') ?? [];
      if (!Array.isArray(raw)) { unreadable = true; continue; }
      if (!raw.length && card.status !== 'MISMATCH') continue;
      const at = time(card.endedAt ?? card.capturedAt ?? card.at ?? card.createdAt ?? card.generatedAt);
      rows.push({
        at: at === -Infinity ? (await stat(path)).mtimeMs : at,
        label: card.task ? `${oneLine(card.task)}${card.turn != null ? `#${card.turn}` : ''}` : basename(entry.name, '.json'),
        details: raw.map(item => oneLine(typeof item === 'string' ? item : item?.reason ?? item?.message ?? item?.detail ?? item?.code)).filter(Boolean),
      });
    } catch { unreadable = true; }
  }
  rows.sort((a, b) => b.at - a.at);
  const lines = limited(rows, row => clip([oneLine(row.label), 'MISMATCH', row.details.join(' / ')].filter(Boolean).join(' '), 160));
  if (unreadable) lines.unshift(`${unavailable}（部分证据卡读取失败）`);
  return lines.join('\n') || '无';
}

export async function gitLines(projectDir) {
  const { stdout } = await run('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', 'status', '--short'], {
    cwd: projectDir, timeout: 5000,
  });
  const changed = stripAnsiAndControl(stdout).trimEnd().split('\n').filter(Boolean);
  return limited(changed, line => clip(line, 140), 5).join('\n') || '工作区干净';
}
