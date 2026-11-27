import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runtimeDirectory } from '../cli/project.mjs';
import { accountWarningPercent, providers } from '../cli/policy.mjs';
import { readText, writeState } from './io.mjs';
import { accountVersion } from '../adapters/accounts/versions.mjs';
export { accountVersion } from '../adapters/accounts/versions.mjs';

export const accountsPath = project => join(runtimeDirectory(project), 'accounts.json');
export const accountStaleMs = 7_200_000;
const passive = new Set(['codex-rollout', 'codex-app-server-push', 'claude-headless',
  'claude-transcript', 'claude-statusline', 'agy-statusline']);
export const refreshAccountSources = Object.freeze({
  codex: 'codex-app-server', claude: 'claude-cli', agy: 'agy-cli', opencode: 'opencode-api',
});
const sources = new Set([...passive, ...Object.values(refreshAccountSources)]);
const identityFields = ['account_ref', 'session_id', 'generation'];
const metadataFields = ['masked_account', 'active', 'reset_credits', 'expires_at'];
const hash = value => createHash('sha256').update(value).digest('hex');
const key = (...parts) => JSON.stringify(parts);
const time = value => typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
const iso = value => Number.isFinite(time(value)) && Math.abs(time(value)) <= 8.64e15 ? new Date(time(value)).toISOString() : null;

