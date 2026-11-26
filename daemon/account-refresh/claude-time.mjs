const months = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const dayMs = 86_400_000;

export function claudeResetTime(text, observedAt) {
  const match = /^([A-Z][a-z]{2}) (\d{1,2}) at (\d{1,2})(?::(\d{2}))?([ap]m) \(([A-Za-z0-9_+/-]+)\)$/.exec(text);
  if (!match) return;
  const [, monthName, dayText, hourText, minuteText = '0', period, timeZone] = match;
  const month = months.indexOf(monthName) + 1;
  const [day, hour, minute] = [dayText, hourText, minuteText].map(Number);
  if (!month || day < 1 || day > 31 || hour < 1 || hour > 12 || minute > 59) return;

  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
    });
  } catch { return; }
  const wallTime = timestamp => {
    const parts = Object.fromEntries(formatter.formatToParts(timestamp).map(({ type, value }) => [type, Number(value)]));
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  };
  const year = new Date(wallTime(observedAt)).getUTCFullYear();
  const clockHour = hour % 12 + (period === 'pm' ? 12 : 0);
  const candidates = [year - 1, year, year + 1]
    .map(y => Date.UTC(y, month - 1, day, clockHour, minute))
    .filter(timestamp => new Date(timestamp).getUTCMonth() === month - 1)
    .sort((a, b) => Math.abs(a - observedAt) - Math.abs(b - observedAt));
  if (!candidates.length) return;

  // The CLI omits the year. Use the nearest calendar occurrence, preserving
  // recently elapsed resets, and keep ambiguous or skipped DST times unknown.
  const target = candidates[0];
  const offsets = new Set([target - dayMs, target, target + dayMs].map(time => wallTime(time) - time));
  const matches = [...offsets].map(offset => target - offset).filter(time => wallTime(time) === target);
  return matches.length === 1 ? new Date(matches[0]).toISOString() : null;
}
