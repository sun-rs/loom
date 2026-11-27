import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, constants, openSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { runtimeDirectory } from '../cli/project.mjs';
import { CommandError } from '../cli/sessions.mjs';
import { hostProtocol, hostProtocols } from './host-control.mjs';
import { activeRelease, activeReleaseFile, installManagedCli, releaseDigest, releaseRoot, upgradeFile, upgradeState } from './release.mjs';
import { nodeVersion, releaseNode, runningNode } from '../lib/node-runtime.mjs';
import { readText, writeState } from './io.mjs';
import { daemonAbsent, request } from './rpc.mjs';
import { hostUUID, readJSON } from './host-control.mjs';
import { inspectProcess, processTable } from './processes.mjs';
import { checkHolder } from '../holder/assets.mjs';
import { hasStoredSessionCapability, socketAuthVersion } from './socket-auth.mjs';
import { preparePeerAuth } from './peer-auth.mjs';

const exec = promisify(execFile);
export const daemonProtocol = 1;
export const storageVersions = [0, 1, 2];

export async function selfCheck(legacyNode) {
  const requirements = JSON.parse(readText(join(releaseRoot, 'package.json'))).dependencies;
  const packages = {};
  for (const [name, version] of Object.entries(requirements)) {
    const path = join(releaseRoot, 'node_modules', name, 'package.json');
    const installed = JSON.parse(readText(realpathSync(path)));
    if (installed.version !== version) throw new Error(`Expected ${name}@${version}, found ${installed.version}`);
    packages[name] = installed.version;
  }
  await import('node-pty');
  await import('@xterm/headless');
  const { controlProtocol } = await import('../tui/pty-control.mjs');
  const holder = await checkHolder(releaseRoot, { pipes: true });
  return { root: releaseRoot, digest: releaseDigest(releaseRoot, { legacy: true }), releaseDigest: releaseDigest(releaseRoot),
    legacyPeerAuth: preparePeerAuth().available,
    daemonProtocol, socketAuthVersion, hostProtocol, hostProtocols: [...hostProtocols, 3], ptyProtocol: controlProtocol, ptyProtocols: [0, 1, 2, 3],
    defaultTuiProtocol: 3, defaultCodexHostProtocol: 3, holderDigest: holder.digest, attachmentCheck: true, storageVersions, packages,
    platform: process.platform, arch: process.arch, node: legacyNode?.version ?? process.versions.node,
    nodeRuntime: runningNode(), ...(legacyNode && { legacyNodeRuntime: legacyNode }) };
}

async function verifyRelease(root, recordedNode) {
  if (!isAbsolute(root ?? '')) throw new CommandError('invalid-arguments', 'Release path must be absolute');
  root = realpathSync(root);
  const digest = releaseDigest(root);
  const node = releaseNode(root, recordedNode);
  const version = nodeVersion(root);
  const { stdout } = await exec(node, [join(root, 'bin/loomd'), '--self-check'],
    { cwd: root, timeout: 45_000, maxBuffer: 1024 * 1024 });
  const build = JSON.parse(stdout);
  if (build.root !== root || (build.releaseDigest ?? build.digest) !== digest ||
      build.digest !== releaseDigest(root, { legacy: true }) || build.daemonProtocol !== daemonProtocol ||
      build.platform !== process.platform || build.arch !== process.arch ||
      (version ? build.nodeRuntime?.version !== version || build.nodeRuntime?.path !== node :
        recordedNode?.version !== undefined && build.node !== recordedNode.version)) {
    throw new Error('Release self-check returned an incompatible build');
  }
  if (!build.hostProtocols?.includes(build.hostProtocol) || !build.ptyProtocols?.includes(build.ptyProtocol)) {
    throw new Error('Release cannot attach its own session protocol');
  }
  return { ...build, nodeRuntime: build.nodeRuntime ?? { path: node, version: build.node },
    legacyDigest: build.digest, digest, id: digest };
}

function storageVersion(project) {
  const db = new DatabaseSync(join(project, '.project', 'index.sqlite'), { readOnly: true });
  try {
    if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('Project index failed SQLite quick_check');
    return db.prepare('PRAGMA user_version').get().user_version;
  } finally { db.close(); }
}

const handoffOwner = (project, id) => {
  if (!hostUUID.test(id)) throw new Error('Invalid upgrade identity');
  return join(runtimeDirectory(project), `upgrade-${id}.owner.json`);
};

export async function liveHandoff(project, id) {
  const owner = readJSON(handoffOwner(project, id));
  return Boolean(owner && await inspectProcess(owner) !== 'dead');
}

