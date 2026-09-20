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

/** Raft hxt: leading # selects Channels, @ selects people; named queries retain literal message search. */
export function searchDirectoryMatches<
  T extends {
    key: string;
    kind: string;
    title: string;
    subtitle: string;
    principalId?: string;
    searchText?: string;
  },
>(query: string, entries: readonly T[]): T[] | undefined {
  const trimmed = query.trim();
  if (!trimmed.startsWith("#") && !trimmed.startsWith("@")) return undefined;
  const channelMode = trimmed[0] === "#";
  const needle = trimmed.slice(1).toLocaleLowerCase();
  const identities = new Set<string>();
  return entries.filter((entry) => {
    if (
      channelMode
        ? entry.kind !== "channel"
        : !["agent", "human"].includes(entry.kind)
    )
      return false;
    if (
      ![entry.title, entry.subtitle, entry.searchText ?? ""].some((text) =>
        text.toLocaleLowerCase().includes(needle),
      )
    )
      return false;
    const identity = entry.principalId ?? entry.key;
    if (identities.has(identity)) return false;
    identities.add(identity);
    return true;
  });
}

/** Bare sigils are directory navigation, not literal message queries. */
export function isDirectoryOnlySearch(query: string): boolean {
  return query.trim() === "@" || query.trim() === "#";
}