export const redactAccountText = value => String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
  .replace(/[^\s@<>()\[\],:;"]+@([a-z0-9.-]+\.[a-z]{2,})/gi, (email, domain) => email[0] + '***@' + domain);
const field = value => typeof value === 'string' && value.trim() ? redactAccountText(value).trim().slice(0, 200) : null;
const masked = value => typeof value === 'string' && /^[^\s@]+@[a-z\d.-]+\.[a-z]{2,}$/i.test(value.trim()) ?
  redactAccountText(value.trim()) : null;
const internalId = value => typeof value === 'string' && value && value.length <= 512 ?
  (/^[a-z\d_.:-]+$/i.test(value) ? value : hash(value)) : null;
export function refreshAccountDiagnostic(cli, outcome, observedAt) {
  const unverified = outcome.status === 'ok' && outcome.versionStatus === 'unverified';
  if (!Object.hasOwn(refreshAccountSources, cli) || !unverified && (outcome.status !== 'unsupported' ||
      !['unsupported-version-shape', 'usage-unavailable'].includes(outcome.reason))) return;
  return {
    cli, status: unverified ? 'unverified' : outcome.status, reason: unverified ? 'unverified-version' : outcome.reason, cliVersion: accountVersion(outcome.version),
    source: refreshAccountSources[cli], observedAt, accountRef: outcome.accountRef ?? outcome.account_ref,
    generation: 'refresh:' + cli,
  };
}
const percent = value => Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const sequence = row => integer(row.sequence ?? row.seq ?? row.source_seq);
const identity = row => row.account_ref ?? row.session_id ?? row.generation;
const accountKey = row => key(row.cli, identity(row), row.plan);
const windowKey = row => key(row.cli, identity(row), row.plan, row.limit_id, row.bucket);
const metadataEvidence = row => ({ source: row.source, observedAt: row.observed_at });
const identityKey = row => key(row.cli, identity(row));
const diagnosticKey = row => key(row.cli, row.accountRef ?? row.sessionId ?? row.generation, row.source);
const incidentKey = row => key(row.cli, row.account_ref, row.session_id, row.status, row.limit_id, row.bucket);
const isStale = (row, now, staleMs) => now - time(row.observed_at) > staleMs || time(row.resets_at) <= now;

function observation(row, secret) {
  if (!providers.includes(row?.cli) || !sources.has(row.source) || !iso(row.observed_at)) return;
  const ids = Object.fromEntries(identityFields.flatMap(name => {
    const value = internalId(row[name]);
    return value ? [[name, value]] : [];
  }));
  if (!identity(ids) && secret && typeof row.masked_account === 'string' && row.masked_account.includes('@') &&
      !row.masked_account.includes('***')) {
    ids.account_ref = createHmac('sha256', secret).update(row.masked_account.trim().toLowerCase()).digest('hex');
  }
  const resetsAt = iso(row.resets_at);
  return {
    cli: row.cli, ...ids, masked_account: masked(row.masked_account), plan: field(row.plan),
    limit_id: field(row.limit_id), bucket: field(row.bucket),
    scope: ['account', 'model', 'pool'].includes(row.scope) ? row.scope : null,
    model: field(row.model), used_percent: percent(row.used_percent), window_minutes: integer(row.window_minutes) || null,
    resets_at: resetsAt === '1970-01-01T00:00:00.000Z' ? null : resetsAt,
    source: row.source, observed_at: iso(row.observed_at),
    ...(row.version_status === 'unverified' && { version_status: row.version_status, cli_version: accountVersion(row.cli_version) }),
    active: typeof row.active === 'boolean' ? row.active : null,
    reset_credits: row.cli === 'codex' ? integer(row.reset_credits) : null, expires_at: iso(row.expires_at),
    ...(sequence(row) != null && { sequence: sequence(row) }),
    ...((row.replayed === true || row.isReplay === true) && { replayed: true }),
  };
}

function diagnostic(row) {
  if (!providers.includes(row?.cli) || !sources.has(row.source) || !iso(row.observedAt)) return;
  const unverified = row.status === 'unverified' && row.reason === 'unverified-version';
  const rejected = row.status === 'unsupported' && (row.reason === 'unsupported-version-shape' ||
    row.reason === 'usage-unavailable' && row.source === refreshAccountSources[row.cli]);
  if (!unverified && !rejected) return;
  const ids = Object.fromEntries(['accountRef', 'sessionId', 'generation'].flatMap(name => {
    const value = internalId(row[name]);
    return value ? [[name, value]] : [];
  }));
  if (!Object.keys(ids).length) return;
  return { cli: row.cli, status: row.status, reason: row.reason, cliVersion: accountVersion(row.cliVersion),
    source: row.source, observedAt: iso(row.observedAt), ...ids };
}

function incident(row) {
  const accountRef = internalId(row?.account_ref);
  if (!accountRef || !providers.includes(row.cli) || !['quota-wait', 'auth-expired', 'recovered'].includes(row.status) ||
      !iso(row.observed_at)) return;
  return { cli: row.cli, account_ref: accountRef, status: row.status,
    session_id: internalId(row.session_id), observed_at: iso(row.observed_at), resets_at: iso(row.resets_at),
    limit_id: field(row.limit_id), bucket: field(row.bucket), ...(iso(row.cleared_at) && { cleared_at: iso(row.cleared_at) }) };
}

function metadata(row) {
  const normalized = observation(row);
  if (!normalized || !metadataFields.includes(row.name) || normalized[row.name] == null) return;
  return { cli: normalized.cli, ...Object.fromEntries(identityFields.filter(name => normalized[name])
    .map(name => [name, normalized[name]])), plan: normalized.plan, source: normalized.source,
  observed_at: normalized.observed_at, name: row.name, [row.name]: normalized[row.name] };
}

const empty = () => ({
  version: 1, snapshots: [], refresh_fallbacks: [], pending_warnings: [], diagnostics: [], incidents: [], metadata: [], warned: [],
});

function load(project) {
  const state = JSON.parse(readText(accountsPath(project), 'null'));
  if (state === null) return empty();
  if (state.version !== 1 || !Array.isArray(state.snapshots) || !Array.isArray(state.pending_warnings) ||
      ['refresh_fallbacks', 'diagnostics', 'incidents', 'metadata', 'warned'].some(name => state[name] !== undefined && !Array.isArray(state[name]))) {
    throw new Error('Invalid accounts snapshot store');
  }
  return { ...empty(), ...state,
    snapshots: state.snapshots.map(row => observation(row)).filter(Boolean),
    refresh_fallbacks: (state.refresh_fallbacks ?? []).map(row => observation(row)).filter(Boolean),
    diagnostics: (state.diagnostics ?? []).map(diagnostic).filter(Boolean),
    incidents: (state.incidents ?? []).map(incident).filter(Boolean),
    metadata: (state.metadata ?? []).map(metadata).filter(Boolean) };
}

function isNewer(row, previous) {
  return !previous || row.observed_at > previous.observed_at ||
    row.observed_at === previous.observed_at && row.source === previous.source &&
      (row.sequence ?? -1) > (previous.sequence ?? -1);
}

const sameResetCycle = (a, b) => !a.resets_at || !b.resets_at || a.resets_at === b.resets_at;

function primaryWindow(row, previous, at, staleMs) {
  if (!previous) return true;
  if (row.resets_at && previous.resets_at && row.resets_at < previous.resets_at) return false;
  if (row.used_percent === null && previous.used_percent !== null) return false;
  if (sameResetCycle(row, previous) && row.used_percent !== null && previous.used_percent !== null && !isStale(row, at, staleMs)) {
    const incomingPassive = passive.has(row.source);
    const existingPassive = passive.has(previous.source);
    if (incomingPassive !== existingPassive && !isStale(previous, at, staleMs)) return incomingPassive;
  }
  return isNewer(row, previous);
}

function displayWindow(row, at, staleMs, quota, auth) {
  const model = row.model ?? null;
  const duration = row.window_minutes === 300 ? '5h' : row.window_minutes === 10080 ? '周' :
    row.window_minutes ? row.window_minutes + 'm' : null;
  return {
    id: [row.limit_id, row.bucket].filter(Boolean).map(encodeURIComponent).join('/'),
    label: [model, duration].filter(Boolean).join(' ') || row.bucket || row.limit_id || '额度',
    kind: model || ['model', 'pool'].includes(row.scope) ? 'model' :
      duration === '5h' ? '5h' : duration === '周' ? 'weekly' : 'model',
    model, usedPercent: quota || auth ? null : row.used_percent,
    windowMinutes: quota ? null : row.window_minutes,
    resetsAt: quota ? quota.resets_at : row.resets_at,
    source: quota ? 'runtime-error' : row.source,
    observedAt: quota ? quota.observed_at : row.observed_at,
    stale: quota ? false : isStale(row, at, staleMs),
    ...(quota && { status: quota.status }),
    ...(!quota && row.version_status === 'unverified' && { versionStatus: 'unverified', cliVersion: row.cli_version }),
  };
}

const publicDiagnostic = ({ accountRef, sessionId, generation, ...row }) => row;
const publicSnapshot = ({ account_ref, session_id, generation, sequence, replayed, ...row }) => row;
const activeIncident = (row, at) => row.status !== 'recovered' && !row.cleared_at &&
  !(row.status === 'quota-wait' && time(row.resets_at) <= at);
const matchesQuota = (row, quota) => (!quota.limit_id || quota.limit_id === row.limit_id) && (!quota.bucket || quota.bucket === row.bucket);

function projectView(state, at, staleMs) {
  const { metadata, incidents, diagnostics } = state;
  const fallbacks = new Map(state.refresh_fallbacks.map(row => [windowKey(row), row]));
  const snapshots = state.snapshots.map(row => {
    const backup = fallbacks.get(windowKey(row));
    return backup && isStale(row, at, staleMs) && !isStale(backup, at, staleMs) &&
      sameResetCycle(backup, row) ? backup : row;
  });
  const groups = Map.groupBy([...snapshots, ...metadata], identityKey);
  const live = Map.groupBy(incidents.filter(row => activeIncident(row, at)), identityKey);
  const rejected = Map.groupBy(diagnostics, row => key(row.cli, row.accountRef ?? row.sessionId ?? row.generation));
  const accounts = [];
  for (const [id, rows] of groups) {
    const plans = new Set(rows.map(row => row.plan).filter(Boolean));
    const byPlan = Map.groupBy(rows, row => row.plan ?? (plans.size === 1 ? plans.values().next().value : null));
    for (const [plan, evidence] of byPlan) {
      const { cli } = evidence[0];
      const account = { cli, plan, accountMasked: null, active: null, resetCredits: null, expiresAt: null, windows: [] };
      for (const [name, fieldName] of [['masked_account', 'accountMasked'], ['active', 'active'],
        ['reset_credits', 'resetCredits'], ['expires_at', 'expiresAt']]) {
        const known = evidence.filter(row => row[name] != null && (!row.name || row.name === name));
        const latest = known.reduce((prior, row) => isNewer(row, prior) ? row : prior, undefined);
        if (latest) {
          account[fieldName] = latest[name];
          if (name === 'reset_credits' || name === 'expires_at') account[fieldName + 'Evidence'] = metadataEvidence(latest);
        }
      }
      const active = live.get(id) ?? [];
      const auth = active.find(row => row.status === 'auth-expired');
      if (auth) account.status = auth.status;
      const windows = Map.groupBy(evidence.filter(row => !row.name), row => key(row.limit_id, row.bucket));
      const quotas = active.filter(row => row.status === 'quota-wait').sort((a, b) =>
        Number(Boolean(b.limit_id || b.bucket)) - Number(Boolean(a.limit_id || a.bucket)) ||
        Number(Boolean(b.resets_at)) - Number(Boolean(a.resets_at)) || b.observed_at.localeCompare(a.observed_at));
      if (quotas.length && !auth) account.status = 'quota-wait';
      account.windows = [...windows.values()].map(rows => {
        const row = rows.reduce((previous, item) => primaryWindow(item, previous, at, staleMs) ? item : previous, undefined);
        return displayWindow(row, at, staleMs, quotas.find(quota => matchesQuota(row, quota)), auth);
      });
      for (const quota of quotas) {
        if (![...windows.values()].some(rows => matchesQuota(rows[0], quota))) {
          account.windows.push(displayWindow(quota, at, staleMs, quota, auth));
        }
      }
      const rejections = (rejected.get(id) ?? []).filter(item =>
        !evidence.some(row => row.source === item.source && row.observed_at > item.observedAt));
      if (rejections.length) account.diagnostics = rejections.map(publicDiagnostic);
      accounts.push(account);
    }
  }
  for (const [id, rows] of live) {
    if (groups.has(id)) continue;
    const status = rows.some(row => row.status === 'auth-expired') ? 'auth-expired' : 'quota-wait';
    accounts.push({ cli: rows[0].cli, plan: null, accountMasked: null, active: null, resetCredits: null,
      expiresAt: null, status, windows: rows.filter(row => row.status === 'quota-wait')
        .map(row => displayWindow(row, at, staleMs, row)),
      ...(rejected.has(id) && { diagnostics: rejected.get(id).map(publicDiagnostic) }) });
  }
  const unmatched = [...rejected].filter(([id]) => !groups.has(id) && !live.has(id)).flatMap(([, rows]) => rows);
  return { version: 1, snapshots: snapshots.map(row => ({
    ...publicSnapshot(row), stale: isStale(row, at, staleMs), age_ms: Math.max(0, at - time(row.observed_at)),
  })), accounts, diagnostics: unmatched.map(publicDiagnostic) };
}

export function readAccounts(project, { now = Date.now, staleMs = accountStaleMs } = {}) {
  try { return projectView(load(project), now(), staleMs); }
  catch { return { ...projectView(empty(), now(), staleMs), snapshotUnavailable: true }; }
}

export function createAccountStore(project, { now = Date.now, staleMs = accountStaleMs, secret } = {}) {
  const path = accountsPath(project);
  // A validation failure must not replace the last file with an empty store.
  let state;
  function current() { return state ??= load(project); }
  function save(next) {
    mkdirSync(runtimeDirectory(project), { recursive: true, mode: 0o700 });
    writeState(path, JSON.stringify(next) + '\n');
    state = next;
  }
  function identitySecret() {
    if (secret) return secret;
    const before = current();
    if (typeof before.identity_key === 'string' && /^[a-f0-9]{64}$/.test(before.identity_key)) {
      return Buffer.from(before.identity_key, 'hex');
    }
    const generated = randomBytes(32);
    save({ ...before, identity_key: generated.toString('hex') });
    return generated;
  }
  function observe(rows, options = {}) {
    const input = rows.map(row => {
      const rawEmail = typeof row?.masked_account === 'string' && row.masked_account.includes('@') &&
        !row.masked_account.includes('***');
      return observation(row, !identity(row ?? {}) && rawEmail ? identitySecret() : secret);
    }).filter(Boolean);
    if (!input.length) return;
    const before = current();
    const windows = new Map(before.snapshots.map(row => [windowKey(row), row]));
    const fallbacks = new Map(before.refresh_fallbacks.map(row => [windowKey(row), row]));
    const values = new Map(before.metadata.map(row => [key(accountKey(row), row.name), row]));
    const diagnostics = new Map(before.diagnostics.map(row => [diagnosticKey(row), row]));
    const warned = new Set(before.warned);
    const pending = [...before.pending_warnings];
    const at = now();
    const warningPercent = options.warningPercent ?? accountWarningPercent(project);
    let changed = false;
    for (const inputRow of input) {
      const row = { ...inputRow };
      if (row.source === refreshAccountSources[row.cli]) {
        const id = key(row.cli, row.generation ?? row.account_ref, row.source);
        const previous = diagnostics.get(id);
        if (previous?.reason === 'usage-unavailable' && row.observed_at >= previous.observedAt) {
          diagnostics.delete(id);
          changed = true;
        }
      }
      const known = new Set([...windows.values(), ...values.values()].filter(previous =>
        identityKey(previous) === identityKey(row) && previous.plan).map(previous => previous.plan));
      if (row.plan == null && known.size === 1) row.plan = known.values().next().value;
      for (const name of metadataFields) {
        if (row[name] == null) continue;
        const item = metadata({ ...row, name });
        const id = key(accountKey(row), name);
        if (isNewer(row, values.get(id))) { values.set(id, item); changed = true; }
      }
      if (!row.bucket && !row.limit_id) continue;
      const id = windowKey(row);
      const previous = windows.get(id);
      const replace = primaryWindow(row, previous, at, staleMs);
      const selected = replace ? row : previous;
      const unselected = replace ? previous : row;
      if (unselected?.used_percent != null && passive.has(selected.source) && !passive.has(unselected.source) &&
          sameResetCycle(selected, unselected) && !isStale(unselected, at, staleMs) && isNewer(unselected, fallbacks.get(id))) {
        fallbacks.set(id, unselected);
        changed = true;
      }
      if (!replace) continue;
      changed = true;
      windows.set(id, row);
      const fallback = fallbacks.get(id);
      if (fallback && (!passive.has(row.source) || !sameResetCycle(row, fallback) || isStale(fallback, at, staleMs))) {
        fallbacks.delete(id);
      }
      if (row.replayed || row.used_percent === null || row.used_percent < warningPercent ||
          !row.resets_at || isStale(row, at, staleMs)) continue;
      const boundError = before.incidents.some(item => identityKey(item) === identityKey(row) && activeIncident(item, at) &&
        (item.status === 'auth-expired' || matchesQuota(row, item)));
      if (boundError) continue;
      const ref = row.account_ref ?? (identity(row) ? hash(identity(row)) : 'anon');
      const warningId = ['account-quota-warning', row.cli, ref, row.limit_id, row.bucket, row.resets_at].join(':');
      if (warned.has(warningId) || pending.some(event => event.id === warningId)) continue;
      warned.add(warningId);
      pending.push({ id: warningId, project, type: 'account-quota-warning', cli: row.cli, at,
        text: [row.cli, row.masked_account, row.plan, row.model ?? row.bucket, row.used_percent + '%', '重置 ' + row.resets_at]
          .filter(Boolean).join(' · ') });
    }
    if (changed) save({ ...before, snapshots: [...windows.values()], refresh_fallbacks: [...fallbacks.values()], metadata: [...values.values()],
      diagnostics: [...diagnostics.values()], pending_warnings: pending, warned: [...warned] });
  }

  return {
    observe, identitySecret,
    observeDiagnostics(rows) {
      const input = rows.map(diagnostic).filter(Boolean);
      if (!input.length) return;
      const before = current();
      const diagnostics = new Map(before.diagnostics.map(row => [diagnosticKey(row), row]));
      const pending = [...before.pending_warnings];
      const warned = new Set(before.warned);
      let changed = false;
      for (const row of input) {
        const id = diagnosticKey(row);
        if (diagnostics.get(id)?.observedAt >= row.observedAt) continue;
        changed = true;
        diagnostics.set(id, row);
        if (row.reason === 'usage-unavailable') continue;
        const unverified = row.status === 'unverified';
        const type = unverified ? 'account-version-unverified' : 'account-version-unsupported';
        const eventId = type + ':' + hash(key(unverified ? row.cli : id, row.cliVersion));
        if (warned.has(eventId) || pending.some(event => event.id === eventId)) continue;
        warned.add(eventId);
        pending.push({ id: eventId, project, type, at: now(),
          cli: row.cli, cliVersion: row.cliVersion, reason: row.reason,
          text: [row.cli, row.cliVersion, unverified ? 'unverified version' : '结构不匹配，无法解析'].filter(Boolean).join(' · ') });
      }
      if (changed) save({ ...before, diagnostics: [...diagnostics.values()], pending_warnings: pending, warned: [...warned] });
    },
    observeIncidents(rows) {
      const input = rows.map(incident).filter(Boolean);
      if (!input.length) return;
      const before = current();
      const incidents = new Map(before.incidents.map(row => [incidentKey(row), row]));
      let changed = false;
      for (const row of input) {
        const match = incidentKey(row);
        const prior = incidents.get(match);
        const recoveryKey = incidentKey({ ...row, status: 'recovered', limit_id: null, bucket: null });
        if (row.status === 'recovered') {
          if (incidents.get(recoveryKey)?.observed_at >= row.observed_at) continue;
          incidents.set(recoveryKey, row);
          changed = true;
          for (const [id, other] of incidents) {
            if (other.cli === row.cli && other.account_ref === row.account_ref && other.session_id === row.session_id &&
                other.status !== 'recovered' && !other.cleared_at && other.observed_at < row.observed_at) {
              incidents.set(id, { ...other, cleared_at: row.observed_at });
            }
          }
          continue;
        }
        if (row.cleared_at ? !prior || prior.cleared_at || row.cleared_at <= prior.observed_at :
          incidents.get(recoveryKey)?.observed_at > row.observed_at ||
          prior && (row.observed_at < prior.observed_at || row.observed_at <= (prior.cleared_at ?? '') ||
            row.observed_at === prior.observed_at && (!row.resets_at || prior.resets_at === row.resets_at))) continue;
        incidents.set(match, row.cleared_at ? { ...prior, cleared_at: row.cleared_at } : row);
        changed = true;
      }
      if (changed) save({ ...before, incidents: [...incidents.values()] });
    },
    read: () => readAccounts(project, { now, staleMs }),
    pendingWarnings: () => current().pending_warnings.map(event => ({ ...event })),
    ackWarnings(ids) {
      const before = current();
      const pending = before.pending_warnings.filter(event => !ids.includes(event.id));
      if (pending.length !== before.pending_warnings.length) save({ ...before, pending_warnings: pending,
        warned: [...new Set([...before.warned, ...ids])] });
    },
    formatBoardSummary() {
      const { accounts, diagnostics, snapshotUnavailable } = readAccounts(project, { now, staleMs });
      return { accounts, ...(diagnostics.length && { diagnostics }), ...(snapshotUnavailable && { snapshotUnavailable }) };
    },
  };
}
