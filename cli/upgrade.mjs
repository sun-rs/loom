import { isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { daemonAbsent, request } from '../daemon/rpc.mjs';
import { activeRelease, upgradeState } from '../daemon/release.mjs';
import { projectDirectory, projectIndex, projectReceipt } from './project.mjs';
import { CommandError } from './sessions.mjs';

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
  const result = await request(project, values.check ? 'upgrade-plan' : 'upgrade-apply',
    { target: values.to, rollback: values.rollback });
  if (values.check) return { ...result, ...context };
  const deadline = Date.now() + 145_000;
  do {
    const state = upgradeState(project);
    if (state?.id === result.upgradeId && state.phase !== 'switching') {
      return { ...context, ok: state.phase === 'committed', ...state };
    }
    await delay(150);
  } while (Date.now() < deadline);
  return { ...context, ...result, ok: false, error: 'Upgrade is still pending. Query loom upgrade --status.' };
}
