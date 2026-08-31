import type { Task } from "@rah-os/protocol";
export type GlobalSurface = "tasks" | "search" | "activity";
// Exit a historical snapshot only after canonical submission succeeds. A late
// completion must not clear a different message selected while it was pending.
export function focusAfterSuccessfulSubmit(
  current: string | undefined,
  submitted: string | undefined,
): string | undefined {
  return current === submitted ? undefined : current;
}
export function visibleReadFrontier(
  rows: readonly { seq: number; top: number; bottom: number }[],
  viewport: { top: number; bottom: number },
): number {
  return rows.reduce(
    (frontier, row) =>
      row.bottom > viewport.top && row.top < viewport.bottom
        ? Math.max(frontier, row.seq)
        : frontier,
    0,
  );
}
export function searchDateBound(
  value: string | null,
  end = false,
): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00"}`);
  const normalized = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return Number.isFinite(date.getTime()) && normalized === value
    ? date.toISOString()
    : undefined;
}
export function searchExcerpt(
  body: string,
  query: string,
  limit = 1000,
): string {
  const match = body.toLowerCase().indexOf(query.toLowerCase());
  const start = Math.max(0, match - Math.floor(limit / 4));
  return `${start ? "…" : ""}${body.slice(start, start + limit)}${start + limit < body.length ? "…" : ""}`;
}
export type DiscoveryLocation = {
  roomId: string;
  messageId?: string;
  rootMessageId?: string;
  task?: boolean;
  surface?: "activity";
};
export function globalSurfaceFromSearch(
  search: string,
): GlobalSurface | "room" {
  const value = new URLSearchParams(search).get("surface");
  return value === "tasks" || value === "search" || value === "activity"
    ? value
    : "room";
}
export function discoveryLocation(
  location: DiscoveryLocation,
  currentSearch = "",
) {
  const params = new URLSearchParams();
  if (location.surface === "activity") {
    params.set("surface", "activity");
    const filter = new URLSearchParams(currentSearch).get("filter");
    if (filter === "unread" || filter === "mentions")
      params.set("filter", filter);
  }
  params.set("room", location.roomId);
  if (location.messageId) params.set("message", location.messageId);
  if (location.rootMessageId)
    params.set("thread", `${location.roomId}:${location.rootMessageId}`);
  return `?${params}`;
}
// Raft Web vL/hnt: five ordered groups, task number descending within a group.
// RAH's durable waiting/blocked states project into Raft's in-progress group.
export function raftTaskGroup(state: Task["state"]) {
  return state === "todo"
    ? "todo"
    : state === "submitted"
      ? "review"
      : state === "completed"
        ? "done"
        : state === "cancelled"
          ? "closed"
          : "in-progress";
}
export function highlightParts(
  body: string,
  query: string,
): Array<{ text: string; match: boolean }> {
  if (!query) return [{ text: body, match: false }];
  const parts: Array<{ text: string; match: boolean }> = [];
  const lower = body.toLowerCase();
  const needle = query.toLowerCase();
  let offset = 0;
  let index = lower.indexOf(needle);
  while (index >= 0) {
    if (index > offset)
      parts.push({ text: body.slice(offset, index), match: false });
    parts.push({ text: body.slice(index, index + query.length), match: true });
    offset = index + query.length;
    index = lower.indexOf(needle, offset);
  }
  if (offset < body.length)
    parts.push({ text: body.slice(offset), match: false });
  return parts;
}
