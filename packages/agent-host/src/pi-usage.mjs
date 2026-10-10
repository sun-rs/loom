const integer = (n) => Number.isSafeInteger(n) && n >= 0;
/** Pi input excludes cache read/write. Native output already includes thinking. */
export function piUsageFrames(messages, { sessionId, turnId }) {
  const byId = new Map(),
    conflicts = new Set(),
    gaps = [];
  for (const m of messages) {
    const id = m.responseId,
      u = m.usage;
    if (
      typeof id !== "string" ||
      !id.trim() ||
      !u ||
      !["input", "output", "cacheRead", "cacheWrite"].every((k) =>
        integer(u[k]),
      ) ||
      !integer(u.input + u.cacheRead + u.cacheWrite)
    ) {
      gaps.push({ provider: "pi-print-json/v1", reason: "parse_error" });
      continue;
    }
    const counts = {
      input: u.input,
      output: u.output,
      cacheRead: u.cacheRead,
      cacheWrite: u.cacheWrite,
    };
    if (
      byId.has(id) &&
      JSON.stringify(byId.get(id)) !== JSON.stringify(counts)
    ) {
      conflicts.add(id);
      continue;
    }
    byId.set(id, counts);
  }
  if (conflicts.size)
    gaps.push({ provider: "pi-print-json/v1", reason: "correction_frame" });
  const generations = [...byId]
    .filter(([id]) => !conflicts.has(id))
    .map(([responseId, u]) => ({
      provider: "pi-print-json/v1",
      responseId,
      inputTokens: u.input + u.cacheRead + u.cacheWrite,
      cachedInputTokens: u.cacheRead,
      outputTokens: u.output,
      reasoningOutputTokens: null,
      contextWindow: null,
      contextUsedTokens: null,
      observedAt: new Date().toISOString(),
    }));
  return { generations, gaps };
}
