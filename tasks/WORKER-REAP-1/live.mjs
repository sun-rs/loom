import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { includeReleaseEntry } from '../../daemon/release.mjs';
import { processTable, sameProcess } from '../../daemon/processes.mjs';
import { readArtifacts } from '../../cli/artifacts.mjs';
import { modelEndpoint } from '../HOTSWAP-0/loopback.mjs';

const codex = process.argv[2];
if (!isAbsolute(codex ?? '')) throw new Error('Supply the absolute path to the native Codex binary');
const root = resolve(import.meta.dirname, '../..');
const temp = mkdtempSync(join(realpathSync('/tmp'), 'lwr-'));
const project = join(temp, 'project');
const candidate = join(temp, 'candidate');
const home = join(temp, 'home');
const codexHome = join(home, 'codex');
const exec = promisify(execFile);
const endpoint = await modelEndpoint(() => {});
const env = {
  HOME: home, CODEX_HOME: codexHome, TMPDIR: temp, LOOM_WORKER_TMP: temp,
  PATH: [dirname(process.execPath), '/usr/bin', '/bin'].join(':'),
  OAR_CODEX_BIN: codex, LOOM_CODEX_BIN: codex, LOOM_DESKTOP_NOTIFY: '0', LOOM_HERDR_LAYOUT: '0',
  NO_PROXY: '127.0.0.1,localhost', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
};
const launched = [];
const ttl = 18_000;
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const job = addr => read(join(project, '.project/loomd/sessions', addr + '.json'));
const run = async (args, caller) => JSON.parse((await exec(process.execPath,
  [join(root, 'bin/loom'), ...args, '--project', project],
  { cwd: project, env: { ...env, ...(caller && { LOOM_ADDR: caller }) }, timeout: 55_000 })).stdout);
const until = async (probe, ready, timeout = 15_000) => {
  const end = Date.now() + timeout;
  let result;
  do {
    result = await probe();
    if (ready(result)) return result;
    await delay(250);
  } while (Date.now() < end);
  assert.fail(JSON.stringify(result));
};

