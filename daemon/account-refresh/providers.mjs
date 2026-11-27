import { claudeResetTime } from './claude-time.mjs';
import { parseJson, readCodex, RefreshFailure, rejectShape, runCommand } from './process.mjs';

const semver = 'v?\\d{1,8}\\.\\d{1,8}\\.\\d{1,8}(?:-[a-z0-9.-]{1,48})?(?:\\+[a-z0-9.-]{1,48})?';
const agentVersion = new RegExp('^[\\w.-]+/(' + semver + ')(?:\\s|$)', 'i');
const commandVersion = new RegExp('^(?:(?:claude|agy|opencode)\\s+)?(' + semver + ')(?:\\s+\\(Claude Code\\))?$', 'i');

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const token = value => typeof value === 'string' && /^[a-z\d][a-z\d_.-]{0,95}$/i.test(value);
const label = value => typeof value === 'string' && /^[\p{L}\p{N}][\p{L}\p{N} .+()_/-]{0,95}$/u.test(value);
const percent = value => Number.isFinite(value) && value >= 0 && value <= 100;
const nonnegativeInteger = value => Number.isSafeInteger(value) && value >= 0;
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
const concretePlan = value => value && value !== 'unknown' ? value : null;
const isoTime = value => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
function validIsoInput(value) {
  const match = typeof value === 'string' &&
    /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i.exec(value);
  return !!match && isoTime(match[1])?.slice(0, 10) === match[1] && isoTime(value) !== null;
}

function recordVersion(ctx, evidence, pattern) {
  ctx.version = typeof evidence === 'string' ? pattern.exec(evidence.trim())?.[1] ?? null : null;
}

async function probeVersion(binary, ctx) {
  const { code, stdout } = await runCommand(binary, ['--version'], ctx);
  recordVersion(ctx, code === 0 ? stdout : null, commandVersion);
}

function requireSuccess(result) {
  if (result.code !== 0) throw new RefreshFailure('error', 'cli-process-failed');
}

async function codex(binary, ctx) {
  const { account: accountFrame, limits: limitsFrame } = await readCodex(binary, ctx, (agent, home) => {
    recordVersion(ctx, agent, agentVersion);
    if (ctx.configDir && home != null && home !== ctx.configDir) rejectShape();
  });
  if (accountFrame.error) throw new RefreshFailure('error', 'cli-rpc-failed');
  const read = accountFrame.result;
  if (!object(read) || typeof read.requiresOpenaiAuth !== 'boolean' || !Object.hasOwn(read, 'account')) rejectShape();
  const account = read.account;
  if (account === null) throw new RefreshFailure('not-signed-in');
  if (!object(account) || !['chatgpt', 'apiKey', 'amazonBedrock', 'gcp'].includes(account.type)) rejectShape();
  if (account.type !== 'chatgpt') throw new RefreshFailure('unsupported', 'usage-unavailable');
  if (account.planType != null && !token(account.planType) || account.email != null && typeof account.email !== 'string') rejectShape();
  if (limitsFrame.error) throw new RefreshFailure('error', 'cli-rpc-failed');

  const limits = limitsFrame.result;
  if (!object(limits) || !object(limits.rateLimits) ||
      limits.rateLimitsByLimitId != null && !object(limits.rateLimitsByLimitId) ||
      limits.accountId != null && !token(limits.accountId)) rejectShape();
  const credits = limits.rateLimitResetCredits;
  if (credits != null && (!object(credits) || !nonnegativeInteger(credits.availableCount))) rejectShape();

  const scopes = new Map();
  for (const [key, snapshot] of [
    [limits.rateLimits.limitId ?? 'codex', limits.rateLimits],
    ...Object.entries(limits.rateLimitsByLimitId ?? {}),
  ]) {
    if (!token(key) || !object(snapshot) || snapshot.limitId != null && snapshot.limitId !== key ||
        snapshot.planType != null && !token(snapshot.planType) ||
        !['primary', 'secondary'].some(bucket => Object.hasOwn(snapshot, bucket))) rejectShape();
    const windows = scopes.get(key) ?? new Map();
    for (const bucket of ['primary', 'secondary']) {
      const window = snapshot[bucket];
      if (window == null) continue;
      if (!object(window) || !percent(window.usedPercent) ||
          window.windowDurationMins != null && !positiveInteger(window.windowDurationMins) ||
          window.resetsAt != null && (!nonnegativeInteger(window.resetsAt) || !isoTime(window.resetsAt * 1000))) rejectShape();
      windows.set(bucket, {
        scope: 'account', limit_id: key, bucket, used_percent: window.usedPercent,
        window_minutes: window.windowDurationMins ?? null,
        resets_at: window.resetsAt == null ? null : isoTime(window.resetsAt * 1000),
        plan: concretePlan(snapshot.planType) ?? concretePlan(account.planType),
      });
    }
    scopes.set(key, windows);
  }

  const plan = concretePlan(account.planType) ?? concretePlan(limits.rateLimits.planType);
  return {
    windows: [...scopes.values()].flatMap(windows => [...windows.values()]), email: account.email,
    identity: limits.accountId, plan, active: true, resetCredits: credits?.availableCount ?? null,
  };
}

