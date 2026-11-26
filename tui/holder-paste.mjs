import { createHash, randomUUID } from 'node:crypto';
import { constants, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { holderError } from '../holder/protocol.mjs';
import { AGENT_PROMPT_BRACKETED_PASTE_END, AGENT_PROMPT_BRACKETED_PASTE_START, agyPasteSegments } from './agent-input.mjs';

export const pasteChunk = 512;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function utf8PasteChunk(bytes, offset) {
  let end = Math.min(bytes.length, offset + pasteChunk);
  while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) --end;
  return bytes.subarray(offset, end);
}

const unwritten = new Set(['stale', 'busy-human', 'would-block', 'exited']);
const ambiguousLink = new Set(['HOLDER_TIMEOUT', 'HOLDER_EOF', 'ECONNRESET', 'EPIPE']);

export async function writeGuardedInput(bytes, before, { write, refresh, valid, verify, id = randomUUID() }) {
  const data = Buffer.from(bytes);
  let current = before;
  let count = 0;
  let nextOffset;
  const deadline = performance.now() + 30_000;
  let progressDeadline = performance.now() + 5_000;
  try {
    do {
      if (!valid(before, current) || count && current.outputSequence !== before.outputSequence &&
          verify && !await verify(current)) {
        if (!count) return false;
        throw holderError('INPUT_CHANGED');
      }
      const part = utf8PasteChunk(data, count);
      const send = () => write(part, current, id);
      const result = await send().catch(error => {
        // The same UUID and bytes query the durable receipt without replaying the write.
        if (ambiguousLink.has(error.code)) return send();
        throw error;
      });
      if (unwritten.has(result.status)) {
        if (!count) return false;
        if (result.status === 'exited') throw holderError('HOLDER_EXITED');
        await delay(15);
        current = await refresh(current, false);
        continue;
      }
      const n = result.written;
      if (!(result.status === 'applied' && n === part.length || result.status === 'partial' && n > 0 && n < part.length) ||
          typeof result.offset !== 'bigint') {
        if (result.status === 'invalid') throw holderError('INPUT_SIZE');
        if (result.status === 'gap') throw holderError('HOLDER_GAP');
        throw holderError('HOLDER_UNCERTAIN', `Holder write ${result.status}`);
      }
      count += n;
      if (nextOffset !== undefined && nextOffset !== result.offset) throw holderError('STDIN_CHANGED');
      if (count === data.length) return true;
      nextOffset = result.offset + BigInt(n);
      progressDeadline = performance.now() + 5_000;
      id = randomUUID();
      current = await refresh(current, true);
    } while (performance.now() < Math.min(deadline, progressDeadline));
    throw holderError('WRITE_TIMEOUT');
  } catch (error) {
    if (!count) throw error;
    throw Object.assign(holderError('HOLDER_PARTIAL_WRITE', `Holder wrote ${count}/${data.length} bytes: ${error.code}`),
      { written: count, total: data.length, reason: error.code ?? 'write-failed' });
  }
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
  const segments = height => (provider === 'agy' ? agyPasteSegments(input, height) : [input]).map(text =>
    Buffer.from(AGENT_PROMPT_BRACKETED_PASTE_START + text + AGENT_PROMPT_BRACKETED_PASTE_END));
  let total = segments(rows).reduce((sum, frame) => sum + frame.length, 0);
  const legacyChunk = (bytes, offset) => bytes.subarray(offset, offset + 4096);
  const writes = events.map(event => ({ ...event, receipt: receipt(event.id) }));
  const dismissals = new Set([overlayDismissal].flat().filter(Boolean));
  let written = 0, continuation, continuationBytes, ownedClosedBytes;
  for (let start = writes.length - 1; start >= 0; --start) {
    if (!writes[start].receipt) continue;
    const frames = segments(writes[start].rows ?? rows);
    const expectedTotal = frames.reduce((sum, frame) => sum + frame.length, 0);
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
      let tail = write;
      let end = stdinOffset;
      const seen = new Set();
      for (const key of writes.slice(i + 1)) {
        if (!dismissals.has(key.id) || seen.has(key.id) || key.receipt?.digest !== digest('\x1b') ||
            key.receipt.partial || key.count !== 1 || key.receipt.count !== 1 || key.receipt.start !== end ||
            key.boundary !== boundary || key.human !== view.humanInputOffset || key.seq > view.eventSeq) break;
        seen.add(key.id);
        tail = key;
        end++;
      }
      const dismissedOverlay = tail !== write && tail === latest && view.outputOffset > tail.output;
      const unchangedInput = (write === latest || dismissedOverlay) && write.human === view.humanInputOffset;
      const uninterrupted = unchangedInput && boundary === view.boundary;
      const unchangedBuffer = write.bufferSequence != null && write.bufferSequence === view.bufferSequence;
      const ownsDraft = provider === 'agy' && writes[start].emptyComposer === true;
      if (offset === expectedTotal) {
        if (uninterrupted && view.outputOffset > write.output) {
          return { status: 'complete', written: offset, total: expectedTotal, ...(ownsDraft && { ownsDraft: true, closedBracket: true }),
            ...(dismissedOverlay && { dismissedOverlay: true }) };
        }
        if (unchangedInput && unchangedBuffer && view.outputOffset > write.output) {
          return { status: 'reflowed', written: offset, total: expectedTotal, ownsDraft };
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
    if (offset > written) {
      written = offset;
      total = expectedTotal;
    }
  }
  return { status: written && written < total ? 'incomplete' : 'unproven',
    written: written || null, total, ...(continuationBytes === written && written < total && { continuation }),
    ...(written > 0 && ownedClosedBytes === written && { ownsDraft: true, closedBracket: true }) };
}

export function adoptionWriteId(incarnation, deliveryId, key) {
  const hex = digest(`adopted-${key}\0${incarnation}\0${deliveryId}`).slice(0, 32);
  return hex.replace(/^(........)(....)(....)(....)(............)$/, '$1-$2-$3-$4-$5');
}
