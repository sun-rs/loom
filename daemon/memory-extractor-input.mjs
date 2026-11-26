import { createHash } from 'node:crypto';
import { historyReader } from '../cli/history.mjs';
import { timestamp, turnTools } from '../cli/turns.mjs';
import { deliveryFailed, deliveryId } from '../inbox/message.mjs';
import { activitySummary, turnActivityFacts } from '../lib/activity-digest.mjs';
import { sanitizeEntry } from '../memory/sanitize.mjs';
import { classifySensitive } from './memory.mjs';

export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const seniorExtractor = role => role === 'leader' || role === 'auditor';
export const stageBoundary = event => ['gate-completed', 'auditor-rotation-proposed'].includes(event.type) ||
  event.type === 'project-completed' && event.phase !== undefined;

export function redactExtractor(value, key) {
  const clean = sanitizeEntry(value, { classifySensitive(text) {
    const result = classifySensitive(text);
    if (key) {
      for (let offset = text.indexOf(key); offset >= 0; offset = text.indexOf(key, offset + key.length)) {
        result.spans.push({ start: offset, end: offset + key.length });
      }
    }
    return result;
  } });
  if (!clean.ok) throw new Error('Extractor redaction failed');
  return clean.entry;
}

function workerSummary(row, item, tools, key) {
  const turn = { ...item.turn, reply: redactExtractor(item.turn.reply ?? '', key) };
  const activity = turnActivityFacts({ ...item, turn, tools, cwd: row.cwd });
  // Keep the L1 reply preview and activity counts. Tool commands, diagnostics,
  // and prompt previews can repeat content from the worker's inputs or files.
  return activitySummary({ index: item.index, task: redactExtractor(row.task, key), turn, tools,
    facts: { claims: [] }, activity: { ...activity, prompt: '', errors: [], tests: [], nonZero: [] },
    source: {}, heads: item.heads });
}

export function extractionTurns(project, rows, messages) {
  const history = historyReader(project);
  const inbox = Map.groupBy(messages, message => message.target.addr);
  return rows.flatMap(row => {
    if (!row.sessionId || row.project !== project || !seniorExtractor(row.role) && row.role !== 'worker') return [];
    let items;
    try { ({ items } = history.sessionHistory(row)); } catch { return []; }
    return items.flatMap(item => {
      const { turn, observation, completion, hook } = item;
      if (turn.id == null || turn.status !== 'completed' || completion?.unconfirmed ||
          observation?.end?.unconfirmed) return [];
      const at = timestamp(turn.endedAt);
      if (!Number.isFinite(at)) return [];
      const identity = { key: digest([row.addr, row.sessionId, turn.id]), at, addr: row.addr, role: row.role };
      const tools = turnTools(row.cli, turn, item.rows)
        .concat(observation && !item.journalOnly ? turnTools(row.cli, turn, observation.rows) : []);
      if (row.role === 'worker') return [{ ...identity, summarize: key => workerSummary(row, item, tools, key) }];
      const nativeIds = (turn.prompts ?? []).map(deliveryId).filter(Boolean);
      const ids = new Set(nativeIds.length ? nativeIds : [...(observation?.end?.inputIds ?? []), hook?.deliveryId].filter(Boolean));
      const deliveries = (inbox.get(row.addr) ?? []).filter(message =>
        !deliveryFailed(message) && (ids.has(message.id) || message.received &&
          message.completion && String(message.completion.nativeTurnId ?? message.completion.turnId) === String(turn.id)));
      const received = deliveries.map(message => ({
        source: { kind: 'delivery', id: message.id }, user: !message.from && !message.projectEvents &&
          !message.gatePacket && !message.waveBatch && !message.memoryReview,
        text: message.memoryReview ? 'Memory proposal review' : message.startup ?
          message.text.split('\n\n## Startup request\n').at(-1) : message.text,
      }));
      const toolNames = [...new Set(tools.map(tool => tool.name))];
      const directUserDeliveries = new Set(deliveries.filter(message => !message.startup).map(message => message.id));
      return [{ ...identity, startedAt: timestamp(turn.startedAt) || at, received, reply: turn.reply ?? '', toolNames,
        directUserDeliveries }];
    });
  }).sort((a, b) => a.at - b.at);
}

export function extractionEvents(events) {
  return events.filter(event => event.type === 'needs-decision' || stageBoundary(event) || event.type === 'red-escalation')
    .map(event => ({ source: { kind: 'event', id: event.id }, type: event.type,
      text: event.text, at: event.at, addr: event.addr }));
}
