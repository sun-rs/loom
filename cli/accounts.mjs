import { accountStaleMs, readAccounts, redactAccountText } from '../daemon/accounts.mjs';
import { daemonAbsent, request } from '../daemon/rpc.mjs';

const minute = 60_000;
const executableStatusText = new Map([
  ['rejected', '路径已拒绝'],
  ['not-found', '未找到'],
  ['invalid-cli-executable', '可执行文件路径无效'],
  ['not-selected', '本次未选中'],
]);
const date = value => typeof value === 'string' ? Date.parse(value) : NaN;
const ageLabel = age => {
  if (age >= 60 * minute) return Math.floor(age / (60 * minute)) + ' 小时';
  if (age >= minute) return Math.floor(age / minute) + ' 分钟';
  return Math.floor(Math.max(0, age) / 1000) + ' 秒';
};

function countdown(ms) {
  const total = Math.ceil(ms / minute);
  const days = Math.floor(total / 1440);
  const hours = Math.floor(total % 1440 / 60);
  const minutes = total % 60;
  return [days && days + 'd', hours && hours + 'h', minutes && minutes + 'm'].filter(Boolean).join(' ');
}

function meter(used, elapsed) {
  const width = 12;
  const filled = Math.round(used * width / 100);
  const marker = Number.isFinite(elapsed) ? Math.round(Math.max(0, Math.min(1, elapsed)) * (width - 1)) : -1;
  return '[' + Array.from({ length: width }, (_, i) => i === marker ? '│' : i < filled ? '█' : '░').join('') + ']';
}

function outcomeText({ status, reason, version, cliVersion, versionStatus }) {
  if (reason === 'unverified-version' || versionStatus === 'unverified') {
    return ['unverified version', cliVersion ?? version].filter(Boolean).join(' ');
  }
  if (reason === 'unsupported-version-shape') return ['该版本暂不支持解析', cliVersion ?? version].filter(Boolean).join(' ');
  if (reason === 'usage-unavailable') return '用量不可用';
  return {
    'not-signed-in': '未登录', unsupported: '不支持', timeout: '刷新超时', error: '刷新失败', cooldown: '刷新冷却中',
    'quota-wait': 'quota-wait', 'auth-expired': 'auth-expired',
  }[status];
}

const label = (...fields) => fields.filter(value => value != null && value !== '' && value !== false)
  .map(redactAccountText).join(' · ');