async function projectStatus(project) {
  try { return await request(project, 'daemon-status', {}, { timeout: 1250 }); }
  catch (error) { if (!daemonAbsent(error) && !['uncertain', 'ECONNRESET', 'EPIPE'].includes(error.code)) throw error; }
}

function launch(project, entry, args, env = process.env, node = process.execPath) {
  const log = openSync(join(runtimeDirectory(project), 'upgrade.log'),
    constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
  let child;
  try {
    child = spawn(node, [entry, ...args], { detached: true, stdio: ['ignore', log, log], env, cwd: project });
  } finally { closeSync(log); }
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(child); });
  });
}

export async function planUpgrade(project, args, current, sessions) {
  const active = activeRelease(project);
  if (args.rollback && !active?.previous) throw new CommandError('not-ready', 'No previous compatible release');
  const [target, verifiedCurrent] = await Promise.all([
    verifyRelease(args.rollback ? active.previous.root : args.target,
      args.rollback ? active.previous.nodeRuntime ?? active.current.legacyNodeRuntime : undefined),
    verifyRelease(current.root, current.nodeRuntime),
  ]);
  if (target.socketAuthVersion !== socketAuthVersion) throw new Error('Release does not support Loom socket capabilities');
  if (target.root === current.root) throw new CommandError('invalid-arguments', 'Prepare the new build in a different release directory');
  if (current.digest !== verifiedCurrent.digest || active?.current.digest &&
      ![verifiedCurrent.digest, verifiedCurrent.legacyDigest].includes(active.current.digest)) {
    throw new Error('Active release changed since it was verified');
  }
  if (args.rollback && active.previous.digest && ![target.digest, target.legacyDigest].includes(active.previous.digest)) {
    throw new Error('Previous release changed since it was verified');
  }
  if (!verifiedCurrent.hostProtocols.includes(target.hostProtocol) || !target.hostProtocols.includes(verifiedCurrent.hostProtocol) ||
      !verifiedCurrent.ptyProtocols.includes(target.ptyProtocol) || !target.ptyProtocols.includes(verifiedCurrent.ptyProtocol)) {
    throw new Error('Releases cannot attach each other’s session protocols');
  }
  const version = storageVersion(project);
  if (!storageVersions.includes(version) || !target.storageVersions?.includes(version)) {
    throw new Error(`Both builds must support SQLite user_version ${version}`);
  }
  sessions = await sessions();
  const blockers = blockersFor(sessions, target);
  if (!target.legacyPeerAuth) for (const session of sessions) {
    if (session.status === 'attached' && !hasStoredSessionCapability(project, session.addr)) {
      blockers.push({ ...session, reason: 'Target cannot authenticate this legacy session by its kernel peer' });
    }
  }
  return { current: { ...verifiedCurrent, id: current.id }, target, sessions, blockers, storageVersion: version, rollback: Boolean(args.rollback) };
}

function blockersFor(sessions, target) {
  return sessions.filter(session => session.status !== 'attached' ||
    session.protocol != null && !(session.backend === 'headless' ? target.hostProtocols : target.ptyProtocols)?.includes(session.protocol));
}

export async function checkUpgradeAttachments(project, plan) {
  if (plan.blockers.length || !plan.target.attachmentCheck) {
    return { ...plan, attachmentCheck: plan.blockers.length ? 'blocked' : 'unsupported' };
  }
  try {
    const checkpoint = exec(plan.target.nodeRuntime?.path ?? process.execPath,
      [join(plan.target.root, 'bin/loomd'), '--project', project, '--check-attachments'],
      { cwd: project, timeout: 40_000, maxBuffer: 1024 * 1024 });
    checkpoint.child.stdin.on('error', () => {}); // The subprocess can exit before accepting input.
    checkpoint.child.stdin.end(JSON.stringify(plan.sessions));
    const { stdout } = await checkpoint;
    const blockers = attachmentFailures(plan.sessions, JSON.parse(stdout));
    return { ...plan, attachmentCheck: 'checked', blockers };
  } catch (error) {
    if (/spawnSync ps ETIMEDOUT/.test(error.stderr ?? error.message)) {
      return { ...plan, attachmentCheck: 'failed', blockers: [{ status: 'unavailable', retryable: true,
        reason: 'Candidate process enumeration timed out. Retry the upgrade check.' }] };
    }
    return { ...plan, attachmentCheck: 'failed', blockers: [{ status: 'unavailable',
      reason: error.killed ? 'Candidate attachment check timed out' : `Candidate attachment check failed: ${error.stderr?.trim() || error.message}` }] };
  }
}

