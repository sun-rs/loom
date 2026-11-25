import { isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { daemonAbsent, request } from '../daemon/rpc.mjs';
import { activeRelease, upgradeState } from '../daemon/release.mjs';
import { checkUpgradeAttachments, liveHandoff } from '../daemon/upgrade.mjs';
import { projectDirectory, projectIndex, projectReceipt } from './project.mjs';
import { CommandError } from './sessions.mjs';
import { startDaemon } from './control.mjs';

export const upgradeUsage = 'loom upgrade [--project DIR] (--to RELEASE [--check] | --rollback [--check] | --status) [--holder SESSION] [--json]';

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
  if (values.holder !== undefined) {
    return { ...await request(project, 'upgrade-holder', { addr: values.holder, target: values.to,
      rollback: values.rollback, check: values.check }), ...context };
  }
  if (!daemon.protocol) {
    const sessions = projectIndex(project).query({ endedAt: null, backend: 'headless' });
    const reason = 'This loomd predates detached session hosts. Stop or retire its headless sessions before installing a compatible daemon.';
    if (!values.check) throw new CommandError('not-ready', reason);
    return { ok: true, ...context, eligible: false, reason, sessions: sessions.map(({ addr, sessionId, backend }) =>
      ({ addr, sessionId, backend, status: 'legacy' })) };
  }
  const plan = { target: values.to, rollback: values.rollback };
  if (values.check || !daemon.attachmentCheck) {
    const checked = await request(project, 'upgrade-plan', plan);
    const verified = daemon.attachmentCheck ? checked : await checkUpgradeAttachments(project, checked);
    const eligible = !verified.blockers?.length;
    if (values.check) return { ...verified, ...context, eligible };
    if (!eligible) throw new CommandError('not-ready', 'Some sessions could not be verified. Run loom upgrade --check for details.');
  }
  const result = await request(project, 'upgrade-apply', plan);
  const deadline = Date.now() + 145_000;
  let launcherCheckAt = 0;
  do {
    const state = upgradeState(project);
    if (state?.id === result.upgradeId) {
      const pending = state.phase === 'switching' || state.recoveryPending;
      if (!pending) {
        if (state.phase === 'failed' && !state.recovered && state.current?.root &&
            (activeRelease(project)?.current.root ?? state.current.root) === state.current.root) {
          try {
            const running = await startDaemon(project, state.current);
            if (running.release?.root === state.current.root) {
              return { ...context, ...state, ok: false, recovered: true, pid: running.pid };
            }
          } catch (error) {
            return { ...context, ...state, ok: false, restartError: error.message };
          }
        }
        return { ...context, ok: state.phase === 'committed', ...state };
      }
      if (Date.now() >= launcherCheckAt) {
        launcherCheckAt = Date.now() + 1000;
        // Daemon startup repairs the orphaned switching record under the
        // writer lock. A candidate still exiting can delay the restart.
        if (!liveHandoff(project, state.id)) {
          const running = await startDaemon(project, state.current).catch(() => undefined);
          const final = upgradeState(project);
          const expected = activeRelease(project)?.current ?? state.current;
          if (running?.release?.root === expected.root && final?.id === state.id && final.phase !== 'switching') {
            const committed = final.phase === 'committed';
            return { ...context, ...final, ok: committed, ...(!committed && { recovered: true }), pid: running.pid };
          }
        }
      }
    }
    await delay(150);
  } while (Date.now() < deadline);
  return { ...context, ...result, ok: false, error: 'Upgrade is still pending. Query loom upgrade --status.' };
}
