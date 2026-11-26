import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { matchesPastePlaceholder } from '../adapters/claude/screen.mjs';
import { claudeNativeDigest, payloadDigest, wireText } from '../inbox/message.mjs';
import { nativeDelivery } from '../inbox/tui.mjs';
import { adoptionWriteId, provePaste, utf8PasteChunk } from './holder-paste.mjs';

const capture = JSON.parse(readFileSync(new URL('../tasks/PILOT2-FIX-2/partial-receipt.json', import.meta.url)));
const { deliveryId: id, written, total, eventSeq, stdoutOffset, stdinOffset } = capture;
const body = '短\n'.repeat(14) + 'a'.repeat(915) + '🐙' + 'b'.repeat(190);
const input = wireText(id, body);
const raw = Buffer.from('\x1b[200~' + input + '\x1b[201~');
const pilot = JSON.parse(readFileSync(new URL('../tasks/DRAFT-HOLD-2/agy-pilot-frame.json', import.meta.url)));
const pilotWrites = pilot.writes.map(write => ({ ...write, seq: BigInt(write.seq), human: BigInt(write.human),
  output: BigInt(write.output), start: BigInt(write.start) }));
const pilotView = { ...pilot.view, eventSeq: BigInt(pilot.view.eventSeq), outputOffset: BigInt(pilot.view.outputOffset),
  humanInputOffset: BigInt(pilot.view.humanInputOffset) };
const pilotProof = (view = pilotView) => provePaste(pilotWrites, pilot.wire, view,
  id => pilotWrites.find(write => write.id === id), { provider: 'agy', rows: pilot.size.rows });

test('Claude paste writes cut at UTF-8 boundaries even for a payload over 1.2 KB', () => {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const parts = [];
  for (let offset = 0; offset < raw.length;) {
    const part = utf8PasteChunk(raw, offset);
    assert(part.length <= 512);
    decoder.decode(part);
    parts.push(part);
    offset += part.length;
  }
  assert.equal(raw.length, total);
  assert.deepEqual(Buffer.concat(parts), raw);
  assert.equal(parts.some(part => part.length === 512), true);
  const crossing = Buffer.from(' '.repeat(511) + '🐙x');
  assert.equal(utf8PasteChunk(crossing, 0).length, 511);
  assert.equal(decoder.decode(utf8PasteChunk(crossing, 511)), '🐙x');
});

test('the captured short receipt and matching Claude +15 chip are insufficient to adopt', () => {
  assert(matchesPastePlaceholder(capture.chip, input));
  const record = { id: capture.writeId, seq: BigInt(eventSeq), output: BigInt(stdoutOffset),
    count: written, human: 4n, boundary: 2 };
  const view = { eventSeq: 1181n, outputOffset: 157625n, humanInputOffset: 4n, boundary: 2 };
  const receipts = new Map([[record.id, { digest: payloadDigest(raw), count: written, partial: true, start: BigInt(stdinOffset) }]]);
  const query = key => receipts.get(key);
  assert.deepEqual(provePaste([record], input, view, query), { status: 'incomplete', written, total });
  const next = { ...record, id: 'suffix', seq: 1180n, count: total - written };
  receipts.set(next.id, { digest: payloadDigest(raw.subarray(written)), count: next.count, start: BigInt(stdinOffset + written) });
  assert.deepEqual(provePaste([record, next], input, view, query), { status: 'complete', written: total, total });
  for (const changed of [{ humanInputOffset: 5n }, { boundary: 3 }, { outputOffset: record.output }]) {
    assert.equal(provePaste([record, next], input, { ...view, ...changed }, query).status, 'unproven');
  }
  assert.equal(provePaste([record, next, { ...next, id: 'enter' }], input, view, query).status, 'unproven');
  assert.equal(adoptionWriteId(id, id, 'enter'), adoptionWriteId(id, id, 'enter'));
  assert.notEqual(adoptionWriteId(id, id, 'enter'), adoptionWriteId('other-holder', id, 'enter'));
});

