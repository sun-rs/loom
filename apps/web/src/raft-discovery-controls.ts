/** Ported from Raft index-WTraJnrd.js RN/MN/uat/mat/fat (2026-08-30).
 * Adaptation: TypeScript names, `user` -> canonical `human`; no server ranker is claimed.
 * Provenance: docs/product/global-discovery-interaction-plan.zh-CN.md. */
export type SearchScope = "mentioned" | "humans" | "agents";

/** Raft HG: pinned self, then unassigned, then the remaining directory. */
export function taskPeopleChoices(
  people: readonly {
    principalId: string;
    handle: string;
    kind: string;
    displayName?: string | undefined;
    avatarKey?: string | undefined;
  }[],
  selfId: string | undefined,
  filter: "creator" | "assignee",
) {
  const self = people.find((person) => person.principalId === selfId);
  return [
    ...(self
      ? [
          {
            id: self.principalId,
            label: filter === "creator" ? "我创建的" : "分配给我的",
            kind: self.kind,
            sentinel: true,
            avatarKey: undefined,
            searchText: filter === "creator" ? "我创建的" : "分配给我的",
          },
        ]
      : []),
    ...(filter === "assignee"
      ? [
          {
            id: "unassigned",
            label: "未分配",
            kind: "none",
            sentinel: true,
            avatarKey: undefined,
            searchText: "未分配",
          },
        ]
      : []),
    ...people
      .filter((person) => person.principalId !== selfId)
      .sort((a, b) => a.handle.localeCompare(b.handle))
      .map((person) => ({
        id: person.principalId,
        label: person.displayName || person.handle,
        kind: person.kind,
        sentinel: false,
        avatarKey: person.avatarKey,
        searchText: `${person.displayName || person.handle} ${person.handle}`,
      })),
  ];
}

/** Route-owned filters: Tasks is multi-channel; Search's visible chip is single.
 * Keep contextual Search links, but never inherit another surface's hidden filters. */
export function normalizeDiscoveryParams(
  search: string,
  surface: "tasks" | "search" | "activity",
) {
  const old = new URLSearchParams(search),
    next = new URLSearchParams({ surface });
  const room = old.get("room");
  if (room) next.set("room", room);
  if (old.get("surface") !== surface) return next;
  const keys =
    surface === "search"
      ? ["q", "scope", "channel", "sender", "time", "after", "before", "sort"]
      : surface === "tasks"
        ? ["channel", "creator", "assignee", "view"]
        : ["filter", "thread", "message"];
  for (const key of keys) {
    const values = old.getAll(key);
    for (const value of surface === "search" &&
    (key === "channel" || key === "sender")
      ? values.slice(0, 1)
      : values)
      next.append(key, value);
  }
  return next;
}
export function normalizeScopes(
  value: string | readonly string[] | null,
): SearchScope[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const selected = new Set(values);
  return (["mentioned", "humans", "agents"] as const).filter((scope) =>
    selected.has(scope),
  );
}
export function senderKindForScopes(
  scopes: readonly string[],
): "human" | "agent" | undefined {
  const humans = scopes.includes("humans"),
    agents = scopes.includes("agents");
  return humans === agents ? undefined : humans ? "human" : "agent";
}
export function reconcileSender(
  scopes: readonly string[],
  sender?: { principalId: string; kind: string },
) {
  const kind = senderKindForScopes(scopes);
  return !kind || kind === sender?.kind ? sender?.principalId : undefined;
}
export function searchSort(
  query: string,
  value: string | null,
): "recent" | "relevance" {
  return query.trim()
    ? value === "recent"
      ? "recent"
      : "relevance"
    : "recent";
}
export function searchShouldRun(
  query: string,
  filters: {
    scopes?: readonly string[];
    roomIds?: readonly string[];
    senderIds?: readonly string[];
    timeRange?: string;
    after?: string | undefined;
    before?: string | undefined;
  },
): boolean {
  return Boolean(
    query.trim() ||
    filters.scopes?.length ||
    filters.roomIds?.length ||
    filters.senderIds?.length ||
    (filters.timeRange && filters.timeRange !== "any") ||
    filters.after ||
    filters.before,
  );
}
export function searchTimeBounds(
  value: string | null,
  now = new Date(),
): { after?: string; before?: string } {
  if (value !== "today" && value !== "7d" && value !== "30d") return {};
  const start = new Date(now);
  if (value === "today") start.setHours(0, 0, 0, 0);
  else start.setDate(start.getDate() - (value === "7d" ? 7 : 30));
  return { after: start.toISOString(), before: now.toISOString() };
}
