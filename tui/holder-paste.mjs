import { createHash } from 'node:crypto';
import { constants, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_PROMPT_BRACKETED_PASTE_END, AGENT_PROMPT_BRACKETED_PASTE_START, agyPasteSegments } from './agent-input.mjs';

export const pasteChunk = 512;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function utf8PasteChunk(bytes, offset) {
  let end = Math.min(bytes.length, offset + pasteChunk);
  while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) --end;
  return bytes.subarray(offset, end);
}

export function readPasteReceipt(dir, id) {
  if (!/^[a-f0-9]{32}$/.test(id)) return;
  let bytes;
  try { bytes = readFileSync(join(dir, 'write-' + id), { flag: constants.O_RDONLY | constants.O_NOFOLLOW }); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (bytes.length !== 45 || ![0, 5].includes(bytes[32])) return;
  return { digest: bytes.toString('hex', 0, 32), count: bytes.readUInt32BE(41), start: bytes.readBigUInt64BE(33),
    partial: bytes[32] === 5 };
}

export function provePaste(events, input, view, receipt, { provider, rows, overlayDismissal } = {}) {
  const frames = (provider === 'agy' ? agyPasteSegments(input, rows) : [input]).map(text =>
    Buffer.from(AGENT_PROMPT_BRACKETED_PASTE_START + text + AGENT_PROMPT_BRACKETED_PASTE_END));
  const total = frames.reduce((sum, frame) => sum + frame.length, 0);
  const legacyChunk = (bytes, offset) => bytes.subarray(offset, offset + 4096);
  const writes = events.map(event => ({ ...event, receipt: receipt(event.id) }));
  let written = 0, continuation, continuationBytes, ownedClosedBytes;
  for (let start = writes.length - 1; start >= 0; --start) {
    if (!writes[start].receipt) continue;
    let offset = 0, frameIndex = 0, cursor = 0;
    let stdinOffset = writes[start].receipt.start;
    const boundary = writes[start].boundary;
    for (let i = start; i < writes.length; ++i) {
      const write = writes[i];
      const proof = write.receipt;
      const frame = frames[frameIndex];
      const part = [utf8PasteChunk(frame, cursor), legacyChunk(frame, cursor)].find(bytes => bytes.length &&
        proof?.digest === digest(bytes) && (proof.partial ? proof.count < bytes.length : proof.count === bytes.length));
      if (!part || proof.start !== stdinOffset || !proof.count || proof.count !== write.count ||
          write.boundary !== boundary || write.seq > view.eventSeq) break;
      offset += proof.count;
      cursor += proof.count;
      stdinOffset += BigInt(proof.count);
      const latest = writes.at(-1);
      const dismissal = i === writes.length - 2 && latest.id === overlayDismissal &&
        latest.receipt?.digest === digest('\x1b') && !latest.receipt.partial && latest.count === 1 &&
        latest.receipt.count === 1 && latest.receipt.start === stdinOffset && latest.boundary === boundary &&
        latest.human === view.humanInputOffset && latest.seq <= view.eventSeq && view.outputOffset > latest.output;
      const uninterrupted = (write === latest || dismissal) &&
        boundary === view.boundary && write.human === view.humanInputOffset;
      const ownsDraft = provider === 'agy' && writes[start].emptyComposer === true;
      if (offset === total) {
        if (uninterrupted && view.outputOffset > write.output) {
          return { status: 'complete', written: offset, total, ...(ownsDraft && { ownsDraft: true, closedBracket: true }) };
        }
        break; // An intervening write might be Enter.
      }
      if (cursor === frame.length) { cursor = 0; ++frameIndex; }
      if (ownsDraft && uninterrupted && cursor === 0 && view.outputOffset > write.output) ownedClosedBytes = offset;
      // Agy can buffer an unfinished bracketed paste without repainting.
      if (provider === 'agy' && uninterrupted && (frames[frameIndex][cursor] & 0xc0) !== 0x80 &&
          offset > (continuationBytes ?? 0)) {
        continuation = { segment: frameIndex, offset: cursor, ...(ownsDraft && { ownsDraft: true }) };
        continuationBytes = offset;
      }
    }
    written = Math.max(written, offset);
  }
  return { status: written && written < total ? 'incomplete' : 'unproven',
    written: written || null, total, ...(continuationBytes === written && written < total && { continuation }),
    ...(written > 0 && ownedClosedBytes === written && { ownsDraft: true, closedBracket: true }) };
}

export function adoptionWriteId(incarnation, deliveryId, key) {
  const hex = digest(`adopted-${key}\0${incarnation}\0${deliveryId}`).slice(0, 32);
  return hex.replace(/^(........)(....)(....)(....)(............)$/, '$1-$2-$3-$4-$5');
}
