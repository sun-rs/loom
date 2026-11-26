import { createHash } from 'node:crypto';
import { deliveryId } from '../inbox/message.mjs';

const normalize = text => text.replace(/\s+/gu, ' ').trim();
const digest = text => createHash('sha256').update(text).digest('hex');

export function draftExpectation(text) {
  const normalized = normalize(text);
  return { id: deliveryId(text), normalized, digest: digest(normalized) };
}

// Agy sometimes paints wrapped rows explicitly, so xterm cannot tell a
// visual row break from a newline. Match back from the caret and permit an
// optional source whitespace only at each painted boundary.
export function verifyAgyDraft(frame, expected, ownsDraft = false) {
  if (!expected?.id || !frame.draft || frame.outsideComposer?.includes(`[loom:${expected.id}]`)) return false;
  const clipped = frame.scrolledDraft;
  if (clipped && !ownsDraft) return false;
  const rows = (clipped?.tail ?? frame.draft).split('\n').map(normalize).filter(Boolean);
  if (!rows.length) return false;
  let end = expected.normalized.length;
  for (const row of rows.toReversed()) {
    if (!expected.normalized.endsWith(row, end)) return false;
    end -= row.length;
    if (expected.normalized[end - 1] === ' ') end--;
  }
  return clipped ? end > 0 && expected.normalized.length - end >= 32 : end === 0;
}

export function isAgyDraftSubset(frame, input) {
  const id = deliveryId(input);
  if (!id || !frame.draft || !frame.atDraftEnd || frame.scrolledDraft || frame.outsideComposer?.includes(`[loom:${id}]`)) return false;
  const compact = value => value.replace(/\s+/gu, '');
  const visible = compact(frame.draft);
  const expected = compact(input);
  if (!visible.startsWith(`[loom:${id}]`) || visible.length >= expected.length) return false;
  let cursor = 0;
  for (const char of visible) {
    const match = expected.indexOf(char, cursor);
    if (match === -1) return false;
    cursor = match + char.length;
  }
  return true;
}

export function verifyDraft(frame, expected, previous) {
  if (!expected?.id || !frame.draft || frame.outsideComposer?.includes(`[loom:${expected.id}]`)) return;
  const { scrolledDraft } = frame;
  if (!scrolledDraft) {
    const tail = normalize(frame.draft);
    if (deliveryId(frame.draft) === expected.id && digest(tail) === expected.digest) {
      return { id: expected.id, length: tail.length, tail, hiddenRows: 0 };
    }
    return;
  }

  // With the composer scrolled to its caret, a new segment must retain some
  // already verified text. Measure what the renderer added from the overlap.
  // The caller excludes intervening input, reflow, buffer switches and turns.
  const tail = normalize(scrolledDraft.tail);
  if (previous?.id !== expected.id || !Number.isSafeInteger(scrolledDraft.hiddenRows) || scrolledDraft.hiddenRows < previous.hiddenRows ||
      tail.length < 32 || !expected.normalized.endsWith(tail)) return;
  const prefix = tail.slice(0, 32);
  let start = previous.tail.indexOf(prefix, Math.max(0, previous.tail.length - tail.length));
  while (start >= 0) {
    const overlap = previous.tail.slice(start);
    if (tail.startsWith(overlap)) {
      const length = previous.length + tail.length - overlap.length;
      if (length === expected.normalized.length) return { id: expected.id, length, tail, hiddenRows: scrolledDraft.hiddenRows };
      return;
    }
    start = previous.tail.indexOf(prefix, start + 1);
  }
}