test('Claude digest unwraps the native paste notation and treats a truncated marker as corrupt', () => {
  const wrapped = text => '\n\n<pasted_content id="abcd">\n' + text + '\n</pasted_content id="abcd">\n';
  assert.equal(claudeNativeDigest(wrapped(input), id), payloadDigest(body));
  assert.equal(claudeNativeDigest(input, id), payloadDigest(body));
  const truncated = wrapped(raw.subarray(6, written).toString()) + '\n\ufffd';
  assert.notEqual(claudeNativeDigest(truncated, id), payloadDigest(body));
  const message = { id, attemptAt: 1000, text: body, mode: 'queue' };
  const observation = { provider: 'claude', tui: { transport: 'holder-v3' },
    events: [{ hook_event_name: 'UserPromptSubmit', session_id: 'native', receivedAt: 2000, prompt: truncated }] };
  const corrupt = nativeDelivery(message, observation);
  assert.equal(corrupt.corrupted.expected, payloadDigest(body));
  assert.equal(corrupt.completion, undefined);
  assert.equal(nativeDelivery(message, { ...observation, events: [{ ...observation.events[0], prompt: wrapped(input) }] }).payloadVerified, true);
});

test('agy proof recovers the exact suffix after completed bracketed segments and rejects a later Escape', async () => {
  const { agyPasteSegments, submitComposer } = await import('./agent-input.mjs');
  const { handover } = JSON.parse(readFileSync(new URL('../tasks/PILOT2-FIX-2/agy-receipts.json', import.meta.url)));
  const content = Array.from({ length: 21 }, (_, index) => ('line ' + index + ' ').padEnd(index >= 10 ? 180 : 18, 'x')).join('\n');
  const input = wireText(handover.deliveryId, content);
  const parts = agyPasteSegments(input, 120);
  const bracket = text => Buffer.from('\x1b[200~' + text + '\x1b[201~');
  const partial = handover.writes[1].bytes;
  assert(bracket(parts[1]).length > partial);
  const records = [{ id: 'first', seq: 10n, count: bracket(parts[0]).length, output: 100n, human: 0n, boundary: 0 },
    { id: 'second', seq: 12n, count: partial, output: 150n, human: 0n, boundary: 0 }];
  const receipts = new Map([
    ['first', { digest: payloadDigest(bracket(parts[0])), count: records[0].count, start: 135n }],
    ['second', { digest: payloadDigest(bracket(parts[1])), count: partial, start: 135n + BigInt(records[0].count), partial: true }],
  ]);
  const frame = { eventSeq: 12n, outputOffset: records[1].output, humanInputOffset: 0n, boundary: 0 };
  const opts = { provider: 'agy', rows: 120 };
  const proof = provePaste(records, input, frame, id => receipts.get(id), opts);
  assert.deepEqual(proof.continuation, { segment: 1, offset: partial });
  assert.equal(provePaste([...records, { ...records[1], id: 'escape', seq: 17n }], input,
    { ...frame, eventSeq: 17n }, id => receipts.get(id), opts).continuation, undefined);
  assert.equal(provePaste(records, input, { ...frame, humanInputOffset: 1n }, id => receipts.get(id), opts).continuation, undefined);
  assert.equal(provePaste(records, input, { ...frame, boundary: 1 }, id => receipts.get(id), opts).continuation, undefined);

  let current = { draft: '', humanSequence: '0', resizeSequence: 0, bufferSequence: 0, buffer: 'normal',
    outputSequence: 1, quietForMs: 200, writable: true, size: { rows: 120 } };
  let finishedPart = 1;
  const writes = [];
  const result = await submitComposer(input, { provider: 'agy', before: current, resume: proof.continuation,
    read: async () => current, valid: () => true,
    async write(bytes) {
      writes.push(Buffer.from(bytes));
      if (bytes !== '\r') current = { ...current, outputSequence: current.outputSequence + 1,
        draft: parts.slice(0, ++finishedPart).join('') };
    },
  });
  assert.equal(result.accepted, true);
  assert.deepEqual(writes, [bracket(parts[1]).subarray(partial), ...parts.slice(2).map(bracket), Buffer.from('\r')]);
});

