import { createAccess } from './access.mjs';
import { itemPath, renderEntry, validateEntry, validateEntryFormat } from './format.mjs';
import { sanitizeEntry } from './sanitize.mjs';

const day = 86_400_000;
const decisions = new Map([
  ['promote', 'promoted'], ['merge', 'merged'], ['return', 'returned'], ['reject', 'rejected'],
]);
const invalid = error => ({ ok: false, code: 'invalid', error });
const forbidden = () => ({ ok: false, code: 'forbidden', error: 'Memory write is forbidden' });
const conflict = currentRevision => ({ ok: false, code: 'conflict', error: 'Memory revision changed', currentRevision });
const nonempty = value => typeof value === 'string' && value.trim() !== '';
const active = entry => entry.status === 'active';

function select(source, fields) {
  return Object.fromEntries(fields.filter(key => source[key] !== undefined).map(key => [key, source[key]]));
}

function draftFields(entry, externalSource) {
  const fields = select(entry, ['kind', 'layer', 'project', 'proposedKind', 'title', 'body', 'keywords', 'importance', 'checkedAt']);
  const { source } = entry;
  return { ...fields, source: source && typeof source === 'object' && !Array.isArray(source)
    ? select(source, ['path', 'sha']) : source, externalSource };
}

function sameFact(a, b) {
  const key = ({ kind, layer, project, owner, author, cardId, proposedKind, title, body,
    keywords = [], importance = 0, source, externalSource = [] }) => JSON.stringify([
    kind, layer, project, owner, kind === 'candidate' ? [author, cardId, proposedKind] : null,
    title, body, keywords, importance, source?.path, source?.sha, externalSource,
  ]);
  return key(a) === key(b);
}

function indexFiles(state) {
  const lines = state.entries.filter(active).sort((a, b) => a.id.localeCompare(b.id, 'en'))
    .map(({ id, title }) => `- ${itemPath(id)} — ${title}`);
  state.files['memory/INDEX.md'] = lines.length ? `${lines.join('\n')}\n` : '';
}

function updateEntry(state, entry, operation) {
  const index = state.entries.findIndex(row => row.id === entry.id);
  if (index < 0) state.entries.push(entry);
  else state.entries[index] = entry;
  if (entry.status === 'forgotten') delete state.files[itemPath(entry.id)];
  else state.files[itemPath(entry.id)] = renderEntry(entry);
  if (operation) {
    const fields = ['id', 'revision', 'project', 'layer', 'kind', 'status', 'owner', 'author', 'cardId'];
    if (operation !== 'withdraw') fields.push('title');
    state.changes.push({ seq: ++state.seq, id: entry.id, revision: entry.revision, operation, entry: select(entry, fields) });
  }
}

function purge(state, entry) {
  const tombstone = select(entry, ['id', 'revision', 'project', 'layer', 'kind', 'owner', 'cardId', 'status']);
  const replacements = new Map([[entry.id, tombstone]]);
  for (const { response } of state.receipts) {
    if (response.item?.id === entry.id && response.candidate?.status === 'promoted') {
      const { id } = response.candidate;
      const candidate = state.entries.find(row => row.id === id);
      if (!candidate) continue;
      const marker = select(candidate, ['id', 'revision', 'project', 'layer', 'kind', 'status', 'author',
        'cardId', 'proposedKind', 'reviewer']);
      replacements.set(id, marker);
      state.entries[state.entries.indexOf(candidate)] = marker;
      delete state.files[itemPath(id)];
    }
  }
  state.changes = state.changes.filter(change => change.id !== entry.id);
  for (const { response } of state.receipts) {
    for (const field of ['item', 'candidate']) {
      const marker = replacements.get(response[field]?.id);
      if (marker) response[field] = marker;
    }
    if (response.items) response.items = response.items.map(item => replacements.get(item.id) ?? item);
  }
  updateEntry(state, tombstone, 'withdraw');
  return tombstone;
}

