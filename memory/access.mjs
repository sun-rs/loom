const kindRank = { ruling: 0, preference: 1, lesson: 2 };
const indexSurfaces = new Set(['index', 'search', 'attachments', 'delta']);
const deltaLimit = 30;

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
        && (!isCrossProject(binding, row) || hasDependency(binding, row, row.cardId != null));
    case 'reviewer':
      return binding.authorizedIds?.[history ? 'history' : 'memory']?.includes(row.id);
    default:
      return false;
  }
}

function compareEntries(a, b) {
  return (b.importance ?? 0) - (a.importance ?? 0)
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

function indexRow(binding, entry, asOf) {
  const source = provenance(binding, entry, asOf);
  return {
    id: entry.id,
    revision: entry.revision,
    line: indexLine(entry, source),
    usage: entry.usage ?? 0,
    ...source,
  };
}

function canWrite(binding, entry) {
  if (!binding || !entry) return false;
  const { role, project, principal } = binding;
  const { layer, kind } = entry;
  if (role === 'super' && entry.project === null) {
    return (layer === 'user' && kind === 'preference')
      || (layer === 'cross_project' && ['ruling', 'lesson'].includes(kind));
  }
  if (project == null || entry.project !== project) return false;
  if (layer === 'private' && (!principal || (entry.owner ?? entry.author) !== principal)) return false;
  if (layer !== 'shared' && layer !== 'private') return false;
  if (role === 'leader') return kind === 'lesson';
  return role === 'auditor' && ['ruling', 'preference'].includes(kind);
}

export function createAccess({ readState, entries = [], changes = [], history, now = Date.now } = {}) {
  const grants = new Map();
  const deltaScopes = new WeakMap();
  let grantId = 0;

  async function snapshot() {
    const state = await readState?.();
    return {
      entries: state?.entries ?? entries,
      changes: state?.changes ?? changes,
      history: state?.history,
      asOf: state?.asOf,
    };
  }

  function mayRead(binding, row, surface, time, project) {
    if (!binding || (project !== undefined && row.project !== project)) return false;
    if (surface !== 'history') {
      const candidate = row.kind === 'candidate' || row.layer === 'candidate';
      if (row.status === 'forgotten' && surface !== 'withdraw') return false;
      if (indexSurfaces.has(surface) && (row.status !== 'active' || candidate)) return false;
      if (surface === 'withdraw' && candidate) return false;
      if (surface === 'attachments' && row.layer !== 'shared') return false;
    }
    if (binding.role !== 'super' && row.project == null && binding.role !== 'reviewer') return false;
    if (binding.role !== 'super' && isCrossProject(binding, row)) {
      if (row.layer !== 'shared') return false;
      const granted = [...grants.values()].some(grant =>
        grant.recipient === binding.principal && grant.sourceProject === row.project
        && grant.recipientProject === binding.project && time < Date.parse(grant.expiresAt));
      if (!granted) return false;
    }
    return canReadRole(binding, row, surface);
  }

  function cutoff(state, time) {
    return state.asOf ?? new Date(time).toISOString();
  }

  async function readIndex(binding, surface, project) {
    const state = await snapshot();
    const time = now();
    const visible = state.entries.filter(entry => mayRead(binding, entry, surface, time, project));
    return { visible, asOf: cutoff(state, time) };
  }

  function visibleChange(binding, change, currentById, time) {
    const current = currentById.get(change.id);
    const entry = change.entry ?? current;
    const withdrawal = change.operation === 'withdraw';
    const surface = withdrawal ? 'withdraw' : 'delta';
    if (!entry || !mayRead(binding, entry, surface, time)) return null;

    // Check both the publication's original scope and the current scope.
    // A forgotten item can still publish its withdrawal.
    if (current && !mayRead(binding, current, withdrawal ? 'withdraw' : 'published', time)) return null;
    return entry;
  }

  return {
    async index(binding, { project } = {}) {
      const { visible, asOf } = await readIndex(binding, 'index', project);
      return { rows: visible.sort(compareEntries).map(entry => indexRow(binding, entry, asOf)) };
    },

    async search(binding, { query = '', limit = 50, cursor = 0, project } = {}) {
      const { visible, asOf } = await readIndex(binding, 'search', project);
      const needle = query.trim().toLowerCase();
      const matches = visible.filter(entry => !needle || [entry.title, ...(entry.keywords ?? [])]
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
      const entry = state.entries.find(row => mayRead(binding, row, 'show', time, project) && row.id === id);
      if (!entry) return { item: null, seq: null };
      let seq = null;
      for (const change of state.changes) {
        if (change.id === id && (!change.entry || mayRead(binding, change.entry, 'show', time, project))) {
          seq = Math.max(seq ?? 0, change.seq);
        }
      }
      return { item: { ...structuredClone(entry), ...provenance(binding, entry, cutoff(state, time)) }, seq };
    },

    async attachments(binding, { keywords = [], project } = {}) {
      const { visible, asOf } = await readIndex(binding, 'attachments', project);
      const needles = new Set(keywords.map(keyword => keyword.trim().toLowerCase()).filter(Boolean));
      return { rows: visible.filter(entry => entry.keywords?.some(keyword => needles.has(keyword.toLowerCase())))
        .sort(compareEntries).map(entry => indexRow(binding, entry, asOf)) };
    },

    async hist(binding, { id, project, sessionId } = {}) {
      const state = await snapshot();
      const records = typeof history === 'function' ? await history(sessionId) : history ?? state.history ?? [];
      const time = now();
      return { rows: records.filter(row => mayRead(binding, row, 'history', time, project)
        && (id === undefined || row.id === id) && (sessionId === undefined || row.sessionId === sessionId))
        .map(row => ({ ...structuredClone(row), ...provenance(binding, row, cutoff(state, time)) })) };
    },

    async delta(binding, { cursor = 0 } = {}) {
      const state = await snapshot();
      const time = now();
      const currentById = new Map(state.entries.map(entry => [entry.id, entry]));
      const baseCursor = cursor ?? 0;
      const visible = [];
      for (const change of state.changes) {
        if (change.seq <= baseCursor) continue;
        const entry = visibleChange(binding, change, currentById, time);
        if (entry) visible.push({ change, entry });
      }
      visible.sort((a, b) => a.change.seq - b.change.seq);
      const batch = visible.slice(0, deltaLimit);
      const rows = batch.map(({ change, entry }) => {
        const source = provenance(binding, entry, cutoff(state, time));
        return {
          seq: change.seq, id: change.id, revision: change.revision ?? entry.revision,
          operation: change.operation, line: indexLine(entry, source), ...source,
        };
      });
      const result = {
        rows, baseCursor, endCursor: rows.at(-1)?.seq ?? baseCursor, truncated: visible.length > deltaLimit,
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
        return latest?.id === change.id && visibleChange(binding, change, currentById, time)
          && visibleChange(binding, latest, currentById, time);
      });
    },

    grant(binding, { sourceProject, recipient, reason, expiresAt } = {}) {
      if (binding?.role !== 'super') return { ok: false, code: 'forbidden' };
      if (typeof sourceProject !== 'string' || !sourceProject.trim() || sourceProject === binding.project
        || typeof recipient !== 'string' || !recipient.trim() || typeof reason !== 'string' || !reason.trim()
        || typeof expiresAt !== 'string' || !(Date.parse(expiresAt) > now())) {
        return { ok: false, code: 'invalid-grant' };
      }
      const grant = { id: 'grant-' + ++grantId, sourceProject, recipient, reason, expiresAt,
        recipientProject: binding.project };
      grants.set(grant.id, grant);
      return { ok: true, grant: { ...grant } };
    },

    revoke(binding, id) {
      if (binding?.role !== 'super') return { ok: false, code: 'forbidden' };
      grants.delete(id);
      return { ok: true };
    },

    canWrite,
  };
}
