import { createHash } from 'node:crypto';

const sourceOf = ({ sessionId, fileId, generation }) => ({ sessionId, fileId, generation });
const sourceKey = ({ sessionId, fileId, generation }) => JSON.stringify([sessionId, fileId, generation]);
const timestamp = clock => new Date(clock()).toISOString();
const stableId = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const isOffset = offset => Number.isSafeInteger(offset) && offset >= 0;

function serialize() {
  let pending = Promise.resolve();
  return operation => {
    const result = pending.then(operation);
    pending = result.catch(() => {});
    return result;
  };
}

export function createCellShipper({ readCheckpoint, writeCheckpoint }) {
  const partials = new Map();
  const run = serialize();
  return {
    ingest: chunk => run(async () => {
      const source = sourceOf(chunk);
      const key = sourceKey(source);
      const checkpoint = await readCheckpoint(source) ?? 0;
      let start = chunk.start;
      let bytes = Buffer.from(chunk.bytes);
      const end = start + bytes.length;
      if (!isOffset(start) || !isOffset(end)) throw new RangeError('Invalid chunk range');

      const partial = partials.get(key);
      if (end <= checkpoint || bytes.length === 0) return [];
      if (start < checkpoint) {
        bytes = bytes.subarray(checkpoint - start);
        start = checkpoint;
      }
      if (partial && end >= partial.start) {
        const partialEnd = partial.start + partial.bytes.length;
        if (start > partialEnd) throw new RangeError('Gap after partial line');
        const overlapStart = Math.max(start, partial.start);
        const overlapEnd = Math.min(end, partialEnd);
        if (!bytes.subarray(overlapStart - start, overlapEnd - start)
          .equals(partial.bytes.subarray(overlapStart - partial.start, overlapEnd - partial.start))) {
          throw new Error('Source bytes changed within a generation');
        }
        if (start > partial.start) {
          bytes = Buffer.concat([partial.bytes.subarray(0, start - partial.start), bytes]);
          start = partial.start;
        }
        if (end < partialEnd) {
          bytes = Buffer.concat([bytes, partial.bytes.subarray(end - partial.start)]);
        }
      }

      const complete = bytes.lastIndexOf(0x0a) + 1;
      if (!partial || end >= partial.start) {
        if (complete === bytes.length) partials.delete(key);
        else partials.set(key, { start: start + complete, bytes: Buffer.from(bytes.subarray(complete)) });
      } else if (complete !== bytes.length) {
        throw new RangeError('Incomplete replay before partial line');
      }
      return complete ? [{ ...source, start, end: start + complete, bytes: bytes.subarray(0, complete) }] : [];
    }),
    acknowledge: ack => run(async () => {
      const source = sourceOf(ack);
      const { contiguousEnd } = ack;
      if (!isOffset(contiguousEnd)) throw new RangeError('Invalid ACK offset');
      const checkpoint = await readCheckpoint(source) ?? 0;
      if (contiguousEnd <= checkpoint) return;
      await writeCheckpoint(source, contiguousEnd);
      const key = sourceKey(source);
      const partial = partials.get(key);
      if (partial && contiguousEnd > partial.start) {
        // An earlier replay may have already committed this line at home.
        partials.delete(key);
      }
    }),
  };
}

function contiguousEnd(rows, start) {
  let end = start;
  for (const row of rows) {
    if (row.start > end) break;
    end = Math.max(end, row.end);
  }
  return end;
}

function byOffset(a, b) {
  return a.start - b.start;
}

