import { inspectScreen } from '../../adapters/tui-screen.mjs';
import claude from '../../adapters/claude/index.mjs';

const quota = /\b(?:usage_limit_reached|quota(?:_exceeded)?|(?:claude |weekly |daily |session |5-hour )?usage limit|(?:weekly|daily|session|5-hour) limit|you(?:'|’)ve hit your (?:claude )?(?:usage )?limit)\b/i;
const rate = /\b(?:rate[ _-]limit(?:ed|_error)?|too many requests|429)\b/i;

function classify(text) {
  // Feed the adapter equivalent copy for additional plan-specific wording.
  // Keep the rest of the frame intact so its tool/prompt filters still apply.
  return claude.screen.classify(text
    .replace(/\byou(?:'|’)ve (?:hit|reached) your (?:weekly|daily|session|5-hour) (?:usage )?limit\b/gi, "You've hit your limit")
    .replace(/\b(?:weekly|daily|session|5-hour) usage limit reached\b/gi, 'Usage limit reached'));
}

function failed(failure, reason, status) {
  return { kind: 'failed', failure, reason, ...(status === undefined ? {} : { status }) };
}

export function stopFailure(row, evidence) {
  const code = row.error ?? 'unknown';
  const reason = row.error_details?.trim() || evidence?.reason || code;
  const statusMatch = /(?:^|\b(?:HTTP(?: error)?|API error|status(?: code)?)[: ]+)([45]\d{2})(?=[ :\-]|$)/i.exec(reason);
  const status = statusMatch ? Number(statusMatch[1]) : undefined;
  if (quota.test(code) || quota.test(reason) || evidence?.failure === 'quota') {
    return failed('quota', reason, status);
  }
  if (code === 'rate_limit' || rate.test(code) || rate.test(reason) || status === 429) {
    return failed('rate_limited', reason, status);
  }
  if (/^auth(?:entication|orization)?(?:_(?:error|failed))?$/.test(code) || status === 401) {
    return failed('auth', reason, status);
  }
  if (/^(?:billing(?:_error)?|insufficient_credits)$/.test(code)) return failed('billing', reason, status);
  if (/^overloaded(?:_error)?$/.test(code) || status === 529) return failed('overloaded', reason, status);
  if (code === 'invalid_request') return failed('invalid_request', reason, status);
  if (code === 'server_error' || status >= 500) return failed('provider', reason, status);
  return failed(evidence?.failure ?? 'unknown', reason, status);
}

export function screenEvidence(text) {
  const assessment = inspectScreen(classify, text);
  const { kind } = assessment;
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean).slice(-24);
  const diagnostic = kind === 'auth-fail' || kind === 'rate-limit'
    ? lines.findLast((line) => classify(line) === kind)
    : undefined;
  const reason = diagnostic?.replace(/^[\s⎿•⏺✖⚠]+/u, '');
  const failure = diagnostic === undefined ? null : failed(
    kind === 'auth-fail' ? 'auth' : quota.test(reason) ? 'quota' : 'rate_limited',
    reason,
    kind === 'rate-limit' && /\b429\b/.test(reason) ? 429 : undefined,
  );
  const repeats = diagnostic === undefined ? 0 : lines.filter((line) => line === diagnostic).length;
  const interruption = lines.filter((line) => /^(?:[⎿•]\s*)?Interrupted\s*·\s*What should Claude do instead\?/i.test(line)).length;
  return {
    ...assessment, text, failure, interruption,
    failureKey: diagnostic === undefined ? null : `${repeats}:${diagnostic}`,
    ready: kind === 'idle',
    busy: kind === 'busy',
    emptyComposer: claude.screen.hasEmptyComposer(text),
  };
}
