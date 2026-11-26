import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createAccess } from './access.mjs';
import { itemPath, renderEntry, validateEntry, validateEntryFormat } from './format.mjs';
import { isShortMemoryId } from './index-row.mjs';
import { eventMemoryId, isLegacyMechanicalMemory, ledgerRulings, rulingPath } from './ledger.mjs';
import { sanitizeEntry } from './sanitize.mjs';

const day = 86_400_000;
const decisions = new Map([
  ['promote', 'promoted'], ['merge', 'merged'], ['return', 'returned'], ['reject', 'rejected'],
]);
const bodyWrites = new Set(['put', 'propose', 'promote', 'merge', 'import_rulings']);
const invalid = error => ({ ok: false, code: 'invalid', error });
const forbidden = () => ({ ok: false, code: 'forbidden', error: 'Memory write is forbidden' });
const conflict = currentRevision => ({ ok: false, code: 'conflict', error: 'Memory revision changed', currentRevision });
const nonempty = value => typeof value === 'string' && value.trim() !== '';
const active = entry => entry.status === 'active';
const receiptKey = (scope, requestId) => JSON.stringify([scope, requestId]);

function select(source, fields) {
  return Object.fromEntries(fields.filter(key => source[key] !== undefined).map(key => [key, source[key]]));
}

function requestFingerprint({ requestId, ...content }) {
  try {
    const canonical = JSON.stringify(content, (_key, value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]));
    });
    return createHash('sha256').update(canonical).digest('hex');
  } catch {
    return undefined;
  }
}

function draftFields(entry, externalSource) {
  const fields = select(entry, ['kind', 'layer', 'project', 'proposedKind', 'title', 'body',
    'keywords', 'paths', 'topics', 'importance', 'checkedAt']);
  const { source } = entry;
  return { ...fields, source: source && typeof source === 'object' && !Array.isArray(source)
    ? select(source, ['path', 'sha']) : source, externalSource };
}

