import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import xterm from '@xterm/headless';
import { events, holderClient, holderError } from '../holder/protocol.mjs';
import { submitComposer } from './agent-input.mjs';
import { titlePhase } from './agent-status.mjs';
import { readGrid } from './pty-grid.mjs';
import { providers } from './providers.mjs';

const humanPause = 800_000_000n;
const writeChunk = 4096;
const keys = { enter: '\r', esc: '\x1b', up: '\x1b[A', down: '\x1b[B', 'ctrl+c': '\x03', '0': '0' };
const stale = () => holderError('STALE_FRAME', 'PTY changed after guarded read');
const gap = () => holderError('HOLDER_GAP', 'Holder journal has a gap');
const elapsed = value => Number.isFinite(value) ? performance.now() - value : Number.MAX_SAFE_INTEGER;
const writeFailure = new Set(['stale', 'busy-human', 'would-block', 'exited']);

export async function holderTerminal(binding, controller, provider, expectedPid, expectedChild) {
  const client = holderClient(binding, controller);
  const initial = await client.claim();
  function verifyIdentity(value) {
    if (value.pid !== initial.pid || value.childPid !== initial.childPid ||
        expectedPid != null && value.pid !== expectedPid || expectedChild != null && value.childPid !== expectedChild ||
        value.epoch !== BigInt(controller.generation)) throw holderError('HOLDER_IDENTITY');
    if (value.gap) throw gap();
  }
  verifyIdentity(initial);
  const { Terminal } = xterm;
  const { cols, rows } = initial.initial;
  const grid = new Terminal({ cols, rows, scrollback: 500, allowProposedApi: true });
  const parse = bytes => new Promise(resolve => grid.write(bytes, resolve));
  let eventSeq = 0n, offset = 0n;
  let bufferSequence = 0, resizeSequence = 0, outputSequence = 0;
  let lastOutputAt, title, echo, frame, cached, cachedSeq;
  let lastChange = -Infinity;
  let queue = Promise.resolve();
  let size = { cols, rows };
  grid.onTitleChange(value => { title = { phase: titlePhase(provider, value), observedAt: Date.now() }; });
  grid.buffer.onBufferChange(() => { bufferSequence++; });

  async function apply(upTo) {
    while (eventSeq < upTo.eventSeq) {
      const batch = await client.read(eventSeq);
      if (!batch.length || batch[0].seq > upTo.eventSeq) throw gap();
      for (const event of batch) {
        if (event.seq > upTo.eventSeq) break;
        if (event.seq !== eventSeq + 1n || event.offset !== offset) throw gap();
        if (event.type === events.output) {
          outputSequence++;
          offset += BigInt(event.data.length);
          lastOutputAt = Date.now();
          lastChange = performance.now();
          if (echo && !echo.found) {
            const scan = echo.tail + event.data.toString();
            echo.found = scan.includes(echo.marker);
            echo.tail = scan.slice(1 - echo.marker.length);
          }
          await parse(event.data);
        } else if (event.type === events.resize) {
          resizeSequence++;
          size = { cols: event.data.readUInt32BE(), rows: event.data.readUInt32BE(4) };
          grid.resize(size.cols, size.rows);
          lastChange = performance.now();
        }
        eventSeq = event.seq;
      }
    }
    if (offset !== upTo.outputOffset || size.cols !== upTo.size.cols || size.rows !== upTo.size.rows) throw gap();
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
      humanSequence: snapshot.humanInputOffset.toString(), quietForMs: elapsed(lastChange), writable: !snapshot.ended,
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
  async function writeOnce(bytes, view) {
    if (!writable(view)) return false;
    // Connection loss after the first byte is inherently ambiguous.
    const response = await client.write({ ...view.cursorToken, minHumanQuietNs: humanPause }, bytes, randomUUID());
    if (response.status === 'applied') return true;
    if (writeFailure.has(response.status)) return false;
    if (response.status === 'invalid') throw holderError('INPUT_SIZE', 'Holder refused the input frame');
    if (response.status === 'gap') throw gap();
    throw holderError('HOLDER_UNCERTAIN', `Holder write ${response.status}`);
  }

  async function write(bytes, view) {
    const data = Buffer.from(bytes);
    for (let offset = 0; offset < data.length; offset += writeChunk) {
      const part = data.subarray(offset, offset + writeChunk);
      const current = offset ? await read() : view;
      if (current.humanSequence !== view.humanSequence || current.resizeSequence !== view.resizeSequence ||
          current.bufferSequence !== view.bufferSequence || current.buffer !== view.buffer || !await writeOnce(part, current)) {
        if (!offset) return false;
        throw holderError('HOLDER_UNCERTAIN', 'Holder stopped a partially written input');
      }
    }
    return true;
  }

  try { await read(); }
  catch (error) { grid.dispose(); throw error; }
  return {
    id: binding.incarnation, client, initial, read,
    async writeIf(text, { host: expected }, verify) {
      const before = await read();
      if (before.generation !== expected.generation || !writable(before)) throw stale();
      let wrote = false;
      try {
        return await submitComposer(text, {
          before, provider, read, verify, valid: writable, pastePlaceholder: providers[provider]?.screen.pastePlaceholder,
          async write(bytes, view) {
            const accepted = await write(bytes, view);
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
    async key(key, expectedGeneration) {
      if (!Object.hasOwn(keys, key) || frame?.generation !== expectedGeneration ||
          !await write(keys[key], frame)) throw stale();
    },
    async close() {
      try { await client.signal('SIGTERM'); }
      finally { grid.dispose(); }
    },
    dispose() { grid.dispose(); },
  };
}
