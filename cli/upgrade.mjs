import { isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { daemonAbsent, request } from '../daemon/rpc.mjs';
import { activeRelease, upgradeState } from '../daemon/release.mjs';
import { checkUpgradeAttachments, liveHandoff } from '../daemon/upgrade.mjs';
import { projectDirectory, projectIndex, projectReceipt } from './project.mjs';
import { CommandError } from './sessions.mjs';
import { startDaemon } from './control.mjs';

export const upgradeUsage = 'loom upgrade [--project DIR] (--to RELEASE [--check] | --rollback [--check] | --status) [--holder SESSION] [--json]';
export const upgradePendingExit = 4;
const terminalPhases = new Set(['committed', 'rolled-back', 'failed']);

export async function upgrade(args) {
  let values;
  try {
    ({ values } = parseArgs({ args, options: { project: { type: 'string' }, to: { type: 'string' },
      check: { type: 'boolean' }, rollback: { type: 'boolean' }, status: { type: 'boolean' }, holder: { type: 'string' },
      json: { type: 'boolean' } } }));
  } catch (error) { throw new CommandError('invalid-arguments', error.message); }
  if ([values.to !== undefined, values.rollback, values.status].filter(Boolean).length !== 1 ||
      values.status && (values.check || values.holder !== undefined) || values.to !== undefined && !isAbsolute(values.to)) {
    throw new CommandError('invalid-arguments', upgradeUsage);
  }
  const project = projectDirectory(values.project);
  const context = projectReceipt(project);
  let daemon;
  try { daemon = await request(project, 'daemon-status'); }
  catch (error) { if (!daemonAbsent(error)) throw error; }
  if (values.status) {
    if (daemon?.running && daemon.protocol) return { ...await request(project, 'upgrade-status'), ...context };
    return { ok: true, ...context, active: activeRelease(project)?.current, upgrade: upgradeState(project),
      sessions: projectIndex(project).query({ endedAt: null }).map(({ addr, backend, sessionId, pane }) =>
        ({ addr, backend, sessionId, pane, status: daemon?.running ? 'legacy' : 'offline' })) };
  }
  if (!daemon?.running) throw new CommandError('not-ready', 'loomd must be running to start an upgrade');
  const smoke = async () => {
    const { promptDoctor } = await import('./prompt-doctor.mjs');
    const result = await promptDoctor(project, { changedOnly: true });
    for (const warning of result.warnings) console.error(`Warning: ${warning}`);
    return { promptSmoke: result };
  };
  if (values.holder !== undefined) {
    return { ...await request(project, 'upgrade-holder', { addr: values.holder, target: values.to,
      rollback: values.rollback, check: values.check }), ...context, ...(values.check && await smoke()) };
  }
  if (!daemon.protocol) {
    const sessions = projectIndex(project).query({ endedAt: null, backend: 'headless' });
    const reason = 'This loomd predates detached session hosts. Stop or retire its headless sessions before installing a compatible daemon.';
    if (!values.check) throw new CommandError('not-ready', reason);
    return { ok: true, ...context, eligible: false, reason, ...await smoke(), sessions: sessions.map(({ addr, sessionId, backend }) =>
      ({ addr, sessionId, backend, status: 'legacy' })) };
  }
  const plan = { target: values.to, rollback: values.rollback };
  if (values.check || !daemon.attachmentCheck) {
    const checked = await request(project, 'upgrade-plan', plan);
    const verified = daemon.attachmentCheck ? checked : await checkUpgradeAttachments(project, checked);
    const eligible = !verified.blockers?.length;
    if (values.check) return { ...verified, ...context, eligible, ...await smoke() };
    if (!eligible) throw new CommandError('not-ready', 'Some sessions could not be verified. Run loom upgrade --check for details.');
  }
  const upgradeId = randomUUID();
  const result = await request(project, 'upgrade-apply', { ...plan, upgradeId }).catch(error => {
    if (!(error instanceof SyntaxError) && !['uncertain', 'ECONNRESET', 'EPIPE'].includes(error.code)) throw error;
    // A handoff may already own the requested ID even if its acknowledgement was lost.
    return { upgradeId, phase: 'unconfirmed' };
  });
  const completed = await waitForUpgrade(result, () => upgradeState(project), async state => {
    // Startup repairs an orphaned switching record under the writer lock.
    const live = await liveHandoff(project, state.id).catch(() => undefined);
    if (live === false) return startDaemon(project, state.current).catch(() => undefined);
  });
  if (completed.phase === 'failed' && !completed.recoveryPending && !completed.recovered && completed.current?.root &&
      (activeRelease(project)?.current.root ?? completed.current.root) === completed.current.root) {
    try {
      const running = await startDaemon(project, completed.current);
      if (running.release?.root === completed.current.root) {
        return { ...context, ...completed, recovered: true, pid: running.pid };
      }
    } catch (error) {
      return { ...context, ...completed, restartError: error.message };
    }
  }
  return { ...context, ...completed };
}

export async function waitForUpgrade(result, readState, recover, {
  now = Date.now, pause = delay, waitMs = 145_000,
} = {}) {
  const deadline = now() + waitMs;
  let launcherCheckAt = 0;
  for (;;) {
    const state = readState();
    if (state?.id === result.upgradeId) {
      if (terminalPhases.has(state.phase) && !state.recoveryPending) return { ...state, ok: state.phase === 'committed' };
      if (now() < deadline && now() >= launcherCheckAt) {
        launcherCheckAt = now() + 1000;
        const running = await recover(state);
        const final = readState();
        if (final?.id === state.id && terminalPhases.has(final.phase) && !final.recoveryPending) {
          return { ...final, ok: final.phase === 'committed' };
        }
        if (final?.id === state.id && final.phase === 'failed' && final.recoveryPending &&
            running?.running && running.release?.root === final.current?.root) {
          return { ...final, ok: false, recovered: true, recoveryPending: false, pid: running.pid };
        }
      }
    }
    if (now() >= deadline) return { ...result, ...(state?.id === result.upgradeId && state), ok: false, pending: true,
      error: state?.id === result.upgradeId || result.phase === 'switching'
        ? 'Upgrade is still switching or recovering. Run loom upgrade --status.'
        : 'Upgrade outcome is still unconfirmed. Run loom upgrade --status.' };
    await pause(Math.min(150, deadline - now()));
  }
}
