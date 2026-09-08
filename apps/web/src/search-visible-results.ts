/** Raft counts displayed directory results plus loaded message hits, not server totals. */
export function visibleSearchResults<Person extends { principalId: string }>(
  data:
    { rooms: readonly unknown[]; principals: readonly Person[] } | undefined,
  loadedHits: readonly unknown[],
  currentHumanId: string | undefined,
) {
  const principals =
    data?.principals.filter(
      (person) => person.principalId !== currentHumanId,
    ) ?? [];
  return {
    principals,
    count: (data?.rooms.length ?? 0) + principals.length + loadedHits.length,
  };
}
