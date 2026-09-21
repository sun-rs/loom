/** Raft v1.17.3 wide/compact preferences; see width-render audit for provenance. */
export function discoveryWidthPolicy(viewport: number, forceCompact: boolean) {
  const compact = forceCompact || viewport < 1024;
  const min = compact ? 320 : 400;
  return {
    compact,
    min,
    max: Math.max(min, Math.min(compact ? 480 : 720, viewport - 64 - 320)),
    defaultWidth: compact ? 320 : 560,
  };
}
export function discoveryWidthKey(compact: boolean) {
  return compact ? "rah:search-compact-width" : "rah:search-width";
}
export function readDiscoveryWidth(
  storage: Pick<Storage, "getItem">,
  compact: boolean,
) {
  const min = compact ? 320 : 400,
    max = compact ? 480 : 720;
  try {
    for (const key of [
      discoveryWidthKey(compact),
      compact ? "rah:activity-compact-width" : "rah:activity-width",
    ]) {
      const value = Number(storage.getItem(key));
      if (Number.isFinite(value) && value >= min && value <= max) return value;
    }
  } catch {
    /* Optional preference; reading never migrates or overwrites storage. */
  }
  return compact ? 320 : 560;
}