async function claude(binary, ctx) {
  const auth = await runCommand(binary, ['auth', 'status', '--json'], ctx);
  let account;
  try { account = JSON.parse(auth.stdout); }
  catch { requireSuccess(auth); }
  // Signed-out status is explicit even when auth status returns a nonzero exit.
  if (account?.loggedIn === false) throw new RefreshFailure('not-signed-in');
  await probeVersion(binary, ctx);
  requireSuccess(auth);
  if (!object(account) || account.loggedIn !== true ||
      account.email != null && typeof account.email !== 'string' ||
      account.authMethod != null && !token(account.authMethod) ||
      account.subscriptionType != null && !token(account.subscriptionType) ||
      account.planTier != null && !token(account.planTier) ||
      account.loginExpiresAt != null && !validIsoInput(account.loginExpiresAt)) rejectShape();
  if (account.authMethod != null && account.authMethod !== 'claude.ai') {
    throw new RefreshFailure('unsupported', 'usage-unavailable');
  }

  const result = await runCommand(binary, ['-p', '/usage', '--no-session-persistence', '--output-format', 'json'], ctx);
  requireSuccess(result);
  const usage = parseJson(result.stdout);
  if (usage?.type !== 'result' || usage.subtype !== 'success' || usage.is_error !== false ||
      usage.local_command !== 'usage' || usage.num_turns !== 0 ||
      usage.duration_api_ms !== 0 || usage.total_cost_usd !== 0 || typeof usage.result !== 'string') rejectShape();
  const windows = new Map();
  for (const line of usage.result.split('\n').map(line => line.trim())) {
    if (!/^Current\b|% used\b/.test(line)) continue;
    const match = /^(Current session|Current week \(([^)]+)\)): (\d{1,3}(?:\.\d+)?)% used(?:\s*·\s*resets (.+))?$/.exec(line);
    if (!match || !percent(Number(match[3]))) rejectShape();
    const [, , name, used, reset] = match;
    const model = !name || name === 'all models' ? null : name;
    if (model && !label(model)) rejectShape();
    const bucket = !name ? 'five_hour' : model ? 'seven_day_' + model.toLowerCase().replace(/[^a-z\d]+/g, '_') : 'seven_day';
    const resetsAt = reset ? claudeResetTime(reset, ctx.startedAt) : null;
    if (resetsAt === undefined || windows.has(bucket)) rejectShape();
    windows.set(bucket, {
      scope: model ? 'model' : 'account', limit_id: 'claude', bucket, model,
      used_percent: Number(used), window_minutes: name ? 10080 : 300, resets_at: resetsAt,
    });
  }
  if (!windows.size) rejectShape();
  return {
    windows: [...windows.values()], email: account.email, active: true,
    plan: concretePlan(account.subscriptionType) ?? concretePlan(account.planTier),
    expiresAt: account.loginExpiresAt == null ? null : isoTime(account.loginExpiresAt),
  };
}

