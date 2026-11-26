import { isAbsolute, relative, resolve, sep } from 'node:path';
import { isCredentialPath } from '../evidence/git.mjs';
import { estimateTokens as defaultEstimate } from '../lib/token-budget.mjs';

const factKinds = ['ruling', 'preference', 'lesson'];
const layers = ['shared', 'private', 'candidate', 'user', 'cross_project'];
const oneLine = value => typeof value === 'string' && value.trim() !== ''
  && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value);
const dateTime = value => oneLine(value) && /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value));
const listOf = (value, check) => Array.isArray(value) && Array.from(value).every(check);
const failure = error => ({ ok: false, code: 'invalid', error });

function isWithin(root, path) {
  const rest = relative(root, path);
  return rest !== '' && rest !== '..' && !rest.startsWith(`..${sep}`)
    && !isAbsolute(rest) && !isCredentialPath(rest);
}

async function verifySource(source, evidence) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
  const { path, sha } = source;
  if (path === undefined && sha === undefined) return false;
  try {
    if (path !== undefined) {
      if (!oneLine(path) || path !== path.trim() || isAbsolute(path) || /[\\:]/u.test(path)
        || path.split('/').includes('..') || !isAbsolute(evidence?.root ?? '')) return false;
      const root = resolve(evidence.root);
      const absolute = resolve(root, path);
      if (!isWithin(root, absolute)) return false;
      const actual = await evidence.realpath(absolute);
      if (typeof actual !== 'string' || !isAbsolute(actual) || !isWithin(root, actual)) return false;
    }
    return sha === undefined || (typeof sha === 'string' && /^(?:[0-9a-f]{7,40}|[0-9a-f]{64})$/iu.test(sha)
      && await evidence?.hasCommit?.(sha) === true);
  } catch {
    return false;
  }
}

export function validateEntryFormat(entry, { estimateTokens = defaultEstimate, maxMetadataBytes = 4096 } = {}) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return failure('Invalid memory entry');
  const { title, body, ...metadata } = entry;
  const { kind, layer, project, proposedKind, checkedAt, keywords, importance, externalSource,
    original, supersedes, supersededBy } = metadata;
  if (!layers.includes(layer) || ![...factKinds, 'candidate'].includes(kind)
    || (kind === 'candidate') !== (layer === 'candidate')
    || (kind === 'candidate' ? !factKinds.includes(proposedKind) : proposedKind !== undefined)
    || (['user', 'cross_project'].includes(layer) ? project !== null : !oneLine(project))
    || !dateTime(checkedAt) || (keywords !== undefined && !listOf(keywords, oneLine))
    || (importance !== undefined && (!Number.isFinite(importance) || importance < 0))
    || (original !== undefined && !oneLine(original))
    || (supersedes !== undefined && !listOf(supersedes, oneLine))
    || (supersededBy !== undefined && !listOf(supersededBy, oneLine))
    || (externalSource !== undefined && !listOf(externalSource, observation => observation
      && ['web', 'mcp'].includes(observation.kind) && oneLine(observation.location) && dateTime(observation.observedAt)))) {
    return failure('Invalid memory metadata');
  }
  if (!oneLine(title) || typeof body !== 'string' || !body.trim() || body.includes('\0')) {
    return failure('Expected a single-line title and a nonempty body');
  }
  if (!(estimateTokens(body) <= 200)) return failure('Memory body exceeds 200 tokens');
  try {
    if (Buffer.byteLength(JSON.stringify({ ...metadata, title })) > maxMetadataBytes) {
      return failure('Memory metadata exceeds its size limit');
    }
  } catch {
    return failure('Invalid memory metadata');
  }
  return { ok: true };
}

export async function validateEntry(entry, { evidence, ...options } = {}) {
  const result = validateEntryFormat(entry, options);
  if (!result.ok) return result;
  if (!await verifySource(entry.source, evidence)) return failure('Memory evidence could not be verified');
  return result;
}

export const itemPath = id => `memory/items/${id}.md`;

export function renderEntry({ title, body, ...metadata }) {
  return `---\n${JSON.stringify(metadata)}\n---\n# ${title}\n\n${body}\n`;
}
