import { createHash } from 'node:crypto';
import { deliveryId } from '../inbox/message.mjs';

const normalize = text => text.replace(/\s+/gu, ' ').trim();
const digest = text => createHash('sha256').update(text).digest('hex');

export function draftExpectation(text) {
  const normalized = normalize(text);
  return { id: deliveryId(text), normalized, digest: digest(normalized) };
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
