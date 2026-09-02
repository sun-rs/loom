const PREFIX = "rah-os:search-history:v1:";
const LIMIT = 20;
type SearchHistoryEntry = { count: number; query: string; updatedAt: number };

type SearchHistoryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function key(workspaceId: string) {
  return `${PREFIX}${workspaceId}`;
}

export function readSearchHistory(
  storage: SearchHistoryStorage,
  workspaceId: string,
): string[] {
  try {
    return readEntries(storage, workspaceId).map(({ query }) => query);
  } catch {
    return [];
  }
}

export function addSearchHistory(
  storage: SearchHistoryStorage,
  workspaceId: string,
  query: string,
): string[] {
  const normalized = query.trim();
  if (!normalized) return readSearchHistory(storage, workspaceId);
  const entries = readEntries(storage, workspaceId);
  const existing = entries.find(
    ({ query: item }) =>
      item.toLocaleLowerCase() === normalized.toLocaleLowerCase(),
  );
  const next: SearchHistoryEntry[] = [
    {
      count: (existing?.count ?? 0) + 1,
      query: normalized,
      updatedAt: Date.now(),
    },
    ...entries.filter(
      ({ query: item }) =>
        item.toLocaleLowerCase() !== normalized.toLocaleLowerCase(),
    ),
  ].slice(0, LIMIT);
  storage.setItem(key(workspaceId), JSON.stringify(next));
  return next.map(({ query: item }) => item);
}

export function readFrequentSearches(
  storage: SearchHistoryStorage,
  workspaceId: string,
): string[] {
  return readEntries(storage, workspaceId)
    .filter(({ count }) => count > 1)
    .sort((a, b) => b.count - a.count || b.updatedAt - a.updatedAt)
    .slice(0, 5)
    .map(({ query }) => query);
}

export function clearSearchHistory(
  storage: SearchHistoryStorage,
  workspaceId: string,
) {
  storage.removeItem(key(workspaceId));
}

function readEntries(
  storage: SearchHistoryStorage,
  workspaceId: string,
): SearchHistoryEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(key(workspaceId)) ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((value, index): SearchHistoryEntry | undefined => {
      if (typeof value === "string")
        return { count: 1, query: value, updatedAt: -index };
      if (
        value &&
        typeof value === "object" &&
        typeof value.query === "string" &&
        Number.isSafeInteger(value.count) &&
        value.count > 0 &&
        Number.isFinite(value.updatedAt)
      )
        return {
          count: value.count,
          query: value.query,
          updatedAt: value.updatedAt,
        };
      return undefined;
    })
    .filter((value): value is SearchHistoryEntry => value !== undefined)
    .slice(0, LIMIT);
}
