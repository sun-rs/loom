import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const acp = args.includes('acp');
const { HOME, HOTSWAP_AGY_BINARY, HOTSWAP_AGY_PROFILE, HOTSWAP_AGY_MODEL } = process.env;
const child = spawn('/usr/bin/sandbox-exec', ['-f', HOTSWAP_AGY_PROFILE, HOTSWAP_AGY_BINARY, ...args,
  ...(acp ? ['--gemini-dir=' + join(HOME, '.gemini'), '--disable-telemetry', '--include-default-customizations=false',
    '--cloud_code_endpoint=' + HOTSWAP_AGY_MODEL] : [])],
{ env: { ...process.env, GOOGLE_GEMINI_BASE_URL: HOTSWAP_AGY_MODEL }, stdio: acp ? ['pipe', 'pipe', 'inherit'] : 'inherit' });
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code);
});
if (acp) {
  const authId = 'loom-local-test-auth';
  const log = row => appendFileSync(join(process.cwd(), 'agy-wire.jsonl'), JSON.stringify({ pid: child.pid, ...row }) + '\n',
    { mode: 0o600, flush: true });
  let initializeId;
  let initialized;
  const opening = new Map();
  const input = createInterface({ input: process.stdin });
  input.on('line', line => {
    const { id, method, params } = JSON.parse(line);
    if (method === 'initialize') initializeId = id;
    if (method === 'session/new' || method === 'session/load') opening.set(id, method);
    if (method === 'session/prompt') {
      const text = params.prompt.find(item => item.type === 'text')?.text;
      log({ method, sessionId: params.sessionId, delivery: /\[loom:([0-9a-f-]{36})\]/.exec(text)?.[1] });
    }
    child.stdin.write(line + '\n');
  });
  input.once('close', () => child.stdin.end());
  child.stdin.on('error', error => { if (error.code !== 'EPIPE') throw error; });
  createInterface({ input: child.stdout }).on('line', line => {
    const { id, error, result } = JSON.parse(line);
    if (id != null && id === initializeId && result) {
      initialized = line;
      // The synthetic key is accepted only by our loopback endpoint.
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: authId, method: 'authenticate',
        params: { methodId: 'gemini-api-key', _meta: { apiKey: 'hotswap-loopback-fixture' } } }) + '\n');
      return;
    }
    if (id === authId) {
      if (error) {
        console.error('Isolated agy authentication failed: ' + error.message);
        child.kill('SIGTERM');
      } else console.log(initialized);
      return;
    }
    if (opening.has(id)) {
      log({ method: opening.get(id), sessionId: result?.sessionId, ...(error && { error: error.message }) });
      opening.delete(id);
    }
    console.log(line);
  });
}
