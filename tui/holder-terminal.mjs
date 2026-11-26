import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import xterm from '@xterm/headless';
import { events, holderClient, holderError } from '../holder/protocol.mjs';
import { QUIET_OUTPUT_MS, submitComposer } from './agent-input.mjs';
import { titlePhase } from './agent-status.mjs';
import { isAgyDraftSubset } from './composer-draft.mjs';
import { readGrid } from './pty-grid.mjs';
import { providers } from './providers.mjs';
import { utf8PasteChunk, provePaste, readPasteReceipt } from './holder-paste.mjs';

const humanPause = 800_000_000n;
const keys = { enter: '\r', esc: '\x1b', up: '\x1b[A', down: '\x1b[B', 'ctrl+c': '\x03', '0': '0' };
const stale = () => holderError('STALE_FRAME', 'PTY changed after guarded read');
const gap = () => holderError('HOLDER_GAP', 'Holder journal has a gap');
const elapsed = value => Number.isFinite(value) ? performance.now() - value : Number.MAX_SAFE_INTEGER;
const writeFailure = new Set(['stale', 'busy-human', 'would-block', 'exited']);

export async function holderTerminal(binding, controller, provider, expectedPid, expectedChild) {
  const client = holderClient(binding, controller);
  const initial = controller ? await client.claim() : await client.snapshot();
  function verifyIdentity(value) {
    if (value.pipes || value.pid !== initial.pid || value.childPid !== initial.childPid ||
        expectedPid != null && value.pid !== expectedPid || expectedChild != null && value.childPid !== expectedChild ||
        controller && value.epoch !== BigInt(controller.generation)) throw holderError('HOLDER_IDENTITY');
    if (value.gap) throw gap();
  }
  verifyIdentity(initial);
  const { Terminal } = xterm;
  const { cols, rows } = initial.initial;
  const grid = new Terminal({ cols, rows, scrollback: 500, allowProposedApi: true });
  // xterm's per-write byte decoding can lose a CJK code point at a journal
  // boundary. Carry partial UTF-8 across batches and snapshots.
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
  const parse = bytes => new Promise(resolve => grid.write(decoder.decode(bytes, { stream: true }), resolve));
  let eventSeq = 0n, offset = 0n;
  let bufferSequence = 0, resizeSequence = 0, outputSequence = 0;
  let lastOutputAt, title, echo, frame, cached, cachedSeq;
  let lastChange = -Infinity;
  let queue = Promise.resolve();
  let size = { cols, rows };
  let human = 0n, editing = 0n;
  let pasteBoundary = 0;
  const recentWrites = [];
  grid.onTitleChange(value => { title = { phase: titlePhase(provider, value), observedAt: Date.now() }; });
  grid.buffer.onBufferChange(() => { bufferSequence++; pasteBoundary++; });

  async function apply(upTo) {
    while (eventSeq < upTo.eventSeq) {
      const batch = await client.read(eventSeq);
      if (!batch.length || batch[0].seq > upTo.eventSeq) throw gap();
      let output = [];
      async function flushOutput() {
        if (!output.length) return;
        await parse(output.length === 1 ? output[0] : Buffer.concat(output));
        output = [];
        lastOutputAt = Date.now();
        lastChange = performance.now();
      }
      for (const event of batch) {
        if (event.seq > upTo.eventSeq) break;
        if (event.seq !== eventSeq + 1n || event.offset !== offset) throw gap();
        // Preserve the grid at input and geometry boundaries. Group adjacent
        // output so replay does not incur xterm's timer for each journal event.
        if (event.type !== events.output) await flushOutput();
        if (event.type === events.output) {
          outputSequence++;
          offset += BigInt(event.data.length);
          if (echo && !echo.found) {
            const scan = echo.tail + event.data.toString();
            echo.found = scan.includes(echo.marker);
            echo.tail = scan.slice(1 - echo.marker.length);
          }
          output.push(event.data);
        } else if (event.type === events.resize) {
          pasteBoundary++;
          resizeSequence++;
          size = { cols: event.data.readUInt32BE(), rows: event.data.readUInt32BE(4) };
          grid.resize(size.cols, size.rows);
          lastChange = performance.now();
        } else if (event.type === events.human) {
          human = event.data.readBigUInt64BE();
          if (event.inputClass !== 'terminal-report') {
            editing = human;
            pasteBoundary++;
          }
        } else if (event.type === events.write) {
          let emptyComposer;
          if (provider === 'agy') {
            const before = readGrid(grid, provider);
            emptyComposer = before.draft === '' && providers.agy.screen.hasEmptyComposer(before.composerText ?? before.text);
          }
          recentWrites.push({ id: event.data.toString('hex', 0, 16), count: event.data.readUInt32BE(16), human: editing, rows: size.rows, bufferSequence,
            seq: event.seq, output: event.offset, boundary: pasteBoundary, emptyComposer });
          if (recentWrites.length > 128) recentWrites.shift();
        }
        eventSeq = event.seq;
      }
      await flushOutput();
    }
    if (offset !== upTo.outputOffset || human !== upTo.humanInputOffset || size.cols !== upTo.size.cols || size.rows !== upTo.size.rows) throw gap();
  }

  async function catchUp() {
    const snapshot = await client.snapshot();
    verifyIdentity(snapshot);
    await apply(snapshot);
    if (cachedSeq !== eventSeq) {
      cachedSeq = eventSeq;
      cached = readGrid(grid, provider, providers[provider]?.screen.draft);
    }
    const age = snapshot.lastHumanNs && snapshot.nowNs - snapshot.lastHumanNs;
    const signal = snapshot.waitStatus & 0x7f;
    frame = { ...cached, title, outputSequence, bufferSequence, resizeSequence, size,
      buffer: grid.buffer.active.type, lastOutputAt, generation: eventSeq.toString(), cursorToken: snapshot,
      humanActive: snapshot.humanPending || Boolean(snapshot.lastHumanNs && age < humanPause),
      humanInputAt: snapshot.lastHumanNs ? Date.now() - Number(age / 1_000_000n) : undefined,
      humanSequence: editing.toString(), quietForMs: elapsed(lastChange), writable: !snapshot.ended,
      ...(snapshot.ended && { exited: true, code: signal ? 128 + signal : snapshot.waitStatus >> 8,
        ...(signal && { signal, reason: `signal:${signal}` }) }) };
    return frame;
  }

  function read() {
    const current = queue.then(catchUp);
    queue = current.catch(() => {});
    return current;
  }

  const writable = view => !view?.exited && view?.writable && !view.humanActive;
  const sameInput = (before, after) => after.humanSequence === before.humanSequence &&
    after.resizeSequence === before.resizeSequence && after.bufferSequence === before.bufferSequence && after.buffer === before.buffer;
  async function writeOnce(bytes, view, id) {
    if (!writable(view)) return 0;
    // Connection loss after the first byte is inherently ambiguous.
    const response = await client.write({ ...view.cursorToken, minHumanQuietNs: humanPause }, bytes, id);
    if (response.status === 'applied' && response.written === bytes.length ||
        response.status === 'partial' && response.written > 0 && response.written < bytes.length) return response.written;
    if (writeFailure.has(response.status)) return 0;
    if (response.status === 'invalid') throw holderError('INPUT_SIZE', 'Holder refused the input frame');
    if (response.status === 'gap') throw gap();
    throw holderError('HOLDER_UNCERTAIN', `Holder write ${response.status}`);
  }

  async function write(bytes, view, { id, verify } = {}) {
    const data = Buffer.from(bytes);
    let accepted = 0;
    let current = view;
    let writeId = id ?? randomUUID();
    const deadline = performance.now() + 2200;
    do {
      if (!sameInput(view, current) || !writable(current) ||
          accepted && verify && !await verify(current)) break;
      const part = utf8PasteChunk(data, accepted);
      const n = await writeOnce(part, current, writeId);
      if (!n && !accepted) return false;
      accepted += n;
      if (accepted === data.length) return true;
      if (!n) await delay(15);
      else writeId = randomUUID();
      current = await read();
    } while (performance.now() < deadline);
    if (accepted) throw holderError('HOLDER_UNCERTAIN', 'Holder stopped a partially written input');
    return false;
  }

  try { await read(); }
  catch (error) { grid.dispose(); throw error; }
  if (!controller) return { initial, read, dispose: () => grid.dispose() };
  return {
    id: binding.incarnation, client, initial, read,
    async writeIf(text, { host: expected }, verify, options) {
      const before = await read();
      if (before.generation !== expected.generation || !writable(before)) throw stale();
      let wrote = false;
      try {
        return await submitComposer(text, {
          ...options, before, provider, read, verify, valid: writable, pastePlaceholder: providers[provider]?.screen.pastePlaceholder,
          async write(bytes, view) {
            const accepted = await write(bytes, view, { verify });
            if (!accepted && !wrote) throw stale();
            wrote ||= accepted;
            return accepted;
          },
          observeEcho(marker) {
            echo = { marker, tail: '', found: false };
            return () => echo.found;
          },
        });
      } finally {
        echo = undefined;
      }
    },
    async key(key, expectedGeneration, id) {
      if (!Object.hasOwn(keys, key) || frame?.generation !== expectedGeneration ||
          !await write(keys[key], frame, { id })) throw stale();
    },
    provePaste(input, expected, overlayDismissal) {
      if (frame !== expected || !binding.bookPath) return { status: 'unproven', written: null };
      return provePaste(recentWrites, input, { ...frame.cursorToken, humanInputOffset: editing, boundary: pasteBoundary, bufferSequence },
        id => readPasteReceipt(dirname(binding.bookPath), id),
        { provider, rows: frame.size.rows, overlayDismissal: overlayDismissal?.replaceAll('-', '') });
    },
    async resumePaste(input, expected, resume, verify, enterId) {
      if (provider !== 'agy' || frame !== expected || !writable(frame) || !await verify(frame)) throw stale();
      return submitComposer(input, { before: expected, provider, read, valid: writable, resume, verify,
        async write(bytes, view) {
          if (!await verify(view)) return false;
          return write(bytes, view, { id: bytes === '\r' ? enterId : undefined, verify });
        },
      });
    },
    async resendAfterClear(input, expected, { clearId, enterId }, verify) {
      if (provider !== 'agy' || frame !== expected || !writable(frame) || !isAgyDraftSubset(frame, input) ||
          !await verify(frame, { held: true })) throw stale();
      // Native agy handles DEL as Backspace across logical lines. At the
      // end of this proven subset, a byte count bounds the number of keys.
      const clear = '\x7f'.repeat(Buffer.byteLength(input));
      if (!await write(clear, expected, { id: clearId, verify })) throw stale();
      const deadline = performance.now() + 2200;
      do {
        const before = await read();
        if (!sameInput(expected, before) || !writable(before)) break;
        if (before.outputSequence > expected.outputSequence && before.quietForMs >= QUIET_OUTPUT_MS &&
            before.draft === '' && providers.agy.screen.hasEmptyComposer(before.composerText ?? before.text) &&
            await verify(before)) {
          return submitComposer(input, { before, provider, read, valid: writable, verify,
            async write(bytes, view) {
              if (!await verify(view)) return false;
              return write(bytes, view, { id: bytes === '\r' ? enterId : undefined, verify });
            },
          });
        }
        await delay(35);
      } while (performance.now() < deadline);
      return { accepted: false, outcome: 'clear-unverified' };
    },
    async close() {
      try { await client.signal('SIGTERM'); }
      finally { grid.dispose(); }
    },
    dispose() { grid.dispose(); },
  };
}
