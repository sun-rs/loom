import { randomUUID } from 'node:crypto';
import { constants, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { decodeEvents, events, holderError } from '../holder/protocol.mjs';

const maxLine = 16 * 1024 * 1024;
const maxWrite = 8192;
const definite = new Set(['stale', 'would-block', 'exited']);
const utf8 = new TextDecoder('utf-8', { fatal: true });

export const pipeCursor = () => ({ seq: '0', stdout: '0', stderr: '0', tail: '', nextId: 0, outgoing: [], calls: {} });
const gap = () => holderError('HOLDER_GAP', 'Codex pipe journal is discontinuous');

export function queueFrame(rpc, message, tag = '') {
  const bytes = Buffer.from(JSON.stringify(message) + '\n');
  if (bytes.length > maxLine) throw new RangeError('Codex RPC frame is too large');
  rpc.outgoing.push({ data: bytes.toString('base64'), offset: 0, writeId: randomUUID(), tag,
    requestId: message.method && typeof message.id === 'number' ? message.id : undefined });
}

export function queueCall(rpc, method, params, meta) {
  const id = rpc.nextId + 1;
  if (!Number.isSafeInteger(id)) throw new Error('Codex RPC ID space exhausted');
  queueFrame(rpc, { id, method, params });
  rpc.nextId = id;
  rpc.calls[id] = { id, method, meta, phase: 'pending' };
  return rpc.calls[id];
}

// A response settles one numeric client call. Server requests with the
// same ID are a different namespace and must never settle that call.
export function correlate(rpc, frame) {
  if (frame.method || !Number.isSafeInteger(frame.id) || !Object.hasOwn(frame, 'result') && !Object.hasOwn(frame, 'error')) return;
  const call = rpc.calls[frame.id];
  if (!call || call.phase !== 'pending') return;
  rpc.outgoing = rpc.outgoing.filter(item => item.requestId !== call.id);
  delete rpc.calls[call.id];
  return call;
}

export function replayPipe(rpc, batch, receive, onExit) {
  let seq = BigInt(rpc.seq);
  let stdout = BigInt(rpc.stdout);
  let stderr = BigInt(rpc.stderr);
  let tail = Buffer.from(rpc.tail, 'base64');
  for (const event of batch) {
    if (event.seq !== seq + 1n || event.offset !== (event.type === events.stderr ? stderr : stdout)) throw gap();
    seq = event.seq;
    if (event.type === events.output) {
      stdout += BigInt(event.data.length);
      const bytes = tail.length ? Buffer.concat([tail, event.data]) : event.data;
      let start = 0;
      for (let end; (end = bytes.indexOf(10, start)) >= 0; start = end + 1) {
        if (end - start > maxLine) throw gap();
        if (end === start) continue;
        let frame;
        try { frame = JSON.parse(utf8.decode(bytes.subarray(start, end))); }
        catch { throw gap(); }
        if (!frame || typeof frame !== 'object' || Array.isArray(frame)) throw gap();
        receive(frame);
      }
      tail = bytes.subarray(start);
      if (tail.length > maxLine) throw gap();
    } else if (event.type === events.stderr) stderr += BigInt(event.data.length);
    else if (event.type === events.exit) {
      if (tail.length) rpc.truncated = true;
      onExit(event.data.readUInt32BE(4), event.data.readUInt32BE());
    } else if (event.type !== events.write) throw gap();
  }
  Object.assign(rpc, { seq: String(seq), stdout: String(stdout), stderr: String(stderr), tail: tail.toString('base64') });
}

export function verifyPipeWatermark(rpc, snapshot) {
  if (!snapshot.pipes || snapshot.gap || BigInt(rpc.seq) !== snapshot.eventSeq ||
      BigInt(rpc.stdout) !== snapshot.outputOffset || BigInt(rpc.stderr) !== snapshot.stderrOffset) throw gap();
}

export function* offlinePipeJournal(dir, after) {
  const start = BigInt(after);
  let segment = start / 512n;
  const names = readdirSync(dir).filter(file => /^events-[a-f0-9]{16}$/.test(file)).sort();
  for (const name of names) {
    const n = BigInt('0x' + name.slice(7));
    if (n < segment) continue;
    if (n !== segment++) throw gap();
    yield decodeEvents(readFileSync(join(dir, name), { flag: constants.O_RDONLY | constants.O_NOFOLLOW }))
      .filter(event => event.seq > start);
  }
}

// A frame and its current write ID are already durable when write is called.
// The holder checks the ID receipt before CAS. Repeating it can only observe
// the old result or write with proof that the previous call sent zero bytes.
export async function advancePipeWrite(rpc, client, snapshot, save) {
  const item = rpc.outgoing[0];
  if (!item) return 'empty';
  const data = Buffer.from(item.data, 'base64');
  const bytes = data.subarray(item.offset, item.offset + maxWrite);
  const result = await client.write({ ...snapshot, minHumanQuietNs: 0n }, bytes, item.writeId);
  if (definite.has(result.status)) return result.status;
  const written = result.written ?? 0;
  if (result.status === 'applied' && written === bytes.length ||
      result.status === 'partial' && written > 0 && written < bytes.length) {
    item.offset += written;
    if (item.offset === data.length) {
      rpc.outgoing.shift();
      if (rpc.calls[item.requestId]) rpc.calls[item.requestId].sent = true;
      save(item.tag);
    } else {
      // Only the previously unwritten suffix gets a new ID. The durable
      // frame, byte position and old holder receipt make restart safe.
      item.writeId = randomUUID();
      save();
    }
    return 'progress';
  }
  throw holderError('HOLDER_UNCERTAIN', 'Codex pipe write has no definitive byte receipt');
}
