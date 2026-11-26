import { isAbsolute, join, relative } from 'node:path';
import { runtimeDirectory } from '../cli/project.mjs';
import { renderMemoryDelta } from '../memory/delta.mjs';
import { createIndexQuery } from '../memory/index-query.mjs';
import { readText, writeState } from './io.mjs';

export function sessionMemoryBinding(row, job) {
  if (!row || !job) return;
  const onCard = ['worker', 'reviewer'].includes(row.role);
  return {
    sessionId: row.addr, principal: job.memoryBinding?.principal ?? (onCard ? row.addr : row.role),
    role: row.role, project: row.project, cardId: onCard ? row.task ?? row.addr : null,
    dependencies: job.memoryBinding?.dependencies ?? [], attachments: job.memoryBinding?.attachments ?? [],
    authorizedIds: job.memoryBinding?.authorizedIds ?? { memory: [], history: [] },
  };
}

function cardScope(text, cwd) {
  const terms = { paths: [], topics: [], keywords: [] };
  for (const line of text.split('\n')) {
    const field = line.match(/^\s*(?:[-*]\s+)?(?:\*\*)?(writable paths?|paths?|topics?|keywords?|可写路径|路径|主题|关键词)(?:\*\*)?[:：]\s*(.*)$/iu);
    if (!field) continue;
    const kind = /path|路径/iu.test(field[1]) ? 'paths' : /topic|主题/iu.test(field[1]) ? 'topics' : 'keywords';
    const values = (kind === 'paths' ? field[2].match(/`[^`]+`|[^,，、\s]+/gu) ?? [] : field[2].split(/[,，、]+/u))
      .map(value => value.trim().replaceAll('`', '').replace(/^\.\//u, '')).filter(Boolean);
    if (kind === 'paths') {
      terms.paths.push(...values.map(path => isAbsolute(path) ? relative(cwd, path) : path)
        .filter(path => path && !path.split('/').includes('..')));
    } else terms[kind].push(...values);
  }
  return terms;
}

const compactionKey = (event, i) => event.eventId ?? `${event.receivedAt ?? event.at}:${i}`;

function cardAttachments(rows) {
  const selected = [];
  let bytes = 0;
  for (const row of rows.slice(0, 30)) {
    bytes += Buffer.byteLength(row.line) + 1;
    if (bytes > 8000) break;
    selected.push(row);
  }
  return selected;
}

export function createMemoryInjection(project, access) {
  const query = createIndexQuery({ access, maxTokens: Infinity, countTokens: () => 0 });

  const indexText = result => result.rows.length ? result.text : '';

  function saveCompactIndex(job, text) {
    const path = join(runtimeDirectory(project), 'sessions', job.row.addr + '.memory-index');
    if (readText(path, null) !== text) writeState(path, text);
    return path;
  }

  return {
    async prepare(job, card, dispatcher) {
      job.memoryStartCursor = await access.publicationCursor();
      if (job.row.role !== 'worker') return;
      const scope = cardScope(card, job.row.cwd);
      const { rows } = await access.attachments(dispatcher ?? { role: 'leader', project: job.row.project },
        { ...scope, project: job.row.project });
      job.memoryBinding = { ...job.memoryBinding, attachments: cardAttachments(rows).map(row => row.id) };
      // The first delivery resolves these IDs again against current permissions.
    },
    async launch(job, binding) {
      if (!binding) return {};
      const text = indexText(await query.index(binding));
      return { indexText: text, ...(job.row.cli === 'claude' && { compactIndexPath: saveCompactIndex(job, text) }) };
    },
    async decorate(job, binding, message, messages, events) {
      const taken = messages.filter(item => item.received && item.target.addr === job.row.addr);
      let cursor = job.memoryStartCursor ?? 0;
      for (const item of taken) cursor = Math.max(cursor, item.memoryCursor ?? 0);
      const appendices = [];
      const memoryAccess = {};
      let memoryCompaction;
      if (job.row.cli !== 'claude') {
        const compaction = events.findLastIndex(event =>
          (event.type === 'compaction_ended' && (event.outcome?.kind ?? event.outcome) === 'completed') ||
          (event.hook_event_name === 'SessionStart' && event.source === 'compact'));
        if (compaction >= 0) {
          const key = compactionKey(events[compaction], compaction);
          if (!taken.some(item => item.memoryCompaction === key)) memoryCompaction = key;
        }
        if (memoryCompaction || job.row.cli === 'agy' && message.startup) {
          const index = await query.index(binding);
          appendices.push(indexText(index));
          if (index.rows.length) memoryAccess.index = index.rows.map(row => row.id);
        }
      }
      if (message.startup && binding.role === 'worker') {
        const { rows } = await access.attachments(binding, { project: binding.project, attached: true });
        const selected = cardAttachments(rows);
        if (selected.length) {
          appendices.push('卡片相关记忆（可用 loom mem show 按需展开）\n' + selected.map(row => row.line).join('\n'));
          memoryAccess.attachments = selected.map(row => row.id);
        }
      }
      const delta = await access.delta(binding, { cursor, fits: batch => Array.from(renderMemoryDelta(batch)).length <= 3000 });
      if (delta.rows.length) {
        appendices.push(renderMemoryDelta(delta).trimStart());
        memoryAccess.publications = delta.rows.map(({ seq, id, revision, operation }) => ({ seq, id, revision, operation }));
      }
      return {
        text: appendices.filter(Boolean).join('\n\n'),
        ...(memoryCompaction && { memoryCompaction }),
        ...(delta.rows.length && { memoryCursor: delta.endCursor }),
        ...(appendices.some(Boolean) && { memoryAccess }),
      };
    },
    async requireVisible(binding, message) {
      if (!message.memoryAccess) return;
      const { index, attachments, publications } = message.memoryAccess;
      const contains = ({ rows }, ids) => {
        const visible = new Set(rows.map(row => row.id));
        return ids.every(id => visible.has(id));
      };
      if (binding && message.memoryRecipient === binding.sessionId &&
          (!index || contains(await access.index(binding), index)) &&
          (!attachments || contains(await access.attachments(binding, { project: binding.project, attached: true }), attachments)) &&
          (!publications || await access.canRetryPublications(binding, publications))) return;
      throw Object.assign(new Error('Delivery memory is no longer visible to the target'), { kind: 'input-refused' });
    },
    async refreshCompactIndex(job, binding) {
      saveCompactIndex(job, indexText(await query.index(binding)));
    },
  };
}
