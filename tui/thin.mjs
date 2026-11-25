import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { submitComposer } from './agent-input.mjs';
import { titlePhase } from './agent-status.mjs';
import { readGrid } from './pty-grid.mjs';

const keys = { enter: '\r', esc: '\x1b', up: '\x1b[A', down: '\x1b[B', 'ctrl+c': '\x03' };
const guardAge = since => Number.isFinite(since) ? performance.now() - since : Number.MAX_SAFE_INTEGER;
const stale = () => Object.assign(new Error('PTY changed after guarded read'), { code: 'STALE_FRAME' });

export function thinBackend({ pty, Terminal, cols = 180, rows = 50, mirror, humanPauseMs = 800 }) {
  return {
    async launch({ cwd, argv, env, unset, provider, extractDraft }) {
      const id = `pty-${randomUUID()}`;
      const childEnv = { ...process.env, ...env, TERM: 'xterm-256color' };
      for (const key of unset) delete childEnv[key];
      const grid = new Terminal({ cols, rows, scrollback: 500, allowProposedApi: true });
      let child;
      try {
        child = pty.spawn(argv[0], argv.slice(1), { cwd, env: childEnv, cols, rows, name: childEnv.TERM, encoding: null });
      } catch (error) {
        grid.dispose();
        throw error;
      }
      let parsed = Promise.resolve();
      let generation = 0;
      let outputSequence = 0;
      let bufferSequence = 0;
      let resizeSequence = 0;
      let size = { cols, rows };
      let humanSequence = 0;
      let lastOutputAt;
      let outputClock = -Infinity;
      let resizedAt = -Infinity;
      let humanInputAt;
      let humanAt = -Infinity;
      let title;
      let echo;
      let mirrorBlocked = false;
      let cachedGrid;
      let cachedGeneration;
      let exit;
      let onExit;
      const exited = new Promise(resolve => { onExit = resolve; });
      const humanActive = () => performance.now() - humanAt < humanPauseMs;
      const onTitle = grid.onTitleChange(value => { title = { phase: titlePhase(provider, value), observedAt: Date.now() }; });
      const onBufferChange = grid.buffer.onBufferChange(() => { bufferSequence++; });
      const onDrain = () => {
        mirrorBlocked = false;
        if (!exit) child.resume();
      };
      const fromPty = child.onData(bytes => {
        ++generation;
        ++outputSequence;
        lastOutputAt = Date.now();
        outputClock = performance.now();
        if (echo && !echo.found) {
          const scan = echo.tail + bytes.toString();
          echo.found = scan.includes(echo.marker);
          echo.tail = scan.slice(1 - echo.marker.length);
        }
        parsed = new Promise(resolve => grid.write(bytes, resolve));
        if (mirror && !mirror.write(bytes) && !mirrorBlocked) {
          mirrorBlocked = true;
          child.pause();
          mirror.once('drain', onDrain);
        }
      });
      // In mirrored mode the outer terminal owns protocol replies. Running both
      // responders would feed the inner CLI two copies of the same terminal reply.
      const fromGrid = !mirror && grid.onData(bytes => { if (!exit) child.write(bytes); });
      const exitListener = child.onExit(({ exitCode, signal }) => {
        ++generation;
        exit = { exited: true, code: signal ? 128 + signal : exitCode,
          ...(signal && { signal, reason: `signal:${signal}` }) };
        onExit(exit);
      });
      function write(bytes) {
        if (exit) throw new Error('Thin PTY exited');
        generation++;
        child.write(bytes);
      }
      async function read() {
        let capture;
        for (let attempt = 0; attempt < 3; attempt++) {
          capture = generation;
          await parsed;
          if (capture === generation) break;
        }
        if (cachedGeneration !== capture) {
          cachedGrid = readGrid(grid, provider, extractDraft);
          cachedGeneration = capture;
        }
        return { ...cachedGrid, title, outputSequence, bufferSequence, resizeSequence, size, buffer: grid.buffer.active.type,
          lastOutputAt, generation: capture, humanActive: humanActive(), humanInputAt, humanSequence,
          quietForMs: guardAge(Math.max(outputClock, resizedAt)), writable: !exit && capture === generation, ...exit };
      }
      const valid = frame => !exit && generation === frame.generation && !humanActive();
      return {
        id,
        read,
        exited,
        writeHuman(bytes) {
          if (exit) return;
          ++humanSequence;
          humanInputAt = Date.now();
          humanAt = performance.now();
          write(bytes);
        },
        resize(columns, height) {
          if (exit || !Number.isInteger(columns) || !Number.isInteger(height) || columns < 1 || height < 1 ||
              (columns === size.cols && height === size.rows)) return;
          ++generation;
          ++resizeSequence;
          resizedAt = performance.now();
          size = { cols: columns, rows: height };
          // Serialize reflow between prior output and the redraw triggered by SIGWINCH.
          parsed = new Promise(resolve => grid.write('', () => { grid.resize(columns, height); resolve(); }));
          child.resize(columns, height);
        },
        signal(name) {
          if (!exit) child.kill(name);
        },
        async writeIf(text, { host: expected }, verify) {
          const before = await read();
          if (before.generation !== expected.generation || !valid(before)) throw stale();
          try {
            return await submitComposer(text, { before, read, write, valid, verify, observeEcho(marker) {
              echo = { marker, tail: '', found: false };
              return () => echo.found;
            } });
          } finally {
            echo = undefined;
          }
        },
        key(key, expectedGeneration) {
          if (generation !== expectedGeneration || exit || humanActive()) throw stale();
          write(keys[key]);
        },
        async close() {
          if (!exit) {
            try { child.kill(); } catch (error) { if (error.code !== 'ESRCH') throw error; }
          }
          let timeout;
          try {
            await Promise.race([exited, new Promise((_, reject) => {
              timeout = setTimeout(() => reject(new Error('Thin PTY did not exit')), 5_000);
            })]);
          } finally {
            clearTimeout(timeout);
            fromPty.dispose();
            fromGrid?.dispose?.();
            exitListener.dispose();
            onTitle.dispose();
            onBufferChange.dispose();
            mirror?.removeListener('drain', onDrain);
            await parsed;
            grid.dispose();
          }
          return exit;
        },
      };
    },
  };
}
