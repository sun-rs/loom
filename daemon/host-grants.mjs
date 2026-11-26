import { randomUUID } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { inDirectory, runtimeDirectory } from '../cli/project.mjs';
import { CommandError } from '../cli/sessions.mjs';
import { readText, writeState } from './io.mjs';

const defaultTtl = 30 * 60_000;
export const hostTrustWarning = 'Trusted host tier. Best-effort hooks are not fail-closed for Codex tool paths.';
const restrictedPath = /(?:^|[/\\])(?:ccp|solars|rah_os|\.?loom-next|\.ssh|\.aws|\.codex|\.claude|\.gemini)(?:[/\\]|$)|claude-protected/i;

export function hostWritePaths(project, paths) {
  const protectedRoots = [homedir(), join(project, '.project'), join(homedir(), 'Library', 'Keychains')];
  function canonical(path) {
    if (lstatSync(path, { throwIfNoEntry: false })) return realpathSync(path);
    return join(canonical(dirname(path)), basename(path));
  }
  return [...new Set(paths.map(path => {
    const normalized = resolve(path);
    if (restrictedPath.test(normalized)) throw new CommandError('invalid-arguments', 'Host write paths cannot cover protected locations');
    const target = canonical(normalized);
    if (restrictedPath.test(target) ||
        protectedRoots.some(root => inDirectory(target, root)) || protectedRoots.slice(1).some(root => inDirectory(root, target))) {
      throw new CommandError('invalid-arguments', 'Host write paths cannot cover protected locations');
    }
    return target;
  }))];
}

export function hostGrants(project, { now = Date.now, notify }) {
  const file = join(runtimeDirectory(project), 'host-grants.json');
  const read = () => JSON.parse(readText(file, '{"grants":[]}'));
  const save = state => writeState(file, JSON.stringify(state) + '\n');
  const matches = (grant, row) => grant.project === row.project && (grant.wave ? row.wave : row.task) === grant.target;
  const publicGrant = ({ claims, closedTasks, ...grant }) => ({ ...grant, remaining: grant.uses - claims.length });

  function issue(state, name, { target, wave, reason, ttlMs, uses, write }, issuedBy) {
    const issuedAt = now();
    const expiresAt = issuedAt + (ttlMs ?? defaultTtl);
    if (!Number.isSafeInteger(expiresAt) || !Number.isFinite(new Date(expiresAt).getTime())) throw new CommandError('invalid-arguments', 'Host grant expiry is outside the supported range');
    const previous = state.grants.findLast(grant => grant.project === name && grant.wave === wave && grant.target === target);
    if (previous && !previous.closedAt && previous.expiresAt > issuedAt) {
      previous.closedAt = issuedAt;
      previous.closeReason = 'replaced';
    }
    const grant = { id: randomUUID(), project: name, target, wave, reason, tier: 'host', issuedBy, issuedAt, expiresAt,
      uses, write: hostWritePaths(project, write), claims: [], closedTasks: {} };
    state.grants.push(grant);
    save(state);
    return grant;
  }

  function publish(grant) {
    const scope = `${grant.wave ? 'wave' : 'task'} ${grant.target}`;
    const event = (suffix, type, at, text, fields = {}) => ({ id: `${grant.id}:${suffix}`, type, grantId: grant.id,
      project: grant.project, at, text, ...fields });
    notify(event('granted', 'host-tier-grant', grant.issuedAt,
      `Host grant for ${scope} · ${grant.uses} use(s) · expires ${new Date(grant.expiresAt).toISOString()} · ${grant.reason}. ${hostTrustWarning}`,
      { grant: { ...publicGrant(grant), remaining: grant.uses } }), ...grant.claims.map(({ addr, at, task }, i) => event(addr, 'host-tier-used', at,
      `Host use for ${task} · ${grant.uses - i - 1} of ${grant.uses} remaining`, { addr })),
    ...(grant.wave ? Object.entries(grant.closedTasks) : []).map(([task, at]) => event(`closed-${task}`, 'host-tier-expired', at,
      `Host access expired for task ${task} · card ended`)),
    ...(grant.closedAt ? [event('expired', 'host-tier-expired', grant.closedAt, `Host grant for ${scope} expired · ${grant.closeReason}`)] : []));
  }

  function unavailable(grant, row, code, reason) {
    notify({ id: `${grant.id}:refused:${code}:${row.task}`, type: 'host-tier-refused', project: row.project,
      grantId: grant.id, at: now(), text: `Host launch refused for ${row.task} · ${reason}` });
    throw new CommandError(code, reason);
  }

  return {
    grant(name, spec, issuedBy) {
      const state = read();
      const grant = issue(state, name, spec, issuedBy);
      for (const entry of state.grants) publish(entry);
      return publicGrant(grant);
    },
    reserve(row, policyWave) {
      const state = read();
      const eligible = state.grants.filter(grant => matches(grant, row));
      let grant = eligible.findLast(grant => !grant.wave) ?? eligible.findLast(grant => grant.wave);
      if (!grant && policyWave) {
        grant = issue(state, row.project, { target: row.wave, wave: true, reason: 'Named wave pre-authorized in project policy',
          uses: 1, write: [] }, 'policy');
      }
      if (!grant) throw new CommandError('host-grant-required', `No host grant for ${row.task} or ${row.wave}`);
      if (grant.issuedBy === 'policy' && !policyWave) unavailable(grant, row, 'host-grant-expired', 'Host wave authorization was removed');
      if (grant.closedAt || grant.expiresAt <= now() || Object.hasOwn(grant.closedTasks, row.task)) {
        unavailable(grant, row, 'host-grant-expired', 'Host grant expired or card ended');
      }
      if (grant.claims.length >= grant.uses) unavailable(grant, row, 'host-grant-exhausted', 'Host grant has no remaining uses');
      grant.claims.push({ addr: row.addr, task: row.task, at: now() });
      save(state);
      publish(grant);
      return { id: grant.id, expiresAt: grant.expiresAt, write: grant.write };
    },
    active(row, id) {
      const grant = read().grants.find(grant => grant.id === id);
      return Boolean(grant && matches(grant, row) && !grant.closedAt && grant.expiresAt > now() &&
        !Object.hasOwn(grant.closedTasks, row.task) && grant.claims.some(claim => claim.addr === row.addr));
    },
    closeCard(row, id, at = now()) {
      const state = read();
      const grant = state.grants.find(grant => grant.id === id);
      if (!grant || !matches(grant, row) || Object.hasOwn(grant.closedTasks, row.task)) return;
      grant.closedTasks[row.task] = at;
      if (!grant.wave && !grant.closedAt) {
        grant.closedAt = at;
        grant.closeReason = 'card-ended';
      }
      save(state);
      publish(grant);
    },
    sweep() {
      const state = read();
      const expired = state.grants.filter(grant => !grant.closedAt && grant.expiresAt <= now());
      for (const grant of expired) {
        grant.closedAt = now();
        grant.closeReason = 'time-limit';
      }
      if (expired.length) save(state);
      for (const grant of state.grants) publish(grant);
    },
  };
}
