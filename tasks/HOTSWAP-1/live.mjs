import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdtempSync, openSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { modelEndpoint } from '../HOTSWAP-0/loopback.mjs';
import { geminiEndpoint } from './gemini-loopback.mjs';
import { deliveryChecks } from '../HOTSWAP-0/invariants.mjs';
import { exec, experiment, installDependencies, isolatedEnvironment, mkdir, read, replaceText, snapshot, write } from '../HOTSWAP-0/setup.mjs';
import { hostHello, hostRequest, hostSocket, readJSON, hostDirectory } from '../../daemon/host-control.mjs';
import { processTable, sameProcess } from '../../daemon/processes.mjs';

assert.equal(experiment, '/Users/sun/Code/exp-relay/hotswap-1');
mkdir(experiment);
assert.equal(realpathSync(experiment), experiment);
const run = mkdtempSync(join(experiment, 'l-'));
console.log('Evidence directory ' + run);
const project = join(run, 'p');
const old = join(run, 'old');
const next = join(run, 'next');
const broken = join(run, 'broken');
const file = name => join(project, name);
mkdir(file('.project'));
for (const target of [old, next, broken]) snapshot(target);
const version = JSON.parse(read(join(old, 'package.json'))).dependencies['@botiverse/oar'];
const dependencies = await installDependencies(run, old, [version]);
for (const target of [old, next, broken]) symlinkSync(dependencies[version], join(target, 'node_modules'));
replaceText(join(next, 'daemon/host-control.mjs'), 'export const hostProtocol = 1;', 'export const hostProtocol = 2;');
replaceText(join(next, 'tui/pty-control.mjs'), 'export const controlProtocol = 1;', 'export const controlProtocol = 2;');
for (const target of [old, next, broken]) replaceText(join(target, 'daemon/main.mjs'), '    ...options,\n    sessionOptions:',
  '    ...options,\n    externalNotification: async () => {},\n    sessionOptions:');
replaceText(join(broken, 'daemon/main.mjs'), 'const handoff = validateHandoff',
  "if (values.handoff) throw new Error('HOTSWAP injected candidate startup failure');\n  const handoff = validateHandoff");

const model = await modelEndpoint(() => {});
const gemini = await geminiEndpoint();
const env = isolatedEnvironment(run, model.url);
const peer = join(run, 'bin', 'agy');
writeFileSync(peer, '#!' + process.execPath + '\nimport(' + JSON.stringify(new URL('./native-agy.mjs', import.meta.url).href) + ');\n',
  { mode: 0o700 });
const profile = join(run, 'agy.sb');
const nativeHome = '/Users/sun';
const denied = ['.codex', '.claude', '.gemini', '.config', '.loom-next', 'Library/Keychains', 'Library/Application Support']
  .map(name => '(subpath ' + JSON.stringify(join(nativeHome, name)) + ')').join(' ');
write(profile, `(version 1)
(allow default)
(deny file-read* (regex #"(^|/)(auth[.]json|memories[^/]*|provider-homes|SKILL[.]md|skills|[.]env[^/]*)(/|$)"))
(deny file-read* file-write* ${denied})
(deny mach-lookup (global-name "com.apple.securityd") (global-name "com.apple.securityd.xpc") (global-name "com.apple.SecurityServer"))
(deny network-outbound)
(allow network-outbound (remote ip "localhost:*"))
`);
Object.assign(env, { LOOM_AGY_BIN: peer, OAR_AGY_BIN: peer, OAR_ANTIGRAVITY_BIN: peer,
  HOTSWAP_AGY_BINARY: '/Users/sun/.local/bin/agy', HOTSWAP_AGY_MODEL: gemini.url, HOTSWAP_AGY_PROFILE: profile });
const log = openSync(join(run, 'loomd.log'), 'a', 0o600);
const initial = spawn(process.execPath, [join(old, 'bin', 'loomd'), '--project', project],
  { env, cwd: project, stdio: ['ignore', log, log] });
closeSync(log);

const evidence = {};
const lines = name => existsSync(name) ? read(name).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
const mail = id => JSON.parse(read(file('.project/inbox/state.json'))).messages.filter(message => message.id === id);
const events = addr => lines(file('.project/relay/events/' + addr + '.jsonl'));
const abort = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => abort.abort(new Error(signal)));
async function until(fn, message) {
  const deadline = Date.now() + 25_000;
  do {
    abort.signal.throwIfAborted();
    const value = await fn();
    if (value) return value;
    await delay(100);
  } while (Date.now() < deadline);
  assert.fail(message);
}

async function cli(build, args, expected = 0) {
  let result;
  try {
    result = await exec(process.execPath, [join(build, 'bin/loom'), ...args, '--project', project],
      { cwd: project, env, maxBuffer: 1024 * 1024, timeout: 155_000 });
  } catch (error) {
    if (error.code !== expected) throw Object.assign(new Error(error.stdout || error.message), { cause: error });
    result = error;
  }
  assert.equal(result.code ?? 0, expected);
  return JSON.parse(result.stdout);
}
const status = (build = old) => cli(build, ['upgrade', '--status']);
const upgrade = (build, ...args) => cli(build, ['upgrade', ...args]);
const spawnRole = (build, role, provider, prompt) => cli(build, ['spawn', role, '--cwd', project, '--cli', provider,
  '--mode', 'headless', '--model', provider === 'agy' ? 'gemini-3.1-pro' : 'gpt-6.2-sol', '--effort', 'low', prompt]);
