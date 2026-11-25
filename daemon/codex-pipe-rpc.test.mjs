import assert from 'node:assert/strict';
import { test } from 'node:test';
import { events } from '../holder/protocol.mjs';
import { advancePipeWrite, correlate, pipeCursor, queueCall, replayPipe, verifyPipeWatermark } from './codex-pipe-rpc.mjs';

const disk = x => JSON.parse(JSON.stringify(x));
const record = (type, seq, offset, data) => ({ type, seq: BigInt(seq), offset: BigInt(offset), data: Buffer.from(data) });

test('Codex RPC replay preserves split UTF-8 and lines with independent stderr offsets', () => {
  const first = pipeCursor();
  const bytes = Buffer.from('{"method":"item/agentMessage/delta","params":{"delta":"待"}}\n{"id":4,"result":{}}\n');
  const split = bytes.indexOf(Buffer.from('待')) + 1;
  replayPipe(first, [record(events.output, 1, 0, bytes.subarray(0, split)), record(events.stderr, 2, 0, 'warn')],
    () => assert.fail('incomplete UTF-8 frame emitted'), () => assert.fail('unexpected exit'));
  const resumed = disk(first);
  const frames = [];
  replayPipe(resumed, [record(events.output, 3, split, bytes.subarray(split)), record(events.stderr, 4, 4, '!')],
    frame => frames.push(frame), () => assert.fail('unexpected exit'));
  assert.deepEqual(frames, [{ method: 'item/agentMessage/delta', params: { delta: '待' } }, { id: 4, result: {} }]);
  assert.equal(resumed.tail, '');
  verifyPipeWatermark(resumed, { pipes: true, eventSeq: 4n, outputOffset: BigInt(bytes.length), stderrOffset: 5n });
});

test('Codex RPC correlates persisted IDs once and keeps server requests separate', () => {
  const sent = pipeCursor();
  const bootstrap = queueCall(sent, 'initialize', {});
  const turn = queueCall(sent, 'turn/start', {}, { key: 'prompt:fixture' });
  const resumed = disk(sent);
  assert.equal(correlate(resumed, { id: turn.id, method: 'server/request', result: {} }), undefined);
  assert.equal(correlate(resumed, { id: 18, result: {} }), undefined);
  assert.equal(correlate(resumed, { id: String(turn.id), result: {} }), undefined);
  assert.deepEqual(correlate(resumed, { id: turn.id, result: {} }), turn);
  assert.equal(correlate(resumed, { id: turn.id, result: {} }), undefined);
  assert.deepEqual(resumed.outgoing.map(f => f.requestId), [bootstrap.id]);
  assert.equal(queueCall(resumed, 'thread/read', {}).id, turn.id + 1);
});

test('Codex RPC reconnect uses the same byte receipt and advances only a confirmed partial suffix', async () => {
  const original = pipeCursor();
  queueCall(original, 'turn/start', { payload: '🐙'.repeat(3000) });
  const encoded = Buffer.from(original.outgoing[0].data, 'base64');
  let durable = disk(original);
  const receipts = new Map();
  const wire = [];
  const writes = [];
  let disconnect = true;
  const client = { async write(condition, bytes, id) {
    assert.equal(condition.minHumanQuietNs, 0n);
    writes.push(id);
    if (receipts.has(id)) return receipts.get(id);
    const written = receipts.size ? bytes.length : 1027;
    wire.push(bytes.subarray(0, written));
    const result = { status: written === bytes.length ? 'applied' : 'partial', written };
    receipts.set(id, result);
    if (disconnect) { disconnect = false; throw Error('connection closed'); }
    return result;
  } };
  const save = () => { durable = disk(resumed); };
  await assert.rejects(advancePipeWrite(original, client, {}, () => assert.fail('receipt not received')), /connection closed/);
  const resumed = disk(durable);
  assert.equal(await advancePipeWrite(resumed, client, {}, save), 'progress');
  assert.equal(writes[0], writes[1]);
  assert.equal(resumed.outgoing[0].offset, 1027);
  assert.notEqual(resumed.outgoing[0].writeId, writes[0]);
  assert.deepEqual(durable, resumed);
  while (resumed.outgoing.length) await advancePipeWrite(resumed, client, {}, save);
  assert.deepEqual(Buffer.concat(wire), encoded);
  assert.equal(resumed.calls[1].sent, true);
});

test('Codex RPC keeps the exact frame on EAGAIN and freezes it on an unknown write or journal gap', async () => {
  const rpc = pipeCursor();
  queueCall(rpc, 'initialize', {});
  const original = disk(rpc);
  const save = () => assert.fail('no cursor or byte receipt may advance');
  assert.equal(await advancePipeWrite(rpc, { write: async () => ({ status: 'would-block' }) }, {}, save), 'would-block');
  await assert.rejects(advancePipeWrite(rpc, { write: async () => ({ status: 'unknown' }) }, {}, save), { code: 'HOLDER_UNCERTAIN' });
  assert.deepEqual(disk(rpc), original);
  assert.throws(() => replayPipe(rpc, [record(events.output, 2, 0, 'data')], save, save), { code: 'HOLDER_GAP' });
  assert.throws(() => replayPipe(rpc, [record(events.stderr, 1, 4, 'data')], save, save), { code: 'HOLDER_GAP' });
  assert.throws(() => verifyPipeWatermark(rpc, { pipes: true, eventSeq: 0n, outputOffset: 0n, stderrOffset: 4n }),
    { code: 'HOLDER_GAP' });
});
