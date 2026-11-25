import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { link, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { adapterFor, openNative, openTranscript, regularPath, roles } from './transcript.mjs';

const sha256 = data => createHash('sha256').update(data).digest('hex');
const hex = /^[0-9a-f]{64}$/;
const keyOf = session => sha256(JSON.stringify([session.project, session.addr, session.sessionId ?? null]));
const archiveName = digest => join('.project', 'archive', `${digest}.jsonl`);
const entriesDir = (root, session) => join(root, '.project', 'handover', keyOf(session));

async function localDir(root, ...components) {
  let path = root;
  for (const component of components) {
    path = join(path, component);
    await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    if (await realpath(path) !== path) throw new Error('交接存储目录不可用');
  }
  return path;
}

async function jsonAt(path) {
  const physical = await regularPath(path);
  return physical === path ? JSON.parse(await readFile(path, 'utf8')) : null;
}

async function linkOnce(temporary, path) {
  try { await link(temporary, path); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}

function temporaryAt(dir) {
  return join(dir, `.${randomUUID()}.tmp`);
}

async function digest(file, temporary) {
  const before = await file.stat();
  if (!before.size) return null;
  const hash = createHash('sha256');
  let bytes = 0;
  const input = file.createReadStream({ autoClose: false, start: 0, end: before.size - 1 });
  async function* measure(source) {
    for await (const chunk of source) {
      hash.update(chunk);
      bytes += chunk.length;
      yield chunk;
    }
  }
  if (temporary) {
    await pipeline(input, measure, createWriteStream(temporary, { flags: 'wx', mode: 0o400, flush: true }));
  } else {
    for await (const chunk of input) {
      hash.update(chunk);
      bytes += chunk.length;
    }
  }
  const after = await file.stat();
  if (!bytes || before.size !== bytes || after.size !== bytes || before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs) return null;
  return { sha256: hash.digest('hex'), bytes };
}

function kindOf(event, payload) {
  const name = event.kind ?? event.type ?? event.method ?? payload.hook_event_name ?? payload.hookEventName;
  switch (name) {
    case 'session-end': case 'SessionEnd': case 'exited': case 'released': return 'session-end';
    case 'shift': case 'handover': return 'shift';
    case 'pre-compact': case 'PreCompact': case 'compaction_started': return 'pre-compact';
    case 'compact': case 'compact_boundary': case 'compacted': case 'PostCompact': case 'thread/compacted': return 'compact';
    case 'compaction_ended': return (event.outcome ?? payload.outcome) === 'completed' ? 'compact' : null;
    case 'system': case 'compaction': return event.subtype === 'compact_boundary' ? 'compact' : null;
    case 'event_msg': return payload.type === 'context_compacted' ? 'compact' : null;
    case 'item/started': return payload.item?.type === 'contextCompaction' ? 'pre-compact' : null;
    case 'item/completed': return payload.item?.type === 'contextCompaction' ? 'compact' : null;
    default: return null;
  }
}

function lifecycle(session, event) {
  const payload = event.payload ?? event.params ?? event;
  const kind = kindOf(event, payload);
  const nativeId = event.sessionId ?? event.session_id ?? payload.session_id ?? payload.sessionId ??
    payload.conversationId ?? payload.conversation_id ?? payload.threadId;
  if (!kind || (event.addr != null && event.addr !== session.addr) || event.isSidechain ||
      event.parentToolUseId || event.parent_tool_use_id || payload.agent_id || event.agentPath?.length ||
      (session.sessionId && nativeId && session.sessionId !== nativeId)) return null;
  const timestamp = event.at ?? event.receivedAt ?? event.timestamp ?? (kind === 'session-end' ? session.endedAt : undefined);
  const parsed = typeof timestamp === 'string' ? Date.parse(timestamp) : timestamp;
  const at = Number.isSafeInteger(parsed) ? parsed : Date.now();
  const identity = event.eventId ?? event.uuid ?? payload.item?.id ?? [event.streamId, event.seq, at];
  return {
    kind, at, id: sha256(JSON.stringify([kind, identity])),
    session: {
      ...session, sessionId: session.sessionId ?? nativeId,
      transcriptPath: event.transcriptPath ?? payload.transcript_path ?? payload.transcriptPath ?? session.transcriptPath,
    },
  };
}

// The daemon supplies confirmed root events and can retry an unavailable checkpoint after the native flush.
export async function recordLifecycle(projectDir, session, event, { mayLoseTranscript, locate = true } = {}) {
  if (!roles.includes(session?.role) || !event) return null;
  const observed = lifecycle(session, event);
  if (!observed) return null;
  const { id, kind, at, session: bound } = observed;
  const root = await realpath(projectDir);
  const location = entriesDir(root, bound);
  const manifest = join(location, `${id}.json`);
  const existing = await jsonAt(manifest);
  if (existing) return { status: 'recorded', record: existing };

  const source = await openNative(bound, { locate });
  if (!source) return { status: 'unavailable', reason: '原生会话记录不可用' };
  const provider = adapterFor(bound)?.id ?? bound.cli ?? bound.runtimeId;
  const archive = mayLoseTranscript ?? (provider === 'claude' || provider === 'agy');
  let copy;
  let pending;
  try {
    const fingerprint = await digest(source.file);
    if (!fingerprint) return { status: 'unavailable', reason: '原生会话记录尚未稳定' };
    const archivePath = archive ? archiveName(fingerprint.sha256) : null;
    if (archivePath) {
      const archived = await localDir(root, '.project', 'archive');
      const destination = join(root, archivePath);
      if (await regularPath(destination) !== destination) {
        copy = temporaryAt(archived);
        const written = await digest(source.file, copy);
        if (written?.sha256 !== fingerprint.sha256) return { status: 'unavailable', reason: '原生会话记录尚未稳定' };
        await linkOnce(copy, destination);
      }
    }

    const directory = await localDir(root, '.project', 'handover', keyOf(bound));
    pending = temporaryAt(directory);
    const record = {
      id, kind, at, project: bound.project, role: bound.role, addr: bound.addr, parent: bound.parent ?? null,
      sessionId: bound.sessionId ?? null, provider: provider ?? null, path: source.path, ...fingerprint, archivePath,
    };
    await writeFile(pending, JSON.stringify(record) + '\n', { flag: 'wx', mode: 0o600, flush: true });
    await linkOnce(pending, manifest);
    return { status: 'recorded', record: await jsonAt(manifest) };
  } finally {
    await source.file.close();
    if (copy) await rm(copy, { force: true });
    if (pending) await rm(pending, { force: true });
  }
}

export async function retainedRecords(projectDir, session) {
  const dir = entriesDir(await realpath(projectDir), session);
  try {
    if (await realpath(dir) !== dir) return [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const names = await readdir(dir);
  const records = await Promise.all(names.filter(name => /^[0-9a-f]{64}\.json$/.test(name))
    .map(name => jsonAt(join(dir, name)).catch(() => null)));
  return records.filter(row => row?.project === session.project && row.addr === session.addr &&
    row.sessionId === (session.sessionId ?? null) && hex.test(row.sha256) && Number.isSafeInteger(row.at))
    .sort((a, b) => b.at - a.at || b.bytes - a.bytes);
}

export async function readRetained(projectDir, session) {
  const root = await realpath(projectDir);
  for (const record of await retainedRecords(root, session)) {
    const archived = record.archivePath === archiveName(record.sha256) ? join(root, record.archivePath) : null;
    const paths = [record.path];
    if (archived && await regularPath(archived) === archived) paths.push(archived);
    for (const path of paths) {
      const source = await openTranscript(path).catch(() => null);
      if (!source) continue;
      try {
        const bytes = await source.file.readFile();
        if (sha256(bytes) === record.sha256) return { path: source.path, text: bytes.toString('utf8') };
      } finally { await source.file.close(); }
    }
  }
  return null;
}