async function agy(binary, ctx) {
  await probeVersion(binary, ctx);
  const result = await runCommand(binary, ['-p', '/usage', '--output-format', 'json'], ctx);
  const usage = parseJson(result.stdout);
  if (usage?.status === 'UNAUTHENTICATED' || usage?.status === 'NOT_SIGNED_IN') throw new RefreshFailure('not-signed-in');
  requireSuccess(result);
  const groups = usage?.command?.data?.groups;
  if (usage?.status !== 'SUCCESS' || usage.num_turns !== 0 || usage.usage?.total_tokens !== 0 ||
      usage.command?.name !== 'usage' || !Array.isArray(groups)) rejectShape();
  const windows = [];
  const ids = new Set();
  for (const group of groups) {
    if (!label(group?.name) || !Array.isArray(group.buckets)) rejectShape();
    for (const bucket of group.buckets) {
      if (!object(bucket) || bucket.disabled != null && typeof bucket.disabled !== 'boolean') rejectShape();
      if (bucket.disabled === true) continue;
      if (!token(bucket.id) || ids.has(bucket.id) || !['weekly', '5h'].includes(bucket.window) ||
          !Number.isFinite(bucket.remaining_fraction) || bucket.remaining_fraction < 0 || bucket.remaining_fraction > 1 ||
          bucket.reset_time != null && !validIsoInput(bucket.reset_time)) rejectShape();
      const reset = bucket.reset_time == null ? null : isoTime(bucket.reset_time);
      ids.add(bucket.id);
      windows.push({
        scope: 'pool', limit_id: bucket.id, bucket: bucket.window, model: group.name,
        used_percent: Math.round((1 - bucket.remaining_fraction) * 10_000) / 100,
        window_minutes: bucket.window === 'weekly' ? 10080 : 300,
        resets_at: reset === '1970-01-01T00:00:00.000Z' ? null : reset,
      });
    }
  }
  return { windows };
}

async function opencode(binary, ctx) {
  await probeVersion(binary, ctx);
  const result = await runCommand(binary, ['--standalone', 'api', 'GET', '/api/experimental/usage/limits'], ctx);
  const response = parseJson(result.stdout);
  if (response?.status === 401 || response?.error?.status === 401) throw new RefreshFailure('not-signed-in');
  requireSuccess(result);
  const data = response?.data;
  if (data === null) throw new RefreshFailure('unsupported', 'usage-unavailable');
  // OpenCode v2.3.0, packages/schema/src/usage-limits.ts.
  if (!object(data) || !token(data.workspace?.id) || !Array.isArray(data.budgets)) rejectShape();
  const windows = [];
  if (data.go != null) {
    if (!object(data.go)) rejectShape();
    for (const [bucket, windowMinutes] of [['rolling', 300], ['weekly', 10080], ['monthly', null]]) {
      const meter = data.go[bucket];
      if (!object(meter) || !percent(meter.percent) || typeof meter.limited !== 'boolean' ||
          !nonnegativeInteger(meter.resetsAt) || !isoTime(meter.resetsAt)) rejectShape();
      windows.push({
        scope: 'account', limit_id: 'opencode-go', bucket, used_percent: meter.percent,
        window_minutes: windowMinutes, resets_at: isoTime(meter.resetsAt), plan: 'go',
      });
    }
  }
  const budgetIds = new Set();
  for (const budget of data.budgets) {
    if (!token(budget?.id) || budgetIds.has(budget.id) ||
        !Number.isFinite(budget.limit) || budget.limit < 0 || !Number.isFinite(budget.spent) || budget.spent < 0 ||
        !nonnegativeInteger(budget.resetsAt) || !isoTime(budget.resetsAt)) rejectShape();
    budgetIds.add(budget.id);
    windows.push({
      scope: 'account', limit_id: 'opencode-budget-' + budget.id, bucket: 'monthly',
      used_percent: budget.limit > 0 ? Math.min(100, Math.round(budget.spent / budget.limit * 10_000) / 100) : null,
      window_minutes: null, resets_at: isoTime(budget.resetsAt), plan: data.go ? 'go' : 'console',
    });
  }
  if (!windows.length) throw new RefreshFailure('unsupported', 'usage-unavailable');
  return { windows, identity: data.workspace.id, plan: data.go ? 'go' : 'console' };
}

export const readProvider = { codex, claude, agy, opencode };
