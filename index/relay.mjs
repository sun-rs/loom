import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { address, workers } from '../relay/project.mjs';

const eventFile = new RegExp(`^(${address})\\.jsonl$`);
const oarFile = new RegExp(`^(oar-${address})\\.json$`);
const annotated = new RegExp(`^([ \\t]*\\|?[ \\t]*${address}\\s*\\|\\s*(${address})\\s*\\|\\s*(?:codex|agy|claude|opencode))\\(([^|)\\r\\n]+)\\)(?=[ \\t]*\\|)`, 'gm');
const text = value => typeof value === 'string' && value.trim() ? value : undefined;
const absolute = value => text(value) && isAbsolute(value) ? value : undefined;
const object = value => value && typeof value === 'object' && !Array.isArray(value);

function local(path, read) {
  try {
    if (realpathSync(path) === path) return read(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function readText(path) {
  return local(path, file => statSync(file).isFile() ? readFileSync(file, 'utf8') : undefined) ?? '';
}

function list(dir, pattern) {
  const entries = local(dir, path => readdirSync(path, { withFileTypes: true })) ?? [];
  return entries.filter(entry => entry.isFile() && pattern.test(entry.name)).map(entry => entry.name).sort();
}

function parseLine(line) {
  try {
    const row = JSON.parse(line);
    if (object(row)) return row;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
}

function nativeCli(event, path) {
  if (event.conversationId || event.conversation_id || path?.includes('/antigravity-cli/brain/')) return 'agy';
  if (path?.includes('/.claude/projects/')) return 'claude';
  if (/\/rollout-[^/]+\.jsonl$/.test(path ?? '')) return 'codex';
}

function time(value) {
  const at = typeof value === 'string' ? Date.parse(value) : value;
  return Number.isSafeInteger(at) && at >= 0 ? at : undefined;
}

export function readRelay(dir, { project } = {}) {
  const root = realpathSync(dir);
  const relay = join(root, '.project', 'relay');
  const sessions = new Map();

  function merge(addr, values) {
    const row = sessions.get(addr) ?? { addr, project: project ?? root, backend: addr.startsWith('oar-') ? 'headless' : 'tui' };
    if (row.sessionId && values.sessionId && row.sessionId !== values.sessionId) row.transcriptPath = null;
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined) row[key] = value;
    }
    sessions.set(addr, row);
  }

  const models = new Map();
  const rows = readText(join(root, '.project', 'workers.md')).replace(annotated, (_, prefix, addr, label) => {
    models.set(addr, text(label.split(/[,/]/, 1)[0].trim()));
    return prefix;
  });
  for (const worker of workers(rows)) {
    merge(worker.addr, { role: 'worker', task: worker.id, cli: worker.provider, wave: worker.wave, model: models.get(worker.addr) });
  }

  function mergeMetadata(addr, data) {
    const transcriptPath = absolute(data.transcriptPath ?? data.transcript_path);
    merge(addr, {
      role: text(data.role), task: text(data.task), wave: text(data.wave),
      backend: ['headless', 'tui'].includes(data.backend) ? data.backend : undefined,
      runtimeId: text(data.runtimeId),
      cli: text(data.cli ?? data.provider) ?? sessions.get(addr)?.cli ?? nativeCli(data, transcriptPath),
      model: text(data.model), sessionId: text(data.sessionId ?? data.session_id ?? data.conversationId ?? data.conversation_id),
      transcriptPath, cwd: absolute(data.cwd), parent: text(data.parent), baseCommit: text(data.baseCommit),
      startedAt: time(data.startedAt), endedAt: time(data.endedAt),
      effort: text(data.effort), pane: text(data.pane),
    });
  }

  const events = join(relay, 'events');
  for (const name of list(events, eventFile)) {
    const [, addr] = eventFile.exec(name);
    for (const line of readText(join(events, name)).split('\n')) {
      const row = parseLine(line.trim());
      if (!row) continue;
      const data = { ...row.payload, ...row };
      if (data.addr != null && data.addr !== addr) continue;
      if (data.agent_id || data.agentPath?.length) continue;
      mergeMetadata(addr, data);
    }
  }

  const oar = join(relay, 'oar');
  for (const name of list(oar, oarFile)) {
    const [, addr] = oarFile.exec(name);
    const row = parseLine(readText(join(oar, name)));
    if (row?.addr === addr) mergeMetadata(addr, row);
  }
  return [...sessions.values()];
}
