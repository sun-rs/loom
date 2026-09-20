import { pinyin } from "pinyin-pro";

// Structural port of Raft Yce/FJe/zJe (2026-09-16 bundle); see the matching audit.
// Presentation only: returns the original objects; never resolves identities.
type Field = { raw: string; priority: number };
type Score = { rank: number; priority: number; position: number; gap: number };
const compare = (a: Score, b: Score) =>
  a.rank - b.rank ||
  a.priority - b.priority ||
  a.position - b.position ||
  a.gap - b.gap;
const characterCache = new Map<string, string>();
function syllable(char: string): string | undefined {
  if (!/^[\u4e00-\u9fff]$/u.test(char)) return undefined;
  let value = characterCache.get(char);
  if (value === undefined) {
    value = pinyin(char, { toneType: "none", v: true });
    characterCache.set(char, value);
  }
  return value;
}
function normalize(raw: string) {
  const tokens = raw.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  let full = "",
    initials = "",
    inLatin = false;
  for (const char of raw) {
    const sound = syllable(char);
    if (sound) {
      full += sound;
      initials += sound[0];
      inLatin = false;
    } else if (/^[a-z0-9]$/iu.test(char)) {
      full += char.toLowerCase();
      if (!inLatin) initials += char.toLowerCase();
      inLatin = true;
    } else inLatin = false;
  }
  return { tokens, compact: tokens.join(""), full, initials };
}
function subsequence(value: string, query: string) {
  let cursor = 0,
    first = -1,
    last = -1;
  for (const char of query) {
    const at = value.indexOf(char, cursor);
    if (at < 0) return undefined;
    if (first < 0) first = at;
    last = at;
    cursor = at + 1;
  }
  const gap = last - first + 1 - query.length;
  return gap <= Math.max(2, query.length * 2)
    ? { position: first, gap }
    : undefined;
}
export function rankComposerSuggestions<T>(
  entries: readonly T[],
  query: string,
  fields: (entry: T) => readonly Field[],
): readonly T[] {
  const raw = query.trim().replace(/^[@#]/u, "").toLowerCase();
  if (!raw) return entries;
  const q = normalize(raw);
  const variants = [...new Set([q.compact, q.full].filter(Boolean))];
  function score(field: Field): Score | undefined {
    const n = normalize(field.raw);
    if (!n.compact && !n.full && !n.initials) return undefined;
    const hit = (rank: number, position = 0, gap = 0): Score => ({
      rank,
      priority: field.priority,
      position,
      gap,
    });
    if (variants.some((v) => n.compact === v || n.full === v)) return hit(0);
    const prefix = variants.find((v) => n.compact.startsWith(v));
    if (prefix) return hit(1, 0, n.compact.length - prefix.length);
    const start = n.tokens.findIndex((v) => v.startsWith(q.tokens[0] ?? ""));
    if (q.tokens.length && start >= 0) {
      let cursor = start,
        matched = 0;
      for (const token of q.tokens) {
        while (cursor < n.tokens.length && !n.tokens[cursor]?.startsWith(token))
          cursor++;
        if (cursor >= n.tokens.length) break;
        cursor++;
        matched++;
      }
      if (matched === q.tokens.length)
        return hit(2, start, cursor - start - q.tokens.length);
    }
    const index = (value: string) => {
      const positions = variants
        .map((v) => value.indexOf(v))
        .filter((p) => p >= 0);
      return positions.length ? Math.min(...positions) : -1;
    };
    const compactAt = index(n.compact);
    if (compactAt >= 0) return hit(3, compactAt);
    if (field.priority <= 1 && q.compact.length >= 2) {
      const fullAt = index(n.full);
      if (fullAt >= 0) return hit(4, fullAt);
      const initialAt = n.initials.indexOf(q.compact);
      if (initialAt >= 0) return hit(5, initialAt);
      if (q.compact.length >= 3) {
        const fuzzy = [
          subsequence(n.compact, q.compact),
          subsequence(n.full, q.compact),
        ]
          .filter((v) => v !== undefined)
          .sort((a, b) => a.position - b.position || a.gap - b.gap)[0];
        if (fuzzy) return hit(6, fuzzy.position, fuzzy.gap);
      }
    }
    const rawAt = field.raw.toLowerCase().indexOf(raw);
    return rawAt >= 0 ? hit(7, rawAt) : undefined;
  }
  return entries
    .map((entry, index) => ({
      entry,
      index,
      score: fields(entry)
        .map(score)
        .filter((s) => s !== undefined)
        .sort(compare)[0],
    }))
    .filter(
      (row): row is typeof row & { score: Score } => row.score !== undefined,
    )
    .sort((a, b) => compare(a.score, b.score) || a.index - b.index)
    .slice(0, 30)
    .map((row) => row.entry);
}