function sameFact(a, b) {
  const key = ({ kind, layer, project, owner, author, cardId, proposedKind, title, body,
    keywords = [], paths = [], topics = [], importance = 0, source, externalSource = [] }) => JSON.stringify([
    kind, layer, project, owner, kind === 'candidate' ? [author, cardId, proposedKind] : null,
    title, body, keywords, paths, topics, importance, source?.path, source?.sha, externalSource,
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

function forgetMarker(entry, revision) {
  return { ...select(entry, ['id', 'project', 'layer', 'kind', 'owner', 'cardId', 'proposedKind']),
    revision, status: 'forgotten' };
}

function purge(state, entry) {
  const tombstone = forgetMarker(entry, entry.revision + 1);
  const replacements = new Map([[entry.id, tombstone]]);
  const links = { ...candidateTargets(state.receipts), ...state.candidateTargets };
  for (const [id, target] of Object.entries(links)) {
    if (target !== entry.id || replacements.has(id)) continue;
    const candidate = state.entries.find(row => row.id === id);
    if (!candidate || !['promoted', 'merged'].includes(candidate.status)) continue;
    const marker = candidate.status === 'merged' ? forgetMarker(candidate, candidate.revision + 1)
      : select(candidate, ['id', 'revision', 'project', 'layer', 'kind', 'status', 'author',
        'cardId', 'proposedKind', 'reviewer']);
    replacements.set(id, marker);
    state.entries[state.entries.indexOf(candidate)] = marker;
    delete state.files[itemPath(id)];
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

function candidateTargets(receipts) {
  return Object.fromEntries(receipts.flatMap(({ response }) => {
    const candidate = response.candidate;
    return ['promoted', 'merged'].includes(candidate?.status) && response.item?.id
      ? [[candidate.id, response.item.id]] : [];
  }));
}

export function createMemoryStore({ now = Date.now, readState, commitState, evidence, allocateId,
  estimateTokens, maxMetadataBytes, staleDays, getObservations, classifySensitive, replacement, readRaw,
  receiptTtlMs = 30 * day, eventProject } = {}) {
  if (!Number.isFinite(receiptTtlMs) || receiptTtlMs < 0) throw new RangeError('Invalid memory receipt TTL');
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
    return rows.map(row => ({
      ...select(row, ['id', 'project', 'layer', 'role', 'owner', 'author', 'cardId', 'title', 'body', 'asOf']),
      sessionId: row.sessionId ?? sessionId,
    }));
  }

  const access = createAccess({ readState, commitState, serialize, history: readRaw ? history : undefined,
    now, ...redaction });

  async function snapshot() {
    return { entries: [], changes: [], seq: 0, files: {}, receipts: [], grants: [], turns: [], nextId: 0,
      ...structuredClone(await readState?.()) };
  }

  const time = () => new Date(now()).toISOString();

  function allocate(state) {
    let id;
    do { id = allocateId?.() ?? `memory-${++state.nextId}`; }
    while (state.entries.some(entry => entry.id === id));
    return id;
  }

  async function prepare(fields, knownHist, validation = format) {
    const raw = validateEntryFormat(fields, validation);
    if (!raw.ok) return raw;
    const safe = sanitizeEntry(fields, redaction);
    if (!safe.ok) return safe;
    if (['project', 'layer', 'kind', 'proposedKind'].some(key => safe.entry[key] !== fields[key])) {
      return invalid('Invalid memory scope or kind');
    }
    if (safe.entry.source?.path !== fields.source?.path || safe.entry.source?.sha !== fields.source?.sha) {
      return invalid('Memory evidence could not be reliably redacted');
    }
    if (fields.source?.hist && (safe.entry.source?.hist?.addr !== fields.source.hist.addr ||
        safe.entry.source?.hist?.turnId !== fields.source.hist.turnId)) {
      return invalid('Memory history could not be reliably redacted');
    }
    const result = await validateEntry(safe.entry, knownHist ? { ...validation, evidence: {
      ...evidence,
      hasHist: hist => hist.addr === knownHist.addr && hist.turnId === knownHist.turnId,
    } } : validation);
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
    const { id, entry, expectedRevision, op, supersedeExpectedRevisions } = request;
    if (id != null && !current) return forbidden();
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return invalid('Invalid memory entry');
    const candidate = op === 'propose';
    const permitted = candidate ? access.canPropose : access.canRevise;
    const scope = { ...entry, owner: binding.principal, author: binding.principal, cardId: binding.cardId };
    if (!permitted(binding, { ...scope, status: current?.status }) || (current && (!permitted(binding, current)
      || current.project !== scope.project || current.layer !== scope.layer || current.kind !== scope.kind))) return forbidden();
    if (current && (candidate ? !['pending', 'returned'].includes(current.status)
      : !['active', 'stale'].includes(current.status))) return invalid('Memory entry cannot be revised');
    const requested = entry.supersedes;
    if (requested !== undefined && (candidate || !Array.isArray(requested) || !Array.from(requested).every(nonempty))) {
      return invalid('Invalid memory replacement');
    }
    const existing = new Set(current?.supersedes);
    const targets = [];
    for (const targetId of new Set(requested)) {
      const retained = existing.has(targetId);
      const revision = supersedeExpectedRevisions != null && Object.hasOwn(supersedeExpectedRevisions, targetId)
        ? supersedeExpectedRevisions[targetId] : undefined;
      if (retained && revision === undefined) continue;
      const target = state.entries.find(row => row.id === targetId);
      if (!access.canWrite(binding, target)) return forbidden();
      if (target.id === id || target.layer !== scope.layer) {
        return invalid('Invalid memory replacement target');
      }
      if (target.status === 'superseded' && Number.isSafeInteger(revision) && revision < target.revision) {
        return conflict(target.revision);
      }
      if (retained) continue;
      if (!['active', 'stale'].includes(target.status)) {
        return invalid('Invalid memory replacement target');
      }
      targets.push({ target, revision });
    }
    const mismatch = expected(expectedRevision, current);
    if (mismatch) return mismatch;
    for (const { target, revision } of targets) {
      const targetMismatch = expected(revision, target);
      if (targetMismatch) return targetMismatch;
    }
    const supersedes = [...existing, ...targets.map(({ target }) => target.id)];
    const extra = current ? select(current, ['original', 'proposer', 'reviewer']) : {};
    if (requested !== undefined || current?.supersedes !== undefined) extra.supersedes = supersedes;
    const draft = draftFields(entry, await observations(binding));
    const hist = current?.source?.hist;
    if (hist && draft.source && draft.source.path === current.source.path && draft.source.sha === current.source.sha) {
      draft.source.hist = hist;
    }
    const fields = await prepare(draft, hist);
    if (!fields.ok) return fields;
    if (!current && !targets.length) {
      const duplicate = state.entries.find(row => (candidate ? row.status === 'pending' : active(row))
        && sameFact(row, { ...fields.entry, owner: entry.layer === 'private' ? binding.principal : undefined,
          author: binding.principal, cardId: binding.cardId }));
      if (duplicate) return success({ item: duplicate }, 'duplicate');
    }
    const item = version(state, binding, fields.entry, current, extra);
    const formatResult = validateEntryFormat(item, format);
    if (!formatResult.ok) return formatResult;
    for (const { target } of targets) {
      const replaced = { ...target, status: 'superseded', revision: target.revision + 1,
        updatedAt: item.updatedAt, supersededBy: [...(target.supersededBy ?? []), item.id] };
      const result = validateEntryFormat(replaced, format);
      if (!result.ok) return result;
      updateEntry(state, replaced, active(target) ? 'withdraw' : null);
    }
    updateEntry(state, item, candidate ? null : active(current ?? {}) ? 'update' : 'add');
    return success({ item }, candidate ? 'candidate' : 'accepted');
  }

  async function review(state, binding, request, current, success) {
    const { cardId, expectedRevision, op } = request;
    if (!access.canReview(binding, current) || !cardId || cardId !== current.cardId) return forbidden();
    const status = decisions.get(op);
    if (op !== 'merge' && current.status === status) {
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
      const externalSource = [...new Map([...(target.externalSource ?? []), ...(current.externalSource ?? []),
        ...await observations(binding)]
        .map(observation => [JSON.stringify(observation), observation])).values()];
      const fields = await prepare({ ...draftFields({ ...target, body: request.body }, externalSource), source: target.source },
        target.source?.hist);
      if (!fields.ok) return fields;
      item = version(state, binding, fields.entry, target, {
        ...select(target, ['original', 'supersedes']), proposer: current.author, reviewer: binding.principal,
      });
      const result = validateEntryFormat(item, format);
      if (!result.ok) return result;
      updateEntry(state, item, 'update');
    }
    if (item !== candidate) (state.candidateTargets ??= {})[candidate.id] = item.id;
    updateEntry(state, candidate);
    return success({ item, candidate });
  }

  function replayMerge(state, binding, request, current, success) {
    if (!access.canReview(binding, current) || !request.cardId || request.cardId !== current.cardId) return forbidden();
    if (current.status === 'forgotten') return conflict(current.revision);
    // The original receipt keeps the redacted merge result even when the target is revised.
    const merged = state.receipts.find(({ response }) => response.candidate?.id === current.id
      && response.candidate.status === 'merged' && response.candidate.revision === current.revision)?.response;
    if (!merged || merged.item.id !== request.targetId || typeof request.body !== 'string') {
      return conflict(current.revision);
    }
    const safe = sanitizeEntry({ body: request.body }, redaction);
    if (!safe.ok) return safe;
    if (safe.entry.body !== merged.item.body) return conflict(current.revision);
    if (request.expectedRevision !== current.revision - 1 && request.expectedRevision !== current.revision) {
      return conflict(current.revision);
    }
    return success(select(merged, ['item', 'candidate']));
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
    const { op, id, expectedRevision, requestId } = request;
    const state = await snapshot();
    const scope = JSON.stringify([binding.sessionId, binding.principal, binding.role, binding.project, binding.cardId]);
    const prior = state.receipts.find(row => row.scope === scope && row.requestId === requestId);
    const fingerprint = requestFingerprint(request);
    const key = receiptKey(scope, requestId);
    if (state.expiredReceipts && Object.hasOwn(state.expiredReceipts, key)) {
      const identical = fingerprint !== undefined && fingerprint === state.expiredReceipts[key];
      return { ok: false, code: 'conflict', error: identical ? 'Memory request receipt has expired' :
        'Memory request ID was already used' };
    }
    if (prior && (fingerprint === undefined || fingerprint !== prior.fingerprint)) {
      return { ok: false, code: 'conflict', error: 'Memory request ID was already used' };
    }
    if (bodyWrites.has(op) && typeof classifySensitive !== 'function') {
      return { ok: false, code: 'classifier-missing', error: 'Memory sensitivity classifier is required' };
    }
    if (fingerprint === undefined) return invalid('Invalid memory request content');
    const success = (fields, status = 'accepted') => ({ ok: true, ...fields, receipt: { requestId, status } });
    let current = state.entries.find(entry => entry.id === id);
    const forgottenMerge = op === 'merge' && current?.status === 'forgotten';
    if (prior && !forgottenMerge) return prior.response;
    let resolved = request;
    if (isShortMemoryId(id) && (op === 'put' || op === 'forget')) {
      const match = access.resolveShortId(binding, state, id);
      if (!match.item) return { ok: false, code: match.code, error: match.error };
      current = match.item;
      resolved = { ...request, id: current.id };
    }
    const before = state.seq;
    let result;
    if (forgottenMerge || (op === 'merge' && current?.status === 'merged')) {
      result = replayMerge(state, binding, request, current, success);
    } else if (op === 'put' || op === 'propose') result = await put(state, binding, resolved, current, success);
    else if (decisions.has(op)) result = await review(state, binding, request, current, success);
    else if (op === 'import_rulings') result = await importRulings(state, binding, request, success);
    else if (op === 'forget') {
      if (!access.canForget(binding, current)) return forbidden();
      const mismatch = expected(expectedRevision, current);
      if (mismatch) return mismatch;
      const item = current.status === 'forgotten' ? current : purge(state, current);
      result = success({ item });
    } else return invalid('Unknown memory write operation');
    if (!result.ok) return result;
    if (state.seq !== before) indexFiles(state);
    state.receipts.push({ scope, requestId, fingerprint, response: result, committedAt: now() });
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
      const { item } = await access.show(binding, id).catch(error => {
        if (error.code === 'not-found' || error.code === 'ambiguous') return {};
        throw error;
      });
      if (item && active(item)) {
        const entry = state.entries.find(row => row.id === item.id);
        updateEntry(state, { ...entry, usage: (entry.usage ?? 0) + 1, lastUsedAt: usedAt });
      }
    }
    state.turns.push(key);
    await commitState(state);
  }

  async function maintain() {
    const state = await snapshot();
    const at = now();
    let receiptsChanged = false;
    const links = candidateTargets(state.receipts);
    state.receipts = state.receipts.filter(row => {
      // Old snapshots have no commit timestamp. Give them one retention window from first upkeep.
      if (!Number.isFinite(row.committedAt)) {
        row.committedAt = at;
        receiptsChanged = true;
      }
      const retained = at - row.committedAt < receiptTtlMs;
      if (!retained) {
        (state.expiredReceipts ??= {})[receiptKey(row.scope, row.requestId)] = row.fingerprint ?? null;
        receiptsChanged = true;
      }
      return retained;
    });
    const cutoff = at - staleDays * day;
    const stale = Number.isFinite(staleDays) && staleDays > 0 ? state.entries.filter(entry => active(entry)
      && entry.source?.path !== rulingPath
      && Date.parse(entry.lastUsedAt ?? entry.effectiveAt ?? entry.updatedAt) <= cutoff) : [];
    const migrated = eventProject ? state.entries.filter(entry => ['active', 'stale'].includes(entry.status) &&
      entry.withdrawnBy !== 'legacy-mechanical-memory' && isLegacyMechanicalMemory(eventProject, entry)) : [];
    if (!stale.length && !migrated.length && !receiptsChanged) return;
    if (Object.keys(links).length) state.candidateTargets = { ...links, ...state.candidateTargets };
    const updatedAt = new Date(at).toISOString();
    const retired = new Set(migrated);
    for (const entry of new Set([...stale, ...migrated])) {
      updateEntry(state, { ...entry, status: 'stale', revision: entry.revision + 1, updatedAt,
        ...(retired.has(entry) && { withdrawnBy: 'legacy-mechanical-memory' }) }, 'withdraw');
    }
    if (stale.length || migrated.length) indexFiles(state);
    await commitState(state);
  }

  async function syncLedger(text) {
    if (!eventProject || typeof classifySensitive !== 'function') return invalid('Memory ledger is unavailable');
    const state = await snapshot();
    const current = new Map(state.entries.map(item => [item.id, item]));
    const parsed = ledgerRulings(eventProject, text);
    const ledger = new Map(parsed.map(item => [item.id, item]));
    const incoming = new Map();
    const updatedAt = time();
    // Ledger entries preserve the source quote, including rulings longer than a manual note.
    const validation = { ...format, estimateTokens: () => 0 };
    const before = state.seq;
    let changed = false;
    for (const { id, supersedes } of parsed) {
      if (current.get(id)?.status === 'forgotten') continue;
      for (const target of supersedes) {
        if (!incoming.has(target)) incoming.set(target, []);
        incoming.get(target).push(id);
      }
    }
    for (const { id, title, body, supersedes, continuationOf } of parsed) {
      const prior = current.get(id);
      if (prior?.status === 'forgotten') continue;
      if (prior && (prior.kind !== 'ruling' || prior.layer !== 'user' || prior.source?.path !== rulingPath)) {
        return invalid('Memory ledger ID is in use');
      }
      const date = /\b\d{4}-\d{2}-\d{2}\b/u.exec(body)?.[0];
      const draft = { title, body, kind: 'ruling', layer: 'user', project: null,
        checkedAt: Number.isFinite(Date.parse(date)) ? date + 'T00:00:00.000Z' : prior?.checkedAt ?? updatedAt,
        source: prior?.source ?? { path: rulingPath } };
      const fields = await prepare(draft, prior?.source?.hist, validation);
      if (!fields.ok) return fields;
      const replacedBy = [...new Set([...(prior?.supersededBy ?? []).filter(id => !ledger.has(id) ||
        current.get(id)?.status === 'forgotten'), ...(incoming.get(id) ?? [])])];
      const next = { ...(prior ?? version(state, { principal: 'super', role: 'super' }, fields.entry, { id, revision: 0 })),
        ...fields.entry, status: replacedBy.length ? 'superseded' : prior?.status === 'stale' ? 'stale' : 'active' };
      if (supersedes.length || prior?.supersedes) next.supersedes = supersedes;
      if (replacedBy.length || prior?.supersededBy) next.supersededBy = replacedBy;
      if (continuationOf) next.continuationOf = continuationOf;
      if (isDeepStrictEqual(prior, next)) continue;
      const item = { ...next, revision: (prior?.revision ?? 0) + 1, updatedAt };
      const result = validateEntryFormat(item, validation);
      if (!result.ok) return result;
      updateEntry(state, item, active(item) ? (prior && active(prior) ? 'update' : 'add') :
        prior && active(prior) ? 'withdraw' : null);
      changed = true;
    }
    if (state.seq !== before) indexFiles(state);
    if (changed) await commitState(state);
    return { ok: true };
  }

  // Internal event ingestion, callable only with a history verifier supplied by the daemon.
  async function recordEvent(binding, key, entry) {
    if (typeof classifySensitive !== 'function') return invalid('Memory sensitivity classifier is required');
    const allowed = access.canWrite(binding, entry) || (binding?.role === 'worker' && binding.cardId &&
      entry.project === binding.project && entry.layer === 'shared' && entry.kind === 'lesson');
    if (!allowed || !nonempty(key) || !entry.source?.hist) return forbidden();
    const id = eventMemoryId(key);
    const state = await snapshot();
    if (state.entries.some(item => item.id === id)) return { ok: true };
    const fields = await prepare({ ...draftFields(entry, await observations(binding)), source: entry.source });
    if (!fields.ok) return fields;
    const item = version(state, binding, fields.entry, { id, revision: 0 });
    const result = validateEntryFormat(item, format);
    if (!result.ok) return result;
    updateEntry(state, item, 'add');
    indexFiles(state);
    await commitState(state);
    return { ok: true, item };
  }

  async function withdrawReviewed(binding, revisions, requestId) {
    const state = await snapshot();
    const targets = Object.entries(revisions).map(([id, revision]) => ({
      revision, entry: state.entries.find(item => item.id === id),
    }));
    if (binding.role !== 'super' || !targets.length ||
        targets.some(({ entry }) => entry?.layer !== 'user' || !access.canWrite(binding, entry))) return forbidden();
    if (targets.every(({ entry }) => entry.withdrawnBy === requestId)) return { ok: true };
    for (const { entry, revision } of targets) {
      if (entry.revision !== revision || entry.status !== 'active') return conflict(entry.revision);
    }
    for (const { entry } of targets) {
      updateEntry(state, { ...entry, revision: entry.revision + 1, status: 'stale',
        updatedAt: time(), withdrawnBy: requestId }, 'withdraw');
    }
    indexFiles(state);
    await commitState(state);
    return { ok: true };
  }

  return {
    access,
    write: (binding, request) => serialize(() => write(binding, request)),
    recordEvent: (binding, key, entry) => serialize(() => recordEvent(binding, key, entry)),
    syncLedger: text => serialize(() => syncLedger(text)),
    withdrawReviewed: (binding, revisions, requestId) => serialize(() => withdrawReviewed(binding, revisions, requestId)),
    recordTurn: event => serialize(() => recordTurn(event)),
    maintain: () => serialize(maintain),
    rebuildIndex: () => serialize(async () => {
      const state = await snapshot();
      indexFiles(state);
      await commitState(state);
    }),
  };
}
