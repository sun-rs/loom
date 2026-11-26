import { statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { historyReader } from '../cli/history.mjs';
import { numberedRulings, projectDocument } from '../handover/organization.mjs';
import { conclusoryReply, deliveryFailed, deliveryId, replyConclusion } from '../inbox/message.mjs';
import { clipTokens } from '../lib/token-budget.mjs';
import { sanitizeEntry, stripPrivate } from '../memory/sanitize.mjs';
import { eventPath, readText } from './io.mjs';

const senior = new Set(['auditor', 'leader', 'super']);
const cardResults = new Set(['DONE', 'PASS', 'PASSED', 'VERIFIED', 'BLOCKED', 'FAILED', 'FAIL']);
const directive = /^[ \t]*REMEMBER:[ \t]*(.*)$/u;
const firstLine = text => text.trim().split(/\r?\n/, 1)[0];
const stamp = path => {
  const file = path && statSync(path, { throwIfNoEntry: false });
  return file ? `${file.ino}:${file.size}:${file.mtimeMs}` : '';
};

function rememberLines(text) {
  const facts = [];
  let fence;
  for (const [line, textLine] of stripPrivate(text).split(/\r?\n/).entries()) {
    const delimiter = /^ {0,3}(`{3,}|~{3,})/.exec(textLine)?.[1];
    if (delimiter) {
      if (!fence) fence = delimiter;
      else if (delimiter[0] === fence[0] && delimiter.length >= fence.length) fence = undefined;
    } else if (!fence) {
      const fact = directive.exec(textLine)?.[1].trim();
      if (fact) facts.push({ line, fact });
    }
  }
  return facts;
}

function matchingTurn(items, message) {
  const done = message.completion;
  return items.find(({ turn, observation, hook }) => turn.id != null && turn.status === 'completed' && (
    String(turn.id) === String(done.nativeTurnId ?? done.turnId) || hook?.deliveryId === message.id ||
    observation?.end?.inputIds?.includes(message.id) || turn.prompts?.some(prompt => deliveryId(prompt) === message.id)));
}

function handoverRequest(project, job) {
  const path = /\bRead (\.project\/replies\/[a-f0-9]{64}\.txt)\b/u.exec(job.prompt)?.[1];
  if (!path) return '';
  return readText(join(project, path)).split('\n\n## 启动指令\n').at(-1)
    .split('\n\n## 交接确认\n')[0].trim();
}

export function collectMemoryEvents(project, { sessions, report, now, classifySensitive, replacement }) {
  const confirmed = new Set();
  const received = new Set();
  const scans = new Map();
  const references = new Set();
  const histKey = ({ addr, turnId }) => JSON.stringify([addr, turnId]);
  const clean = text => {
    const safe = sanitizeEntry({ text }, { classifySensitive, replacement });
    return safe.ok ? safe.entry.text.trim() : '';
  };

  async function collect(messages, bindingFor, recordEvent) {
    if (typeof classifySensitive !== 'function') return;
    const history = historyReader(project);
    const rows = sessions.rows().filter(row => sessions.jobs.has(row.addr));
    const byAddr = new Map(rows.map(row => [row.addr, row]));
    let ledger;
    const rulingPath = '.project/rulings.md';

    async function save(row, turn, category, { key = turn.id, title, body, kind, layer = 'shared', path }) {
      const identity = JSON.stringify([project, row.project, category, category === 'ruling' ? null : row.addr, key]);
      if (confirmed.has(identity)) return true;
      const safeTitle = Array.from(firstLine(clean(title))).slice(0, 150).join('');
      const safeBody = clipTokens(clean(body), 200);
      if (!safeTitle || !safeBody) return true;
      const hist = { addr: row.addr, turnId: String(turn.id) };
      references.add(histKey(hist));
      try {
        const result = await recordEvent(bindingFor(row), identity, { project: layer === 'user' ? null : row.project,
          kind, layer, title: safeTitle, body: safeBody,
          checkedAt: turn.endedAt ? new Date(turn.endedAt).toISOString() : new Date(now()).toISOString(),
          source: { hist, ...(path && { path }) },
        });
        if (!result.ok) return false;
        confirmed.add(identity);
        return true;
      } finally { references.delete(histKey(hist)); }
    }

    try {
      for (const message of messages) {
        if (received.has(message.id)) continue;
        const row = byAddr.get(message.target.addr);
        const done = message.completion;
        if (!row || !done?.body || done.unconfirmed || deliveryFailed(message) ||
            (done.outcome && done.outcome.kind !== 'completed') ||
            (done.sessionId && row.sessionId && done.sessionId !== row.sessionId)) continue;
        const job = sessions.jobs.get(row.addr);
        const handover = job.handoverBound && job.handoverAck && message.id === job.handoverReportId;
        const packet = row.role === 'auditor' && message.gatePacket && message.gateProject === row.project;
        const reply = stripPrivate(done.body);
        const body = reply.split(/\r?\n/).filter(line => !directive.test(line)).join('\n').trim();
        const workerResult = row.role === 'worker' && cardResults.has(replyConclusion(firstLine(body)).tag);
        const verdict = packet && (conclusoryReply(body, true) || /^(?:RESOLVED|UNRESOLVED)\b/i.test(firstLine(body)));
        if (!handover && !workerResult && !verdict) {
          received.add(message.id);
          continue;
        }
        const item = matchingTurn(history.sessionHistory(row).items, message);
        if (!item) continue;
        const { turn } = item;
        let saved;
        if (handover) {
          const request = handoverRequest(project, job);
          const details = body.split(/\r?\n/).slice(1).join('\n').trim();
          saved = await save(row, turn, 'handover', {
            title: `${row.role} handover${request ? ' ' + firstLine(request) : ''}`,
            body: [`${job.handoverFrom} → ${row.addr}`, request, details].filter(Boolean).join('\n'),
            kind: row.role === 'leader' ? 'lesson' : 'ruling',
          });
        } else if (verdict) {
          saved = await save(row, turn, 'gate', { key: message.id,
            title: `${message.redEscalation ? 'Escalation' : 'Gate'} ${message.gateId} round ${message.gateRound ?? 1}`,
            body, kind: 'ruling', path: relative(project, message.gatePacket),
          });
        } else {
          saved = await save(row, turn, 'card', { title: `Card ${row.task ?? row.addr}`, body, kind: 'lesson' });
        }
        if (saved) received.add(message.id);
      }

      for (const row of rows.filter(row => senior.has(row.role))) {
        const signature = [row.transcriptPath, stamp(row.transcriptPath), stamp(eventPath(project, row.addr)),
          row.role === 'super' ? stamp(join(project, rulingPath)) : ''].join('\0');
        if (scans.get(row.addr) === signature) continue;
        let settled = true;
        for (const { turn, observation, completion } of history.sessionHistory(row).items) {
          if (turn.status !== 'completed' || turn.id == null || !turn.reply ||
              completion?.unconfirmed || observation?.end?.unconfirmed && !completion?.body) continue;
          const kind = row.role === 'leader' ? 'lesson' : 'ruling';
          const layer = row.role === 'super' ? 'user' : 'shared';
          for (const { line, fact } of rememberLines(turn.reply)) {
            if (!await save(row, turn, 'remember', { key: [turn.id, line], title: fact, body: fact, kind, layer })) settled = false;
          }
          const reply = stripPrivate(turn.reply);
          if (row.role !== 'super' || !/\.project\/rulings\.md\b/u.test(reply)) continue;
          const cited = new Set([...reply.matchAll(/\bR(\d+)\b|(?:裁决|\bruling)\s*#?(\d+)/giu)]
            .map(match => match[1] ?? match[2]));
          if (!cited.size) continue;
          if (!ledger) {
            const document = await projectDocument(project, 'rulings');
            ledger = numberedRulings(stripPrivate(document.text ?? ''));
          }
          for (const ruling of ledger.filter(item => cited.has(item.number))) {
            const body = ruling.quote.map(line => line.replace(/^ {0,3}> ?/u, '')).join('\n');
            if (!await save(row, turn, 'ruling', { key: ruling.number, title: `R${ruling.number} ${firstLine(body)}`,
              body, kind, layer, path: rulingPath })) settled = false;
          }
        }
        if (settled) scans.set(row.addr, signature);
      }
    } catch {
      report('Loom could not record memory from verified session history');
    }
  }

  return { collect, hasHist: source => references.has(histKey(source)) };
}
