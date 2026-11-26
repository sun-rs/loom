import { randomUUID } from 'node:crypto';
import { matchesGlob } from 'node:path';
import { sanitizeEntry } from './sanitize.mjs';
import { formatIndexRow, isShortMemoryId, resolveShortMemoryId } from './index-row.mjs';

const kindRank = { ruling: 0, preference: 1, lesson: 2 };
const indexSurfaces = new Set(['index', 'search', 'attachments', 'delta']);
const deltaLimit = 30;
const historyKeys = ['id', 'project', 'layer', 'role', 'owner', 'author', 'cardId', 'sessionId', 'asOf'];

function isUserGuidance(row) {
  return row.project === null && row.layer === 'user' && ['ruling', 'preference'].includes(row.kind);
}

function isCrossProject(binding, row) {
  return row.project != null && row.project !== binding.project;
}

function hasDependency(binding, row, requireCard) {
  return binding.dependencies?.some(({ project, cardId }) =>
    project === row.project && (!requireCard || (cardId != null && cardId === row.cardId)));
}

function canReadRole(binding, row, surface) {
  const history = surface === 'history';
  switch (binding.role) {
    case 'super':
      return true;
    case 'auditor':
      if (row.layer === 'private') {
        return Boolean(binding.principal) && (row.owner ?? row.author) === binding.principal;
      }
      return history || row.layer === 'shared' || row.layer === 'candidate';
    case 'leader':
      return row.layer !== 'private'
        && (row.layer === 'shared' || (history ? row.role === 'worker' : row.layer === 'candidate'));
    case 'worker':
      if (history) {
        if (row.layer !== 'shared' || row.cardId == null) return false;
        const ownLineage = row.project === binding.project
          && (row.cardId === binding.cardId || binding.ancestors?.includes(row.cardId));
        return ownLineage || hasDependency(binding, row, true);
      }
      return (surface === 'show' || surface === 'attachments') && row.layer === 'shared'
        && binding.attachments?.includes(row.id)
        && (!isCrossProject(binding, row) || hasDependency(binding, row, false));
    case 'reviewer':
      return binding.authorizedIds?.[history ? 'history' : 'memory']?.includes(row.id);
    default:
      return false;
  }
}

function compareEntries(a, b) {
  return Number(b.kind === 'ruling') - Number(a.kind === 'ruling')
    || (b.importance ?? 0) - (a.importance ?? 0)
    || (kindRank[a.kind] ?? 3) - (kindRank[b.kind] ?? 3)
    || (b.usage ?? 0) - (a.usage ?? 0)
    || (a.id < b.id ? -1 : Number(a.id > b.id));
}

function provenance(binding, row, asOf) {
  return isCrossProject(binding, row)
    ? { sourceProject: row.project, asOf: row.asOf ?? asOf } : {};
}

function indexLine(entry, source) {
  const title = entry.title?.replace(/[\r\n\u2028\u2029]+/gu, ' ').trim();
  const label = title ? ' — ' + title : '';
  const origin = source.sourceProject ? ' [' + source.sourceProject + ' @ ' + source.asOf + ']' : '';
  return '- ' + entry.id + label + origin;
}

function indexRow(binding, entry, asOf, compact = false) {
  const source = provenance(binding, entry, asOf);
  return {
    id: entry.id,
    revision: entry.revision,
    line: compact ? formatIndexRow(entry, indexLine(entry, source)) : indexLine(entry, source),
    usage: entry.usage ?? 0,
    ...source,
  };
}

function canWrite(binding, entry) {
  if (!binding || !entry) return false;
  const { role, project, principal } = binding;
  const { layer, kind } = entry;
  if (role === 'super' && entry.project === null) {
    return isUserGuidance(entry)
      || (layer === 'cross_project' && ['ruling', 'lesson'].includes(kind));
  }
  if (project == null || entry.project !== project) return false;
  if (layer === 'private' && (!principal || (entry.owner ?? entry.author) !== principal)) return false;
  if (layer !== 'shared' && layer !== 'private') return false;
  if (role === 'leader') return layer === 'shared' && kind === 'lesson';
  return role === 'auditor' && ['ruling', 'preference'].includes(kind);
}

