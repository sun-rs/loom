/** Identity facets of the native read cache; references stay stable for useSyncExternalStore. */
export function createAgentFacet(
  kind: "role" | "instance",
  classify: (id: string) => "role" | "instance" | undefined,
) {
  const cache = new WeakMap<readonly any[], any[]>();
  return (rows: readonly any[]) => {
    let value = cache.get(rows);
    if (!value) {
      value = rows.filter((row) => classify(row.id) === kind);
      cache.set(rows, value);
    }
    return value;
  };
}
