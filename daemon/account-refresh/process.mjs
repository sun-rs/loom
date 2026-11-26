import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

const outputLimit = 1024 * 1024;

export class RefreshFailure extends Error {
  constructor(status, reason) {
    super(reason ?? status);
    this.status = status;
    this.reason = reason;
  }
}

export function rejectShape() {
  throw new RefreshFailure('unsupported', 'unsupported-version-shape');
}

function run(binary, args, { env, deadline, signal }, protocol) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) throw new RefreshFailure('error', 'refresh-cancelled');
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw new RefreshFailure('timeout');

    const group = process.platform !== 'win32';
    const child = spawn(binary, args, {
      env, cwd: '/', shell: false, detached: group,
      stdio: [protocol ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    let bytes = 0;
    const chunks = [];
    const finish = (error, value, stop = true) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      if (stop && child.pid) {
        try {
          if (group) process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch {
          // The process may have already exited.
        }
      }
      child.stdin?.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new RefreshFailure('timeout')), remaining);
    const cancel = () => finish(new RefreshFailure('error', 'refresh-cancelled'));
    signal?.addEventListener('abort', cancel, { once: true });
    const failed = () => finish(new RefreshFailure('error', 'cli-process-failed'));
    const count = chunk => {
      if (settled) return false;
      bytes += chunk.length;
      if (bytes <= outputLimit) return true;
      finish(new RefreshFailure('error', 'cli-output-limit'));
      return false;
    };
    const send = frame => child.stdin.write(JSON.stringify(frame) + '\n');
    child.once('error', failed);
    child.stdin?.on('error', failed);
    child.stdout.on('error', failed);
    child.stderr.on('error', failed);
    child.stderr.on('data', count);
    child.stdout.on('data', chunk => {
      if (!count(chunk)) return;
      if (!protocol) {
        chunks.push(chunk);
        return;
      }
      try { protocol.read(chunk, send, value => finish(null, value)); }
      catch (error) { finish(error); }
    });
    if (protocol) child.once('spawn', () => {
      if (settled) return;
      try { protocol.start(send); }
      catch (error) { finish(error); }
    });
    child.once('close', (code, signal) => {
      if (protocol || signal) failed();
      else finish(null, { code, stdout: Buffer.concat(chunks).toString('utf8') }, false);
    });
  });
}

export function runCommand(binary, args, options) {
  return run(binary, args, options);
}

export function parseJson(stdout) {
  try { return JSON.parse(stdout); }
  catch { rejectShape(); }
}

export function readCodex(binary, options, verifyAgent) {
  const decoder = new StringDecoder('utf8');
  let lineBuffer = '';
  let initialized = false;
  const responses = new Map();
  return run(binary, ['app-server', '--listen', 'stdio://'], options, {
    start(send) {
      send({ id: 0, method: 'initialize', params: {
        clientInfo: { name: 'loom-account-refresh', version: '1.0.0' },
        capabilities: { experimentalApi: true },
      } });
    },
    read(chunk, send, complete) {
      lineBuffer += decoder.write(chunk);
      let newline;
      while ((newline = lineBuffer.indexOf('\n')) !== -1) {
        const line = lineBuffer.slice(0, newline).trim();
        lineBuffer = lineBuffer.slice(newline + 1);
        if (!line) continue;
        const frame = parseJson(line);
        if (!frame || typeof frame !== 'object' || Array.isArray(frame)) rejectShape();
        if (Object.hasOwn(frame, 'method')) continue;
        if (!initialized && frame.id === 0) {
          if (frame.error) throw new RefreshFailure('error', 'cli-rpc-failed');
          verifyAgent(frame.result?.userAgent, frame.result?.codexHome);
          initialized = true;
          send({ method: 'initialized', params: {} });
          send({ id: 1, method: 'account/read', params: { refreshToken: false } });
          send({ id: 2, method: 'account/rateLimits/read' });
          continue;
        }
        if (!initialized || ![1, 2].includes(frame.id) || responses.has(frame.id)) continue;
        responses.set(frame.id, frame);
        if (responses.size === 2) {
          complete({ account: responses.get(1), limits: responses.get(2) });
          return;
        }
      }
    },
  });
}