try {
  mkdirSync(codexHome, { recursive: true, mode: 0o700 });
  mkdirSync(join(project, '.project'), { recursive: true });
  writeFileSync(join(codexHome, 'config.toml'), `
model = "gpt-6.2-sol"
model_provider = "loopback"
check_for_update_on_startup = false
skip_model_catalog_refresh_on_startup = true
cli_auth_credentials_store = "file"
[analytics]
enabled = false
[feedback]
enabled = false
[model_providers.loopback]
name = "WORKER-REAP loopback"
base_url = ${JSON.stringify(endpoint.url)}
wire_api = "responses"
requires_openai_auth = false
request_max_retries = 0
stream_max_retries = 0
`);
  writeFileSync(join(project, '.project/policy.json'), JSON.stringify({
    workers: { warmMs: { codex: ttl } }, delivery: { coalesceMs: 0 },
  }));
  mkdirSync(candidate);
  for (const name of ['adapters', 'bin', 'cli', 'daemon', 'evidence', 'handover', 'holder', 'inbox', 'index', 'lib',
    'memory', 'relay', 'runtimes', 'schema', 'tui', 'watch', 'package.json', 'package-lock.json']) {
    cpSync(join(root, name), join(candidate, name), { recursive: true, filter: path => includeReleaseEntry(basename(path)) });
  }
  symlinkSync(join(root, 'node_modules'), join(candidate, 'node_modules'));
  appendFileSync(join(candidate, 'daemon/main.mjs'), '\n// Isolated upgrade candidate for WORKER-REAP-1.\n');

  const launch = async (role, caller) => {
    const result = await run(['spawn', role, '--cwd', project, '--cli', 'codex', '--mode', 'headless',
      '--model', 'gpt-6.2-sol', '--effort', 'low', ...(caller ? ['--task', 'NATIVE', '--wave', 'GATE'] : []),
      'Reply with the fixture result.'], caller);
    launched.unshift(result.session.addr);
    return result;
  };
  await run(['daemon', 'start']);
  const leader = await launch('leader');
  const worker = await launch('worker', leader.session.addr);
  assert.equal(worker.dispatch, 'new');
  const { addr, sessionId } = worker.session;
  const checked = await run(['worker-check'], addr);
  assert.equal(checked.firstReportCheck.status, 'verified');
  assert.deepEqual(checked.firstReportCheck.actual, worker.checkpoint);
  const state = () => run(['state', addr]);
  const status = () => run(['status', '--json']);
  const ready = await until(state, result => result.state === 'idle-warm' && result.retention.remainingMs > 0);
  assert.equal(ready.reuse, 'reusable');
  assert.equal(ready.compactions, 0);
  const ownerPath = incarnation => join(project, '.project/loomd/hosts', addr, incarnation, 'owner.json');
  const incarnation = job(addr).host.incarnation;
  const ownerFile = ownerPath(incarnation);
  const owner = read(ownerFile).identity;
  const before = await processTable();
  const children = [...before.values()].filter(row => row.ppid === owner.pid || row.pgid === owner.pid);
  assert(children.some(child => child.pid !== owner.pid && child.executable.endsWith('/codex')));
  const beforeStatus = await status();
  assert(beforeStatus.memory[0].rssKiB > 0);
  const daemon = await run(['daemon', 'status']);
  const upgrade = await run(['upgrade', '--to', candidate]);
  assert.equal(upgrade.phase, 'committed');
  assert.notEqual(upgrade.pid, daemon.pid);
  const attached = await state();
  assert.equal(job(addr).host.incarnation, incarnation);
  assert.equal(attached.retention.idleSince, ready.retention.idleSince);
  assert(attached.retention.remainingMs < ready.retention.remainingMs);
  const offline = await until(state, result => result.state === 'offline', ttl + 8_000);
  assert(offline.retention.releasedAt >= ready.retention.idleSince + ttl);
  await until(() => processTable(children.map(child => child.pid)), table =>
    children.every(child => !sameProcess(child, table.get(child.pid))));
  const offlineStatus = await status();
  assert(offlineStatus.memory[0].rssKiB < beforeStatus.memory[0].rssKiB);
  assert.equal((await run(['cost'])).memory[0].measuredSessions, 1);
  assert.equal(offlineStatus.workerMetrics.find(row => row.gate === 'GATE').ttl, 1);
  const firstEvidence = readArtifacts(project).cards(addr).map(card => card.path);
  assert(firstEvidence.length > 0);
  assert.equal((await run(['hist', addr, '--turns', '2', '--level', 'L2', '--json'])).turns.length, 1);

  const revived = await run(['send', 'NATIVE', '--reason', 'Same files and prior knowledge', 'Follow up in the same context.'], leader.session.addr);
  assert.equal(revived.dispatch, 'revived');
  assert.equal(revived.dispatchReason, 'Same files and prior knowledge');
  assert.notEqual(job(addr).host.incarnation, incarnation);
  await until(state, result => result.deliveries.some(delivery => delivery.id === revived.deliveryId && delivery.deliveryStatus === 'answered') &&
    result.retention.remainingMs > 0);
  const current = (await run(['ls'])).sessions.find(row => row.addr === addr);
  assert.equal(current.sessionId, sessionId);
  assert.equal(current.cwd, worker.session.cwd);
  assert(current.transcriptPath.startsWith(codexHome + '/'));
  const transcript = readFileSync(current.transcriptPath, 'utf8');
  assert(transcript.includes(worker.deliveryId) && transcript.includes(revived.deliveryId));
  assert.equal((await run(['hist', addr, '--turns', '2', '--level', 'L2', '--json'])).turns.length, 2);
  const evidence = readArtifacts(project).cards(addr).map(card => card.path);
  assert(firstEvidence.every(path => evidence.includes(path)) && evidence.length > firstEvidence.length);
  for (const id of [worker.deliveryId, revived.deliveryId]) assert.equal(endpoint.requests.filter(request => request.delivery === id).length, 1);
  const released = await run(['release', addr], leader.session.addr);
  assert.equal(released.state, 'offline');
  const metrics = (await status()).workerMetrics.find(row => row.gate === 'GATE');
  assert.deepEqual([metrics.newSpawns, metrics.revives, metrics.reuses, metrics.leader, metrics.ttl], [1, 1, 1, 1, 1]);
  assert.equal(metrics.coldRevivesMeasured, 1);
  assert(metrics.coldReviveTokens > 0);
  console.log(JSON.stringify({ nativeResume: true, sessionId, sameWorktree: true, firstReportCheck: true, verifiedReceipts: 2,
    previousDaemonPid: daemon.pid, newDaemonPid: upgrade.pid, idleSince: ready.retention.idleSince,
    remainingBeforeMs: ready.retention.remainingMs, remainingAfterMs: attached.retention.remainingMs,
    beforeRssKiB: beforeStatus.memory[0].rssKiB, releasedRssKiB: offlineStatus.memory[0].rssKiB,
    coldReviveTokens: metrics.coldReviveTokens }));
} catch (error) {
  console.error('Isolated fixture logs:', temp);
  process.exitCode = 1;
  console.error(error);
} finally {
  for (const addr of launched) await run(['stop', addr]).catch(() => {});
  await run(['daemon', 'stop']).catch(() => {});
  await endpoint.close();
  if (!process.exitCode) rmSync(temp, { recursive: true, force: true });
}
