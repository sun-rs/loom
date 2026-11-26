import { inside, meter, pad, row, safe, widthOf, wrap } from './status-layout.mjs';

const minute = 60_000;
const staleAfter = 120 * minute;
const when = value => typeof value === 'string' ? Date.parse(value) : NaN;
const maskedEmail = /^[^\s*@]\*{3}@[a-z\d.-]+\.[a-z]{2,}$/i;
const email = /[\w.!#$%&'*+/=?^_\x60{|}~-]+@[a-z\d.-]+\.[a-z]{2,}/gi;
const privateText = value => safe(value).replace(email, match => maskedEmail.test(match) ? match : '[hidden]');

export function duration(ms, round = Math.floor) {
  if (!Number.isFinite(ms)) return '—';
  const minutes = round(Math.max(0, ms) / minute);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes % 1440 / 60);
  if (days) return `${days}d` + (hours ? ` ${hours}h` : '');
  if (hours) return `${hours}h` + (minutes % 60 ? `${String(minutes % 60).padStart(2, '0')}m` : '');
  return minutes ? `${minutes}m` : `${Math.floor(Math.max(0, ms) / 1000)}s`;
}

function resetText(resetsAt, now) {
  if (!Number.isFinite(resetsAt)) return 'reset unknown';
  return resetsAt > now ? `resets in ${duration(resetsAt - now, Math.ceil)}` : 'reset due';
}

function quotaWindow(window, now) {
  const { usedPercent, windowMinutes } = window;
  const used = Number.isFinite(usedPercent) ? Math.round(Math.min(100, Math.max(0, usedPercent))) : null;
  const reset = when(window.resetsAt);
  const observed = when(window.observedAt);
  const pendingReset = reset > now;
  const elapsed = 100 * (1 - (reset - now) / (windowMinutes * minute));
  const pace = pendingReset && windowMinutes > 0 ? Math.min(100, Math.max(0, elapsed)) : null;
  const lead = used != null && pace != null ? used - pace : 0;
  const stale = reset <= now || now - observed >= staleAfter;
  const tone = used == null || stale ? 'muted' : used >= 95 || lead >= 25 ? 'bad' :
    used >= 80 || lead >= 10 ? 'warn' : 'good';
  return { used, reset, pace, lead, tone, stale, observed };
}

function accountHeader(fields, width) {
  const lines = [];
  let line = '';
  for (const field of fields.filter(Boolean)) {
    const next = line ? line + ' · ' + field : field;
    if (line && widthOf(next) > width) {
      lines.push(...wrap(line, width));
      line = field;
    } else line = next;
  }
  return [...lines, ...wrap(line, width)];
}

export function accountRows(document, width, now, paint) {
  const space = inside(width);
  const accounts = document?.accounts;
  if (!Array.isArray(accounts)) return [row(paint('muted', 'Waiting for loom accounts snapshots.'))];
  if (!accounts.length) return [row(paint('muted', 'No quota snapshots · R refresh'))];

  const lines = [row(paint('muted', 'Usage shown as used % · │ elapsed window time'))];
  for (const account of accounts) {
    const identity = maskedEmail.test(account.accountMasked ?? '') ? account.accountMasked : '';
    const name = [privateText(account.cli), privateText(account.plan)].filter(Boolean).join('·');
    const windows = Array.isArray(account.windows) ? account.windows : [];
    const resets = windows.map(window => when(window.resetsAt)).filter(at => at > now);
    const expires = when(account.expiresAt);
    if (lines.length > 1) lines.push(row());
    lines.push(...accountHeader([name || 'Account', identity, account.active && '[in use]',
      resets.length && `next reset ${duration(Math.min(...resets) - now, Math.ceil)}`,
      Number.isSafeInteger(account.resetCredits) && account.resetCredits >= 0 ? `⟲${account.resetCredits} reset credits` : '',
      Number.isFinite(expires) && `expires ${new Date(expires).toISOString().slice(0, 10)}`,
    ], space).map(line => row(paint('accent', line))));
    if (!windows.length) {
      lines.push(row(paint('muted', '  No snapshot · R refresh')));
      continue;
    }
    for (const window of windows) {
      const { used, reset, pace, lead, tone, stale, observed } = quotaWindow(window, now);
      const label = privateText(window.label || window.model || window.kind || window.id || 'Quota');
      const caption = [
        used == null ? 'used % unknown' : `${used}% used`,
        !stale && used != null && pace != null && (lead >= 10 ? '↑ ahead' : lead <= -10 ? '↓ behind' : '~ on pace'),
        resetText(reset, now),
        window.windowMinutes > 0 && duration(window.windowMinutes * minute),
        stale && (Number.isFinite(observed) ? `stale · data ${duration(now - observed)} old` : 'stale'),
        !stale && used != null && !Number.isFinite(observed) && 'data age unknown',
        used == null && 'R refresh',
      ].filter(Boolean).join(' · ');
      const graph = meter(used ?? 0, Math.max(1, Math.min(16, Math.floor(space / 6))), paint, { pace, tone });
      const prefix = '  ' + pad(label, Math.min(14, Math.max(5, Math.floor(space / 4)))) + ' ' + graph;
      if (widthOf(prefix) + 2 + widthOf(caption) <= space) lines.push(row(prefix + '  ' + paint(tone, caption)));
      else {
        // At narrow widths the graph has its own line and the usage data can wrap.
        lines.push(row(space >= widthOf(prefix) ? prefix : label));
        const indent = ' '.repeat(Math.min(4, Math.max(0, space - 1)));
        for (const part of wrap(caption, space - indent.length)) lines.push(row(indent + paint(tone, part)));
      }
    }
  }
  return lines;
}