const spawnPane = build => cli(build, ['spawn', 'super', '--cwd', project, '--cli', 'codex',
  '--mode', 'tui', '--model', 'gpt-6.2-sol', '--effort', 'low', 'HS-AUDITOR']);
const post = (build, addr, id, text) => cli(build, ['send', addr, '--id', id, text]);
const receipts = (addr, id) => events(addr).filter(event => event.type === 'input-received' && event.inputId === id);
const completions = (addr, id) => events(addr).filter(event => event.type === 'turn-end' && event.inputIds.includes(id));

const identity = session => {
  const table = processTable();
  const host = table.get(session.pid);
  assert(host);
  const descendants = new Set([host.pid]);
  for (const pid of descendants) {
    for (const row of table.values()) if (row.ppid === pid) descendants.add(row.pid);
  }
  const native = [...descendants].map(pid => table.get(pid)).filter(row => /\/(codex|agy)$/.test(row.executable));
  return { host, native,
    incarnation: session.incarnation, streamId: session.streamId };
};
const hosts = new Map();
function capture(report) {
  assert(report.sessions.length);
  for (const session of report.sessions) {
    assert.equal(session.status, 'attached');
    const current = identity(session);
    const previous = hosts.get(session.addr);
    if (previous) {
      assert(sameProcess(previous.host, current.host));
      assert.equal(previous.incarnation, current.incarnation);
      assert.equal(previous.streamId, current.streamId);
      assert(previous.native.some(child => current.native.some(live => sameProcess(child, live))));
    } else {
      assert(current.native.length);
      hosts.set(session.addr, current);
    }
  }
  return report;
}

