import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, constants, lstatSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { holderAsset } from '../holder/assets.mjs';
import { holderClient, holderError } from '../holder/protocol.mjs';
import { absoluteCommand } from '../runtimes/tui/transport.mjs';
import { codexConfiguration } from './codex-launch.mjs';
import { codexPipeSession } from './codex-pipe-session.mjs';
import { hostDirectory, hostSocket, hostUUID } from './host-control.mjs';
import { syncDirectory } from './io.mjs';
import { holderAbsent, switchHolder, verifyHolderBuild } from './native-holder.mjs';
import { inspectProcess, processLiveness, processTable } from './processes.mjs';
import { controllerFile, managedEnvironment, releaseRoot } from './release.mjs';
import { workerEnvironment, workerProviderEnvironment } from './worker-environment.mjs';
import { seniorToolEnvironment } from './senior-tools.mjs';

export const pipeTransport = 'holder-pipes';
export const useCodexHolder = (row, job) => row.cli === 'codex' &&
  (job.host ? job.host.transport === pipeTransport : !job.integration && process.env.LOOM_TEST_CODEX_PIPES === '1');
const sameBirth = (identity, live) => live && live.pid === identity?.pid &&
  live.started === identity.started && live.uid === process.getuid();
const unknown = () => Object.assign(new Error('Codex holder liveness is unknown; preserving the existing holder binding'),
  { code: 'liveness-unknown' });

async function launch(project, row, job, dir, socket, capabilities) {
  const { incarnation, holderRelease } = job.host;
  const asset = holderAsset(holderRelease.root);
  if (asset.digest !== holderRelease.digest) throw holderError('HOLDER_BUILD');
  const managed = managedEnvironment(project, row.addr);
  const isolated = workerEnvironment(row);
  const env = { ...process.env, ...managed, ...isolated, ...workerProviderEnvironment(row), ...seniorToolEnvironment(project, row) };
  delete env.HC_TERMINAL_ID;
  if (capabilities) env.LOOM_CAPABILITY = capabilities.ensureSession(row.addr).token;
  const command = await absoluteCommand(process.env.LOOM_CODEX_BIN ?? process.env.OAR_CODEX_BIN ?? 'codex', 'codex');
  const args = ['app-server', ...codexConfiguration(project, { ...row, fast: job.fast }, managed, isolated), '--listen', 'stdio://'];
  const fd = openSync(join(dir, 'holder.log'),
    constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
  try {
    const child = spawn(asset.path, ['--pipes', socket, dir, controllerFile(project), incarnation.replaceAll('-', ''),
      asset.digest, command, ...args], { cwd: row.cwd, detached: true, env, stdio: ['ignore', fd, fd] });
    child.unref();
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    return child;
  } finally { closeSync(fd); }
}

export async function attachCodexHolder(project, row, job, saveJob, controller, { stop = false, capabilities } = {}) {
  const save = () => saveJob(job);
  if (!job.host) {
    if (stop) return { endedAt: Date.now() };
    job.host = { transport: pipeTransport, incarnation: randomUUID(),
      holderRelease: { root: releaseRoot, digest: holderAsset(releaseRoot).digest } };
    save();
  }
  const binding = job.host;
  const { incarnation } = binding;
  if (binding.transport !== pipeTransport || !hostUUID.test(incarnation) || !controller) throw holderError('HOLDER_IDENTITY');
  const dir = hostDirectory(project, row.addr, incarnation);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  syncDirectory(join(dir, '..'));
  const socket = hostSocket(project, row.addr, incarnation);
  const client = holderClient({ socket, incarnation }, controller);

  const hello = () => client.hello().catch(error => { if (!holderAbsent(error)) throw error; });
  let snapshot = await hello();
  if (!snapshot && !binding.identity && !lstatSync(socket, { throwIfNoEntry: false })) {
    if (stop) return { endedAt: Date.now() };
    const candidate = await launch(project, row, job, dir, socket, capabilities);
    const limit = performance.now() + 8000;
    do {
      if (candidate.exitCode != null || candidate.signalCode) throw holderError('HOLDER_START', 'Codex holder exited during launch');
      await delay(35);
      snapshot = await hello();
    } while (!snapshot && performance.now() < limit);
    if (!snapshot) throw holderError('HOLDER_NOT_READY');
  }

  function verify(value) {
    if (!value.pipes || value.pid <= 1 || value.childPid <= 1 ||
        binding.identity && (value.pid !== binding.identity.pid || value.childPid !== binding.childPid)) {
      throw holderError('HOLDER_IDENTITY');
    }
    verifyHolderBuild(binding, value, save);
  }
  const gone = async () => Boolean(binding.identity && await inspectProcess(binding.identity) === 'dead');
  if (snapshot) {
    verify(snapshot);
    const processes = await processTable([snapshot.pid, snapshot.childPid]);
    const pid = processes.get(snapshot.pid);
    const child = processes.get(snapshot.childPid);
    if (pid && (pid.uid !== process.getuid() || binding.identity && !sameBirth(binding.identity, pid)) ||
        !snapshot.ended && child && (child.uid !== process.getuid() || child.ppid !== snapshot.pid)) {
      throw holderError('HOLDER_IDENTITY');
    }
    if (!binding.identity && (!pid || !snapshot.ended && !child)) throw unknown();
    if (binding.identity && processLiveness(binding.identity, pid) === 'dead') throw holderError('HOLDER_IDENTITY');
    if (!binding.identity) {
      binding.identity = { pid: pid.pid, started: pid.started };
      binding.childPid = snapshot.childPid;
      save();
    }
    const claimed = await client.claim();
    verify(claimed);
    if (claimed.epoch !== BigInt(controller.generation)) throw holderError('HOLDER_STALE');
  } else if (!await gone()) throw unknown();

  const runtime = codexPipeSession(project, row, dir, incarnation, client, value => {
    verify(value);
    if (value.epoch !== BigInt(controller.generation)) throw holderError('HOLDER_STALE');
  }, error => holderAbsent(error) && gone());
  if (stop) await runtime.close();
  else await runtime.ready();
  return Object.assign(runtime, {
    transport: pipeTransport, pid: binding.identity?.pid, childPid: binding.childPid,
    build: () => binding.holderRelease.root,
    async snapshot() { const value = await client.hello(); verify(value); return value; },
    async handoff({ target, rollback, check }) {
      const result = await switchHolder({ addr: row.addr, binding, client, save, target, rollback, check,
        dead: gone, verify, pipes: true });
      if (!check) await runtime.pull();
      return result;
    },
  });
}
