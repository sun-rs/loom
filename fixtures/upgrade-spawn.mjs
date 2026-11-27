import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { connectUnix } from '../lib/unix-socket.mjs';
import { interceptSpawn, spawn } from './test-process.mjs';

const endpoint = 'LOOM_TEST_UPGRADE_SPAWN_SOCKET';
const holderName = `loom-holder-${process.platform}-${process.arch}`;

function launchKind(file, args) {
  if (args[0] === '--pipes' && file.endsWith('/holder/bin/' + holderName)) return 'holder';
  if (file !== process.execPath) return;
  if (args[0]?.endsWith('/daemon/upgrade.mjs')) return 'upgrade';
  if (args[0]?.endsWith('/bin/loomd') && args.includes('--handoff')) return 'handoff';
}

// Keep the fixture-owned children under the test process when an upgrade
// exits its previous daemon. The integration ps bridge only sees descendants.
export async function anchorUpgradeProcesses(t, directory, project, root, candidate) {
  const path = join(directory, 'a');
  const active = new Set();
  const writes = new Set();
  const server = createServer(socket => {
    writes.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => writes.delete(socket));
    const send = value => { if (!socket.destroyed) socket.write(JSON.stringify(value) + '\n'); };
    createInterface({ input: socket }).once('line', line => {
      try {
        const { file, args, env } = JSON.parse(line);
        const kind = launchKind(file, args);
        const entry = kind === 'holder' ? file : args[0];
        const permitted = kind === 'holder' ? [join(root, 'holder/bin', holderName)] :
          kind === 'upgrade' ? [join(root, 'daemon/upgrade.mjs'), join(candidate, 'daemon/upgrade.mjs')] :
            kind === 'handoff' ? [join(root, 'bin/loomd'), join(candidate, 'bin/loomd')] : [];
        if (!permitted.includes(entry)) throw new Error('Unexpected upgrade fixture process');
        const child = spawn(file, args, { cwd: project, env, stdio: 'ignore', detached: true });
        active.add(child);
        child.once('spawn', () => send({ pid: child.pid }));
        child.once('error', error => send({ error: error.message }));
        child.once('close', (code, signal) => {
          active.delete(child);
          send({ code, signal });
          socket.end();
        });
      } catch (error) {
        send({ error: error.message });
        socket.end();
      }
    });
  });
  server.listen(path);
  await once(server, 'listening');
  t.after(async () => {
    await Promise.all([...active].map(async child => {
      const closed = once(child, 'close');
      child.kill('SIGKILL');
      await closed;
    }));
    for (const socket of writes) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  return { [endpoint]: path, NODE_OPTIONS: [process.env.NODE_OPTIONS, '--import=' + import.meta.url].filter(Boolean).join(' ') };
}

if (process.env[endpoint]) {
  interceptSpawn((original, file, args, options) => {
    if (!options?.detached || !launchKind(file, args)) return original(file, args, options);
    const socket = connectUnix(process.env[endpoint]);
    const child = Object.assign(new EventEmitter(), {
      exitCode: null, signalCode: null, unref: () => socket.unref(), kill: signal => process.kill(child.pid, signal),
    });
    socket.on('error', error => child.emit('error', error));
    socket.once('connect', () => socket.write(JSON.stringify({ file, args, env: options.env }) + '\n'));
    createInterface({ input: socket }).on('line', line => {
      const event = JSON.parse(line);
      if (event.error) child.emit('error', new Error(event.error));
      else if (event.pid) {
        child.pid = event.pid;
        child.emit('spawn');
      } else {
        child.exitCode = event.code;
        child.signalCode = event.signal;
        child.emit('exit', event.code, event.signal);
      }
    });
    return child;
  });
}