try {
  write(file('.project/policy.json'), '{"preferred":[],"deny":[]}\n');
  await until(async () => (await cli(next, ['daemon', 'status'])).running, 'old daemon never started');
  model.hold('LEADER-HOLD');
  const codex = await spawnRole(next, 'leader', 'codex', 'HS-LEADER-HOLD');
  const agy = await spawnRole(old, 'auditor', 'agy', 'ACP-HOLD');
  const oldPane = await spawnPane(old);
  await until(() => mail(oldPane.deliveryId)[0]?.completion?.body, 'old loom-pty did not complete its startup turn');
  const codexAddr = codex.session.addr;
  const agyAddr = agy.session.addr;
  await until(() => model.requests.some(row => row.delivery === codex.deliveryId) && mail(agy.deliveryId)[0]?.received &&
    gemini.requests.some(row => row.id === agy.deliveryId && row.held),
    'native turns did not become active');
  evidence.before = capture(await status(next));
  const check = await upgrade(next, '--to', next, '--check');
  assert(check.eligible);
  assert.deepEqual(check.sessions.map(session => session.protocol), [1, 1, 1]);

  evidence.changed = capture(await upgrade(old, '--to', next));
  assert.equal(evidence.changed.phase, 'committed');
  assert.equal(evidence.changed.target.root, next);
  assert.notEqual(evidence.changed.pid, initial.pid);
  const newcomer = await spawnRole(old, 'super', 'agy', 'ACP-NEW');
  const newPane = await spawnPane(old);
  const newAddr = newcomer.session.addr;
  await until(() => mail(newcomer.deliveryId)[0]?.completion, 'new v2 host did not complete a turn');
  await until(() => mail(newPane.deliveryId)[0]?.completion?.body, 'new loom-pty did not complete its startup turn');
  evidence.coexist = capture(await status(old));
  for (const [addr, protocol] of [[codexAddr, 1], [agyAddr, 1], [oldPane.session.addr, 1],
    [newAddr, 2], [newPane.session.addr, 2]]) {
    assert.equal(evidence.coexist.sessions.find(session => session.addr === addr)?.protocol, protocol);
  }

  const v2 = evidence.coexist.sessions.find(session => session.addr === newAddr);
  const path = hostSocket(project, newAddr, v2.incarnation);
  const controller = readJSON(join(hostDirectory(project, newAddr, v2.incarnation), 'controller.json'));
  assert.equal((await hostHello(path, v2.incarnation)).protocol, 2);
  assert.equal((await hostRequest(path, v2.incarnation, 'state', {}, 1)).sessionId, newcomer.session.sessionId);
  await assert.rejects(hostRequest(path, v2.incarnation, 'missing', {}, 2), /Unknown session host method/);
  await assert.rejects(hostRequest(path, randomUUID(), 'hello'), /identity changed/);
  await assert.rejects(hostRequest(path, v2.incarnation, 'state', {}, 99), /Unsupported session host protocol/);
  await assert.rejects(hostRequest(path, v2.incarnation, 'claim', {}, 2,
    { id: randomUUID(), generation: controller.generation - 1 }), /Stale session host controller/);

  evidence.rollback = capture(await upgrade(next, '--rollback'));
  assert.equal(evidence.rollback.phase, 'committed');
  assert.equal(evidence.rollback.target.root, old);
  const brokenResult = await cli(next, ['upgrade', '--to', broken], 1);
  assert.equal(brokenResult.phase, 'recovered');
  evidence.automaticRecovery = capture(brokenResult);
  assert.equal((await status(next)).active.root, old);
  assert.equal(mail(codex.deliveryId)[0].completion, undefined);
  assert.equal(mail(agy.deliveryId)[0].completion, undefined);

  await cli(old, ['daemon', 'stop']);
  for (const { host, native } of hosts.values()) {
    const table = processTable();
    assert([host, ...native].every(row => sameProcess(row, table.get(row.pid))));
  }
  model.release('LEADER-HOLD');
  gemini.release(agy.deliveryId);
  await until(() => completions(codexAddr, codex.deliveryId).length === 1 &&
    completions(agyAddr, agy.deliveryId).length === 1, 'both hosts must finish with loomd down');
  evidence.duringOutage = { codex: completions(codexAddr, codex.deliveryId)[0], agy: completions(agyAddr, agy.deliveryId)[0] };
  assert.equal(mail(codex.deliveryId)[0].completion, undefined);
  assert.equal(mail(agy.deliveryId)[0].completion, undefined);
  await cli(next, ['daemon', 'start']);
  const codexDone = await until(() => mail(codex.deliveryId)[0]?.completion, 'Codex completion missing');
  const agyDone = await until(() => mail(agy.deliveryId)[0]?.completion, 'ACP result missing');
  assert.equal(codexDone.body, 'OK LEADER-HOLD');
  assert.equal(agyDone.unconfirmedBody, 'ACP held result');
  assert.equal(agyDone.outcome.kind, 'completed');
  const transcript = await until(async () => (await cli(old, ['ls'])).sessions.find(row => row.addr === codexAddr).transcriptPath,
    'Codex transcript was never bound');
  assert(transcript.startsWith(env.CODEX_HOME + '/sessions/'));
  const native = lines(transcript);
  assert(deliveryChecks({ id: codex.deliveryId, body: codexDone.body, inbox: mail(codex.deliveryId),
    native, provider: model.requests }).ok);
  for (const [addr, first, text] of [[codexAddr, codex.deliveryId, 'HS-FOLLOWUP'], [agyAddr, agy.deliveryId, 'ACP-FOLLOWUP']]) {
    const id = randomUUID();
    assert.equal((await post(next, addr, id, text)).id, id);
    const done = await until(() => mail(id)[0]?.completion, 'follow-up missing');
    assert.equal(done.body ?? done.unconfirmedBody, addr === codexAddr ? 'OK FOLLOWUP' : 'ACP follow-up');
    assert.equal((await post(old, addr, id, text)).id, id);
    for (const delivery of [first, id]) {
      assert.equal(receipts(addr, delivery).length, 1);
      assert.equal(completions(addr, delivery).length, 1);
      assert.equal(mail(delivery).length, 1);
      const provider = addr === codexAddr ? model.requests : lines(file('agy-wire.jsonl'));
      assert.equal(provider.filter(row => row.delivery === delivery).length, 1);
      if (addr === agyAddr) {
        const nativeRequests = gemini.requests.filter(row => row.id === delivery);
        assert.equal(nativeRequests.length, 1);
        assert(!nativeRequests[0].closed);
      }
    }
  }
  evidence.final = capture(await status(next));
  evidence.modelRequests = { codex: model.requests, agy: gemini.requests };
  console.log('Codex, agy ACP and loom-pty kept their native identities through upgrade and rollback.');
} catch (error) {
  evidence.error = error.stack;
  throw error;
} finally {
  const cleanupErrors = [];
  try {
    if (!(await cli(old, ['daemon', 'status'])).running) await cli(old, ['daemon', 'start']);
    const current = await status();
    for (const session of current.sessions) {
      try { await cli(old, ['stop', session.addr]); }
      catch (error) { cleanupErrors.push(error); }
    }
  } catch (error) { cleanupErrors.push(error); }
  try { await cli(old, ['daemon', 'stop']); }
  catch (error) { cleanupErrors.push(error); }
  await Promise.all([model.close(), gemini.close()]);
  try {
    for (const { host, native } of hosts.values()) {
      await until(() => {
        const table = processTable();
        return ![host, ...native].some(row => sameProcess(row, table.get(row.pid)));
      }, 'An owned native process was left behind');
    }
  } catch (error) { cleanupErrors.push(error); }
  if (cleanupErrors.length) evidence.cleanupErrors = cleanupErrors.map(error => error.stack);
  write(join(run, 'result.json'), JSON.stringify(evidence, null, 2) + '\n');
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Live test cleanup failed');
}
