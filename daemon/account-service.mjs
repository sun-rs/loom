import { accountVersion, createAccountStore, refreshAccountDiagnostic, refreshAccountSources } from './accounts.mjs';

export function accountService(project, { now = Date.now, report, notifications, rows, options = {}, accountBinding }) {
  const accountStore = createAccountStore(project, { now, ...options.store });
  const lastAccountAttempts = new Map();
  const sessionAccountIncidents = new Map();
  let refreshing;
  let refreshController;
  function accountOperation(operation) {
    try { return operation(); }
    catch { report('Could not persist project account evidence'); }
  }

  function publishAccountWarnings() {
    accountOperation(() => {
      const pending = accountStore.pendingWarnings();
      if (!pending.length) return;
      const names = new Set(rows().map(row => row.project));
      const name = names.size === 1 ? names.values().next().value : project;
      notifications.add(...pending.map(event => ({ ...event, project: name, batch: 'account-evidence' })));
      accountStore.ackWarnings(pending.map(event => event.id));
    });
  }

  async function refreshProjectAccounts(signal) {
    const refresh = options.refresh ?? (await import('./account-refresh.mjs')).refreshAccounts;
    const configured = typeof options.profiles === 'function' ? await options.profiles() : options.profiles;
    const result = await refresh({ executables: options.executables, accounts: configured, now,
      secret: accountOperation(() => accountStore.identitySecret()),
      lastAttempts: lastAccountAttempts, minRefreshIntervalMs: 60_000, signal });
    if (signal.aborted) return accountStore.formatBoardSummary();
    const { observations, outcomes, resolvedExecutables } = result;
    accountOperation(() => accountStore.observe(observations ?? []));
    const observedAt = result.refreshed_at ?? new Date(now()).toISOString();
    const diagnostics = [];
    const publicOutcomes = {};
    for (const [name, outcome] of Object.entries(outcomes ?? {})) {
      const cli = outcome.cli ?? name.split(':', 1)[0];
      if (!Object.hasOwn(refreshAccountSources, cli) ||
          !['ok', 'not-signed-in', 'unsupported', 'timeout', 'error', 'cooldown'].includes(outcome.status)) continue;
      const version = accountVersion(outcome.version);
      const diagnostic = refreshAccountDiagnostic(cli, outcome, observedAt);
      if (diagnostic) diagnostics.push(diagnostic);
      let publicKey = cli;
      for (let n = 2; Object.hasOwn(publicOutcomes, publicKey); n++) publicKey = cli + ':' + n;
      publicOutcomes[publicKey] = { cli, status: outcome.status, ...(diagnostic && { reason: diagnostic.reason }),
        ...(outcome.versionStatus === 'unverified' && { versionStatus: 'unverified' }),
        ...(version !== null && { version }) };
    }
    accountOperation(() => accountStore.observeDiagnostics(diagnostics));
    publishAccountWarnings();
    const { accounts, diagnostics: rejected, snapshotUnavailable } = accountStore.read();
    return { accounts, refreshed_at: result.refreshed_at, outcomes: publicOutcomes, ...(rejected.length && { diagnostics: rejected }),
      ...(resolvedExecutables && { resolvedExecutables }),
      ...(snapshotUnavailable && { snapshotUnavailable }) };
  }

  function observeAccountHealth(row, job, snapshot, health) {
    const ref = accountBinding?.(row)?.accountRef ?? job.accountRef ?? job.account_ref;
    const prior = sessionAccountIncidents.get(row.addr);
    const failed = health && ['quota-wait', 'auth-expired'].includes(health.status);
    if (!ref || !snapshot || !failed && (!prior || health?.status === 'silent-hang')) return;
    const next = failed ? { cli: row.cli, account_ref: ref, session_id: row.sessionId ?? row.addr,
      status: health.status, observed_at: health.since, resets_at: health.retryAt,
      limit_id: health.limit_id ?? health.limitId, bucket: health.bucket } : undefined;
    accountStore.observeIncidents([next ?? { ...prior, status: 'recovered', observed_at: now() }]);
    if (next) sessionAccountIncidents.set(row.addr, next);
    else sessionAccountIncidents.delete(row.addr);
  }

  return {
    collectors: {
      accountBinding,
      observeAccounts: batch => accountOperation(() => accountStore.observe(batch)),
      observeAccountDiagnostics: batch => accountOperation(() => accountStore.observeDiagnostics(batch)),
      observeAccountIncidents: batch => accountOperation(() => accountStore.observeIncidents(batch)),
    },
    read: accountStore.formatBoardSummary,
    refresh() {
      if (!refreshing) {
        refreshController = new AbortController();
        refreshing = refreshProjectAccounts(refreshController.signal).finally(() => { refreshing = refreshController = undefined; });
      }
      return refreshing;
    },
    async close() {
      refreshController?.abort();
      await refreshing?.catch(() => {});
    },
    observeHealth: (...args) => accountOperation(() => observeAccountHealth(...args)),
    clearHealth: addr => sessionAccountIncidents.delete(addr),
    publishWarnings: publishAccountWarnings,
  };
}
