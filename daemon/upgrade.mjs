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
import { activeRelease, activeReleaseFile, releaseDigest, releaseRoot, upgradeFile, upgradeState } from './release.mjs';
import { readText, writeState } from './io.mjs';
import { daemonAbsent, request } from './rpc.mjs';
import { hostUUID, readJSON } from './host-control.mjs';
import { processTable, sameProcess } from './processes.mjs';

const exec = promisify(execFile);
export const daemonProtocol = 1;
export const storageVersions = [0, 1, 2];

export async function selfCheck() {
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
  return { root: releaseRoot, digest: releaseDigest(releaseRoot), daemonProtocol, hostProtocol, hostProtocols,
    ptyProtocol: controlProtocol, ptyProtocols: [0, 1, 2], storageVersions, packages,
    platform: process.platform, arch: process.arch, node: process.versions.node };
}

async function verifyRelease(root) {
  if (!isAbsolute(root ?? '')) throw new CommandError('invalid-arguments', 'Release path must be absolute');
  root = realpathSync(root);
  const digest = releaseDigest(root);
  const { stdout } = await exec(process.execPath, [join(root, 'bin/loomd'), '--self-check'],
    { cwd: root, timeout: 45_000, maxBuffer: 1024 * 1024 });
  const build = JSON.parse(stdout);
  if (build.root !== root || build.digest !== digest || build.daemonProtocol !== daemonProtocol ||
      build.platform !== process.platform || build.arch !== process.arch || build.node !== process.versions.node) {
    throw new Error('Release self-check returned an incompatible build');
  }
  if (!build.hostProtocols?.includes(build.hostProtocol) || !build.ptyProtocols?.includes(build.ptyProtocol)) {
    throw new Error('Release cannot attach its own session protocol');
  }
  return { ...build, id: digest };
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

export function liveHandoff(project, id) {
  const owner = readJSON(handoffOwner(project, id));
  return Boolean(owner && sameProcess(owner, processTable().get(owner.pid)));
}

async function projectStatus(project) {
  try { return await request(project, 'daemon-status'); }
  catch (error) { if (!daemonAbsent(error)) throw error; }
}

function launch(project, entry, args, env = process.env) {
  const log = openSync(join(runtimeDirectory(project), 'upgrade.log'),
    constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
  let child;
  try {
    child = spawn(process.execPath, [entry, ...args], { detached: true, stdio: ['ignore', log, log], env, cwd: project });
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
    verifyRelease(args.rollback ? active.previous.root : args.target), verifyRelease(current.root),
  ]);
  if (target.root === current.root) throw new CommandError('invalid-arguments', 'Prepare the new build in a different release directory');
  if (current.digest !== verifiedCurrent.digest || active?.current.digest && active.current.digest !== current.digest) {
    throw new Error('Active release changed since it was verified');
  }
  if (args.rollback && active.previous.digest && active.previous.digest !== target.digest) {
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
  return { current: { ...verifiedCurrent, id: current.id }, target, sessions, blockers, storageVersion: version, rollback: Boolean(args.rollback) };
}

function blockersFor(sessions, target) {
  return sessions.filter(session => session.status !== 'attached' ||
    session.protocol != null && !(session.backend === 'headless' ? target.hostProtocols : target.ptyProtocols)?.includes(session.protocol));
}

export async function beginUpgrade(project, plan) {
  if (blockersFor(plan.sessions, plan.target).length) throw new CommandError('not-ready', 'Some sessions could not be verified. Run loom upgrade --check for details.');
  const prior = upgradeState(project);
  if (prior?.phase === 'switching') throw new CommandError('not-ready', 'An upgrade is already switching');
  const state = { id: randomUUID(), phase: 'switching', startedAt: Date.now(), predecessorPid: process.pid, ...plan };
  const path = upgradeFile(project);
  writeState(path, JSON.stringify(state));
  try {
    const helper = await launch(project, fileURLToPath(import.meta.url), [project, state.id]);
    const deadline = Date.now() + 5000;
    while (!liveHandoff(project, state.id)) {
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

export function validateHandoff(project, id, recovery) {
  const state = upgradeState(project);
  if (!id) {
    const active = activeRelease(project);
    if (active && active.current.root !== releaseRoot) throw new Error('Start loomd from the active project release');
    if (state?.phase === 'switching') {
      if (liveHandoff(project, state.id)) throw new Error('An upgrade is switching the project release');
      const installed = active?.upgradeId === state.id && active.current.root === state.target.root;
      writeState(upgradeFile(project), JSON.stringify({ ...state, phase: installed ? 'committed' : 'failed',
        finishedAt: Date.now(), error: installed ? undefined : 'Interrupted upgrade launcher. Resumed the active release.' }));
    }
    return;
  }
  if (state?.id !== id || state.phase !== 'switching' || (recovery ? state.current : state.target).root !== releaseRoot ||
      !liveHandoff(project, id)) {
    throw new Error('Invalid loomd handoff identity');
  }
  if (!recovery && releaseDigest(releaseRoot) !== state.target.digest) throw new Error('Target release changed since self-check');
  return state;
}

export function validateReattachment(plan, result) {
  for (const live of result.sessions) {
    if (live.status === 'ended') continue;
    const before = plan.sessions.find(session => session.addr === live.addr);
    if (live.status !== 'attached' || before && (live.pid !== before.pid ||
        live.incarnation !== before.incarnation || before.sessionId && live.sessionId !== before.sessionId ||
        live.streamId !== before.streamId)) {
      throw new Error(`Session ${live.addr} could not reattach: ${live.reason ?? 'identity changed'}`);
    }
  }
}

async function handoff(project, id) {
  const state = upgradeState(project);
  if (state?.id !== id || state.phase !== 'switching') throw new Error('Upgrade record changed');
  const identity = processTable().get(process.pid);
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
  async function start(build, recovery) {
    const child = await launch(project, join(build.root, 'bin/loomd'),
      ['--project', project, '--handoff', id, ...(recovery ? ['--handoff-recovery'] : [])],
      { ...process.env, LOOM_RELEASE_ID: build.id });
    try {
      return await waitFor(async () => {
        if (child.exitCode !== null || child.signalCode) throw new Error(`loomd exited during ${recovery ? 'recovery' : 'handoff'}`);
        const daemon = await projectStatus(project);
        if (daemon?.pid === child.pid && daemon.handoff === id && daemon.ready) return daemon;
      }, 'Timed out waiting for loomd to verify session attachments');
    } catch (error) {
      if (child.exitCode === null && !child.signalCode) {
        child.kill('SIGKILL');
        await waitFor(() => child.exitCode !== null || child.signalCode, 'Failed candidate did not exit');
      }
      throw error;
    }
  }
  try {
    await waitFor(async () => {
      if (upgradeState(project)?.phase !== 'switching') throw new Error('Upgrade launcher no longer owns the handoff');
      // The previous daemon releases the project writer lock immediately before exit.
      try { process.kill(state.predecessorPid, 0); }
      catch (error) { if (error.code === 'ESRCH') return true; throw error; }
    }, 'Previous loomd did not release the project');
  } catch (error) {
    if (upgradeState(project)?.phase === 'switching') save('failed', { error: error.message });
    return;
  }
  try {
    const result = await start(state.target, false);
    writeState(activeReleaseFile(project), JSON.stringify({ current: state.target, previous: state.current, upgradeId: id }));
    save('committed', { pid: result.pid, sessions: result.sessions });
  } catch (error) {
    try {
      const result = await start(state.current, true);
      writeState(activeReleaseFile(project), JSON.stringify({ current: state.current, previous: previousPointer?.previous, upgradeId: id }));
      save('recovered', { error: error.message, pid: result.pid, sessions: result.sessions });
    } catch (recovery) {
      save('failed', { error: error.message, recoveryError: recovery.message });
    }
  }
}

if (import.meta.main) handoff(...process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