export async function beginUpgrade(project, plan, id = randomUUID()) {
  if (!hostUUID.test(id)) throw new CommandError('invalid-arguments', 'Invalid upgrade ID');
  plan = await checkUpgradeAttachments(project, { ...plan, blockers: blockersFor(plan.sessions, plan.target) });
  if (plan.blockers.length) {
    if (plan.blockers.every(blocker => blocker.retryable)) {
      throw new CommandError('process-enumeration-retry', 'Process enumeration temporarily unavailable. Retry loom upgrade.');
    }
    throw new CommandError('not-ready', 'Some sessions could not be verified. Run loom upgrade --check for details.');
  }
  const prior = upgradeState(project);
  if (prior?.id === id || prior?.phase === 'switching' || prior?.recoveryPending && await liveHandoff(project, prior.id)) {
    throw new CommandError('not-ready', 'An upgrade is already switching');
  }
  const predecessor = (await processTable([process.pid])).get(process.pid);
  if (!predecessor) throw new Error('Previous loomd identity unavailable');
  const state = { id, phase: 'switching', startedAt: Date.now(), predecessorPid: process.pid, predecessor, ...plan };
  const path = upgradeFile(project);
  writeState(path, JSON.stringify(state));
  try {
    const helper = await launch(project, fileURLToPath(import.meta.url), [project, state.id]);
    const deadline = Date.now() + 5000;
    while (!await liveHandoff(project, state.id)) {
      if (helper.exitCode !== null || helper.signalCode || Date.now() >= deadline) {
        throw new Error('Upgrade launcher did not claim its handoff');
      }
      await delay(50);
    }
  } catch (error) {
    writeState(path, JSON.stringify({ ...state, phase: 'failed', error: error.message }));
    throw error;
  }
  return { upgradeId: state.id, phase: state.phase, sessions: plan.sessions };
}

export async function validateHandoff(project, id, recovery) {
  const state = upgradeState(project);
  if (!id) {
    const active = activeRelease(project);
    if (active && active.current.root !== releaseRoot) throw new Error('Start loomd from the active project release');
    if (state?.phase === 'switching') {
      if (await liveHandoff(project, state.id)) throw new Error('An upgrade is switching the project release');
      const installed = active?.upgradeId === state.id && active.current.root === state.target.root;
      writeState(upgradeFile(project), JSON.stringify({ ...state, phase: installed ? 'committed' : 'failed',
        finishedAt: Date.now(), error: installed ? undefined : 'Interrupted upgrade launcher. Resumed the active release.' }));
    }
    return;
  }
  if (state?.id !== id || state.phase !== 'switching' || (recovery ? state.current : state.target).root !== releaseRoot ||
      !await liveHandoff(project, id)) {
    throw new Error('Invalid loomd handoff identity');
  }
  if (!recovery && releaseDigest(releaseRoot) !== (state.target.releaseDigest ?? state.target.digest)) {
    throw new Error('Target release changed since self-check');
  }
  const expected = (recovery ? state.current : state.target).nodeRuntime;
  if (expected && (expected.path !== process.execPath || expected.version !== process.versions.node ||
      expected.abi !== undefined && expected.abi !== process.versions.modules)) throw new Error('Handoff Node runtime changed since self-check');
  return state;
}

function attachmentFailures(expected, sessions) {
  const before = new Map(expected.map(session => [session.addr, session]));
  const observed = new Set(sessions.map(session => session.addr));
  const failures = expected.filter(session => !observed.has(session.addr)).map(session =>
    ({ ...session, status: 'unavailable', reason: 'Session missing from attachment check' }));
  for (const live of sessions) {
    if (live.status === 'ended') continue;
    const prior = before.get(live.addr);
    if (live.status !== 'attached' || prior && (live.backend !== prior.backend || live.protocol !== prior.protocol ||
        live.pid !== prior.pid || live.incarnation !== prior.incarnation || prior.sessionId && live.sessionId !== prior.sessionId ||
        live.streamId !== prior.streamId || prior.protocol === 3 && (live.pane !== prior.pane ||
          live.paneCreatedAt !== prior.paneCreatedAt || live.childPid !== prior.childPid))) {
      failures.push({ ...live, status: 'unavailable', reason: live.reason ?? 'identity changed' });
    }
  }
  return failures;
}