export function formatAccountsText(data, { now = Date.now, timeZone, color = false, summary = false } = {}) {
  const at = now();
  const stamp = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone });
  const calendar = new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone });
  const localTime = value => stamp.format(value);
  const localDate = value => {
    const { year, month, day } = Object.fromEntries(calendar.formatToParts(value).map(({ type, value }) => [type, value]));
    return year + '-' + month + '-' + day;
  };
  const today = localDate(at);
  const resetTime = value => {
    const day = localDate(value);
    const time = localTime(value);
    return day === today ? time : day.slice(-5) + ' ' + time;
  };
  const dim = text => color ? '\x1b[90m' + text + '\x1b[0m' : text;
  const expired = (observed, stale) => {
    if (!stale) return null;
    return Number.isFinite(observed) ? '过期 · 数据 ' + ageLabel(at - observed) + '前' : '过期';
  };
  const staleEvidence = observed => at - observed > accountStaleMs;
  const evidence = sample => {
    if (!sample) return null;
    const observed = date(sample.observedAt);
    return label(sample.source, Number.isFinite(observed) && localDate(observed) + ' ' + localTime(observed));
  };
  const detail = (text, sample, stale) => {
    const observed = date(sample?.observedAt);
    const rendered = label(text, evidence(sample), expired(observed, stale));
    return stale ? dim(rendered) : rendered;
  };
  const accounts = data.accounts ?? [];
  const rows = accounts.map(account => {
    const windows = account.windows ?? [];
    const nextReset = Math.min(...windows.map(window => date(window.resetsAt)).filter(reset => reset > at));
    let refresh = !windows.length;
    const parts = [
      label(account.cli, account.plan, account.accountMasked, account.active === true && '使用中', outcomeText(account)),
      Number.isFinite(nextReset) && '重置 ' + countdown(nextReset - at) + ' (' + resetTime(nextReset) + ')',
    ];
    if (Number.isSafeInteger(account.resetCredits) && account.resetCredits >= 0) {
      const sample = account.resetCreditsEvidence;
      const stale = staleEvidence(date(sample?.observedAt));
      refresh ||= stale;
      parts.push(detail('重置卡 ' + account.resetCredits, sample, stale));
    }
    const expiry = date(account.expiresAt);
    if (Number.isFinite(expiry)) {
      const sample = account.expiresAtEvidence;
      const stale = staleEvidence(date(sample?.observedAt)) || expiry <= at;
      refresh ||= stale;
      parts.push(detail('有效期 ' + localDate(expiry), sample, stale));
    }
    for (const window of windows) {
      const reset = date(window.resetsAt);
      const observed = date(window.observedAt);
      const stale = window.stale === true || !window.status && (staleEvidence(observed) || reset <= at);
      const used = window.usedPercent;
      const known = Number.isFinite(used) && used >= 0 && used <= 100;
      const elapsed = window.windowMinutes > 0 ? 1 - (reset - at) / (window.windowMinutes * minute) : NaN;
      const usage = known && (summary ? used + '%' : label(meter(used, elapsed) + ' ' + used + '%',
        !Number.isFinite(elapsed) && '时间进度未知'));
      const text = label(window.label, usage, window.status, outcomeText(window), !summary && Number.isFinite(reset) && '重置 ' + resetTime(reset));
      refresh ||= stale || !known && !window.status && !account.status;
      parts.push(detail(text, window, stale));
    }
    parts.push(...new Set((account.diagnostics ?? []).map(outcomeText).filter(Boolean)));
    if (!windows.length) parts.push('暂无快照');
    if (refresh) parts.push('用 --refresh 刷新');
    return parts.filter(Boolean).join(' · ');
  });
  const statuses = new Set();
  for (const diagnostic of data.diagnostics ?? []) {
    const text = label(diagnostic.cli, outcomeText(diagnostic), evidence(diagnostic));
    if (text) statuses.add(text);
  }
  for (const [name, result] of Object.entries(data.outcomes ?? {})) {
    const text = outcomeText(result);
    if (!text || result.reason &&
        [...(data.diagnostics ?? []), ...accounts.flatMap(account => account.diagnostics ?? [])].some(item =>
          item.cli === (result.cli ?? name) && item.status === result.status &&
          item.reason === result.reason && item.cliVersion === (result.version ?? null))) continue;
    statuses.add(label(result.cli ?? name, text));
  }
  rows.push(...statuses);
  if (data.snapshotUnavailable) rows.push('快照不可读 · 用 --refresh 刷新');
  else if (!accounts.length) rows.push('暂无快照 · 用 --refresh 刷新');
  if (data.refreshUnavailable) rows.push('刷新不可用 · loomd 离线');
  for (const [cli, value] of Object.entries(data.resolvedExecutables ?? {})) {
    rows.push('可执行文件 · ' + cli + ' · ' + (executableStatusText.get(value) ?? value));
  }
  return rows.join('\n');
}

export function accountSummaryLines(data, options) {
  const document = Array.isArray(data) ? { accounts: data.map(row => row.windows ? row : ({
    cli: row.cli, plan: row.plan, accountMasked: row.masked_account,
    windows: [{ label: row.bucket, usedPercent: row.used_percent, resetsAt: row.resets_at,
      stale: row.stale, observedAt: row.observed_at, source: row.source }],
  })) } : data ?? {};
  return formatAccountsText(document, { ...options, summary: true }).split('\n');
}

export async function runAccounts({ project, refresh }, deps = {}) {
  let refreshUnavailable;
  if (refresh) {
    try { return await (deps.request ?? request)(project, 'accounts-refresh'); }
    catch (error) {
      if (!daemonAbsent(error)) throw error;
      refreshUnavailable = true;
    }
  }
  const { accounts, diagnostics, snapshotUnavailable } = (deps.readAccounts ?? readAccounts)(project);
  return { ok: true, accounts, ...(diagnostics?.length && { diagnostics }),
    ...(refreshUnavailable && { refreshUnavailable }), ...(snapshotUnavailable && { snapshotUnavailable }) };
}