test('agy urgent bypass refuses an invisible parked partial even if an old daemon released its request', async t => {
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { bindTuiSession } = await import('./index.mjs');
  const { parked } = JSON.parse(readFileSync(new URL('../tasks/PILOT2-FIX-2/agy-receipts.json', import.meta.url)));
  const dir = mkdtempSync(join(tmpdir(), 'loom-held-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const text = 'prior payload';
  const bookPath = join(dir, 'book.jsonl');
  writeFileSync(bookPath, JSON.stringify({ id: parked.deliveryId, entry: { digest: payloadDigest(text), released: true,
    hostReceipt: { error: 'HOLDER_UNCERTAIN' } } }) + '\n');
  const terminal = { read: async () => ({ text: 'looks idle', draft: '', humanActive: false, writable: true,
    quietForMs: 200, generation: '42' }), provePaste: () => ({ status: 'incomplete', written: parked.written, total: parked.segmentBytes }),
    key: () => assert.fail('No keys on an unresolved partial'), writeIf: () => assert.fail('Urgent input appended to prior draft') };
  const provider = { id: 'agy', screenStartup: true, screen: { classify: () => 'idle', hasEmptyComposer: () => true } };
  const session = bindTuiSession(terminal, provider, { bookPath, evidenceRoot: dir, cwd: dir, hookSink: join(dir, 'hooks.jsonl'),
    readPending: () => ({ text, attemptAt: 100 }) });
  const state = await session.readState();
  assert.equal(state.blocker, 'draft-held');
  assert.equal(state.screen.empty, true);
  assert.equal(state.urgentReady, false);
  assert.equal(state.heldDraftBytes.written, parked.written);
  assert.equal((await session.submit({ id: parked.urgentId, urgent: true, text: 'urgent' })).kind, 'refused');
});

test('pilot-2 proves all 639 bytes and adopts the clipped composer without clearing or repasting', async t => {
  assert.deepEqual(pilotProof(), { status: 'complete', written: 639, total: 639, ownsDraft: true, closedBracket: true });
  assert.equal(pilotProof({ ...pilotView, humanInputOffset: pilotView.humanInputOffset + 1n }).ownsDraft, undefined);
  const { read, bookPath, frame, tdir } = await setupPilotHeld(t, pilot.frames.final, pilotProof);
  await read();
  const held = await read();
  await read();
  assert.equal(held.pending, pilot.deliveryId);
  assert.deepEqual(tdir.keys, [['enter', frame.generation, adoptionWriteId('pilot', pilot.deliveryId, 'enter')]]);
  assert.equal(tdir.resends.length, 0);
  assert.equal(lastBookEntry(bookPath).hostReceipt.outcome, 'adopted-draft');
});

test('a proven agy subset clears once, persists the resend result, and leaves uncertain or human drafts untouched', async t => {
  const rule = '─'.repeat(60);
  const marker = pilot.wire.split('\n')[0];
  for (const kind of ['owned', 'human-input', 'foreign-text', 'stale-clear']) {
    const draft = `${marker}\n${kind === 'foreign-text' ? 'UNRELATED 🚨' : '续作 T17'}`;
    const sample = { draft, atDraftEnd: true,
      text: `${rule}\n> ${draft}\n${rule}\naccept-edits · Gemini 4 Neon · medium`,
      vacantText: `${rule}\n>\n${rule}\naccept-edits · Gemini 4 Neon · medium` };
    const proof = kind === 'human-input' ? () => pilotProof({ ...pilotView, humanInputOffset: pilotView.humanInputOffset + 1n }) : pilotProof;
    const { read, restart, bookPath, tdir } = await setupPilotHeld(t, sample, proof, { stale: kind === 'stale-clear' });
    await read();
    await read();
    const reread = restart();
    await reread();
    await reread();
    assert.equal(tdir.resends.length, kind === 'owned' || kind === 'stale-clear' ? 1 : 0);
    assert.equal(tdir.keys.length, 0);
    assert.equal(lastBookEntry(bookPath).hostReceipt.outcome, kind === 'owned' ? 'resent-after-clear' : 'draft-unverified');
  }
});

function lastBookEntry(path) {
  return JSON.parse(readFileSync(path, 'utf8').trimEnd().split('\n').at(-1)).entry;
}

async function setupPilotHeld(t, sample, proof, { stale = false } = {}) {
  const { mkdtemp, rm, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { bindTuiSession } = await import('./index.mjs');
  const { providers } = await import('./providers.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'loom-held-pilot-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const text = pilot.wire.slice(pilot.wire.indexOf('\n') + 1);
  const bookPath = join(dir, 'book.jsonl');
  await writeFile(bookPath, JSON.stringify({ id: pilot.deliveryId, entry: { digest: payloadDigest(text),
    hostReceipt: { accepted: false, outcome: 'draft-unverified' } } }) + '\n');
  const { text: painted, size = pilot.size, ...draft } = sample;
  const frame = { ...draft, text: painted, outsideComposer: '', generation: '146390',
    vacantText: sample.vacantText ?? `${'─'.repeat(42)}\n>\n${'─'.repeat(42)}\naccept-edits · Gemini 4 Neon · medium`,
    humanActive: false, writable: true, quietForMs: 200, size };
  const tdir = { keys: [], resends: [] };
  const terminal = {
    read: async () => frame,
    writeIf: () => assert.fail('Do not use an unguarded paste'),
    provePaste: () => proof(),
    key: async (...args) => { tdir.keys.push(args); },
    async resendAfterClear(input, before, ids, verify) {
      assert.equal(input, pilot.wire);
      assert.equal(before, frame);
      assert.equal(await verify(frame, { held: true }), true);
      assert.equal(ids.clearId, adoptionWriteId('pilot', pilot.deliveryId, 'clear-draft'));
      assert.equal(lastBookEntry(bookPath).clearResend, true);
      tdir.resends.push(ids);
      if (stale) throw Object.assign(new Error('Frame changed'), { code: 'STALE_FRAME' });
      return { accepted: true };
    },
  };
  const restart = () => bindTuiSession(terminal, providers.agy, { bookPath, incarnation: 'pilot', evidenceRoot: dir,
    cwd: dir, hookSink: join(dir, 'hooks.jsonl'), readPending: () => ({ text, attemptAt: 100 }) }).readState;
  return { read: restart(), restart, bookPath, frame, tdir };
}

test('the captured Neon overlay permits one guarded Escape and requires a repaint before v3 resumes', async t => {
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { bindTuiSession } = await import('./index.mjs');
  const { providers } = await import('./providers.mjs');
  const { handover } = JSON.parse(readFileSync(new URL('../tasks/PILOT2-FIX-2/agy-receipts.json', import.meta.url)));
  const { deliveryId, overlay } = handover;
  for (const repaints of [true, false]) {
    const dir = mkdtempSync(join(tmpdir(), 'loom-overlay-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const bookPath = join(dir, 'book.jsonl');
    const text = 'x'.repeat(1300);
    const input = wireText(deliveryId, text);
    const raw = Buffer.from('\x1b[200~' + input + '\x1b[201~');
    writeFileSync(bookPath, JSON.stringify({ id: deliveryId, entry: { digest: payloadDigest(text),
      hostReceipt: { error: 'HOLDER_UNCERTAIN' } } }) + '\n');
    const banner = [overlay.title, overlay.body, overlay.dismiss].join('\n');
    const composer = '────────────\n> [loom:' + deliveryId + ']\n────────────\naccept-edits · Gemini 4 Neon · medium';
    const size = { rows: 120 };
    let frame = { text: banner + '\n' + composer, outsideComposer: banner, draft: '', generation: '16',
      humanActive: false, writable: true, quietForMs: 200, size };
    const partial = handover.writes[1].bytes;
    const records = [{ id: 'paste', count: partial, seq: 12n, human: 0n, boundary: 0, output: 10n }];
    const receipts = new Map([['paste', { digest: payloadDigest(raw), count: partial, partial: true, start: 135n }]]);
    let outputOffset = 20n, esc = 0, resumes = 0;
    const expectedEsc = adoptionWriteId('holder', deliveryId, 'overlay-esc');
    const terminal = {
      read: async () => frame,
      writeIf: () => assert.fail('Do not start another paste into an overlay or held composer'),
      provePaste(value, current, overlayDismissal) {
        assert.equal(value, input);
        assert.equal(current, frame);
        return provePaste(records, input, { eventSeq: BigInt(frame.generation), outputOffset, humanInputOffset: 0n, boundary: 0 },
          id => receipts.get(id), { provider: 'agy', rows: size.rows, overlayDismissal });
      },
      async key(key, generation, id) {
        assert.equal(key, 'esc');
        assert.equal(generation, '16');
        assert.equal(id, expectedEsc);
        ++esc;
        records.push({ id, count: 1, seq: 17n, human: 0n, boundary: 0, output: 20n });
        receipts.set(id, { digest: payloadDigest('\x1b'), count: 1, start: 135n + BigInt(partial) });
        frame = { ...frame, generation: '17' };
        if (repaints) {
          outputOffset = 29n;
          frame = { ...frame, generation: '18', text: composer, outsideComposer: '' };
        }
      },
      async resumePaste(value, current, continuation, verify, enterId) {
        assert.equal(value, input);
        assert.equal(current, frame);
        assert.deepEqual(continuation, { segment: 0, offset: partial });
        assert.equal(await verify(current), true);
        assert.equal(enterId, adoptionWriteId('holder', deliveryId, 'enter'));
        ++resumes;
        return { accepted: true };
      },
    };
    const bind = () => bindTuiSession(terminal, providers.agy, { bookPath, incarnation: 'holder', evidenceRoot: dir,
      cwd: dir, hookSink: join(dir, 'hooks.jsonl'), readPending: () => ({ text, attemptAt: 100 }) });
    const before = bind();
    assert.equal((await before.readState()).blocker, 'overlay');
    assert.equal(resumes, 0);
    await before.readState();
    assert.equal(esc, 1);
    const after = bind(); // The proof survives loomd replacement just after Escape.
    await after.readState();
    await after.readState();
    assert.equal(esc, 1);
    assert.equal(resumes, repaints ? 1 : 0);
  }
});

test('pilot-2 post-resize 611/615-byte readback enters only with a classified report or no intervening input', async t => {
  const capture = JSON.parse(readFileSync(new URL('../tasks/DELIVERY-SLA-1/pilot-reflow.json', import.meta.url)));
  assert.equal(capture.deliveryId, pilot.deliveryId);
  assert.equal(Buffer.byteLength(capture.frame.draft), 611);
  assert.equal(Buffer.from(capture.modelledTerminalReportHex, 'hex').length, capture.inputOffsetAfter - capture.inputOffsetBefore);
  const writes = pilotWrites.map(write => ({ ...write, rows: pilot.size.rows, bufferSequence: 0 }));
  for (const inputClass of ['terminal-report', 'editing', 'unknown']) {
    const prove = () => provePaste(writes, pilot.wire, {
      eventSeq: BigInt(capture.inputEvent), outputOffset: BigInt(capture.outputOffset), boundary: pilotView.boundary + 1,
      humanInputOffset: BigInt(inputClass === 'terminal-report' ? capture.inputOffsetBefore : capture.inputOffsetAfter),
      bufferSequence: 0,
    }, id => writes.find(write => write.id === id), { provider: 'agy', rows: capture.frame.size.rows });
    assert.equal(prove().status, inputClass === 'terminal-report' ? 'reflowed' : 'unproven');
    const { read, restart, tdir } = await setupPilotHeld(t, capture.frame, prove);
    await read();
    await read();
    await restart()();
    assert.equal(tdir.keys.length, inputClass === 'terminal-report' ? 1 : 0);
    assert.equal(tdir.resends.length, 0);
  }
});
