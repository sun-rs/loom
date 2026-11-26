import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { jsonRows, readText } from '../daemon/io.mjs';
import { inDirectory } from './project.mjs';

export const safeName = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
export const protectedPath = /(?:^|[/\\])(?:provider-homes|memories[^/\\]*|\.env[^/\\]*|auth\.json|(?:\.)?credentials\.json)(?:[/\\]|$)/i;

export function projectText(project, ...parts) {
  const path = join(project, '.project', ...parts);
  try {
    if (realpathSync(path) !== path || !lstatSync(path).isFile()) throw new Error(`Unsafe project artifact: ${path}`);
    return readText(path, null);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

export function readArtifacts(project) {
  const json = (...parts) => JSON.parse(projectText(project, ...parts) ?? 'null');
  let evidence;
  function cards() {
    if (evidence) return evidence;
    evidence = new Map();
    const dir = join(project, '.project', 'evidence');
    if (lstatSync(dir, { throwIfNoEntry: false })?.isDirectory() && realpathSync(dir) === dir) {
      for (const file of readdirSync(dir, { withFileTypes: true })) {
        if (!file.isFile() || !/^[A-Za-z0-9_.-]+\.json$/.test(file.name)) continue;
        const data = json('evidence', file.name);
        if (typeof data?.addr !== 'string') continue;
        const list = evidence.get(data.addr) ?? [];
        const path = join(dir, file.name);
        list.push({ path, summary: data.card ?? null, data });
        evidence.set(data.addr, list);
      }
    }
    return evidence;
  }
  let messages;
  return {
    project,
    messages: () => messages ??= json('inbox', 'state.json')?.messages ?? [],
    relay: () => json('relay', 'state.json') ?? {},
    job: addr => safeName.test(addr) ? json('loomd', 'sessions', `${addr}.json`) : null,
    context: addr => safeName.test(addr) ? json('relay', 'events', `${addr}.context.json`) : null,
    journal: addr => safeName.test(addr) ? jsonRows(projectText(project, 'relay', 'events', `${addr}.jsonl`) ?? '') : [],
    journalSource(addr) {
      if (!safeName.test(addr)) return null;
      const text = projectText(project, 'relay', 'events', `${addr}.jsonl`);
      return text == null ? null : { path: join(project, '.project', 'relay', 'events', `${addr}.jsonl`), text };
    },
    turnHeads: addr => safeName.test(addr) ? json('loomd', 'sessions', `${addr}.turn-heads.json`) ?? [] : [],
    cards: addr => cards().get(addr) ?? [],
  };
}

export function sessionProject(directory, session) {
  if (isAbsolute(session.project)) return session.project;
  return inDirectory(directory, session.cwd) ? directory : null;
}
