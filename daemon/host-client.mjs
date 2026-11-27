import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, constants, lstatSync, mkdirSync, openSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { hostAbsent, hostDirectory, hostHello, hostRequest, hostSocket, hostUUID, readJSON } from './host-control.mjs';
import { eventPath, jsonRows, readText, syncDirectory, writeState } from './io.mjs';
import { inspectProcess } from './processes.mjs';
import { releaseId, releaseRoot } from './release.mjs';
import { claudeApiEnvKeys } from '../adapters/claude/launch.mjs';
import { claudeAuthMode } from '../cli/policy.mjs';

const lastExit = path => jsonRows(readText(path)).findLast(event => ['stream-opened', 'exited', 'released'].includes(event.type));
const unknown = () => Object.assign(new Error('Session host liveness is unknown; preserving the existing host binding'),
  { code: 'liveness-unknown' });

async function connect(path, incarnation) {
  try { return await hostHello(path, incarnation); }
  catch (error) { if (!hostAbsent(error)) throw error; }
}

export async function attachHost(project, row, job, save, controller, { stop = false, capabilities, authorizeLaunch } = {}) {
  const addr = row.addr;
  const journal = eventPath(project, addr);
  let resume = row.sessionId;
  let start = !job.host;
  let hello;
  let boundIdentity;
  if (job.host) {
    if (!hostUUID.test(job.host.incarnation)) throw new Error('Invalid stored session host incarnation');
    const dir = hostDirectory(project, addr, job.host.incarnation);
    const ended = readJSON(join(dir, 'ended.json'));
    const failure = readJSON(join(dir, 'failed.json'));
    const native = readJSON(join(dir, 'native.json'));
    resume = native?.sessionId ?? resume;
    let owner = readJSON(join(dir, 'owner.json'));
    if (ended || failure) {
      if (failure && !stop && (!job.retention?.resuming || owner &&
          sameProcess(owner.identity, (await processTable([owner.identity.pid])).get(owner.identity.pid)))) {
        throw new Error(failure.message);
      }
      return { endedAt: ended?.at ?? Date.now(), sessionId: ended?.sessionId ?? native?.sessionId,
        transcriptPath: ended?.transcriptPath, ...(failure && { error: failure.message }) };
    }
    if (stop && !owner) {
      writeState(join(dir, 'cancelled.json'), 'true');
      owner = readJSON(join(dir, 'owner.json'));
      if (!owner) return { endedAt: Date.now() };
    }
    if (owner) {
      if (owner.addr !== addr || owner.project !== project || owner.incarnation !== job.host.incarnation) {
        throw new Error('Session host binding changed');
      }
      boundIdentity = owner.identity;
      const socket = hostSocket(project, addr, owner.incarnation);
      hello = await connect(socket, owner.incarnation);
      if (!hello) {
        if (stop && job.pendingHostGrant) {
          writeState(join(dir, 'cancelled.json'), 'true');
          return { endedAt: Date.now() };
        }
        const event = lastExit(journal);
        if (event && ['exited', 'released'].includes(event.type) && event.incarnation === owner.incarnation) {
          return { endedAt: event.at };
        }
        const status = await inspectProcess(owner.identity);
        if (status !== 'dead' && !(status === 'alive' && job.pendingHostGrant)) throw unknown();
        start = status === 'dead';
        if (start && lstatSync(socket, { throwIfNoEntry: false })?.isSocket()) unlinkSync(socket);
      }
    }
    if (stop && (start || !owner)) return { endedAt: Date.now() };
  } else if (stop) return { endedAt: Date.now() };
  if (start && job.host && (job.hostGrant || job.pendingHostGrant)) return { endedAt: Date.now() };
  if (start) {
    boundIdentity = undefined;
    if (row.cli === 'claude') job.authMode = claudeAuthMode(project, row.role);
    job.host = { incarnation: randomUUID(), release: releaseId(), root: releaseRoot };
    const dir = hostDirectory(project, addr, job.host.incarnation);
    const hostGrant = job.pendingHostGrant ?? job.hostGrant;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeState(join(dir, 'launch.json'), JSON.stringify({ row: { ...row, sessionId: resume,
      ...(job.integration && { integration: true }),
      ...(hostGrant && { hostGrant }),
      ...(job.fast !== undefined && { fast: job.fast }),
      ...(job.authMode && { authMode: job.authMode }) }, ...(job.pendingHostGrant && { awaitHostGrant: true }) }));
    syncDirectory(join(dir, '..'));
    save(job);
  }

  const { incarnation, root, release } = job.host;
  const dir = hostDirectory(project, addr, incarnation);
  const path = hostSocket(project, addr, incarnation);
  const authorizePreparedLaunch = () => {
    if (stop || !job.pendingHostGrant || !readJSON(join(dir, 'preflight-ready.json'))) return;
    if (readJSON(join(dir, 'cancelled.json'))) throw new Error('Host launch was cancelled');
    authorizeLaunch();
  };
  let spawnError;
  hello ??= await connect(path, incarnation);
  if (!hello && !readJSON(join(dir, 'owner.json'))) {
    let env;
    if (row.role === 'worker' && row.cli === 'codex') env = { ...process.env, OAR_CODEX_SANDBOX: 'inherit' };
    if (row.cli === 'claude' && (job.authMode !== 'api-key' || claudeAuthMode(project, row.role) !== 'api-key')) {
      // This also fences a retained release launching an unfinished intent.
      env = Object.fromEntries(Object.keys(process.env).filter(key => !claudeApiEnvKeys.includes(key))
        .map(key => [key, process.env[key]]));
      if (job.authMode !== 'subscription') {
        job.authMode = 'subscription';
        save(job);
      }
    }
    if (capabilities) env = { ...(env ?? process.env), LOOM_CAPABILITY: capabilities.ensureSession(addr).token };
    const log = openSync(join(dir, 'host.log'), constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
    try {
      const child = spawn(process.execPath, [join(root, 'daemon', 'session-host.mjs'), project, addr, incarnation, release], {
        cwd: row.cwd, detached: true, stdio: ['ignore', log, log],
        env,
      });
      child.once('error', error => { spawnError = error; });
      child.unref();
    } finally { closeSync(log); }
  }
  const deadline = Date.now() + 45_000;
  while (!hello) {
    if (spawnError) throw spawnError;
    if (stop && readJSON(join(dir, 'cancelled.json'))) return { endedAt: Date.now() };
    const failure = readJSON(join(dir, 'failed.json'));
    const ended = readJSON(join(dir, 'ended.json'));
    if (ended) return { endedAt: ended.at, sessionId: ended.sessionId, transcriptPath: ended.transcriptPath };
    if (failure) throw new Error(failure.message);
    const owner = readJSON(join(dir, 'owner.json'));
    if (owner && await inspectProcess(owner.identity) === 'dead') {
      throw new Error(readJSON(join(dir, 'failed.json'))?.message ?? 'Session host exited during startup');
    }
    if (Date.now() >= deadline) throw owner ? unknown() : new Error('Session host did not become ready');
    authorizePreparedLaunch();
    await delay(125);
    hello = await connect(path, incarnation);
  }
  authorizePreparedLaunch();

  const call = (method, params) => hostRequest(path, incarnation, method, params, hello.protocol, controller);
  let current = await call('claim');
  function verify(state) {
    if (state.project !== project || state.addr !== addr || state.incarnation !== incarnation ||
        state.release !== release || state.root !== root || resume && state.sessionId !== resume ||
        boundIdentity && ['pid', 'started', 'uid'].some(key => state.identity?.[key] !== boundIdentity[key])) {
      throw new Error('Session host binding changed');
    }
    resume ??= state.sessionId;
    return state;
  }
  verify(current);
  let rows = jsonRows(readText(journal));
  let size = lstatSync(journal, { throwIfNoEntry: false })?.size;
  function readRows() {
    const bytes = lstatSync(journal, { throwIfNoEntry: false })?.size;
    if (size !== bytes) {
      rows = jsonRows(readText(journal));
      size = bytes;
    }
    return rows;
  }
  async function pull() {
    try { current = verify(await call('state')); }
    catch (error) {
      if (!hostAbsent(error)) throw error;
      const ended = readJSON(join(dir, 'ended.json'));
      if (!ended) {
        if (await inspectProcess(current.identity) !== 'dead') throw unknown();
        throw error;
      }
      current = { ...current, endedAt: ended.at };
    }
    return current;
  }
  return {
    hosted: true, incarnation, protocol: hello.protocol, release, oar: current.oar, pid: current.identity.pid,
    identity: current.identity,
    streamId: current.streamId, pull,
    get session() { return { id: current.sessionId, status: () => ({ value: current.status }),
      effort: () => ({ value: current.effort }), model: () => ({ value: current.model }), steer: current.steer }; },
    get rows() { return readRows(); },
    get endedAt() { return current.endedAt; },
    get transcriptPath() { return current.transcriptPath; },
    get stuck() { return current.stuck; },
    userPrompt: () => current.userPrompt,
    active: () => current.active && { ...current.active, turn: current.active.hcTurn },
    error: () => current.error,
    receipt: (action, id) => call('receipt', { action, id }),
    control: (action, { id, text, active }) => call('control', { action, id, text, active }),
    close: options => call('close', options),
  };
}
