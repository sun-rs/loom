import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { appendFileSync, closeSync, existsSync, mkdtempSync, openSync, readdirSync, realpathSync, renameSync,
  symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { modelEndpoint } from './loopback.mjs';
import { exec, experiment, installDependencies, isolatedEnvironment,
  mkdir, previousOar, read, replaceText, snapshot, write } from './setup.mjs';
import { countNativeInputs, deliveryChecks } from './invariants.mjs';

const stages = ['control', 'restart', 'crash', 'daemon-code', 'pty-code', 'schema', 'oar'];
const { values } = parseArgs({ options: { audit: { type: 'boolean' }, case: { type: 'string', multiple: true }, source: { type: 'string' } } });
const selected = values.case ?? stages;
assert(selected.every(stage => stages.includes(stage)), 'Unknown case');
mkdir(experiment);
assert.equal(realpathSync(experiment), experiment);
const run = mkdtempSync(join(experiment, 'r-'));
console.log('Evidence directory ' + run);
const seed = join(run, 'source');
snapshot(seed, values.source && resolve(values.source));
const targetOar = JSON.parse(read(join(seed, 'package.json'))).dependencies['@botiverse/oar'];
const packages = await installDependencies(run, seed,
  selected.includes('oar') ? [targetOar, previousOar] : [targetOar]);

const abort = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => abort.abort(new Error(signal)));
const sleep = ms => delay(ms, undefined, { signal: abort.signal });
const json = (dir, path) => JSON.parse(read(join(dir, path)));
const lines = path => existsSync(path) ? read(path).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
const put = (path, value) => write(path, JSON.stringify(value, null, 2) + '\n');
const options = { timeout: 20_000, maxBuffer: 2 * 1024 * 1024 };

async function until(readState, description, timeout = 18_000) {
  const deadline = performance.now() + timeout;
  do {
    abort.signal.throwIfAborted();
    const state = await readState();
    if (state) return state;
    if (performance.now() >= deadline) throw new Error(description);
    await sleep(125);
  } while (true);
}

async function proc(pid) {
  const output = await exec('/bin/ps', ['-p', String(pid), '-o', 'pid=,ppid=,lstart=,tty=,comm='], options)
    .then(result => result.stdout.trim(), error => {
      if (error.code !== 1) throw error;
      return '';
    });
  if (!output) return null;
  const [, id, ppid, started, tty, executable] = /^(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+[\d:]+\s+\d+)\s+(\S+)\s+(.+)$/.exec(output);
  return { pid: Number(id), ppid: Number(ppid), started, tty, executable };
}

async function children(pid) {
  try {
    const { stdout } = await exec('/usr/bin/pgrep', ['-P', String(pid)], options);
    return (await Promise.all(stdout.trim().split(/\s+/).map(proc))).filter(Boolean);
  } catch (error) {
    if (error.code !== 1) throw error;
    return [];
  }
}

async function ttyFds(processes) {
  return Promise.all(processes.filter(Boolean).map(async ({ pid }) => {
    const { stdout } = await exec('/usr/sbin/lsof', ['-nP', '-a', '-p', String(pid), '-Ffn'], options)
      .catch(error => {
        if (error.code !== 1) throw error;
        return { stdout: error.stdout ?? '' };
      });
    let fd;
    const devices = [];
    for (const line of stdout.split('\n')) {
      if (line[0] === 'f') fd = line.slice(1);
      if (/^n\/dev\/(?:ttys|ptmx|pty|tty)/.test(line)) devices.push({ fd, device: line.slice(1) });
    }
    return { pid, devices };
  }));
}

const sameProcess = (before, after) => Boolean(before && after && before.pid === after.pid &&
  before.started === after.started && before.executable === after.executable);

