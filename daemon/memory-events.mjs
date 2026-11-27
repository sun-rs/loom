import { statSync } from 'node:fs';
import { historyReader } from '../cli/history.mjs';
import { clipTokens } from '../lib/token-budget.mjs';
import { sanitizeEntry, stripPrivate } from '../memory/sanitize.mjs';
import { eventPath } from './io.mjs';

const senior = new Set(['auditor', 'leader', 'super']);
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

export function collectMemoryEvents(project, { sessions, report, now, classifySensitive, replacement }) {
  const confirmed = new Set();
  const scans = new Map();
  const references = new Set();
  const histKey = ({ addr, turnId }) => JSON.stringify([addr, turnId]);
  const clean = text => {
    const safe = sanitizeEntry({ text }, { classifySensitive, replacement });
    return safe.ok ? safe.entry.text.trim() : '';
  };

  async function collect(bindingFor, recordEvent) {
    if (typeof classifySensitive !== 'function') return;
    const history = historyReader(project);
    const rows = sessions.rows().filter(row => sessions.jobs.has(row.addr));

    async function save(row, turn, { line, fact, kind, layer }) {
      const identity = JSON.stringify([project, row.project, 'remember', row.addr, [turn.id, line]]);
      if (confirmed.has(identity)) return true;
      const cleaned = clean(fact);
      const safeTitle = Array.from(firstLine(cleaned)).slice(0, 150).join('');
      const safeBody = clipTokens(cleaned, 200);
      if (!safeTitle || !safeBody) return true;
      const hist = { addr: row.addr, turnId: String(turn.id) };
      references.add(histKey(hist));
      try {
        const result = await recordEvent(bindingFor(row), identity, { project: layer === 'user' ? null : row.project,
          kind, layer, title: safeTitle, body: safeBody,
          checkedAt: turn.endedAt ? new Date(turn.endedAt).toISOString() : new Date(now()).toISOString(),
          source: { hist },
        });
        if (!result.ok) return false;
        confirmed.add(identity);
        return true;
      } finally { references.delete(histKey(hist)); }
    }

    try {
      for (const row of rows.filter(row => senior.has(row.role))) {
        const signature = [row.transcriptPath, stamp(row.transcriptPath), stamp(eventPath(project, row.addr))].join('\0');
        if (scans.get(row.addr) === signature) continue;
        let settled = true;
        for (const { turn, observation, completion } of history.sessionHistory(row).items) {
          if (turn.status !== 'completed' || turn.id == null || !turn.reply ||
              completion?.unconfirmed || observation?.end?.unconfirmed && !completion?.body) continue;
          const kind = row.role === 'leader' ? 'lesson' : 'ruling';
          const layer = row.role === 'super' ? 'user' : 'shared';
          for (const { line, fact } of rememberLines(turn.reply)) {
            if (!await save(row, turn, { line, fact, kind, layer })) settled = false;
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
