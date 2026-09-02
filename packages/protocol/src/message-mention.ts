export type MessageMentionCandidate = {
  end: number;
  handle: string;
  start: number;
  value: string;
};

const blockedLeadingCharacter = /[A-Za-z0-9_.-]/u;
const blockedUnicodeIdentifierCharacter = /[\p{L}\p{N}_.-]/u;

function maskRange(mask: string[], start: number, end: number): void {
  for (let index = start; index < end; index += 1) {
    if (mask[index] !== "\n" && mask[index] !== "\r") mask[index] = " ";
  }
}

/**
 * Produces an index-preserving view of visible Markdown prose. Mentions inside
 * code, math, authored links, URLs and HTML/autolink syntax are not delivery
 * instructions and therefore remain masked for every caller.
 */
function visibleMessageText(source: string): string {
  // RegExp match.index and String#slice are UTF-16 code-unit based. Keep this
  // mask on the same index system; a code-point spread would shift every range
  // after an astral character such as an emoji.
  const mask = source.split("");
  const protectedRanges: Array<[number, number]> = [];

  let offset = 0;
  let fence: { character: "`" | "~"; length: number } | undefined;
  for (const line of source.matchAll(/.*(?:\r?\n|$)/gu)) {
    const value = line[0];
    if (value === "") continue;
    const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(value)?.[1];
    if (fence === undefined && marker !== undefined) {
      fence = { character: marker[0] as "`" | "~", length: marker.length };
      protectedRanges.push([offset, offset + value.length]);
    } else if (fence !== undefined) {
      protectedRanges.push([offset, offset + value.length]);
      if (
        marker !== undefined &&
        marker[0] === fence.character &&
        marker.length >= fence.length
      )
        fence = undefined;
    } else if (/^(?: {4}|\t)/u.test(value)) {
      protectedRanges.push([offset, offset + value.length]);
    }
    offset += value.length;
  }

  const protect = (pattern: RegExp) => {
    for (const match of source.matchAll(pattern)) {
      if (match.index !== undefined)
        protectedRanges.push([match.index, match.index + match[0].length]);
    }
  };
  protect(/(`+)[^\n]*?\1/gu);
  protect(/\$\$[\s\S]*?\$\$|\$(?!\s)[^\n$]*?\$/gu);
  protect(/!?\[[^\]\n]*\]\([^\n)]*\)/gu);
  protect(/!?\[[^\]\n]*\]\[[^\]\n]*\]/gu);
  const referenceLabels = new Set<string>();
  for (const match of source.matchAll(
    /^ {0,3}\[([^\]\n]+)\]:[^\n]*(?:\r?\n|$)/gmu,
  )) {
    if (match.index === undefined) continue;
    referenceLabels.add(messageReferenceNameKey(match[1]!));
    protectedRanges.push([match.index, match.index + match[0].length]);
  }
  for (const match of source.matchAll(/!?\[([^\]\n]+)\]/gu)) {
    if (
      match.index !== undefined &&
      referenceLabels.has(messageReferenceNameKey(match[1]!))
    )
      protectedRanges.push([match.index, match.index + match[0].length]);
  }
  protect(/<(?:https?:\/\/|mailto:)[^>\n]+>/giu);
  protect(/(?:https?:\/\/|mailto:)[^\s<>()]+/giu);
  protect(/<!--[\s\S]*?-->/gu);
  protect(/<([A-Za-z][\w:-]*)\b[^>]*>[\s\S]*?<\/\1\s*>/giu);
  protect(/<[^>\n]+>/gu);
  for (const [start, end] of protectedRanges) maskRange(mask, start, end);
  return mask.join("");
}

function escapedPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** The comparison key shared by delivery, rendering and canonical writers. */
export function messageReferenceNameKey(value: string): string {
  return value.trim().normalize("NFKC").toLowerCase();
}

/**
 * Matches only names supplied by the caller's canonical directory. This is
 * what lets Chinese prose such as `请@Alice处理` work without guessing where
 * an unknown Unicode handle ends.
 */
export function messageMentionCandidates(
  source: string,
  knownHandles: readonly string[],
): MessageMentionCandidate[] {
  const visible = visibleMessageText(source);
  const candidates: MessageMentionCandidate[] = [];
  const handlesByKey = new Map<string, Set<string>>();
  for (const handle of knownHandles.filter(Boolean)) {
    const key = messageReferenceNameKey(handle);
    const values = handlesByKey.get(key) ?? new Set<string>();
    values.add(handle);
    handlesByKey.set(key, values);
  }
  // Case/NFKC-equivalent but differently spelled handles are ambiguous. A
  // mention must fail closed instead of selecting one identity or waking both.
  const handles = [...handlesByKey.values()]
    .filter((values) => values.size === 1)
    .map((values) => [...values][0]!)
    .sort(
      (left, right) => right.length - left.length || left.localeCompare(right),
    );
  for (const handle of handles) {
    const pattern = new RegExp(`@${escapedPattern(handle)}`, "giu");
    const unicodeBoundary = /[^\x00-\x7f]/u.test(handle);
    for (const match of visible.matchAll(pattern)) {
      if (match.index === undefined) continue;
      const previous = match.index === 0 ? "" : visible[match.index - 1]!;
      const end = match.index + match[0].length;
      const next = visible[end] ?? "";
      const blockedBoundary = unicodeBoundary
        ? blockedUnicodeIdentifierCharacter
        : blockedLeadingCharacter;
      if (
        (previous !== "" && blockedBoundary.test(previous)) ||
        (next !== "" && blockedBoundary.test(next))
      )
        continue;
      if (
        candidates.some(
          (candidate) => match.index! < candidate.end && end > candidate.start,
        )
      )
        continue;
      candidates.push({
        end,
        handle,
        start: match.index,
        value: source.slice(match.index, end),
      });
    }
  }
  return candidates.sort((left, right) => left.start - right.start);
}

export function messageHasMention(source: string, handle: string): boolean {
  return messageMentionCandidates(source, [handle]).length > 0;
}
