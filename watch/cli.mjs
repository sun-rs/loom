#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { createWatcher, loomQueue } from './index.mjs';

const help = `Usage: node watch/cli.mjs (--index FILE | --index-db FILE) --events FILE [options]
  --index FILE        JSON index snapshot, as returned by loom ls
  --index-db FILE     Query the live loom SQLite index
  --hooks-dir DIR     Read per-terminal hook logs DIR/<addr>.jsonl
  --hooks-file FILE   Read a shared event log whose records have addr
  --trust-cwd DIR     Auto-accept folder trust for this exact absolute cwd (repeatable)
  --super ADDR        Send needs-you and recovery notices through hc (default: file only)
  --loom PATH         Loom executable for queue delivery (default: this checkout's bin/loom)
  --project DIR       Project directory for Loom queue delivery (default: infer from each cwd)
  --poll-ms MS        Polling interval, at most 30000 (default: 5000)
  --idle-ms MS        Idle without a closing hook (default: 30000)
  --busy-ms MS        Busy without output or hook activity (default: 45000)
  --once              Observe a single snapshot and exit
`;

async function hookRows(path) {
  let body;
  try { body = await readFile(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  // A hook process can still be appending the final line.
  return body.split('\n').slice(0, -1).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

async function indexRows(path) {
  const value = JSON.parse(await readFile(path, 'utf8'));
  const rows = Array.isArray(value) ? value : value?.sessions;
  if (!Array.isArray(rows)) throw new TypeError('Index must be an array or an object with a sessions array');
  return rows;
}

async function main() {
  const { values } = parseArgs({ options: {
    index: { type: 'string' }, 'index-db': { type: 'string' }, events: { type: 'string' }, 'hooks-dir': { type: 'string' },
    'hooks-file': { type: 'string' }, 'trust-cwd': { type: 'string', multiple: true },
    super: { type: 'string' }, loom: { type: 'string' }, project: { type: 'string' }, 'poll-ms': { type: 'string', default: '5000' },
    'idle-ms': { type: 'string' }, 'busy-ms': { type: 'string' }, once: { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.help) { console.log(help); return; }
  const indexPath = values['index-db'] ?? values.index;
  if (!indexPath || !values.events || (values.index && values['index-db'])) {
    throw new TypeError('Specify an index source and --events');
  }
  if (resolve(indexPath) === resolve(values.events)) throw new TypeError('Index and event output must be different files');
  if (values['hooks-dir'] && values['hooks-file']) throw new TypeError('Specify one hook source');
  if (values['hooks-file'] && resolve(values['hooks-file']) === resolve(values.events)) {
    throw new TypeError('Hook input and event output must be different files');
  }
  const interval = Number(values['poll-ms']);
  if (!Number.isInteger(interval) || interval < 1 || interval > 30_000) throw new RangeError('Invalid --poll-ms');

  let list;
  if (values['index-db']) {
    const { openIndex } = await import('../index/index.mjs');
    const index = openIndex(indexPath);
    list = () => index.query({ backend: 'tui', endedAt: null });
  } else {
    list = () => indexRows(indexPath);
  }
  let readHooks;
  let sharedHooks;
  if (values['hooks-file']) {
    readHooks = async session => (await (sharedHooks ??= hookRows(values['hooks-file'])))
      .filter(row => row?.addr === session.addr);
  } else if (values['hooks-dir']) {
    readHooks = session => hookRows(join(values['hooks-dir'], `${session.addr}.jsonl`));
  }
  const watcher = createWatcher({
    listSessions: () => { sharedHooks = undefined; return list(); }, readHooks, eventFile: values.events,
    trustedCwds: values['trust-cwd'], superAddr: values.super,
    enqueue: loomQueue(values.loom && resolve(values.loom), values.project && resolve(values.project)),
    idleMs: values['idle-ms'] === undefined ? undefined : Number(values['idle-ms']),
    busyMs: values['busy-ms'] === undefined ? undefined : Number(values['busy-ms']),
  });

  if (values.once) {
    console.log(JSON.stringify(await watcher.poll()));
  } else {
    const stop = new AbortController();
    process.once('SIGTERM', () => stop.abort());
    process.once('SIGINT', () => stop.abort());
    let lastError;
    while (!stop.signal.aborted) {
      const start = performance.now();
      try { await watcher.poll(); lastError = undefined; }
      catch (error) {
        if (lastError !== error.message) console.error(`watch: ${error.message}`);
        lastError = error.message;
      }
      if (!stop.signal.aborted) {
        await sleep(Math.max(0, interval - (performance.now() - start)), undefined, { signal: stop.signal })
          .catch(error => { if (error.name !== 'AbortError') throw error; });
      }
    }
  }
  await watcher.flush();
}

main().catch(error => {
  console.error(`watch: ${error.message}`);
  process.exitCode = 1;
});
