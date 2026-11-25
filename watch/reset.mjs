import { stripAnsiAndControl } from '../adapters/agy/lib/classify-screen.mjs';

const monthNames = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');
const clock = /^(?:([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?,?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([\w/+.-]+)\))?/i;
const rateMessage = /\b(?:429|resource_exhausted|too many requests|(?:rate|usage|weekly|daily|session|5-hour)\s+limit|hit your .*?limit|hit your limit|quota|model is at capacity)\b/i;
const resetMarker = /\b(retry[-_ ]after|x-ratelimit-reset|resets?[_ -]at|resets?\s+(?:in|after|on)|try again\s+(?:at|in|after|on)|retry\s+in|resets?)\b["']?\s*[:=]?\s*["']?/gi;

function clockTime(value, now) {
  const match = clock.exec(value);
  if (!match) return null;
  const [, month, day, year, hourText, minuteText, meridiem, timeZone] = match;
  if (!minuteText && !meridiem) return null;
  const hour = Number(hourText);
  const minute = Number(minuteText ?? 0);
  const monthIndex = month && monthNames.indexOf(month.slice(0, 3).toLowerCase());
  if (monthIndex === -1 || minute > 59 || (meridiem ? hour < 1 || hour > 12 : hour > 23)) return null;

  let format;
  try {
    format = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' });
  } catch { return null; }
  const partsAt = at => Object.fromEntries(format.formatToParts(at).map(({ type, value }) => [type, Number(value)]));
  const asUtc = ({ year, month, day, hour, minute, second }) => Date.UTC(year, month - 1, day, hour, minute, second);
  const today = partsAt(now);
  const local = {
    year: Number(year ?? today.year), month: month ? monthIndex + 1 : today.month, day: Number(day ?? today.day),
    hour: meridiem ? hour % 12 + (meridiem.toLowerCase() === 'pm' ? 12 : 0) : hour, minute, second: 0,
  };
  const desired = asUtc(local);
  if (new Date(desired).getUTCDate() !== local.day) return null;
  const wallTime = target => {
    const guess = target + target - asUtc(partsAt(target));
    const at = guess + target - asUtc(partsAt(guess));
    return asUtc(partsAt(at)) === target ? at : null;
  };
  const at = wallTime(desired);
  if (at != null && at + 60_000 <= now && !day) return wallTime(desired + 86_400_000);
  return at;
}

export function parseResetAt(text, now) {
  const rows = stripAnsiAndControl(text).split('\n').map(line => line.trim()).filter(Boolean).slice(-32);
  const errorIndex = rows.findLastIndex(line => rateMessage.test(line));
  if (errorIndex < 0) return null;
  const continuation = rows.slice(errorIndex + 1, errorIndex + 5);
  const nextPrompt = continuation.findIndex(line => /^[❯›>](?:\s|$)|^─{4,}$/.test(line));
  const diagnostic = [rows[errorIndex], ...continuation.slice(0, nextPrompt < 0 ? continuation.length : nextPrompt)].join(' ');
  for (const match of diagnostic.matchAll(resetMarker)) {
    const marker = match[1].toLowerCase();
    const value = diagnostic.slice(match.index + match[0].length);
    const absolute = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})|(?:\w{3},\s*)?\d{1,2}\s+\w{3}\s+\d{4}\s+\d{2}:\d{2}:\d{2}\s+GMT)\b/i.exec(value);
    if (absolute && Number.isFinite(Date.parse(absolute[1]))) return Date.parse(absolute[1]);

    const epoch = /^(\d{10}|\d{13})\b/.exec(value);
    if (epoch && /reset/.test(marker)) return Number(epoch[1]) * (epoch[1].length === 10 ? 1000 : 1);
    const duration = /^(?:(?:\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\s*)+(?![a-z])/i.exec(value);
    if (duration && /(?:in|after)$/.test(marker)) {
      let seconds = 0;
      for (const [, amount, unit] of duration[0].matchAll(/(\d+(?:\.\d+)?)\s*([hms])[a-z]*/gi)) {
        seconds += Number(amount) * { h: 3600, m: 60, s: 1 }[unit.toLowerCase()];
      }
      if (Number.isFinite(seconds) && now + seconds * 1000 <= 8.64e15) return now + seconds * 1000;
    }
    if (/^retry[-_ ]after$/.test(marker)) {
      const seconds = /^(\d{1,10})(?=$|[\s.,;"')])/.exec(value);
      if (seconds) return now + Number(seconds[1]) * 1000;
    }
    const at = clockTime(value, now);
    if (at != null) return at;
  }
  return null;
}
