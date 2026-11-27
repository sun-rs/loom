import { appendFileSync, chmodSync, constants, lstatSync, mkdirSync, realpathSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { projectDirectory, projectOption, runtimeDirectory, socketPath } from '../cli/project.mjs';
import { claimProject } from '../relay/lock.mjs';
import { createSupervisor } from './supervisor.mjs';
import { maxLine } from './rpc.mjs';
import { projectLayout } from './herdr-layout.mjs';
import { readText, syncDirectory } from './io.mjs';
import { activeRelease, installManagedCli, nextController, releaseDigest, releaseId, releaseRoot, upgradeState } from './release.mjs';
import { beginUpgrade, checkUpgradeAttachments, daemonProtocol, liveHandoff, planUpgrade, selfCheck, validateHandoff, validateReattachment } from './upgrade.mjs';
import { authorizeSocketCommand, hasStoredSessionCapability, mayUseLegacyCaller, socketCapabilities } from './socket-auth.mjs';
import { preparePeerAuth } from './peer-auth.mjs';
import { markProjectShutdown, registerGlobalProject } from './global-registry.mjs';

function excludeProjectMetadata(project) {
  const git = (...args) => execFileSync('git', ['-C', project, 'rev-parse', ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trimEnd();
  let prefix, exclude;
  try {
    prefix = git('--show-prefix');
    exclude = git('--path-format=absolute', '--git-path', 'info/exclude');
  } catch { return; } // Non-Git projects have no exclude file.
  const entry = `/${prefix.replace(/[\\*?\[\] ]/g, '\\$&')}.project/`;
  const previous = readText(exclude);
  if (previous.split(/\r?\n/).includes(entry)) return;
  mkdirSync(dirname(exclude), { recursive: true });
  appendFileSync(exclude, (previous && !previous.endsWith('\n') ? '\n' : '') + entry + '\n',
    { mode: 0o600, flag: constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, flush: true });
}

function optionalTimeout(name) {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw)) throw new RangeError(`${name} must be a nonnegative integer in milliseconds`);
  return Number(raw);
}

export async function main(args, { pollInterval = 350, ...options } = {}) {
  const { values } = parseArgs({ args, options: { project: { type: 'string' }, help: { type: 'boolean', short: 'h' },
    'self-check': { type: 'boolean' }, 'check-attachments': { type: 'boolean' }, handoff: { type: 'string' },
    'handoff-recovery': { type: 'boolean' } } });
  if (values.help) {
    console.log(`loomd [--project DIR]\n${projectOption}`);
    return;
  }
  if (values['self-check']) { console.log(JSON.stringify(await selfCheck())); return; }
  const project = projectDirectory(values.project);
  if (values['check-attachments']) {
    const { probeAttachments } = await import('./attachment-check.mjs');
    let roster = '';
    for await (const chunk of process.stdin) {
      roster += chunk;
      if (Buffer.byteLength(roster) > maxLine) throw new Error('Attachment roster is too large');
    }
    const attached = await probeAttachments(project, JSON.parse(roster));
    const legacy = attached.filter(session => session.status === 'attached' && !hasStoredSessionCapability(project, session.addr));
    if (legacy.length && !preparePeerAuth().available) for (const session of legacy) {
      Object.assign(session, { status: 'unavailable', reason: 'Kernel peer identity is unavailable for this legacy session' });
    }
    console.log(JSON.stringify(attached));
    return;
  }
  delete process.env.LOOM_CAPABILITY;
  delete process.env.LOOM_EXTERNAL_SUPER;
  const runningRelease = { id: releaseId(), root: releaseRoot, digest: releaseDigest(releaseRoot) };
  const metadata = join(project, '.project');
  mkdirSync(metadata, { recursive: true, mode: 0o700 });
  if (realpathSync(metadata) !== metadata) throw new Error('loomd metadata directory must be project-local');
  syncDirectory(project);
  const release = claimProject(project);
  process.once('exit', release);
  excludeProjectMetadata(project);
  mkdirSync(runtimeDirectory(project), { recursive: true, mode: 0o700 });
  mkdirSync(join(metadata, 'relay', 'events'), { recursive: true, mode: 0o700 });
  syncDirectory(metadata);
  syncDirectory(join(metadata, 'relay'));
  const handoff = await validateHandoff(project, values.handoff, values['handoff-recovery']);
  const capabilities = socketCapabilities(project);
  installManagedCli(project);
  try { registerGlobalProject(project, { release: runningRelease.id, lastOnlineAt: Date.now(), lastShutdown: 'abnormal' }); }
  catch (error) { console.error(`global registry update: ${error.message}`); }
  const controller = nextController(project);

  const path = socketPath(project);
  const previous = lstatSync(path, { throwIfNoEntry: false });
  if (previous) {
    if (!previous.isSocket()) throw new Error('loomd socket path is occupied');
    unlinkSync(path);
  }
  const supervisor = createSupervisor(project, {
    window: optionalTimeout('LOOM_WAVE_WINDOW_MS'), sealWindow: optionalTimeout('LOOM_WAVE_SEAL_MS'),
    partialWindow: optionalTimeout('LOOM_WAVE_PARTIAL_MS'), uncertainWindow: optionalTimeout('LOOM_UNCERTAIN_MS'),
    blockedWindow: optionalTimeout('LOOM_BLOCKED_COALESCE_MS'),
    ...options,
    sessionOptions: { layout: projectLayout(project), ...options.sessionOptions, controller, capabilities },
  });
  const legacy = new Set(supervisor.legacySessions().map(row => row.addr));
  const peers = legacy.size ? preparePeerAuth() : undefined;
  if (peers && !peers.available) {
    throw new Error(`Kernel peer identity is unavailable for running legacy Loom sessions. ${peers.reason}`);
  }
  const recovering = Boolean(handoff && values['handoff-recovery']);
  let ready = !handoff || recovering;
  let attached, attachmentError;
  let lastPollError;
  let chain = Promise.resolve();
  let closing;
  let timer;
  let switching = false;
  let activated = !handoff;
  function canDispatch() {
    if (!ready || closing || switching) return false;
    if (activated) return true;
    const state = upgradeState(project);
    if (state?.id !== handoff.id || state.pid !== process.pid) return false;
    activated = recovering ? state.phase === 'failed' :
      state.phase === 'committed' && activeRelease(project)?.upgradeId === handoff.id;
    return activated;
  }
  function serial(task) {
    const result = chain.then(task);
    chain = result.catch(() => {});
    return result;
  }

  const server = createServer(socket => {
    socket.setEncoding('utf8');
    socket.setTimeout(10_000, () => socket.destroy());
    socket.on('error', () => {});
    let data = '';
    socket.on('data', function receive(chunk) {
      data += chunk;
      if (Buffer.byteLength(data) > maxLine) return socket.destroy();
      if (!data.includes('\n')) return;
      socket.off('data', receive);
      socket.setTimeout(0);
      serve().catch(error => socket.end(JSON.stringify({
        ok: false, error: { code: error.code && typeof error.code === 'string' && /^[a-z-]+$/.test(error.code) ?
          error.code : 'unavailable', message: error.message, ...(error.freshCommand && { freshCommand: error.freshCommand }) },
      }) + '\n'));

      async function serve() {
        const { command, args = {}, capability, protocol } = JSON.parse(data);
        if (protocol !== undefined && protocol !== daemonProtocol) throw new Error('Unsupported loomd protocol');
        if (typeof command !== 'string' || !args || typeof args !== 'object' || Array.isArray(args)) {
          throw Object.assign(new Error('Expected a loomd command and an argument object'), { code: 'invalid-arguments' });
        }
        const authorize = async () => {
          let actor = capabilities.identify(capability, supervisor.liveCaller);
          if (!actor && capability === undefined && legacy.size && mayUseLegacyCaller(command)) {
            actor = await supervisor.legacyPeerCaller(peers.ancestors(socket), legacy);
          }
          authorizeSocketCommand(command, args, actor);
          return actor;
        };
        let result;
        if (command === 'daemon-status' || command === 'daemon-stop') {
          if (command === 'daemon-stop') await serial(authorize);
          result = { running: !closing && command === 'daemon-status', pid: process.pid,
            relay: closing ? 'stopping' : lastPollError ? 'degraded' : 'integrated',
            protocol: daemonProtocol, release: runningRelease, attachmentCheck: true,
            ...(handoff && { handoff: handoff.id, ready, sessions: attached, attachmentError }) };
        } else if (command === 'hello') {
          result = { protocol: daemonProtocol, incarnation: controller.id, generation: controller.generation };
        } else if (command === 'upgrade-status') {
          result = { active: { ...activeRelease(project)?.current, ...runningRelease },
            upgrade: upgradeState(project), sessions: canDispatch() ? await serial(supervisor.upgradeSessions) : attached ?? [] };
        } else if (command === 'upgrade-holder') {
          result = await serial(async () => {
            await authorize();
            if (!canDispatch()) throw Object.assign(new Error('loomd is switching releases'), { code: 'not-ready' });
            return supervisor.upgradeHolder(args);
          });
        } else if (command === 'upgrade-plan' || command === 'upgrade-apply') {
          await serial(authorize);
          if (!canDispatch()) throw Object.assign(new Error('loomd is switching releases'), { code: 'not-ready' });
          const plan = await planUpgrade(project, args, runningRelease, () => serial(supervisor.upgradeSessions));
          if (command === 'upgrade-plan') {
            const checked = await checkUpgradeAttachments(project, plan);
            result = { ...checked, eligible: !checked.blockers.length };
          } else result = await serial(async () => {
            await authorize();
            if (!canDispatch()) throw Object.assign(new Error('loomd is switching releases'), { code: 'not-ready' });
            // Capture sessions started while the target was being verified.
            plan.sessions = await supervisor.upgradeSessions();
            const receipt = await beginUpgrade(project, plan, args.upgradeId);
            switching = true;
            return receipt;
          });
        } else if (command === 'accounts-refresh') {
          const { pending } = await serial(async () => {
            if (!canDispatch()) throw Object.assign(new Error('loomd is switching releases'), { code: 'not-ready' });
            const actor = await authorize();
            return { pending: supervisor.handle(command, args, actor?.addr, { external: actor?.external }) };
          });
          result = await pending;
        } else {
          result = await serial(async () => {
            if (!canDispatch()) throw Object.assign(new Error('loomd is switching releases'), { code: 'not-ready' });
            const actor = await authorize();
            return supervisor.handle(command, args, actor?.addr, { external: actor?.external });
          });
        }
        socket.end(JSON.stringify({ ok: true, ...result }) + '\n');
        if (command === 'daemon-stop' || command === 'upgrade-apply') void stop();
      }
    });
  });

  function stop() {
    return closing ??= (async () => {
      clearInterval(timer);
      server.close();
      await chain;
      await supervisor.shutdown();
      try { markProjectShutdown(project, 'normal', process.env, Date.now()); }
      catch (error) { console.error(`global registry shutdown: ${error.message}`); }
      release();
      process.exit(0);
    })();
  }

  for (const signal of ['SIGHUP', 'SIGTERM', 'SIGINT']) process.once(signal, stop);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, resolve);
  });
  chmodSync(path, 0o600);

  async function verifyAttachments() {
    try {
      attached = await supervisor.reattach(handoff.sessions);
      validateReattachment(handoff, { sessions: attached });
      ready = true;
    } catch (error) {
      attachmentError = error.message;
      console.error(attachmentError);
    }
  }

  let polling = false;
  let handoffCheckAt = 0;
  function poll() {
    if (polling || closing) return;
    if (!canDispatch()) {
      if (handoff && !switching && Date.now() >= handoffCheckAt) {
        handoffCheckAt = Date.now() + 1000;
        polling = true;
        void liveHandoff(project, handoff.id).then(live => {
          // The launcher can persist the outcome and exit while this probe is in flight.
          if (!live && !canDispatch()) void stop();
        }, error => console.error(error.message)).finally(() => { polling = false; });
      }
      return;
    }
    polling = true;
    void serial(() => canDispatch() && supervisor.tick()).then(() => { lastPollError = undefined; }, error => {
      lastPollError = error;
      console.error(error.message);
    }).finally(() => { polling = false; });
  }
  timer = setInterval(poll, pollInterval);
  poll();
  if (handoff && !recovering) await verifyAttachments();
}
