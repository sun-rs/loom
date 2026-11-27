import { accountVersion, verifiedAccountVersion } from './versions.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const percent = (value, max = 100) => Number.isFinite(value) && value >= 0 && value <= max;
const rounded = value => Math.round(value * 100) / 100;
const token = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_.-]{0,95}$/i.test(value) ? value : null;
export function maskEmail(email) {
  const match = typeof email === 'string' && /^([a-z0-9])[a-z0-9._+%*-]*@([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/i.exec(email.trim());
  return match ? `${match[1]}***@${match[2]}` : null;
}

export function accountMetadata(ctx, plan) {
  const expiresAt = accountTime(ctx.expiresAt);
  return {
    masked_account: maskEmail(ctx.maskedAccount ?? ctx.email),
    plan: token(plan) ?? token(ctx.plan),
    ...(typeof ctx.active === 'boolean' && { active: ctx.active }),
    ...(expiresAt && { expires_at: expiresAt }),
  };
}

export function accountTime(value) {
  const ms = typeof value === 'number' ? value :
    typeof value === 'string' && /T.*(?:Z|[+-]\d\d:?\d\d)$/i.test(value) ? Date.parse(value) : NaN;
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

const reset = value => accountTime(typeof value === 'number' ? value * 1000 : value);
const validReset = value => value == null || reset(value) !== null;
const matches = (row, ctx) => {
  const id = row.session_id ?? row.sessionId ?? row.conversationId;
  return id == null || !ctx.sessionId || id === ctx.sessionId;
};
const sidechain = row => row.isSidechain || row.agent_id || row.agentId || row.parent_tool_use_id || row.parentToolUseId;

function at(ctx, time) {
  if (time != null) return accountTime(time);
  return accountTime(ctx.observedAt ?? (ctx.isReplay ? null : Date.now()));
}

function collect(cli, source, ctx, observedAt, windows, plan) {
  if (!observedAt) return [];
  const unverified = !verifiedAccountVersion(cli, ctx.cliVersion);
  if (windows === null || unverified) {
    const { accountRef, sessionId, generation } = ctx;
    if (accountRef || sessionId || generation) ctx.observeAccountDiagnostics?.([{
      cli, status: windows === null ? 'unsupported' : 'unverified',
      reason: windows === null ? 'unsupported-version-shape' : 'unverified-version',
      cliVersion: accountVersion(ctx.cliVersion), source, observedAt,
      ...(accountRef && { accountRef }), ...(sessionId && { sessionId }), ...(generation && { generation }),
    }]);
    if (windows === null) return [];
  }
  return windows.map(window => ({
    cli, source, observed_at: observedAt,
    ...(unverified && { cli_version: accountVersion(ctx.cliVersion), version_status: 'unverified' }),
    ...accountMetadata(ctx, plan),
    ...(ctx.accountRef && { account_ref: ctx.accountRef }),
    ...(ctx.sessionId && { session_id: ctx.sessionId }),
    ...(ctx.generation && { generation: ctx.generation }),
    ...(ctx.sequence !== undefined && { sequence: ctx.sequence }),
    ...window,
  }));
}

function codexWindows(limits, { id, used, minutes, resets }) {
  if (limits === null) return [];
  if (!object(limits) || limits[id] != null && !token(limits[id]) ||
      !['primary', 'secondary'].some(bucket => Object.hasOwn(limits, bucket))) return null;
  const windows = [];
  for (const bucket of ['primary', 'secondary']) {
    const entry = limits[bucket];
    if (entry == null) continue;
    if (!object(entry) || !percent(entry[used]) ||
        entry[minutes] != null && (!Number.isSafeInteger(entry[minutes]) || entry[minutes] <= 0) ||
        !validReset(entry[resets])) return null;
    windows.push({ limit_id: limits[id] ?? 'codex', bucket, scope: 'account',
      used_percent: entry[used], window_minutes: entry[minutes] ?? null, resets_at: reset(entry[resets]) });
  }
  return windows;
}

export function parseCodexRolloutLine(row, ctx) {
  const payload = row?.payload;
  if (row?.type !== 'event_msg' || payload?.type !== 'token_count' || !Object.hasOwn(payload, 'rate_limits') ||
      !matches(row, ctx) || !matches(payload, ctx)) return [];
  const limits = payload.rate_limits;
  return collect('codex', 'codex-rollout', ctx, at(ctx, row.timestamp),
    codexWindows(limits, { id: 'limit_id', used: 'used_percent', minutes: 'window_minutes', resets: 'resets_at' }),
    limits?.plan_type);
}

export function parseCodexPushNotification(msg, ctx) {
  if (msg?.method !== 'account/rateLimits/updated' || !matches(msg.params ?? {}, ctx)) return [];
  const limits = msg.params?.rateLimits;
  return collect('codex', 'codex-app-server-push', ctx, at(ctx, msg.timestamp),
    codexWindows(limits, { id: 'limitId', used: 'usedPercent', minutes: 'windowDurationMins', resets: 'resetsAt' }),
    limits?.planType);
}

function claudeWindow(bucket) {
  if (bucket === 'five_hour') return { window_minutes: 300, scope: 'account' };
  if (bucket === 'seven_day') return { window_minutes: 10080, scope: 'account' };
  const family = /^seven_day_(opus|sonnet|haiku|fable)$/.exec(bucket)?.[1];
  if (family) return { window_minutes: 10080, scope: 'model', model: family[0].toUpperCase() + family.slice(1) };
}

function claudeEventWindows(info) {
  const bucket = info?.rateLimitType;
  const window = claudeWindow(bucket);
  const usage = info?.utilization;
  if (!object(info) || !window || !['allowed', 'allowed_warning', 'rejected'].includes(info.status) ||
      (usage == null ? info.status !== 'rejected' || info.resetsAt == null : !percent(usage, 1)) ||
      !validReset(info.resetsAt)) return null;
  return [{ ...window, limit_id: 'claude', bucket,
    used_percent: usage == null ? null : rounded(usage * 100), resets_at: reset(info.resetsAt) }];
}

export function parseClaudeRateLimitEvent(event, ctx) {
  if (event?.type !== 'rate_limit_event' || sidechain(event) || !matches(event, ctx)) return [];
  return collect('claude', 'claude-headless', ctx, at(ctx, event.timestamp),
    claudeEventWindows(event.rate_limit_info), event.rate_limit_info?.plan);
}

export function parseClaudeTranscriptLine(row, ctx) {
  if (!object(row) || sidechain(row) || !matches(row, ctx)) return [];
  const containers = [row, row.message, row.api_error_params, row.message?.api_error_params];
  if (containers.some(value => object(value) && (sidechain(value) || !matches(value, ctx)))) return [];
  const parent = containers.find(value => object(value) && Object.hasOwn(value, 'rate_limit_info'));
  if (!parent && row.type !== 'rate_limit_info') return [];
  const info = parent ? parent.rate_limit_info : row;
  return collect('claude', 'claude-transcript', ctx, at(ctx, row.timestamp ?? row.created_at),
    claudeEventWindows(info), info?.plan);
}

function claudeStatusWindows(limits) {
  if (!object(limits)) return null;
  const windows = [];
  for (const [bucket, entry] of Object.entries(limits)) {
    const window = claudeWindow(bucket);
    if (!window) return null;
    if (entry === null) continue;
    if (!object(entry) || !percent(entry.used_percentage) || !validReset(entry.resets_at)) return null;
    windows.push({ ...window, limit_id: 'claude', bucket,
      used_percent: entry.used_percentage, resets_at: reset(entry.resets_at) });
  }
  return windows;
}

export function parseClaudeStatuslinePayload(payload, ctx) {
  if (!object(payload) || !Object.hasOwn(payload, 'rate_limits') || !matches(payload, ctx)) return [];
  return collect('claude', 'claude-statusline', ctx, at(ctx), claudeStatusWindows(payload.rate_limits), payload.plan_tier);
}

function agyWindows(quotas) {
  if (!Array.isArray(quotas)) return null;
  const windows = [];
  const seen = new Set();
  for (const quota of quotas) {
    const id = token(quota?.id);
    const match = /^(gemini|3p)-(5h|weekly)$/.exec(id ?? '');
    const window = quota?.window;
    if (!match || match[2] !== window || seen.has(id) || !percent(quota.used_percentage) ||
        !validReset(quota.reset_time)) return null;
    seen.add(id);
    const resetsAt = reset(quota.reset_time);
    windows.push({ limit_id: id, bucket: window, scope: 'pool',
      model: match[1] === 'gemini' ? 'Gemini Models' : 'Claude and GPT models',
      used_percent: quota.used_percentage, window_minutes: window === '5h' ? 300 : 10080,
      resets_at: resetsAt === '1970-01-01T00:00:00.000Z' ? null : resetsAt });
  }
  return windows;
}

export function parseAgyStatuslinePayload(payload, ctx) {
  if (!object(payload) || !matches(payload, ctx) ||
      !Object.hasOwn(payload, 'quotas') && !Object.hasOwn(payload, 'quota')) return [];
  return collect('agy', 'agy-statusline', ctx, at(ctx),
    agyWindows(Object.hasOwn(payload, 'quotas') ? payload.quotas :
      Array.isArray(payload.quota) ? payload.quota : [payload.quota]), payload.plan_tier);
}