export function createHomeShipper({ clock, readRaw, appendRaw, recordConflict, readRetainedEnd }) {
  const run = serialize();
  return {
    receive: batch => run(async () => {
      const source = sourceOf(batch);
      const { start, end } = batch;
      const bytes = Buffer.from(batch.bytes);
      if (!isOffset(start) || !isOffset(end) || end <= start || end - start !== bytes.length ||
        bytes.at(-1) !== 0x0a) {
        throw new RangeError('Invalid complete-line batch');
      }

      const base = await readRetainedEnd?.(source) ?? 0;
      const rows = (await readRaw(source)).filter(row => sourceKey(row) === sourceKey(source)).sort(byOffset);
      const ack = committed => ({ ...source, contiguousEnd: contiguousEnd(committed, base) });
      let next = Math.max(start, base);
      const missing = [];
      for (const row of rows) {
        const from = Math.max(start, row.start);
        const to = Math.min(end, row.end);
        if (from >= to) continue;
        if (!bytes.subarray(from - start, to - start)
          .equals(Buffer.from(row.bytes).subarray(from - row.start, to - row.start))) {
          await recordConflict({ ...source, start, end, at: timestamp(clock) });
          return ack(rows);
        }
        if (next < from) missing.push([next, from]);
        next = Math.max(next, to);
      }
      if (next < end) missing.push([next, end]);
      if (missing.length === 0) return ack(rows);

      const receivedAt = timestamp(clock);
      const additions = missing.map(([from, to]) => {
        if ((from !== start && bytes[from - start - 1] !== 0x0a) || bytes[to - start - 1] !== 0x0a) {
          throw new RangeError('Overlapping ranges do not align on line boundaries');
        }
        return { ...source, start: from, end: to, bytes: bytes.subarray(from - start, to - start),
          confirmed: true, receivedAt };
      });
      await appendRaw(additions);
      return ack(rows.concat(additions).sort(byOffset));
    }),
  };
}

export function createOpenCodeAdapter({ clock, readPage, readAppended, append }) {
  const run = serialize();
  const recordKey = (id, version) => JSON.stringify([id, version]);

  return {
    project: sessionId => run(async () => {
      const existing = await readAppended(sessionId);
      const seen = new Set(existing.map(row => recordKey(row.nativeId, row.version)));
      const additions = [];
      const cursors = new Set();
      let cursor = null;
      do {
        if (cursors.has(cursor)) throw new Error('OpenCode pagination repeated a cursor');
        cursors.add(cursor);
        const { records, nextCursor } = await readPage({ sessionId, cursor });
        for (const record of records) {
          const { id: nativeId, version } = record;
          const key = recordKey(nativeId, version);
          if (seen.has(key)) continue;
          seen.add(key);
          additions.push({ sessionId, nativeId, version, id: stableId(sessionId, nativeId, version),
            record: structuredClone(record), at: timestamp(clock) });
        }
        cursor = nextCursor ?? null;
      } while (cursor !== null);
      if (additions.length) await append(additions);
      return additions.length;
    }),
  };
}

export function createHistoryPublisher({
  clock, publishEvidence, deliverDone, performCleanup,
  turns = new Map(), acks = new Map(), intents = new Map(),
}) {
  const run = serialize();

  async function publish(turn) {
    const { event, publicationId } = turn;
    if ((acks.get(sourceKey(event)) ?? 0) < event.end) return;
    // Stable IDs let the sinks deduplicate a retry after a committed write.
    if (!turn.evidencePublished) {
      await publishEvidence({ ...event, publicationId, at: turn.at });
      turn.evidencePublished = true;
    }
    if (!turn.doneDelivered) {
      await deliverDone({ turnId: event.turnId, deliveryId: event.deliveryId, publicationId });
      turn.doneDelivered = true;
    }
  }

  function ready(intent) {
    return !intent.cleaned && turns.get(intent.action.turnId)?.doneDelivered;
  }

  return {
    completeTurn: event => run(async () => {
      const { turnId, deliveryId, start, end } = event;
      if (!isOffset(start) || !isOffset(end) || end <= start) throw new RangeError('Invalid turn range');
      const publicationId = stableId(sourceKey(event), turnId, deliveryId, start, end);
      if (!turns.has(turnId)) turns.set(turnId, { event: { ...event }, publicationId, at: timestamp(clock) });
      const turn = turns.get(turnId);
      if (turn.publicationId !== publicationId) throw new Error('Turn already has a different raw range');
      await publish(turn);
    }),
    acknowledge: ack => run(async () => {
      const key = sourceKey(ack);
      if (!isOffset(ack.contiguousEnd)) throw new RangeError('Invalid ACK offset');
      acks.set(key, Math.max(acks.get(key) ?? 0, ack.contiguousEnd));
      for (const turn of turns.values()) {
        if (sourceKey(turn.event) === key) await publish(turn);
      }
    }),
    requestCleanup: ({ turnId, paths }) => run(() => {
      const id = stableId('cleanup', turnId);
      if (!intents.has(id)) intents.set(id, { action: { id, turnId, paths: [...paths] }, cleaned: false });
    }),
    pendingCleanup: () => run(() => [...intents.values()].filter(ready)
      .map(intent => structuredClone(intent.action))),
    runCleanup: id => run(async () => {
      const intent = intents.get(id);
      if (!intent || !ready(intent)) return;
      await performCleanup(structuredClone(intent.action));
      intent.cleaned = true;
    }),
  };
}