export function createMemoryStore({ now = Date.now, readState, commitState, evidence,
  estimateTokens, maxMetadataBytes, staleDays, getObservations, classifySensitive, replacement, readRaw } = {}) {
  const format = { evidence, estimateTokens, maxMetadataBytes };
  const redaction = { classifySensitive, replacement };
  let pending = Promise.resolve();

  function serialize(action) {
    const result = pending.then(action);
    pending = result.catch(() => {});
    return result;
  }

  async function history(sessionId) {
    const rows = await readRaw(sessionId) ?? [];
    return rows.flatMap(row => {
      const data = select(row, ['id', 'project', 'layer', 'role', 'owner', 'author', 'cardId', 'title', 'body', 'asOf']);
      const safe = sanitizeEntry({ ...data, sessionId: row.sessionId ?? sessionId }, redaction);
      if (!safe.ok) return [];
      // Classification may remove display text, but must not change history's authorization keys.
      if (Object.keys(data).some(key => !['title', 'body'].includes(key) && data[key] !== safe.entry[key])
        || safe.entry.sessionId !== (row.sessionId ?? sessionId)) return [];
      return [safe.entry];
    });
  }

  const access = createAccess({ readState, history: readRaw ? history : undefined, now });

  async function snapshot() {
    return { entries: [], changes: [], seq: 0, files: {}, receipts: [], turns: [], nextId: 0,
      ...structuredClone(await readState?.()) };
  }

  const time = () => new Date(now()).toISOString();

  function allocate(state) {
    let id;
    do { id = `memory-${++state.nextId}`; }
    while (state.entries.some(entry => entry.id === id));
    return id;
  }

  async function prepare(fields) {
    const raw = validateEntryFormat(fields, format);
    if (!raw.ok) return raw;
    const safe = sanitizeEntry(fields, redaction);
    if (!safe.ok) return safe;
    if (['project', 'layer', 'kind', 'proposedKind'].some(key => safe.entry[key] !== fields[key])) {
      return invalid('Invalid memory scope or kind');
    }
    if (safe.entry.source?.path !== fields.source?.path || safe.entry.source?.sha !== fields.source?.sha) {
      return invalid('Memory evidence could not be reliably redacted');
    }
    const result = await validateEntry(safe.entry, format);
    return result.ok ? safe : result;
  }

  function version(state, binding, fields, current, extra = {}) {
    const updatedAt = time();
    const entry = { ...fields, ...extra, id: current?.id ?? allocate(state), revision: (current?.revision ?? 0) + 1,
      author: binding.principal, role: binding.role, cardId: binding.cardId ?? null, updatedAt,
      effectiveAt: updatedAt, usage: current?.usage ?? 0, status: fields.kind === 'candidate' ? 'pending' : 'active',
    };
    if (fields.layer === 'private') entry.owner = current?.owner ?? binding.principal;
    return entry;
  }

  async function observations(binding) {
    const rows = await getObservations?.(binding.sessionId) ?? [];
    return rows.filter(row => row && ['web', 'mcp'].includes(row.kind))
      .map(row => select(row, ['kind', 'location', 'observedAt']));
  }

  function expected(requested, current) {
    const revision = current?.revision ?? null;
    return requested === revision ? null : conflict(revision);
  }

  async function put(state, binding, request, current, success) {
    const { id, entry, expectedRevision, op } = request;
    if (id != null && !current) return forbidden();
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return invalid('Invalid memory entry');
    const candidate = op === 'propose';
    const permitted = candidate ? access.canPropose : access.canWrite;
    const scope = { ...entry, owner: binding.principal, author: binding.principal, cardId: binding.cardId };
    if (!permitted(binding, scope) || (current && (!permitted(binding, current)
      || current.project !== scope.project || current.layer !== scope.layer || current.kind !== scope.kind))) return forbidden();
    if (current && (candidate ? !['pending', 'returned'].includes(current.status)
      : !['active', 'stale'].includes(current.status))) return invalid('Memory entry cannot be revised');
    const mismatch = expected(expectedRevision, current);
    if (mismatch) return mismatch;
    const fields = await prepare(draftFields(entry, await observations(binding)));
    if (!fields.ok) return fields;
    if (!current) {
      const duplicate = state.entries.find(row => (candidate ? row.status === 'pending' : active(row))
        && sameFact(row, { ...fields.entry, owner: entry.layer === 'private' ? binding.principal : undefined,
          author: binding.principal, cardId: binding.cardId }));
      if (duplicate) return success({ item: duplicate }, 'duplicate');
    }
    const item = version(state, binding, fields.entry, current,
      current ? select(current, ['original', 'supersedes', 'proposer', 'reviewer']) : {});
    const formatResult = validateEntryFormat(item, format);
    if (!formatResult.ok) return formatResult;
    updateEntry(state, item, candidate ? null : active(current ?? {}) ? 'update' : 'add');
    return success({ item }, candidate ? 'candidate' : 'accepted');
  }

  async function review(state, binding, request, current, success) {
    const { cardId, expectedRevision, op } = request;
    if (!access.canReview(binding, current) || !cardId || cardId !== current.cardId) return forbidden();
    const status = decisions.get(op);
    if (current.status === status) {
      const prior = state.receipts.find(({ response }) => response.candidate?.id === current.id
        && response.candidate.status === status && response.candidate.revision === current.revision);
      if (prior && (expectedRevision === current.revision - 1 || expectedRevision === current.revision)) {
        return success(select(prior.response, ['candidate', 'item']));
      }
    }
    const mismatch = expected(expectedRevision, current);
    if (mismatch) return mismatch;
    if (current.status !== 'pending') return invalid('Candidate is not pending');

    const candidate = { ...current, status, revision: current.revision + 1, updatedAt: time(), reviewer: binding.principal };
    const candidateFormat = validateEntryFormat(candidate, format);
    if (!candidateFormat.ok) return candidateFormat;
    let item = candidate;
    if (op === 'promote') {
      const entry = { ...current, kind: current.proposedKind, layer: 'shared', proposedKind: undefined };
      const fields = await prepare(draftFields(entry, current.externalSource ?? []));
      if (!fields.ok) return fields;
      item = state.entries.find(row => active(row) && sameFact(row, fields.entry));
      if (!item) {
        item = version(state, binding, fields.entry, null, { proposer: current.author, reviewer: binding.principal });
        const result = validateEntryFormat(item, format);
        if (!result.ok) return result;
        updateEntry(state, item, 'add');
      }
    }
    if (op === 'merge') {
      const target = state.entries.find(entry => entry.id === request.targetId);
      if (!access.canWrite(binding, target) || target.project !== current.project
        || target.layer !== 'shared' || target.kind !== current.proposedKind) return forbidden();
      const targetMismatch = expected(request.targetExpectedRevision, target);
      if (targetMismatch) return targetMismatch;
      if (!active(target)) return invalid('Merge target is not active');
      const externalSource = [...new Map([...(target.externalSource ?? []), ...(current.externalSource ?? [])]
        .map(observation => [JSON.stringify(observation), observation])).values()];
      const fields = await prepare(draftFields({ ...target, body: request.body }, externalSource));
      if (!fields.ok) return fields;
      item = version(state, binding, fields.entry, target, {
        ...select(target, ['original', 'supersedes']), proposer: current.author, reviewer: binding.principal,
      });
      const result = validateEntryFormat(item, format);
      if (!result.ok) return result;
      updateEntry(state, item, 'update');
    }
    updateEntry(state, candidate);
    return success({ item, candidate });
  }

  async function importRulings(state, binding, request, success) {
    const scope = { project: binding.project, kind: 'ruling', layer: 'shared' };
    if (!access.canWrite(binding, scope)) return forbidden();
    if (!Array.isArray(request.entries) || !request.entries.length) return invalid('Expected legacy rulings');
    const batch = new Map();
    const originals = new Set();
    const externalSource = await observations(binding);
    for (const row of request.entries) {
      if (!nonempty(row?.id) || !nonempty(row.original) || batch.has(row.id) || originals.has(row.original)
        || (row.supersedes !== undefined && (!Array.isArray(row.supersedes) || !Array.from(row.supersedes).every(nonempty)))) {
        return invalid('Invalid legacy ruling');
      }
      const draft = { ...row, ...scope, source: { path: row.original }, checkedAt: row.checkedAt ?? time() };
      const fields = await prepare(draftFields(draft, externalSource));
      if (!fields.ok) return fields;
      const original = fields.entry.source.path;
      if (originals.has(original) || state.entries.some(entry => entry.project === scope.project && entry.original === original)) {
        return invalid('Legacy ruling has already been imported');
      }
      originals.add(original);
      batch.set(row.id, { item: version(state, binding, fields.entry, null, { original }), supersedes: row.supersedes ?? [] });
    }
    for (const { item, supersedes } of batch.values()) {
      const replaced = [...new Set(supersedes)].map(id => batch.get(id)?.item);
      if (replaced.some(row => !row || row === item)) return invalid('Invalid legacy ruling replacement');
      if (replaced.length) item.supersedes = replaced.map(row => row.id);
      for (const row of replaced) {
        row.supersededBy = [...(row.supersededBy ?? []), item.id];
        row.status = 'superseded';
      }
    }
    const items = [...batch.values()].map(({ item }) => item);
    // Topologically remove nodes with no incoming replacement to detect cycles.
    const incoming = new Map(items.map(item => [item.id, item.supersededBy?.length ?? 0]));
    const ready = items.filter(item => incoming.get(item.id) === 0);
    const byId = new Map(items.map(item => [item.id, item]));
    for (let i = 0; i < ready.length; i++) {
      for (const id of ready[i].supersedes ?? []) {
        const count = incoming.get(id) - 1;
        incoming.set(id, count);
        if (count === 0) ready.push(byId.get(id));
      }
    }
    if (ready.length !== items.length) return invalid('Cyclic legacy ruling replacement');
    for (const item of items) {
      const result = validateEntryFormat(item, format);
      if (!result.ok) return result;
      updateEntry(state, item, active(item) ? 'add' : null);
    }
    return success({ items });
  }

  async function write(binding, request) {
    if (!nonempty(binding?.sessionId) || !nonempty(binding.principal)) return forbidden();
    if (!nonempty(request?.requestId)) return invalid('Expected a memory request ID');
    const state = await snapshot();
    const { op, id, expectedRevision, requestId } = request;
    const scope = JSON.stringify([binding.sessionId, binding.principal, binding.role, binding.project, binding.cardId]);
    const prior = state.receipts.find(row => row.scope === scope && row.requestId === requestId);
    if (prior) return prior.response;
    const success = (fields, status = 'accepted') => ({ ok: true, ...fields, receipt: { requestId, status } });
    const current = state.entries.find(entry => entry.id === id);
    const before = state.seq;
    let result;
    if (op === 'put' || op === 'propose') result = await put(state, binding, request, current, success);
    else if (decisions.has(op)) result = await review(state, binding, request, current, success);
    else if (op === 'import_rulings') result = await importRulings(state, binding, request, success);
    else if (op === 'forget') {
      if (!access.canForget(binding, current)) return forbidden();
      const mismatch = expected(expectedRevision, current);
      if (mismatch) return mismatch;
      if (current.status === 'forgotten') return success({ item: current });
      const item = purge(state, { ...current, status: 'forgotten', revision: current.revision + 1 });
      result = success({ item });
    } else return invalid('Unknown memory write operation');
    if (!result.ok) return result;
    if (state.seq !== before) indexFiles(state);
    state.receipts.push({ scope, requestId, response: result });
    await commitState(state);
    return structuredClone(result);
  }

  async function recordTurn({ binding, turnId, isRoot, replay, text }) {
    if (!isRoot || replay || !nonempty(binding?.sessionId) || !nonempty(turnId) || typeof text !== 'string') return;
    const state = await snapshot();
    const key = JSON.stringify([binding.sessionId, turnId]);
    if (state.turns.includes(key)) return;
    const ids = new Set([...text.matchAll(/\[memory:([\w-]+)\]/gu)].map(match => match[1]));
    const usedAt = time();
    for (const id of ids) {
      const { item } = await access.show(binding, id);
      if (item && active(item)) {
        const entry = state.entries.find(row => row.id === item.id);
        updateEntry(state, { ...entry, usage: (entry.usage ?? 0) + 1, lastUsedAt: usedAt });
      }
    }
    state.turns.push(key);
    await commitState(state);
  }

  async function maintain() {
    if (!Number.isFinite(staleDays) || staleDays <= 0) return;
    const state = await snapshot();
    const updatedAt = time();
    const cutoff = Date.parse(updatedAt) - staleDays * day;
    const stale = state.entries.filter(entry => active(entry)
      && Date.parse(entry.lastUsedAt ?? entry.effectiveAt ?? entry.updatedAt) <= cutoff);
    if (!stale.length) return;
    for (const entry of stale) {
      updateEntry(state, { ...entry, status: 'stale', revision: entry.revision + 1, updatedAt }, 'withdraw');
    }
    indexFiles(state);
    await commitState(state);
  }

  return {
    access,
    write: (binding, request) => serialize(() => write(binding, request)),
    recordTurn: event => serialize(() => recordTurn(event)),
    maintain: () => serialize(maintain),
    rebuildIndex: () => serialize(async () => {
      const state = await snapshot();
      indexFiles(state);
      await commitState(state);
    }),
  };
}
