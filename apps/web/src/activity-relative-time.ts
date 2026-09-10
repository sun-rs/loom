/**
 * Structural port of Raft index-BVfbaScj.js ZVe / Vae (2026-09-08).
 * ThreadsInbox-Df4Pr6bf.js imports export j as et and uses it for all card times.
 * Local adaptation: fixed zh-CN product locale and injectable clock; no locale UI.
 */
const formatter = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
export function formatActivityRelativeTime(
  value: string,
  now = Date.now(),
): string | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return null;
  const delta = timestamp - now;
  const absolute = Math.abs(delta);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const formatted =
    absolute < hour
      ? formatter.format(Math.round(delta / minute), "minute")
      : absolute < day
        ? formatter.format(Math.round(delta / hour), "hour")
        : formatter.format(Math.round(delta / day), "day");
  return formatted
    .replace(/(\d)\s*([\u4e00-\u9fff\u3400-\u4dbf])/g, "$1 $2")
    .replace(/([\u4e00-\u9fff\u3400-\u4dbf])\s*(\d)/g, "$1 $2");
}
