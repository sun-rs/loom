import { spawn } from 'node:child_process';
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync, writeSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseAgyStatuslinePayload, parseClaudeStatuslinePayload } from './passive.mjs';

const script = fileURLToPath(import.meta.url);
const parsers = { claude: parseClaudeStatuslinePayload, agy: parseAgyStatuslinePayload };
const shellQuote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";

export function createStatuslineSettings({
  cli, cliVersion, sinkPath, sessionId, generation, userCommand, wrapperScript = script, bindNative = false,
}) {
  if (!Object.hasOwn(parsers, cli) || !isAbsolute(sinkPath) || !isAbsolute(wrapperScript) || !sessionId || !generation) {
    throw new TypeError('Invalid statusline launch binding');
  }
  const config = JSON.stringify({ cli, cliVersion, sinkPath, sessionId, generation, userCommand, bindNative });
  return { statusLine: { type: 'command', command: [process.execPath, wrapperScript, config].map(shellQuote).join(' ') } };
}

const isPrivateFile = stat => stat.isFile() && stat.nlink === 1 &&
  (stat.mode & 0o777) === 0o600 && stat.uid === process.getuid?.();

function boundVersion(path) {
  if (!isAbsolute(path) || realpathSync(dirname(path)) !== dirname(path)) return;
  const fd = openSync(path + '.version', constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!isPrivateFile(stat) || stat.size > 128) return;
    const buffer = Buffer.alloc(stat.size);
    const value = buffer.subarray(0, readSync(fd, buffer)).toString('utf8');
    if (/^v?\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/i.test(value)) return value;
  } finally {
    closeSync(fd);
  }
}

function appendObservation(path, entry) {
  if (!isAbsolute(path) || realpathSync(dirname(path)) !== dirname(path)) return;
  const fd = openSync(path, constants.O_RDWR | constants.O_APPEND | constants.O_CREAT |
    constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  try {
    const stat = fstatSync(fd);
    if (!isPrivateFile(stat)) return;
    const tail = Buffer.alloc(Math.min(stat.size, 64 * 1024));
    const bytes = readSync(fd, tail, 0, tail.length, stat.size - tail.length);
    const last = tail.subarray(0, bytes).toString('utf8').trimEnd().split('\n').at(-1);
    const fingerprint = row => JSON.stringify(row, (key, value) =>
      key === 'observedAt' || key === 'observed_at' ? undefined : value);
    if (last) {
      try { if (fingerprint(JSON.parse(last)) === fingerprint(entry)) return; }
      catch { /* A damaged last row does not block later observations. */ }
    }
    writeSync(fd, (bytes && tail[bytes - 1] !== 10 ? '\n' : '') + JSON.stringify(entry) + '\n');
  } finally {
    closeSync(fd);
  }
}

function collectStatusline(stdin, { cli, cliVersion, sinkPath, sessionId, generation, bindNative }) {
  if (!Object.hasOwn(parsers, cli) || !sessionId || !generation || Buffer.byteLength(stdin) > 1024 * 1024) return;
  const payload = JSON.parse(stdin);
  const nativeSessionId = payload?.session_id ?? payload?.sessionId ?? payload?.conversationId;
  if (bindNative && (typeof nativeSessionId !== 'string' || !/^[a-z0-9_-]{1,128}$/i.test(nativeSessionId) ||
      cli === 'claude' && nativeSessionId !== sessionId)) return;
  if (bindNative && cliVersion == null) {
    try { cliVersion = boundVersion(sinkPath); }
    catch { /* The existing pane version probe may not have published its result yet. */ }
  }
  const diagnostics = [];
  const observedAt = new Date().toISOString();
  const observations = parsers[cli](payload, {
    cliVersion: cliVersion ?? payload?.version ?? payload?.cli_version, observedAt,
    sessionId: nativeSessionId, generation, observeAccountDiagnostics: batch => diagnostics.push(...batch),
  });
  if (!observations.length && !diagnostics.length) return;
  const binding = { sessionId, generation };
  if (bindNative) {
    appendObservation(sinkPath, { cli, ...binding, nativeSessionId, observedAt, observations, diagnostics });
  } else if (!observations.length && diagnostics.length) {
    appendObservation(sinkPath, { ...diagnostics[0], ...binding });
  } else {
    appendObservation(sinkPath, { cli, ...binding, observedAt, observations, ...(diagnostics.length && { diagnostics }) });
  }
}

export async function runStatuslineWrapper({
  stdin, userCommand, cwd, env, output = 'capture', ...binding
}) {
  try { collectStatusline(stdin, binding); }
  catch { /* Collection is optional and must not interfere with the user's command. */ }
  if (!userCommand) return { stdout: '', stderr: '', exitCode: 0 };
  return new Promise(resolve => {
    const inherit = output === 'inherit';
    const child = spawn('/bin/sh', ['-c', userCommand], { cwd, env, stdio: ['pipe', inherit ? 'inherit' : 'pipe', inherit ? 'inherit' : 'pipe'] });
    const stdout = [], stderr = [];
    child.stdout?.on('data', chunk => stdout.push(chunk));
    child.stderr?.on('data', chunk => stderr.push(chunk));
    child.stdin.on('error', () => {}); // A downstream command may exit without reading its input.
    child.on('error', () => resolve({ stdout: '', stderr: '', exitCode: 127 }));
    child.on('close', (code, signal) => resolve({
      stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), exitCode: code, signal,
    }));
    child.stdin.end(stdin);
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const result = await runStatuslineWrapper({ ...JSON.parse(process.argv[2]), stdin: Buffer.concat(chunks), output: 'inherit' });
  if (result.signal) process.kill(process.pid, result.signal);
  else process.exitCode = result.exitCode;
}
