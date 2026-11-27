import { createHash } from 'node:crypto';
import { historyReader } from '../cli/history.mjs';
import { timestamp, turnTools } from '../cli/turns.mjs';
import { checkEvidence } from '../evidence/checks.mjs';
import { deliveryFailed, deliveryId } from '../inbox/message.mjs';
import { sanitizeEntry } from '../memory/sanitize.mjs';
import { classifySensitive } from './memory.mjs';
import { auditEscalations } from './routing.mjs';

export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const seniorExtractor = role => role === 'leader' || role === 'auditor';
export const stageBoundary = event => ['gate-completed', 'auditor-rotation-proposed'].includes(event.type) ||
  event.type === 'project-completed' && event.phase !== undefined;

const handoverAck = /^HANDOVER-ACK [a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu;
const acknowledgment = /^(?:noreply|ok(?:ay)?|ack(?:nowledged)?|confirmed|received|noted|got it|(?:已)?收到|(?:已)?确认|了解|明白|好的|知悉)$/iu;
const waiting = /^(?:(?:继续)?等待(?:门禁(?:结果)?|结果|反馈|指示|通知|后续投递)?|(?:still )?waiting(?: for (?:the )?(?:gate result|results?|feedback|instructions|next delivery))?)$/iu;

export function substantiveReply(reply) {
  const lines = reply.trim().split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
  if (handoverAck.test(lines[0]) && lines.slice(1).every(line => /^(?:HEAD|Branch|Base SHA|WIP|Rulings):/u.test(line))) {
    return false;
  }
  return lines.some(line => {
    const text = line.replace(/[.!。！…]+$/u, '').trimEnd();
    return text && !acknowledgment.test(text) && !waiting.test(text);
  });
}

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

function workerSummary(task, index, tools) {
  const tests = { passed: 0, failed: 0, unknown: 0 };
  for (const tool of tools) {
    if (tool.tool !== 'shell') continue;
    const check = checkEvidence({ ...tool, started: true });
    if (check) tests[check.result]++;
  }
  return `${task ? task + ' ' : ''}第 ${index} 轮 · 工具 ${tools.length} · ` +
    `测试命令 通过 ${tests.passed} 失败 ${tests.failed} 未知 ${tests.unknown}`;
}

const deliveryRoles = new Set(['user', 'super', 'auditor', 'leader']);
const escalationTypes = new Set(['red-escalation', 'audit-escalation', 'escalation']);
const startupRequest = '\n\n## Startup request\n';

function deliveryRole(message, senderRoles) {
  if (message.waveBatch || message.continuationBatch || message.replyKey || message.replyTo || message.autoReceipt ||
      message.receipt || message.memoryReview || message.gatePacket || message.projectEvents || message.reviewerResult ||
      message.stuckOf || message.watchResume || message.corruptedOf || message.uncertainOf ||
      message.orgEvents && !message.orgAppendix) return undefined;

  // Sender bindings carry an address. A direct user send has Super priority
  // and no sender, while a user-launched startup carries the request wrapper.
  const role = message.from === undefined ?
    (message.startup || message.superPriority === true ? 'user' : undefined) : senderRoles.get(message.from?.addr);
  return deliveryRoles.has(role) && (message.kind === undefined || message.kind === role) ? role : undefined;
}

function receivedDelivery(message, senderRoles) {
  const source = { kind: 'delivery', id: message.id };
  const withheld = { source, user: false, text: '[Delivery body withheld]' };
  const role = deliveryRole(message, senderRoles);
  if (!role) return withheld;

  if (!message.startup) return { source, user: role === 'user', text: message.text };
  const parts = message.text.split(startupRequest);
  return parts.length > 1 ? { source, user: role === 'user', text: parts.at(-1) } : withheld;
}

export function extractionTurns(project, rows, messages) {
  const history = historyReader(project);
  const inbox = Map.groupBy(messages, message => message.target.addr);
  const senderRoles = new Map(rows.map(({ addr, role }) => [addr, role]));
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
      if (row.role === 'worker') return [{ ...identity, summarize: () => workerSummary(row.task, item.index, tools) }];
      const nativeIds = (turn.prompts ?? []).map(deliveryId).filter(Boolean);
      const ids = new Set(nativeIds.length ? nativeIds : [...(observation?.end?.inputIds ?? []), hook?.deliveryId].filter(Boolean));
      const deliveries = (inbox.get(row.addr) ?? []).filter(message =>
        !deliveryFailed(message) && (ids.has(message.id) || message.received &&
          message.completion && String(message.completion.nativeTurnId ?? message.completion.turnId) === String(turn.id)));
      const received = deliveries.map(message => receivedDelivery(message, senderRoles));
      const toolNames = [...new Set(tools.map(tool => tool.name))];
      const directUserDeliveries = new Set(deliveries.filter(message => !message.startup).map(message => message.id));
      const directSuperOrUser = deliveries.some(message => {
        if (message.startup || typeof message.text !== 'string' || !message.text.trim()) return false;
        const role = deliveryRole(message, senderRoles);
        return role === 'user' || role === 'super';
      });
      return [{ ...identity, startedAt: timestamp(turn.startedAt) || at, received, reply: turn.reply ?? '', toolNames,
        directUserDeliveries, directSuperOrUser }];
    });
  }).sort((a, b) => a.at - b.at);
}

export function extractionEvents(events) {
  return events.flatMap(event => {
    // Auditor escalation notices are also stored as needs-decision with an escalation reason.
    const escalation = escalationTypes.has(event.type) ||
      event.type === 'needs-decision' && auditEscalations.has(event.reason);
    if (!escalation && event.type !== 'needs-decision' && !stageBoundary(event)) return [];
    return [{ source: { kind: 'event', id: event.id }, type: event.type,
      text: escalation ? '[Escalation evidence withheld]' : event.text, at: event.at, addr: event.addr }];
  });
}