export function validateReattachment(plan, result) {
  const [failure] = attachmentFailures(plan.sessions, result.sessions);
  if (failure) throw new Error(`Session ${failure.addr} could not reattach: ${failure.reason}`);
}

async function handoff(project, id) {
  const state = upgradeState(project);
  if (state?.id !== id || state.phase !== 'switching') throw new Error('Upgrade record changed');
  const identity = (await processTable([process.pid])).get(process.pid);
  if (!identity) throw new Error('Upgrade launcher identity unavailable');
  writeState(handoffOwner(project, id), JSON.stringify(identity));
  const path = upgradeFile(project);
  const save = (phase, extra) => writeState(path, JSON.stringify({ ...state, phase, finishedAt: Date.now(), ...extra }));
  const previousPointer = activeRelease(project);
  async function waitFor(check, description) {
    const deadline = Date.now() + 45_000;
    do {
      const result = await check();
      if (result) return result;
      await delay(100);
    } while (Date.now() < deadline);
    throw new Error(description);
  }
  const exited = child => child.exitCode !== null || child.signalCode !== null;
  async function terminate(child) {
    if (!child || exited(child)) return;
    child.kill('SIGKILL');
    await waitFor(() => exited(child), 'Failed loomd did not exit');
  }
  async function start(build, mode) {
    const handoff = mode !== 'restart';
    const child = await launch(project, join(build.root, 'bin/loomd'),
      ['--project', project, ...(handoff ? ['--handoff', id] : []), ...(mode === 'recovery' ? ['--handoff-recovery'] : [])],
      { ...process.env, LOOM_RELEASE_ID: build.id }, build.nodeRuntime?.path);
    try {
      const daemon = await waitFor(async () => {
        if (exited(child)) throw new Error(`loomd exited during ${mode}`);
        const daemon = await projectStatus(project);
        if (daemon?.pid !== child.pid || daemon.release?.root !== build.root || !daemon.running) return;
        if (!handoff) return daemon;
        if (daemon.handoff !== id) throw new Error('loomd reported a different handoff');
        if (daemon.attachmentError) throw new Error(daemon.attachmentError);
        if (daemon.ready) return daemon;
      }, mode === 'handoff' ? 'Timed out waiting for loomd to verify session attachments' :
        'Timed out waiting for the previous loomd to serve');
      return { child, daemon };
    } catch (error) {
      await terminate(child);
      throw error;
    }
  }
  try {
    await waitFor(async () => {
      if (upgradeState(project)?.phase !== 'switching') throw new Error('Upgrade launcher no longer owns the handoff');
      if (state.predecessor) {
        return await inspectProcess(state.predecessor) === 'dead';
      }
      try { process.kill(state.predecessorPid, 0); }
      catch (error) { if (error.code === 'ESRCH') return true; if (error.code !== 'EPERM') throw error; }
    }, 'Previous loomd did not release the project');
  } catch (error) {
    if (upgradeState(project)?.phase === 'switching') save('failed', { error: error.message });
    return;
  }
  let candidate;
  try {
    candidate = await start(state.target, 'handoff');
    writeState(activeReleaseFile(project), JSON.stringify({ current: state.target, previous: state.current, upgradeId: id }));
    save('committed', { pid: candidate.daemon.pid, sessions: candidate.daemon.sessions });
  } catch (error) {
    await terminate(candidate?.child);
    if (activeRelease(project)?.upgradeId === id) writeState(activeReleaseFile(project), JSON.stringify(previousPointer));
    let recovery;
    try {
      recovery = await start(state.current, 'recovery');
      save('failed', { error: error.message, pid: recovery.daemon.pid, recovered: true });
    } catch (failure) {
      await terminate(recovery?.child);
      const extra = { error: error.message, recoveryError: failure.message };
      // Normal startup binds the control socket without waiting for the
      // attachment pass. It is also usable by a retained older release.
      save('failed', { ...extra, recoveryPending: true });
      try {
        const { daemon } = await start(state.current, 'restart');
        save('failed', { ...extra, pid: daemon.pid, recovered: true });
      } catch (restart) {
        save('failed', { ...extra, recoveryError: `${failure.message}; restart: ${restart.message}` });
      }
    }
  }
  const completed = upgradeState(project);
  if (completed?.id === id && completed.phase === 'committed' && !nodeVersion(state.target.root)) {
    // Legacy rollback targets do not update their pre-existing launcher.
    installManagedCli(project, { node: state.target.nodeRuntime.path, root: state.target.root });
  }
}

if (import.meta.main) handoff(...process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
