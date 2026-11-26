import { lstatSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { readText, writeState } from '../daemon/io.mjs';
import { checkFacts } from '../evidence/facts.mjs';
import { isCredentialPath } from '../evidence/git.mjs';
import { charterLines, projectDocument } from '../handover/organization.mjs';
import { clipTokens, estimateTokens } from '../lib/token-budget.mjs';

const itemId = /^[a-z0-9][a-z0-9_-]*$/;
const sha = /^(?:[0-9a-f]{7,40}|[0-9a-f]{64})$/i;
const sourcePath = /^(?:[\w.@+ -]+\/)*[\w.@+ -]+$/;
const oneLine = /^[^\x00-\x1f\x7f-\x9f\u2028\u2029]+$/u;
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const today = () => new Date().toISOString().slice(0, 10);
const itemPath = id => `.project/memory/items/${id}.md`;
export const indexLine = ({ title, path }) => `- ${path} — ${title}`;

function directories(project, create = false) {
  let path = project;
  for (const name of ['.project', 'memory', 'items']) {
    path = join(path, name);
    if (create) mkdirSync(path, { recursive: true, mode: 0o700 });
    if (!lstatSync(path, { throwIfNoEntry: false })?.isDirectory()) return;
  }
  return path;
}

function validMeta(meta, id) {
  if (!meta || meta.id !== id || typeof id !== 'string' || !itemId.test(id) || meta.scope !== 'project' ||
      typeof meta.owner !== 'string' || !itemId.test(meta.owner) ||
      typeof meta.source !== 'string' || !oneLine.test(meta.source) ||
      !date(meta.verified) || meta.expires !== undefined && !date(meta.expires) ||
      meta.supersededBy !== undefined && (typeof meta.supersededBy !== 'string' || !itemId.test(meta.supersededBy)) ||
      meta.keywords !== undefined && (typeof meta.keywords !== 'string' || !oneLine.test(meta.keywords))) return false;
  return !isAbsolute(meta.source) && sourcePath.test(meta.source) && meta.source === meta.source.trim() &&
    !meta.source.split('/').includes('..') && !isCredentialPath(meta.source);
}

function parseItem(text, id) {
  if (estimateTokens(text) > 200) return;
  const match = /^---\r?\n([^\r\n]+)\r?\n---\r?\n# ([^\r\n]+)\r?\n\r?\n([\s\S]+)$/.exec(text);
  if (!match) return;
  const [, json, title, body] = match;
  let meta;
  try { meta = JSON.parse(json); } catch { return; }
  if (validMeta(meta, id) && oneLine.test(title) && title.trim() && body.trim()) {
    return { meta, title, body, path: itemPath(id) };
  }
}

function verifiedSource(root, source) {
  if (sha.test(source)) {
    const reference = checkFacts('sha: ' + source, root);
    return reference.checked > 0 && !reference.misses.length;
  }
  // A memory source is an explicit project reference. Drift reports use more
  // permissive rules for prose, including paths outside the project.
  try {
    const path = relative(root, realpathSync(join(root, source)));
    return !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`) && !isCredentialPath(path);
  } catch { return false; }
}

function verified(project, { meta, title, body }) {
  const root = realpathSync(project);
  return verifiedSource(root, meta.source) && !checkFacts(`${title}\n${body}`, root, root, undefined,
    { pathBoundary: root }).misses.length;
}

function activeItems(project) {
  const dir = directories(project);
  if (!dir) return [];
  const now = today();
  const items = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const item = parseItem(readText(join(dir, entry.name)), entry.name.slice(0, -3));
    if (item && !item.meta.supersededBy && !(item.meta.expires < now) && verified(project, item)) items.push(item);
  }
  return items;
}

export function syncMemoryIndex(project) {
  const lines = activeItems(project).map(indexLine);
  if (directories(project)) writeState(join(project, '.project/memory/INDEX.md'), lines.length ? lines.join('\n') + '\n' : '');
  return lines;
}

export function writeMemory(project, { title, body, ...meta }) {
  const text = `---\n${JSON.stringify(meta)}\n---\n# ${title}\n\n${body}\n`;
  const item = typeof title === 'string' && oneLine.test(title) && typeof body === 'string' && parseItem(text, meta.id);
  if (!item) throw new Error('Invalid project memory item or item exceeds 200 tokens');
  if (!verified(project, item)) throw new Error('Project memory facts could not be verified');
  if (!directories(project, true)) throw new Error('Expected real project memory directories');
  writeState(join(project, item.path), text);
  syncMemoryIndex(project);
}

export function searchMemory(project, query) {
  const term = query.trim().toLowerCase();
  const results = [];
  if (!term) return results;
  for (const { meta, title, path } of activeItems(project)) {
    if (![title, meta.keywords ?? ''].some(text => text.toLowerCase().includes(term))) continue;
    const result = { id: meta.id, title, path };
    if (estimateTokens(JSON.stringify([...results, result]) + '\n') <= 500) results.push(result);
    if (results.length === 5) break;
  }
  return results;
}

export function workerMemoryPrompt(project, card) {
  const context = card.toLowerCase();
  const matches = activeItems(project).map(item => ({ item, score: [item.title, ...(item.meta.keywords ?? '').split(/[,\s]+/)]
    .filter(term => term.length >= 3 && context.includes(term.toLowerCase())).length }))
    .filter(match => match.score > 0).sort((a, b) => b.score - a.score).slice(0, 2);
  return matches.length ? ['## Relevant project memory', ...matches.map(({ item }) =>
    `${indexLine(item)}\n${clipTokens(item.body.trim(), 100)}`)].join('\n\n') : '';
}

export async function projectMemoryPrompt(project) {
  const indexLines = syncMemoryIndex(project);
  if (!indexLines.length) return '';
  const [charter, rulings] = await Promise.all(['charter', 'rulings'].map(name => projectDocument(project, name)));
  const lines = ['## 项目记忆'];
  if (charter.text !== undefined) {
    lines.push(`项目章程及完整红线见 ${charter.path}`);
    const redlines = charterLines(charter.text).find(([label]) => label.startsWith('红线'))[1];
    lines.push(clipTokens(`红线 · ${redlines}`, 150));
  }
  if (rulings.text !== undefined) lines.push(`项目裁决见 ${rulings.path}`);
  for (const line of indexLines) {
    if (estimateTokens([...lines, line].join('\n') + '\n\n') <= 400) lines.push(line);
  }
  return lines.join('\n') + '\n\n';
}
