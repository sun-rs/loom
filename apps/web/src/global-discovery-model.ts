import type { Task, WorkspaceSearchResponse } from "@rah-os/protocol";
import type { ProductNavigationRequest } from "./navigation-target.ts";
import { navigationSearch } from "./navigation-target.ts";
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
export type DiscoveryLocation = ProductNavigationRequest;
export type DiscoveryNavigationHandler = (
  location: DiscoveryLocation,
) => Promise<boolean>;
export function globalSurfaceFromSearch(
  search: string,
): GlobalSurface | "agents" | "computers" | "room" | "saved" | "settings" {
  const value = new URLSearchParams(search).get("surface");
  return value === "tasks" ||
    value === "search" ||
    value === "activity" ||
    value === "saved" ||
    value === "agents" ||
    value === "computers" ||
    value === "settings"
    ? value
    : "room";
}
export function discoveryLocation(
  location: DiscoveryLocation,
  currentSearch = "",
) {
  return navigationSearch(location, currentSearch);
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

export type SearchResultGroup =
  | {
      key: string;
      kind: "message";
      hits: [WorkspaceSearchResponse["hits"][number]];
    }
  | {
      key: string;
      kind: "thread";
      hits: WorkspaceSearchResponse["hits"];
    };

/** Raft presents multiple matches in one message Thread as one result panel. */
export function groupSearchHits(
  hits: WorkspaceSearchResponse["hits"],
): SearchResultGroup[] {
  const groups: SearchResultGroup[] = [];
  const threads = new Map<
    string,
    Extract<SearchResultGroup, { kind: "thread" }>
  >();
  for (const hit of hits) {
    if (hit.rootMessageId === undefined) {
      groups.push({
        key: `message:${hit.message.messageId}`,
        kind: "message",
        hits: [hit],
      });
      continue;
    }
    const key = `thread:${hit.message.roomId}:${hit.rootMessageId}`;
    const existing = threads.get(key);
    if (existing) existing.hits.push(hit);
    else {
      const group = { key, kind: "thread" as const, hits: [hit] };
      threads.set(key, group);
      groups.push(group);
    }
  }
  return groups;
}

/** Append-only Search pagination; retries/stale pages cannot duplicate a hit. */
export function mergeSearchHits(
  current: WorkspaceSearchResponse["hits"],
  next: WorkspaceSearchResponse["hits"],
): WorkspaceSearchResponse["hits"] {
  const seen = new Set(current.map(({ message }) => message.messageId));
  return [
    ...current,
    ...next.filter(({ message }) => !seen.has(message.messageId)),
  ];
}