async function exercise(stage) {
  const caseDir = join(run, stage);
  const project = join(caseDir, 'p');
  const release = join(caseDir, 'release');
  const logPath = join(caseDir, 'timeline.jsonl');
  mkdir(join(project, '.project'));
  snapshot(release, seed);
  let version = stage === 'oar' ? previousOar : targetOar;
  const modules = join(release, 'node_modules');
  symlinkSync(packages[version], modules);
  const record = (event, details = {}) =>
    appendFileSync(logPath, JSON.stringify({ at: Date.now(), event, ...details }) + '\n', { mode: 0o600, flush: true });
  const result = { stage, project, checks: {}, cleanup: {} };
  const check = (name, ok, evidence) => { result.checks[name] = { ok: Boolean(ok), evidence }; };
  const model = await modelEndpoint(entry => record('model-request', entry));
  const env = isolatedEnvironment(caseDir, model.url);
  const originalWorkerPids = new Map();
  const paneClaims = new Map();
  const daemons = [];
  let daemon;
  const entry = join(release, 'boot.mjs');
  write(entry, `import { readFileSync } from 'node:fs';
import { main } from './daemon/main.mjs';
const packagePath = new URL('../package.json', import.meta.resolve('@botiverse/oar'));
console.log(JSON.stringify({ oar: JSON.parse(readFileSync(packagePath, 'utf8')).version, module: import.meta.resolve('@botiverse/oar') }));
await main(['--project', process.argv[2]], { externalNotification: async () => {}, pollInterval: 150 });\n`);
  const control = (await import(pathToFileURL(join(release, 'tui/pty-control.mjs')))).requestControl;
  const initialJob = addr => json(project, '.project/loomd/sessions/' + addr + '.json');
  const cli = async (...args) => {
    const { stdout } = await exec(process.execPath, [join(release, 'bin/loom'), ...args, '--project', project],
      { ...options, cwd: project, env });
    return JSON.parse(stdout);
  };
  const hc = async (command, ...args) => {
    const { stdout } = await exec(join(caseDir, 'bin/hc'), [command, '--json', ...args],
      { ...options, env, cwd: project });
    return JSON.parse(stdout);
  };
  const mail = () => existsSync(join(project, '.project/inbox/state.json')) ?
    json(project, '.project/inbox/state.json').messages : [];
  const messages = id => mail().filter(row => row.id === id);
  const waitMail = (id, key) => until(() => messages(id).find(row => row[key]), 'No ' + key + ' for ' + id);
  const waveMessages = () => mail().filter(row => row.waveBatch && row.target.addr === leader.addr);
  const readRows = addr => lines(join(project, '.project/relay/events', addr + '.jsonl'));
  let leader, worker, auditor;

  function row(addr) {
    const db = new DatabaseSync(join(project, '.project/index.sqlite'), { readOnly: true });
    try { return db.prepare('SELECT * FROM sessions WHERE addr = ?').get(addr); }
    finally { db.close(); }
  }
  function sql(command) {
    const db = new DatabaseSync(join(project, '.project/index.sqlite'));
    try { db.exec('PRAGMA busy_timeout = 5000'); db.exec(command); }
    finally { db.close(); }
  }
  function ownTranscript(addr) {
    const path = row(addr)?.transcriptPath;
    if (!path || !path.startsWith(env.CODEX_HOME + '/sessions/') || realpathSync(path) !== path) return null;
    return path;
  }
  async function workerProcess(delivery) {
    const servicePort = new URL(model.url).port;
    return until(async () => {
      const request = model.requests.findLast(row => row.delivery === delivery);
      if (!request) return;
      const socket = 'n127.0.0.1:' + request.port + '->127.0.0.1:' + servicePort;
      const { stdout } = await exec('/usr/sbin/lsof',
        ['-nP', '-a', '-iTCP:' + servicePort, '-sTCP:ESTABLISHED', '-Fpn'], options)
        .catch(error => {
          if (error.code !== 1) throw error;
          return { stdout: '' };
        });
      let pid;
      for (const line of stdout.split('\n')) {
        if (line[0] === 'p') pid = Number(line.slice(1));
        if (line === socket) {
          const native = await proc(pid);
          if (native?.executable.endsWith('/codex')) {
            originalWorkerPids.set(native.pid, native);
            return native;
          }
        }
      }
    }, 'No Codex process for held delivery ' + delivery);
  }
  async function onlyPane(name, address) {
    const pane = await hc('get', address ?? name);
    assert.equal(pane.name, name);
    assert.equal(pane.cwd, project);
    if (address) assert.equal(pane.address, address);
    return pane;
  }
  async function startDaemon() {
    const log = join(caseDir, 'loomd-' + (daemons.length + 1) + '.log');
    const fd = openSync(log, 'a', 0o600);
    let child;
    try { child = spawn(process.execPath, [entry, project], { cwd: project, env, stdio: ['ignore', fd, fd] }); }
    finally { closeSync(fd); }
    const exited = once(child, 'exit');
    const handle = { child, exited, log };
    daemons.push(handle);
    daemon = handle;
    await until(async () => {
      if (child.exitCode !== null || child.signalCode) throw new Error(read(log));
      try { return (await cli('daemon', 'status')).pid === child.pid; }
      catch (error) {
        if (child.exitCode === null && !child.signalCode) return false;
        throw error;
      }
    }, 'Daemon never became available');
    const loaded = JSON.parse(read(log).split('\n')[0]);
    assert.equal(loaded.oar, version);
    record('daemon-started', { pid: child.pid, ...loaded });
    return handle;
  }
  async function stopDaemon(signal) {
    const current = daemon;
    if (!current || current.child.exitCode !== null || current.child.signalCode) return;
    current.child.kill(signal);
    const exit = await Promise.race([current.exited, delay(22_000, null, { ref: false })]);
    if (!exit) throw new Error('Daemon did not exit after ' + signal);
    assert.deepEqual(exit, signal === 'SIGKILL' ? [null, 'SIGKILL'] : [0, null]);
    daemon = null;
    record('daemon-stopped', { pid: current.child.pid, signal, exit });
  }
  async function spawnRole(role, prompt, ...extra) {
    const receipt = await cli('spawn', role, '--cwd', project, '--cli', 'codex', '--model', 'gpt-6.2-sol',
      '--effort', 'low', '--mode', role === 'worker' ? 'headless' : 'tui', ...extra, prompt);
    const { session, deliveryId } = receipt;
    if (session.pane) {
      const name = session.addr.replaceAll('-', '').slice(4, 26);
      paneClaims.set('loom-' + name, session.pane);
    }
    record('spawn', { role, addr: session.addr, pane: session.pane, deliveryId, transport: receipt.transport });
    return { ...session, first: deliveryId };
  }
  async function send(addr, text, id = randomUUID()) {
    const receipt = await cli('send', addr, '--id', id, text);
    assert.equal(receipt.id, id);
    return id;
  }
  async function leaderHost() {
    const job = initialJob(leader.addr);
    assert.equal(job.tui.transport, 'loom-pty');
    const { socket, incarnation } = job.tui;
    const name = [...paneClaims].find(([, address]) => address === leader.pane)[0];
    const pane = await onlyPane(name, leader.pane);
    const wrapper = await proc(pane.pid);
    const inner = (await children(pane.pid)).find(child => child.executable.endsWith('/codex'));
    const state = await control(socket, 'state', {}, incarnation);
    return { pane: { address: pane.address, pid: pane.pid, createdAt: pane.created_ms, state: pane.state },
      socket, incarnation, wrapper, inner, nativeId: state.native.sessionId, nativeTurn: state.native.activeTurn,
      phase: state.phase, build: state.hotswapBuild ?? 'old' };
  }

  try {
    put(join(project, '.project/policy.json'), { preferred: [], deny: [] });
    await startDaemon();
    leader = await spawnRole('leader', 'HS-LEADER-START');
    await waitMail(leader.first, 'completion');
    assert(ownTranscript(leader.addr), 'Leader transcript must be in the experiment home');
    const quiet = await leaderHost();
    assert(quiet.inner && quiet.wrapper && quiet.nativeId, 'TUI native identities unavailable');
    model.hold('LEADER-HOLD');
    model.hold('WORKER-HOLD');
    const held = await send(leader.addr, 'HS-LEADER-HOLD');
    await waitMail(held, 'received');
    await until(() => model.requests.some(row => row.delivery === held), 'Leader turn never reached endpoint');
    worker = await spawnRole('worker', 'HS-WORKER-HOLD', '--task', 'HSW', '--wave', 'HSW', '--parent', leader.addr);
    await waitMail(worker.first, 'received');
    await until(() => ownTranscript(worker.addr), 'Worker transcript must be in the experiment home');
    await until(() => model.requests.some(row => row.delivery === worker.first), 'Worker turn never reached endpoint');
    const queued = await send(leader.addr, 'HS-QUEUED');
    assert.equal(messages(queued)[0].phase, 'queued');
    const wave = await until(() => Object.values(json(project, '.project/relay/state.json').waves ?? {})
      .find(row => row.members.some(value => value.includes(worker.addr))), 'Wave never became durable');
    assert.equal(wave.closed, undefined);
    const before = await leaderHost();
    const originalWorker = await workerProcess(worker.first);
    const holder = await proc(before.wrapper.ppid);
    const owner = holder && await proc(holder.ppid);
    result.before = { leader: before, holder, owner, ptyFds: await ttyFds([holder, before.wrapper, before.inner]),
      worker: originalWorker, workerParent: await proc(originalWorker.ppid), workerSessionId: row(worker.addr).sessionId, wave, held, queued,
      workerInput: worker.first, oar: version };
    assert(before.nativeTurn, 'Leader native turn id missing at upgrade boundary');
    record('before', result.before);

    if (['restart', 'crash', 'daemon-code', 'oar'].includes(stage)) {
      await stopDaemon(stage === 'crash' ? 'SIGKILL' : 'SIGTERM');
      const during = await leaderHost();
      const workerWhileDown = await proc(originalWorker.pid);
      result.during = { leader: during, worker: workerWhileDown };
      check('worker-process-alive-during-outage', sameProcess(originalWorker, workerWhileDown), workerWhileDown);
      check('leader-turn-alive-during-outage',
        during.nativeTurn === before.nativeTurn && during.phase === 'busy' &&
        sameProcess(before.inner, during.inner), during);
      model.release('LEADER-HOLD');
      const stopped = await until(() => readRows(leader.addr).find(event =>
        event.hook_event_name === 'Stop' && event.turn_id === before.nativeTurn), 'The leader did not finish while loomd was down');
      result.during.leaderStop = { turn: stopped.turn_id, at: stopped.receivedAt };
      assert.equal(messages(queued)[0].phase, 'queued');
      if (workerWhileDown && !values.audit) {
        model.release('WORKER-HOLD');
        const end = await until(() => readRows(worker.addr).find(event =>
          event.type === 'turn-end' && event.inputIds.includes(worker.first)), 'The worker did not finish while loomd was down');
        assert.equal(end.finalReply, 'DONE HSW verified');
        assert.equal(messages(worker.first)[0].completion, undefined);
        result.during.workerEnd = end;
      }
      if (stage === 'daemon-code') {
        replaceText(join(release, 'daemon/main.mjs'), 'const supervisor = createSupervisor(project, {',
          "console.log('HOTSWAP-D2');\n  const supervisor = createSupervisor(project, {");
        replaceText(join(release, 'bin/loom'), 'const { main }',
          "if (process.argv.includes('--hotswap-fixture-version')) { console.log('HOTSWAP-C2'); process.exit(0); }\nconst { main }");
        const { stdout } = await exec(process.execPath, [join(release, 'bin/loom'), '--hotswap-fixture-version'], { ...options, env });
        assert.equal(stdout.trim(), 'HOTSWAP-C2');
      }
      if (stage === 'oar') {
        version = targetOar;
        symlinkSync(packages[version], modules + '.next');
        renameSync(modules + '.next', modules);
      }
      await startDaemon();
      if (stage === 'daemon-code') assert.match(read(daemon.log), /HOTSWAP-D2/);
    } else if (stage === 'pty-code') {
      const wrapper = join(release, 'tui/loom-pty');
      replaceText(wrapper, 'closeControl = await listenControl(LOOM_PTY_SOCKET, bindTuiSession(terminal, plugin, evidence), evidence.incarnation);',
        "const session = bindTuiSession(terminal, plugin, evidence);\n      const originalState = session.readState;\n" +
        "      session.readState = async () => ({ ...await originalState(), hotswapBuild: 'P2' });\n" +
        "      closeControl = await listenControl(LOOM_PTY_SOCKET, session, evidence.incarnation);");
      const hello = binding => control(binding.socket, 'hello', {}, binding.incarnation).catch(error => {
        if (error.message !== 'Invalid control request') throw error;
        return { protocol: 0 };
      });
      const oldHello = await hello(before);
      const controlFile = join(release, 'tui/pty-control.mjs');
      if (oldHello.protocol) {
        const declaration = 'export const controlProtocol = ';
        replaceText(controlFile, declaration + oldHello.protocol + ';', declaration + (oldHello.protocol + 1) + ';');
      }
      await assert.rejects(control(before.socket, 'unknown-hotswap-test-method', {}, before.incarnation), /Invalid control request/);
      await assert.rejects(control(before.socket, 'state', {}, randomUUID()), /identity changed/);
      auditor = await spawnRole('auditor', 'HS-AUDITOR');
      await waitMail(auditor.first, 'completion');
      const binding = initialJob(auditor.addr).tui;
      const newPty = await control(binding.socket, 'state', {}, binding.incarnation);
      const oldPty = await leaderHost();
      const newHello = await hello(binding);
      check('old-and-new-pty-coexist', newPty.hotswapBuild === 'P2' && oldPty.build === 'old' &&
        newHello.protocol === oldHello.protocol + Number(Boolean(oldHello.protocol)),
        { old: oldPty.build, new: newPty.hotswapBuild, oldHello, newHello,
          oldUnknownMethod: 'rejected', wrongOwner: 'rejected' });
    } else if (stage === 'schema') {
      sql('BEGIN IMMEDIATE; CREATE TABLE hotswap_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;' +
        "INSERT INTO hotswap_meta VALUES ('generation','2'); PRAGMA user_version = 2; COMMIT;");
      const eventPath = join(project, '.project/relay/events', leader.addr + '.jsonl');
      const marker = { cwd: project, receivedAt: Date.now(), session_id: before.nativeId,
        hook_event_name: 'HotswapProbe', writerVersion: 2, extension: { marker: 'additive' } };
      appendFileSync(eventPath, JSON.stringify(marker) + '\n', { flush: true });
      sql('BEGIN IMMEDIATE; ALTER TABLE sessions ADD COLUMN hotswap_generation INTEGER; COMMIT;');
      const index = (await import(pathToFileURL(join(release, 'index/index.mjs')))).openIndex(join(project, '.project/index.sqlite'));
      assert.equal(index.query({ addr: leader.addr })[0].addr, leader.addr);
      sql(`UPDATE sessions SET hotswap_generation = 17 WHERE addr = '${leader.addr}';`);
      let writeError;
      try { index.update(leader.addr, { model: row(leader.addr).model }); }
      catch (error) { writeError = error.message; }
      check('old-index-writer-can-round-trip-additive-column', !writeError, { oldRead: 'ok', writeError });
      if (writeError) sql('BEGIN IMMEDIATE; ALTER TABLE sessions DROP COLUMN hotswap_generation; COMMIT;');
      const db = new DatabaseSync(join(project, '.project/index.sqlite'), { readOnly: true });
      try {
        result.schema = { userVersion: db.prepare('PRAGMA user_version').get().user_version,
          generation: writeError ? null : db.prepare('SELECT hotswap_generation FROM sessions WHERE addr = ?').get(leader.addr).hotswap_generation,
          sidecar: db.prepare('SELECT value FROM hotswap_meta').get().value, marker: readRows(leader.addr).some(event => event.writerVersion === 2 && event.hook_event_name === marker.hook_event_name),
          integrity: db.prepare('PRAGMA integrity_check').get().integrity_check, columnReverted: Boolean(writeError) };
      } finally { db.close(); }
      check('additive-storage-survives', result.schema.userVersion === 2 && result.schema.sidecar === '2' &&
        result.schema.marker && result.schema.integrity === 'ok' && (values.audit || result.schema.generation === 17), result.schema);
    }

    if (result.during === undefined) {
      const live = await leaderHost();
      check('leader-turn-alive-at-upgrade', live.nativeTurn === before.nativeTurn && live.phase === 'busy', live);
    }
    model.release('LEADER-HOLD');
    model.release('WORKER-HOLD');
    const after = await leaderHost();
    result.after = { leader: after, workerSessionId: row(worker.addr).sessionId, oar: version };
    check('leader-kept-original-pane-and-native-process', after.pane.state === 'live' &&
      after.pane.address === before.pane.address && after.pane.createdAt === before.pane.createdAt &&
      sameProcess(before.wrapper, after.wrapper) && sameProcess(before.inner, after.inner) &&
      after.incarnation === before.incarnation && after.nativeId === before.nativeId, after);
    check('worker-kept-native-session-id', result.before.workerSessionId === result.after.workerSessionId,
      result.after.workerSessionId);
    await waitMail(held, 'completion');
    const queuedMail = await waitMail(queued, 'completion');
    assert.equal(await send(leader.addr, 'HS-QUEUED', queued), queued);
    model.hold('FOLLOWUP');
    const followup = await send(worker.addr, 'HS-FOLLOWUP');
    const currentWorker = await workerProcess(followup);
    result.after.worker = currentWorker;
    result.after.workerParent = await proc(currentWorker.ppid);
    check('worker-kept-original-native-process', sameProcess(originalWorker, currentWorker), currentWorker);
    model.release('FOLLOWUP');
    await waitMail(followup, 'completion');
    const workerLost = !sameProcess(originalWorker, currentWorker);
    await until(() => waveMessages().find(row => row.completion), 'No wave completed', workerLost ? 4500 : 18000)
      .catch(error => {
        if (!workerLost || error.message !== 'No wave completed') throw error;
      });
    await sleep(1000);
    const batches = waveMessages();
    const deliveries = [[leader.addr, leader.first, 'OK LEADER-START'], [leader.addr, held, 'OK LEADER-HOLD'],
      [leader.addr, queued, 'OK QUEUED'], [worker.addr, worker.first, 'DONE HSW verified'],
      [worker.addr, followup, 'OK FOLLOWUP'], ...(auditor ? [[auditor.addr, auditor.first, 'OK AUDITOR']] : []),
      ...batches.map(batch => [leader.addr, batch.id, 'OK WAVE'])];
    for (const [addr, id, body] of deliveries) {
      const path = ownTranscript(addr);
      const evidence = deliveryChecks({ id, body, inbox: messages(id), native: path ? lines(path) : [],
        provider: model.requests, warmup: id === leader.first || id === auditor?.first });
      check('delivery-' + id, evidence.ok, evidence);
      if (addr === leader.addr) {
        const reply = await control(before.socket, 'confirmations', { id }, before.incarnation);
        check('wrapper-confirmation-' + id, reply.count === 1, reply);
      }
    }
    const workerInputs = ownTranscript(worker.addr);
    result.wave = { batches: batches.map(batch => ({ id: batch.id, kind: batch.waveKind, text: batch.text,
      phase: batch.phase, body: batch.completion?.body })), queuedPhase: queuedMail.phase,
      workerFirst: messages(worker.first).map(row => ({ phase: row.phase, received: row.received, completion: row.completion })),
      workerFirstNativeCount: workerInputs ? countNativeInputs(lines(workerInputs), worker.first) : 0,
      workerStreams: readRows(worker.addr).filter(event => ['stream-opened', 'exited', 'released', 'turn-end'].includes(event.type)),
      runtimeRequests: model.requests };
    check('one-wave-delivery', batches.length === 1 && batches[0].completion?.body === 'OK WAVE',
      batches.map(({ id, phase }) => ({ id, phase })));
    check('one-successful-wave', batches.length === 1 && batches[0].text.includes('DONE HSW verified') &&
      batches[0].completion?.body === 'OK WAVE', result.wave.batches);
    record('after', { ...result.after, wave: result.wave });
  } catch (error) {
    result.error = error.stack;
  } finally {
    try {
      const jobDir = join(project, '.project/loomd/sessions');
      if (existsSync(jobDir)) {
        const owned = readdirSync(jobDir).filter(name => /^oar-[\da-f-]{36}\.json$/.test(name))
          .map(file => json(jobDir, file)).filter(job => job.host && row(job.row.addr)?.endedAt === null);
        if (owned.length && !daemon) await startDaemon();
        for (const job of owned) await cli('stop', job.row.addr);
      }
    } catch (error) { result.cleanup.hostError = error.stack; }
    try { await stopDaemon('SIGTERM'); }
    catch (error) {
      result.cleanup.daemonError = error.stack;
      for (const { child, exited } of daemons) {
        if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL');
        await exited;
      }
    }
    try {
      const jobDir = join(project, '.project/loomd/sessions');
      if (existsSync(jobDir)) {
        for (const file of readdirSync(jobDir).filter(name => /^loom-[\da-f-]{36}\.json$/.test(name))) {
          const { row } = json(jobDir, file);
          assert.equal(row.cwd, project);
          const name = 'loom-' + row.addr.slice(5).replaceAll('-', '').slice(0, 22);
          if (!paneClaims.has(name)) paneClaims.set(name);
        }
      }
      const closed = [];
      for (const [name, address] of paneClaims) {
        let pane;
        try { pane = await onlyPane(name, address); }
        catch (error) {
          if (typeof error.stderr === 'string' && error.stderr.includes('"not_found"') && !address) continue;
          throw error;
        }
        if (pane.state !== 'finished') await hc('kill', pane.address);
        pane = await onlyPane(name, pane.address);
        assert.equal(pane.state, 'finished');
        closed.push(pane.address);
      }
      result.cleanup.panes = closed;
    } catch (error) { result.cleanup.paneError = error.stack; }
    try {
      await model.close();
      const leftovers = [];
      for (const original of originalWorkerPids.values()) {
        const live = await proc(original.pid);
        if (sameProcess(original, live)) {
          leftovers.push(live.pid);
          process.kill(live.pid, 'SIGTERM');
          const deadline = Date.now() + 2000;
          while (sameProcess(original, await proc(live.pid)) && Date.now() < deadline) await delay(100);
          if (sameProcess(original, await proc(live.pid))) process.kill(live.pid, 'SIGKILL');
        }
      }
      result.cleanup.workerLeftovers = leftovers;
    } catch (error) { result.cleanup.workerError = error.stack; }
    put(join(caseDir, 'result.json'), result);
  }
  return result;
}

const results = [];
for (const stage of selected) {
  const result = await exercise(stage);
  const failed = Object.entries(result.checks).filter(([, value]) => !value.ok).map(([name]) => name);
  const cleanupOK = !Object.keys(result.cleanup).some(key => key.endsWith('Error')) && !result.cleanup.workerLeftovers?.length;
  const summary = { stage, error: result.error, failed, cleanupOK, passed: !result.error && !failed.length && cleanupOK };
  results.push(summary);
  console.log(JSON.stringify(summary));
  if (abort.signal.aborted) break;
}
put(join(run, 'summary.json'), results);
if (results.some(result => !result.cleanupOK || result.error || (!values.audit && !result.passed)) || abort.signal.aborted) {
  process.exitCode = 1;
}