function nativeRecords(row) {
  const records = [];
  for (const line of Buffer.from(row.bytes).toString('utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (record && typeof record === 'object') records.push(record);
    } catch {
      // A malformed raw line remains available for inspection.
    }
  }
  return records;
}

function timeValue(value) {
  const time = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function rowTime(row) {
  let latest = null;
  for (const record of nativeRecords(row)) {
    const time = timeValue(record.at);
    if (time !== null && (latest === null || time > latest)) latest = time;
  }
  return latest ?? timeValue(row.receivedAt ?? row.at);
}

export function createHistoryStore({
  clock, retention = {}, readRaw, deleteRaw, readGit, derived = new Map(), retentionBoundaries = new Map(),
}) {
  const run = serialize();

  async function rebuild(sessionId) {
    const raw = await readRaw(sessionId);
    const streams = new Map();
    for (const row of raw) {
      if (row.sessionId !== sessionId || row.confirmed !== true) continue;
      const key = sourceKey(row);
      if (!streams.has(key)) streams.set(key, []);
      streams.get(key).push(row);
    }
    const turns = [];
    const gaps = [];
    for (const rows of streams.values()) {
      for (const row of rows.sort(byOffset)) {
        for (const record of nativeRecords(row)) {
          if (record.type !== 'turn.completed') continue;
          const at = timeValue(record.at);
          const turn = { ...record, at: at === null ? null : new Date(at).toISOString() };
          if (record.gitSha) {
            const git = await readGit(record.gitSha);
            if (git) {
              turn.diff = git.diff;
            } else {
              turn.gap = { turnId: record.turnId, kind: 'missing-git-object', sha: record.gitSha };
              gaps.push(turn.gap);
            }
          }
          turns.push(turn);
        }
      }
    }
    turns.sort((a, b) => (timeValue(a.at) ?? 0) - (timeValue(b.at) ?? 0));
    const boundaries = [...retentionBoundaries.values()].filter(row => row.sessionId === sessionId);
    const [boundary] = boundaries;
    const result = { turns, gaps, retentionBoundary: boundary ? { start: boundary.start } : null };
    if (boundaries.length > 1) result.retentionBoundaries = boundaries;
    derived.set(sessionId, result);
    return result;
  }

  async function scanRetention() {
    const { maxAgeMs = Infinity, maxBytes = Infinity } = retention;
    const cutoff = clock() - maxAgeMs;
    const raw = await readRaw();
    let size = raw.reduce((total, row) => total + row.bytes.length, 0);
    const candidates = raw.filter(row => row.confirmed === true).map(row => ({ row, at: rowTime(row) }));
    // Age comes from the newest event in the range. Unknown ages still count toward the byte budget.
    candidates.sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity) || byOffset(a.row, b.row));
    const expired = [];
    for (const { row, at } of candidates) {
      if ((at !== null && at < cutoff) || size > maxBytes) {
        expired.push(row);
        size -= row.bytes.length;
      }
    }
    if (expired.length) await deleteRaw(expired);

    const affected = new Set();
    for (const row of expired) {
      const key = sourceKey(row);
      const boundary = retentionBoundaries.get(key);
      retentionBoundaries.set(key, { ...sourceOf(row), start: Math.max(row.end, boundary?.start ?? 0) });
      affected.add(row.sessionId);
    }
    for (const sessionId of affected) derived.delete(sessionId);
    return expired.length;
  }

  return {
    rebuild: sessionId => run(async () => structuredClone(await rebuild(sessionId))),
    query: sessionId => run(async () => structuredClone(derived.get(sessionId) ?? await rebuild(sessionId))),
    scanRetention: () => run(scanRetention),
  };
}