function canPropose(binding, candidate) {
  return binding?.role === 'worker' && Boolean(binding.cardId) && Boolean(binding.project)
    && candidate?.kind === 'candidate' && candidate.layer === 'candidate'
    && candidate.project === binding.project && candidate.cardId === binding.cardId
    && candidate.author === binding.principal;
}

function canReview(binding, candidate) {
  return candidate?.kind === 'candidate' && candidate.layer === 'candidate'
    && canWrite(binding, { project: candidate.project, kind: candidate.proposedKind, layer: 'shared' });
}

function canRevise(binding, entry) {
  if (canWrite(binding, entry)) return true;
  return entry?.status === 'stale' && entry.kind === 'lesson'
    && canWrite(binding, { ...entry, kind: 'ruling' });
}

function canForget(binding, entry) {
  return canReview(binding, entry) || canRevise(binding, entry);
}

export function createAccess({ readState, commitState, serialize, entries = [], changes = [], history,
  now = Date.now, classifySensitive, replacement } = {}) {
  const deltaScopes = new WeakMap();
  let localGrants;
  let pending = Promise.resolve();

  const grantsOf = state => localGrants ?? state?.grants ?? [];

  function updateGrants(change) {
    const success = { ok: true };
    if (!readState && !commitState) return change(localGrants ??= []) ?? success;
    const action = async () => {
      const state = await readState?.();
      const grants = [...grantsOf(state)];
      const result = change(grants);
      if (!result) return success;
      if (commitState) await commitState({ ...state, grants });
      else localGrants = grants;
      return result;
    };
    if (serialize) return serialize(action);
    const result = pending.then(action);
    pending = result.catch(() => {});
    return result;
  }

  async function snapshot() {
    const state = await readState?.();
    return {
      entries: state?.entries ?? entries,
      changes: state?.changes ?? changes,
      grants: grantsOf(state),
      history: state?.history,
      asOf: state?.asOf,
    };
  }

  function grantExpiry(binding, row, grants) {
    let expiry = -Infinity;
    for (const grant of grants) {
      if (!grant.revoked && grant.recipient === binding.principal && grant.sourceProject === row.project
        && grant.recipientProject === binding.project) {
        const expires = Date.parse(grant.expiresAt);
        if (expires > expiry) expiry = expires;
      }
    }
    return expiry;
  }

  function mayRead(binding, row, surface, time, grants, project, retry = false) {
    if (!binding || (project !== undefined && row.project !== project)) return false;
    if (surface !== 'history') {
      const candidate = row.kind === 'candidate' || row.layer === 'candidate';
      if (row.status === 'forgotten' && surface !== 'withdraw') return false;
      if (indexSurfaces.has(surface) && (candidate || (!retry && row.status !== 'active'))) return false;
      if (surface === 'withdraw' && candidate) return false;
      if (surface === 'attachments' && row.layer !== 'shared') return false;
    }
    if (binding.role !== 'super' && row.project == null && binding.role !== 'reviewer') {
      return surface !== 'history' && isUserGuidance(row) && ['auditor', 'leader'].includes(binding.role);
    }
    if (binding.role !== 'super' && isCrossProject(binding, row)) {
      if (row.layer !== 'shared' || time >= grantExpiry(binding, row, grants)) return false;
    }
    return canReadRole(binding, row, surface);
  }

  function cutoff(state, time) {
    return state.asOf ?? new Date(time).toISOString();
  }

  async function readIndex(binding, surface, project) {
    const state = await snapshot();
    const time = now();
    const visible = state.entries.filter(entry => mayRead(binding, entry, surface, time, state.grants, project));
    return { visible, asOf: cutoff(state, time) };
  }

  function visibleChange(binding, change, currentById, time, grants, retry = false) {
    const current = currentById.get(change.id);
    const entry = change.entry ?? current;
    const withdrawal = change.operation === 'withdraw';
    const surface = withdrawal ? 'withdraw' : 'delta';
    if (!entry || !mayRead(binding, entry, surface, time, grants)) return null;

    // Check both the publication's original scope and the current scope.
    // A forgotten item can still publish its withdrawal.
    if (current && !mayRead(binding, current, surface, time, grants, undefined, retry)) return null;
    return entry;
  }

  return {
    resolveShortId(binding, state, id, project) {
      const time = now();
      const grants = grantsOf(state);
      const visible = row => mayRead(binding, row, 'show', time, grants, project);
      const exact = state.entries.find(row => row.id === id && visible(row));
      return exact ? { item: exact } : resolveShortMemoryId(state.entries, id, visible);
    },
    async index(binding, { project } = {}) {
      const { visible, asOf } = await readIndex(binding, 'index', project);
      return { rows: visible.sort(compareEntries).map(entry => indexRow(binding, entry, asOf, true)) };
    },

    async search(binding, { query = '', limit = 50, cursor = 0, project } = {}) {
      const { visible, asOf } = await readIndex(binding, 'search', project);
      const needle = query.trim().toLowerCase();
      const matches = visible.filter(entry => !needle || [entry.title, ...(entry.keywords ?? []),
        ...(entry.layer === 'user' && entry.kind === 'ruling' && entry.source?.path === '.project/rulings.md' ? [entry.body] : [])]
        .some(value => value?.toLowerCase().includes(needle))).sort(compareEntries);
      const offset = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
      const size = Number.isSafeInteger(limit) && limit > 0 ? limit : 50;
      const end = offset + size;
      return {
        rows: matches.slice(offset, end).map(entry => indexRow(binding, entry, asOf)),
        nextCursor: end < matches.length ? end : null,
      };
    },

    async show(binding, id, { project } = {}) {
      const state = await snapshot();
      const time = now();
      const visible = row => mayRead(binding, row, 'show', time, state.grants, project);
      let entry = state.entries.find(row => row.id === id && visible(row));
      if (!entry && isShortMemoryId(id)) {
        const result = resolveShortMemoryId(state.entries, id, visible);
        if (!result.item) throw Object.assign(new Error(result.error), { code: result.code });
        entry = result.item;
      }
      if (!entry) return { item: null, seq: null };
      // Use the visible publication watermark of the snapshot, including the rest of a maintenance batch.
      const currentById = new Map(state.entries.map(row => [row.id, row]));
      let seq = null;
      for (const change of state.changes) {
        const publication = visibleChange(binding, change, currentById, time, state.grants);
        if ((publication && (project === undefined || publication.project === project))
          || (change.id === entry.id && (!change.entry || mayRead(binding, change.entry, 'show', time, state.grants, project)))) {
          seq = Math.max(seq ?? 0, change.seq);
        }
      }
      return { item: { ...structuredClone(entry), ...provenance(binding, entry, cutoff(state, time)) }, seq };
    },

    async cacheUntil(binding, item) {
      const { grants } = await snapshot();
      if (!mayRead(binding, item, 'show', now(), grants)) return 0;
      return binding.role !== 'super' && isCrossProject(binding, item) ? grantExpiry(binding, item, grants) : null;
    },

    async attachments(binding, { keywords = [], topics = [], paths = [], project, attached = false } = {}) {
      const { visible, asOf } = await readIndex(binding, 'attachments', project);
      const terms = new Set([...keywords, ...topics].map(term => term.trim().toLowerCase()).filter(Boolean));
      const matches = entry => [...(entry.keywords ?? []), ...(entry.topics ?? [])]
        .some(term => terms.has(term.toLowerCase())) || entry.paths?.some(pattern =>
        paths.some(path => path === pattern || path.startsWith(pattern.replace(/\/$/u, '') + '/') ||
          matchesGlob(path, pattern) || matchesGlob(path.replace(/\/$/u, '') + '/', pattern)));
      return { rows: visible.filter(attached ? entry => binding.attachments?.includes(entry.id) : matches)
        .sort(compareEntries).map(entry => indexRow(binding, entry, asOf)) };
    },

    async hist(binding, { id, project, sessionId } = {}) {
      if (typeof classifySensitive !== 'function') return { ok: false, code: 'classifier-missing', rows: [] };
      const state = await snapshot();
      const records = (typeof history === 'function' ? await history(sessionId) : history ?? state.history) ?? [];
      const time = now();
      return { rows: records.filter(row => mayRead(binding, row, 'history', time, state.grants, project)
        && (id === undefined || row.id === id) && (sessionId === undefined || row.sessionId === sessionId))
        .flatMap(row => {
          const safe = sanitizeEntry(row, { classifySensitive, replacement });
          if (!safe.ok || historyKeys.some(key => safe.entry[key] !== row[key])) return [];
          return [{ ...safe.entry, ...provenance(binding, row, cutoff(state, time)) }];
        }) };
    },

    async publicationCursor() {
      const { changes } = await snapshot();
      return changes.reduce((cursor, change) => Math.max(cursor, change.seq), 0);
    },

    async delta(binding, { cursor = 0, fits } = {}) {
      const state = await snapshot();
      const time = now();
      const currentById = new Map(state.entries.map(entry => [entry.id, entry]));
      const baseCursor = cursor ?? 0;
      const visible = [];
      for (const change of state.changes) {
        if (change.seq <= baseCursor) continue;
        const entry = visibleChange(binding, change, currentById, time, state.grants);
        if (entry) visible.push({ change, entry });
      }
      visible.sort((a, b) => a.change.seq - b.change.seq);
      const batch = [];
      const rows = [];
      for (const publication of visible.slice(0, deltaLimit)) {
        const { change, entry } = publication;
        const source = provenance(binding, entry, cutoff(state, time));
        const row = {
          seq: change.seq, id: change.id, revision: change.revision ?? entry.revision,
          operation: change.operation, line: indexLine(entry, source), ...source,
        };
        const truncated = rows.length + 1 < visible.length;
        if (fits && !fits({ rows: [...rows, row], truncated })) {
          if (rows.length || !fits({ rows: [...rows, { ...row, line: '- ' + row.id }], truncated })) break;
          row.line = '- ' + row.id;
        }
        rows.push(row);
        batch.push(publication);
      }
      const result = {
        rows, baseCursor, endCursor: rows.at(-1)?.seq ?? baseCursor, truncated: visible.length > rows.length,
      };
      deltaScopes.set(result, batch.map(({ change, entry }) => {
        const { id, project, layer, status, kind, owner, author } = entry;
        return { seq: change.seq, id: change.id, operation: change.operation,
          entry: { id, project, layer, status, kind, owner, author } };
      }));
      return result;
    },

    async canRetryDelta(binding, result) {
      const original = deltaScopes.get(result);
      if (!original) return false;
      const state = await snapshot();
      const time = now();
      const currentById = new Map(state.entries.map(entry => [entry.id, entry]));
      const changesBySeq = new Map(state.changes.map(change => [change.seq, change]));
      return original.every(change => {
        const latest = changesBySeq.get(change.seq);
        return latest?.id === change.id && visibleChange(binding, change, currentById, time, state.grants, true)
          && visibleChange(binding, latest, currentById, time, state.grants, true);
      });
    },

    async canRetryPublications(binding, rows) {
      const state = await snapshot();
      const time = now();
      const currentById = new Map(state.entries.map(entry => [entry.id, entry]));
      const changesBySeq = new Map(state.changes.map(change => [change.seq, change]));
      return rows.every(({ seq, id, revision, operation }) => {
        const change = changesBySeq.get(seq);
        return change?.id === id && change.operation === operation &&
          (change.revision ?? change.entry?.revision) === revision &&
          Boolean(visibleChange(binding, change, currentById, time, state.grants, true));
      });
    },

    grant(binding, { sourceProject, targetProject = binding?.project, recipient, reason, expiresAt } = {}) {
      if (binding?.role !== 'super') return { ok: false, code: 'forbidden' };
      if (typeof sourceProject !== 'string' || !sourceProject.trim() || sourceProject === targetProject
        || typeof targetProject !== 'string' || !targetProject.trim()
        || typeof recipient !== 'string' || !recipient.trim() || typeof reason !== 'string' || !reason.trim()
        || typeof expiresAt !== 'string' || !(Date.parse(expiresAt) > now())) {
        return { ok: false, code: 'invalid-grant' };
      }
      return updateGrants(grants => {
        const grant = { id: 'grant-' + randomUUID(), sourceProject, recipient, reason, expiresAt,
          recipientProject: targetProject, revoked: false };
        grants.push(grant);
        return { ok: true, grant: { ...grant } };
      });
    },

    revoke(binding, id) {
      if (binding?.role !== 'super') return { ok: false, code: 'forbidden' };
      return updateGrants(grants => {
        const index = grants.findIndex(grant => grant.id === id && !grant.revoked);
        if (index < 0) return null;
        grants[index] = { ...grants[index], revoked: true };
        return { ok: true };
      });
    },

    canWrite,
    canRevise,
    canPropose,
    canReview,
    canForget,
  };
}
