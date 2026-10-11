import { isDeepStrictEqual } from "node:util";
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const resultOf = (entry) =>
  Object.fromEntries(
    ["summary", "firstKeptEntryId", "tokensBefore", "details", "usage"].map(
      (k) => [k, entry[k]],
    ),
  );
/** Caller must first verify native session identity and the append-only branch.
 * Only default native summaries have audited disjoint usage; retries remain unknown.
 */
export function piCompactionUsage(entries, frames, nativeSessionId) {
  const completed = frames.filter(
    (f) => f.type === "compaction_end" && f.aborted === false && f.result,
  );
  return entries.flatMap((entry) => {
    if (
      entry.type !== "compaction" ||
      entry.fromHook !== false ||
      typeof entry.id !== "string" ||
      !entry.id.trim()
    )
      return [];
    const result = resultOf(entry);
    if (
      completed.filter((f) => isDeepStrictEqual(resultOf(f.result), result))
        .length !== 1
    )
      return [];
    // Ambiguous identical entries cannot establish separate aggregate identities.
    if (
      entries.filter(
        (e) =>
          e.type === "compaction" && isDeepStrictEqual(resultOf(e), result),
      ).length !== 1
    )
      return [];
    const u = entry.usage;
    if (
      !u ||
      !["input", "output", "cacheRead", "cacheWrite"].every((k) =>
        integer(u[k]),
      ) ||
      !integer(u.input + u.cacheRead + u.cacheWrite)
    )
      return [];
    return [
      {
        provider: "pi-print-json/v1",
        kind: "compaction",
        nativeSessionId,
        entryId: entry.id,
        inputTokens: u.input + u.cacheRead + u.cacheWrite,
        outputTokens: u.output,
        cachedInputTokens: u.cacheRead,
        reasoningOutputTokens: null,
        observedAt: new Date().toISOString(),
      },
    ];
  });
}
