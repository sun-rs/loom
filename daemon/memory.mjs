import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { validateMemoryCommand } from '../cli/memory.mjs';
import { runtimeDirectory } from '../cli/project.mjs';
import { CommandError } from '../cli/sessions.mjs';
import { createMemoryStore } from '../memory/store.mjs';
import { collectMemoryEvents } from './memory-events.mjs';
import { sessionMemoryBinding } from './memory-injection.mjs';
import { readText, writeState } from './io.mjs';

const exec = promisify(execFile);

function classifySensitive(text) {
  // Recognize explicit secret assignments and common credential formats locally.
  const patterns = [
    /\b(?:api[-_]?key|access[-_]?token|auth[-_]?token|client[-_]?secret|password)\s*["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/giu,
    /\bBearer[ \t]+[\w.~+/=-]{8,}/gi,
    /\b(?:sk-(?:proj-)?[\w-]{16,}|gh[pousr]_[\w]{20,}|github_pat_[\w]{20,}|AKIA[A-Z0-9]{16})\b/g,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@/gi,
  ];
  return { reliable: true, spans: patterns.flatMap(pattern => [...text.matchAll(pattern)].map(match => ({
    start: match.index, end: match.index + match[0].length,
  }))) };
}

export function createProjectMemory(project, { sessions, now, options, report }) {
  const path = join(runtimeDirectory(project), 'memory-v1.json');
  const events = collectMemoryEvents(project, { sessions, report, classifySensitive, now, ...options });
  const store = createMemoryStore({
    now, classifySensitive, allocateId: () => `memory-${randomUUID()}`,
    readState: () => JSON.parse(readText(path, 'null')),
    commitState: state => writeState(path, JSON.stringify(state) + '\n'),
    ...options,
    evidence: {
      root: project, realpath,
      async hasCommit(sha) {
        await exec('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: project, timeout: 10_000 });
        return true;
      },
      ...options?.evidence,
      hasHist: events.hasHist,
    },
  });
  const bindingFor = row => sessionMemoryBinding(row, sessions.jobs.get(row?.addr));

  async function handle(args, caller) {
    const row = caller && sessions.rows().find(session => session.addr === caller || session.pane === caller);
    const binding = bindingFor(row);
    if (!binding || row.endedAt !== null || binding.role === 'worker' && args?.action !== 'show') {
      throw new CommandError('forbidden', 'Memory access is forbidden');
    }
    validateMemoryCommand(args);
    const { action, target, entry, requestId, expectedRevision } = args;
    if (action === 'search') return store.access.search(binding, { query: target });
    if (action === 'show') return store.access.show(binding, target);
    const draft = entry && { ...entry, project: Object.hasOwn(entry, 'project') ? entry.project : binding.project };
    const result = await store.write(binding, { op: action === 'invalidate' ? 'forget' : 'put',
      id: target, entry: draft, requestId, expectedRevision });
    if (!result.ok) throw new CommandError(result.code, result.error);
    return { item: result.item, receipt: result.receipt };
  }

  return {
    access: store.access,
    async handle(args, caller) {
      try { return await handle(args, caller); }
      catch (error) {
        if (error instanceof CommandError) throw error;
        report('Loom project memory is unavailable');
        throw new CommandError('unavailable', 'Project memory is unavailable');
      }
    },
    async tick(messages) {
      await store.maintain();
      await events.collect(messages, bindingFor, store.recordEvent);
    },
  };
}
