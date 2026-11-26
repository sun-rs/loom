import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, linkSync, lstatSync, readFileSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { controllerFile, releaseRoot } from './release.mjs';
import { hostDirectory, hostMethods, hostProtocol, hostSocket, hostUUID, privateHostSocket,
  readJSON, receiveHostLine } from './host-control.mjs';
import { jsonRows, prepareJournal, syncDirectory, writeState } from './io.mjs';
import { oarControl, oarSnapshot, openOar, trackOar } from './oar.mjs';
import { processTable } from './processes.mjs';
import { closeHostChildren, disposeSession, ownedHostChildren, withDeadline } from './session-close.mjs';
import { idleForRelease } from './worker-retention.mjs';

const oarVersion = () => JSON.parse(readFileSync(new URL('../package.json', import.meta.resolve('@botiverse/oar')))).version;
const refused = (message, kind = 'input-refused') => Object.assign(new Error(message), { kind });
const controlTimeoutMs = 10_000;

export async function main(project, addr, incarnation, release, { ownerGraceMs = 300_000, checkIntervalMs = 2_000 } = {}) {
  if (!/^oar-/.test(addr) || !hostUUID.test(addr.slice(4)) || !hostUUID.test(incarnation)) throw new Error('Invalid host identity');
  const dir = hostDirectory(project, addr, incarnation);
  const directory = lstatSync(dir);
  const { row } = readJSON(join(dir, 'launch.json'));
  if (row.addr !== addr || row.backend !== 'headless') throw new Error('Invalid host launch intent');
  const path = hostSocket(project, addr, incarnation);
  const identity = (await processTable([process.pid])).get(process.pid);
  if (!identity || identity.pgid !== identity.pid) throw new Error('Detached session host process identity unavailable');
  const binding = { incarnation, identity, project, addr, release, root: releaseRoot, oar: oarVersion() };
  const owner = join(dir, 'owner.json');
  const staging = join(dir, randomUUID() + '.owner');
  writeState(staging, JSON.stringify(binding));
  try { linkSync(staging, owner); }
  catch (error) { if (error.code === 'EEXIST') return; throw error; }
  finally { unlinkSync(staging); }
  syncDirectory(dir);
  if (readJSON(join(dir, 'cancelled.json'))) return;

  let session;
  let runtime;
  let server;
  let listening = false;
  let endedAt;
  let closing;
  let stopRequested = false;
  let ownerTimer;
  let lastOwnerAt;
  let stalled;
  let controller = readJSON(join(dir, 'controller.json'));
  let chain = Promise.resolve();
  const journal = join(dir, 'requests.jsonl');
  const receipts = new Map();
  const save = receipt => {
    appendFileSync(journal, JSON.stringify(receipt) + '\n', { mode: 0o600, flush: true });
    receipts.set(receipt.key, receipt);
  };
  let transcript;
  let lastTranscriptCheck = 0;
  let locating;
  function unlinkSocket() {
    if (!listening) return;
    try { unlinkSync(path); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    finally { listening = false; }
  }
  function stateDirectoryPresent() {
    const current = lstatSync(dir, { throwIfNoEntry: false });
    return current?.isDirectory() && current.dev === directory.dev && current.ino === directory.ino;
  }
  function locateTranscript() {
    if (transcript || locating || !session?.nativeSessionFile || Date.now() - lastTranscriptCheck < 350) return;
    lastTranscriptCheck = Date.now();
    locating = Promise.resolve().then(() => session.nativeSessionFile()).then(candidate => {
      if (typeof candidate === 'string') transcript = candidate;
    }).catch(error => console.error(error.message)).finally(() => { locating = undefined; });
  }
  function state() {
    if (runtime.rows.length > 1) locateTranscript();
    const snapshot = oarSnapshot(runtime, runtime.rows, endedAt != null);
    const exit = runtime.rows.findLast(event => ['exited', 'released'].includes(event.type) && event.streamId === runtime.streamId);
    return { ...binding, sessionId: session.id, streamId: runtime.streamId, status: snapshot.runtimeStatus,
      active: snapshot.active, ...(snapshot.userPrompt && { userPrompt: snapshot.userPrompt }), error: runtime.error()?.message,
      endedAt: endedAt ?? exit?.at, transcriptPath: transcript,
      ...(stalled && { stuck: { reason: 'request-timeout', at: stalled.at } }),
      model: session.model().value, effort: session.effort().value, steer: Boolean(session.steer) };
  }

  function close() {
    return closing ??= (async () => {
      clearInterval(ownerTimer);
      await releaseSession();
      runtime?.unsubscribe();
      endedAt = Date.now();
      try {
        if (stateDirectoryPresent()) writeState(join(dir, 'ended.json'),
          JSON.stringify({ at: endedAt, sessionId: session?.id, transcriptPath: transcript }));
      } finally {
        setImmediate(() => { server?.close(); unlinkSocket(); });
      }
      return { endedAt };
    })();
  }

  async function releaseSession() {
    const children = await ownedHostChildren(identity).catch(error => { console.error(error.message); });
    if (session) {
      locateTranscript();
      try { await disposeSession(session, 4_000); }
      catch (error) { console.error(error.message); }
    }
    try { await closeHostChildren(identity, children); }
    catch (error) {
      console.error(error.message);
      // Enumeration failure must not keep this detached process group alive.
      setTimeout(() => process.kill(-identity.pgid, 'SIGKILL'), 1000);
    }
  }

  const retire = () => { void close().catch(error => console.error(error.message)); };
  for (const signal of ['SIGHUP', 'SIGTERM', 'SIGINT']) process.on(signal, () => {
    stopRequested = true;
    if (listening) retire();
  });

  async function handle({ owner, method, params, protocol, controller: sender }) {
    if (owner !== incarnation) throw refused('Session host identity changed');
    if (!hostMethods.includes(method)) throw refused('Unknown session host method');
    if (method === 'hello') return { protocol: hostProtocol, incarnation, methods: hostMethods };
    // v1 clients can still call v2 hosts using the original envelope.
    if (protocol !== 1 && protocol !== hostProtocol) throw refused('Unsupported session host protocol');
    if (method === 'state') {
      if (controller && controller.generation === sender?.generation && controller.id === sender.id) lastOwnerAt = performance.now();
      return state();
    }
    if (!Number.isSafeInteger(sender?.generation) || sender.generation <= 0 || !hostUUID.test(sender?.id)) {
      throw refused('Invalid controller identity');
    }
    if (method === 'claim' && (!controller || sender.generation > controller.generation)) {
      const current = readJSON(controllerFile(project));
      if (current?.generation !== sender.generation || current.id !== sender.id) throw refused('Unregistered session host controller');
      writeState(join(dir, 'controller.json'), JSON.stringify(sender));
      controller = sender;
    }
    if (controller?.generation !== sender.generation || controller.id !== sender.id) {
      throw refused('Stale session host controller');
    }
    lastOwnerAt = performance.now();
    if (method === 'claim') return state();
    if (method === 'close') {
      if (params?.idleStream !== undefined && (params.idleStream !== runtime.streamId || stalled || runtime.error() ||
          !idleForRelease(oarSnapshot(runtime, runtime.rows, endedAt != null)))) {
        throw refused('Session is no longer idle', 'status_mismatch');
      }
      return close();
    }
    const { action, id, text: input, active } = params ?? {};
    if (!['prompt', 'steer', 'abort'].includes(action) || !hostUUID.test(id)) throw refused('Invalid session host request');
    const key = `${action}:${id}`;
    const previous = receipts.get(key);
    if (method === 'receipt') return previous ?? { status: 'absent' };
    if (action !== 'abort' && (typeof input !== 'string' || !input.trim())) throw refused('Invalid session host input');
    const text = action === 'abort' ? input : input.toWellFormed();
    const digest = createHash('sha256').update(JSON.stringify([text, active?.streamId, active?.sinceSeq, active?.turnId])).digest('hex');
    if (previous) {
      if (previous.digest !== digest) throw refused('Session host request ID conflicts with prior input');
      if (previous.status === 'accepted') return previous.result;
      if (previous.status === 'pending' || previous.status === 'uncertain') throw refused('Session host input is uncertain', 'uncertain');
      // Guard failures prove the provider received nothing. The same
      // delivery can be scheduled again after the daemon rechecks state.
    }
    if (row.hostGrant && Date.now() >= row.hostGrant.expiresAt) throw refused('Host grant expired', 'status_mismatch');
    if (closing || stalled) throw refused('Session host is not ready for another request', 'status_mismatch');
    const entry = { key, id, action, digest, streamId: runtime.streamId, generation: sender.generation,
      sinceSeq: active?.sinceSeq, turnId: active?.turnId, at: Date.now() };
    save({ ...entry, status: 'pending' });
    const operation = oarControl(runtime, action, { id, text, active }, { state: 'idle' }).then(({ kind, requestId, seq }) => {
      const result = { kind, requestId, seq };
      save({ ...entry, status: 'accepted', result });
      return result;
    }, error => {
      const definite = ['steer-unavailable', 'status_mismatch', 'input-refused', 'blocked', 'provider-overloaded'].includes(error.kind);
      save({ ...entry, status: definite ? 'refused' : 'uncertain', kind: error.kind });
      throw error;
    }).finally(() => {
      if (stalled?.key === key) stalled = undefined;
    });
    try { return await withDeadline(operation, controlTimeoutMs, 'OAR request acknowledgement timed out', 'request-timeout'); }
    catch (error) {
      if (error.code !== 'request-timeout') throw error;
      stalled = entry;
      save({ ...entry, status: 'uncertain', kind: 'request-timeout' });
      throw refused(error.message, 'uncertain');
    }
  }

  try {
    for (const receipt of jsonRows(prepareJournal(journal))) receipts.set(receipt.key, receipt);
    if (row.hostGrant && Date.now() >= row.hostGrant.expiresAt) throw new Error('Host grant expired before native launch');
    session = await withDeadline(openOar(row, project, row.sessionId), 35_000, 'OAR host startup timed out', 'startup-timeout');
    if (row.sessionId && session.id !== row.sessionId) throw new Error('OAR resumed a different native session');
    let nativeExited = false;
    runtime = trackOar(project, row, session, error => console.error(error.message), incarnation, () => {
      nativeExited = true;
      if (listening) setImmediate(retire);
    });
    writeState(join(dir, 'native.json'), JSON.stringify({ sessionId: session.id, streamId: runtime.streamId }));
    server = createServer(socket => {
      socket.on('error', () => {});
      socket.setTimeout(25_000, () => socket.destroy());
      receiveHostLine(socket, line => {
        const call = Promise.resolve().then(() => {
          const request = JSON.parse(line);
          if (['hello', 'state', 'receipt'].includes(request.method)) return handle(request);
          const pending = chain.then(() => handle(request));
          chain = pending.catch(() => {});
          return pending;
        });
        void call.then(result => ({ ok: true, result }), error => ({ ok: false, error: error.message, kind: error.kind }))
          .then(reply => socket.end(JSON.stringify(reply) + '\n'));
      });
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(path, resolve);
    });
    listening = true;
    privateHostSocket(path);
    lastOwnerAt = performance.now();
    ownerTimer = setInterval(() => {
      try {
        if (!stateDirectoryPresent() || performance.now() - lastOwnerAt >= ownerGraceMs ||
            row.hostGrant && Date.now() >= row.hostGrant.expiresAt) retire();
      } catch (error) {
        console.error(error.message);
        retire();
      }
    }, checkIntervalMs);
    ownerTimer.unref();
    if (stopRequested || nativeExited) retire();
  } catch (error) {
    await releaseSession().catch(error => console.error(error.message));
    try {
      if (stateDirectoryPresent()) writeState(join(dir, 'failed.json'), JSON.stringify({ message: error.message }));
    } finally {
      if (listening) { server.close(); unlinkSocket(); }
    }
    throw error;
  }
}

if (import.meta.main) main(...process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
