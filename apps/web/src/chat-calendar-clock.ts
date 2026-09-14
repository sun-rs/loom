import { chatLocalDateKey } from "./chat-timeline-presentation.ts";

// One display-only clock for all mounted message timestamps and date dividers.
// Calendar midnight uses local Date setters, so DST days can be 23 or 25 hours.
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let publishedDay = "";
export function getLocalDaySnapshot(): string {
  return chatLocalDateKey(new Date());
}
function refresh() {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  const day = getLocalDaySnapshot();
  if (day !== publishedDay) {
    publishedDay = day;
    for (const listener of listeners) listener();
  }
  if (!listeners.size) return;
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  // Exact midnight deadline, with a bounded recalibration for wall-clock changes.
  timer = setTimeout(
    refresh,
    Math.min(60_000, Math.max(1, midnight.getTime() - now.getTime())),
  );
}
export function subscribeToLocalDay(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    publishedDay = getLocalDaySnapshot();
    refresh();
    if (typeof window !== "undefined") {
      window.addEventListener("focus", refresh);
      window.addEventListener("pageshow", refresh);
      document.addEventListener("visibilitychange", refresh);
    }
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", refresh);
    }
  };
}
