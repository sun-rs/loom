/** Structural port: Raft index-BVfbaScj.js mdt/pdt/fdt.
 * Local glue: Workspace-scoped typed destination keys, no cached entity data.
 * Upstream bounds: 90 days, 24 opens/entity, 64 entities, 7-day half-life, 10 cards.
 */
type StoragePort = Pick<Storage, "getItem" | "setItem">;
const age = 90 * 86400000;
function read(
  storage: StoragePort,
  scope: string,
  now: number,
): Record<string, number[]> {
  try {
    const data: unknown = JSON.parse(
      storage.getItem(`rah-os:search-entity-usage:v1:${scope}`) ?? "{}",
    );
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    return Object.fromEntries(
      Object.entries(data)
        .filter(([key, value]) => key.length <= 401 && Array.isArray(value))
        .map(
          ([key, value]) =>
            [
              key,
              [
                ...new Set(
                  (value as unknown[]).filter(
                    (n): n is number =>
                      typeof n === "number" &&
                      Number.isFinite(n) &&
                      n >= now - age &&
                      n <= now + 300000,
                  ),
                ),
              ]
                .sort((a, b) => b - a)
                .slice(0, 24),
            ] as const,
        )
        .filter(([, times]) => times.length)
        .sort((a, b) => b[1][0]! - a[1][0]!)
        .slice(0, 64),
    );
  } catch {
    return {};
  }
}
export function recordSearchOpen(
  storage: StoragePort,
  scope: string,
  key: string,
  now = Date.now(),
) {
  const usage = read(storage, scope, now);
  usage[key] = [now, ...(usage[key] ?? [])].slice(0, 24);
  try {
    storage.setItem(
      `rah-os:search-entity-usage:v1:${scope}`,
      JSON.stringify(usage),
    );
  } catch {
    /* Preferences are optional. */
  }
}
export function frequentSearchEntities<
  T extends { key: string; title: string },
>(
  storage: StoragePort,
  scope: string,
  entities: readonly T[],
  now = Date.now(),
): T[] {
  const usage = read(storage, scope, now);
  return entities
    .map((entity) => ({
      entity,
      times: usage[entity.key] ?? [],
      score: (usage[entity.key] ?? []).reduce(
        (sum, t) => sum + 2 ** (-Math.max(0, now - t) / (7 * 86400000)),
        0,
      ),
    }))
    .filter((row) => row.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.times[0] ?? 0) - (a.times[0] ?? 0) ||
        a.entity.title.localeCompare(b.entity.title) ||
        a.entity.key.localeCompare(b.entity.key),
    )
    .slice(0, 10)
    .map((row) => row.entity);
}
