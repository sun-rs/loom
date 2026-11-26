import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { deliveryId } from '../inbox/message.mjs';
import { createAccess } from '../memory/access.mjs';
import { createIndexQuery } from '../memory/index-query.mjs';
import { buildOarLaunch, buildResumeLaunch, buildSwitchLaunch, buildTuiLaunch } from '../memory/launch-config.mjs';
import { codexConfiguration } from './codex-launch.mjs';
import { openOar } from './oar.mjs';
import { createSupervisor } from './supervisor.mjs';

function setEnvironment(values) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

let restoreEnvironment;
let fixtureHome;
before(() => {
  const home = fixtureHome = mkdtempSync(join(realpathSync(tmpdir()), 'loom-memory-home-'));
  const config = join(home, 'gitconfig');
  writeFileSync(config, '');
  restoreEnvironment = setEnvironment({
    HOME: home, GIT_CONFIG_GLOBAL: config, CODEX_HOME: join(home, '.codex'),
    CLAUDE_CONFIG_DIR: join(home, '.claude'), XDG_CONFIG_HOME: join(home, '.config'),
    XDG_DATA_HOME: join(home, '.local/share'), XDG_STATE_HOME: join(home, '.local/state'),
    LOOM_DESKTOP_NOTIFY: '0', GIT_CONFIG_NOSYSTEM: '1',
    OAR_CODEX_BIN: writeStub(home, 'codex'), LOOM_CLAUDE_BIN: writeStub(home, 'claude'),
    OAR_CODEX_SANDBOX: 'inherit', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0',
  });
});
after(() => {
  restoreEnvironment?.();
  if (fixtureHome) rmSync(fixtureHome, { recursive: true, force: true });
});

const now = () => Date.parse('2026-11-26T12:00:00Z');
const binding = (role, project, fields = {}) => ({
  role, project, principal: role, sessionId: role + '-session', dependencies: [],
  attachments: [], authorizedIds: { memory: [], history: [] }, ...fields,
});
const item = (id, project, fields = {}) => ({
  id, project, revision: 1, layer: 'shared', kind: 'lesson', status: 'active',
  title: 'Fixture ' + id, body: 'Synthetic memory body', keywords: [], ...fields,
});
const rows = result => result.rows.map(row => row.id);

function fixture(t, nativeOpen) {
  const project = mkdtempSync(join(realpathSync(tmpdir()), 'loom-memory-injection-'));
  mkdirSync(join(project, '.project'));
  writeFileSync(join(project, '.project/policy.json'), JSON.stringify({ preferred: [], deny: [] }));
  const state = { entries: [], changes: [], seq: 0 };
  const access = createAccess({ now, readState: () => state });
  const prompts = [];
  const native = new Map();
  const daemon = () => createSupervisor(project, {
    now, report: () => {}, externalNotification: async () => {},
    // The home store seam keeps seeding separate from the loomd behavior under test.
    sessionOptions: { memoryStore: { access }, open: nativeOpen ?? open },
  });
  let d = daemon();
  t.after(async () => {
    try { await d.shutdown(); }
    finally { rmSync(project, { recursive: true, force: true }); }
  });
  async function open(row) {
    const id = randomUUID();
    let seq = 0;
    let observer;
    const emit = (kind, fields) => observer?.({
      kind, ...fields, sessionId: id, agentPath: [], seq: seq++, receivedAt: Date.now(),
    });
    native.set(row.addr, emit);
    return {
      id, records: () => [], status: () => ({ value: { kind: 'idle' } }),
      events: notify => { observer = notify; return () => { observer = undefined; }; },
      async dispose() {},
      async prompt(input) {
        prompts.push({ addr: row.addr, input });
        const inputId = deliveryId(input);
        const requestId = randomUUID();
        emit('turn_started', { requestId, input });
        emit('turn_active', { inputId });
        emit('text_delta', { phase: 'final_answer', text: 'NOREPLY' });
        emit('turn_ended', { inputId, outcome: { kind: 'completed' } });
        return { kind: 'accepted', requestId, seq: seq - 1 };
      },
    };
  }
  function publish(entry, operation = 'add') {
    state.entries = state.entries.filter(previous => previous.id !== entry.id).concat(entry);
    if (operation === null) return;
    const { id, revision } = entry;
    const metadata = { ...entry };
    if (operation === 'withdraw') delete metadata.title;
    state.changes.push({ seq: ++state.seq, id, revision, operation, entry: metadata });
  }
  const spawn = (role, cli, prompt, caller, task = 'FIXTURE') => d.handle('spawn', {
    role, cli, mode: 'headless', model: 'fixture', effort: 'high', cwd: project, task, wave: 'MEM', prompt,
  }, caller);
  const inputs = session => prompts.filter(record => record.addr === session.addr).map(record => record.input);
  async function deliver(session, body) {
    const before = inputs(session).length;
    const receipt = await d.handle('send', { target: session.addr, mode: 'queue', text: body });
    await d.tick();
    const added = inputs(session).slice(before);
    assert.equal(added.length, 1, 'one native prompt for the existing delivery');
    assert.equal(deliveryId(added[0]), receipt.deliveryId);
    assert.ok(added[0].includes(body), 'business body survives');
    return added[0].slice(added[0].indexOf(body) + body.length).trim();
  }
  return { project, spawn, inputs, deliver, publish, native, tick: () => d.tick(),
    switchTo: to => d.handle('switch', { role: 'leader', to }),
    async restart() { await d.shutdown(); d = daemon(); await d.tick(); },
  };
}

const shared = 'MEM-SHARED';
const ruling = 'MEM-USER-RULING';
const preference = 'MEM-USER-PREFERENCE';
const indexText = '背景笔记，仅供参考，使用前核验\n- ' + shared;
function flag(argv, name) {
  const index = argv.findLastIndex(arg => arg === name || arg.startsWith(name + '='));
  if (index < 0) return;
  return argv[index] === name ? argv[index + 1] : argv[index].slice(name.length + 1);
}

function writeStub(home, cli) {
  const path = join(home, cli);
  const codexNative = new URL('../tasks/PROTO-HARDEN-0/fixtures/native.mjs', import.meta.url).href;
  writeFileSync(path, `#!${process.execPath}
import { appendFileSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const cli = ${JSON.stringify(cli)};
const argv = process.argv.slice(2);
const flag = ${flag.toString()};
if (argv.includes('--version') || argv.includes('--help')) {
  if (cli === 'codex') await import(${JSON.stringify(codexNative)});
  else console.log('2.1.331 (Claude Code)');
  process.exit(0);
}
const keys = ['HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'PATH', 'LOOM_BIN', 'LOOM_PROJECT', 'LOOM_ADDR',
  'CLAUDE_CODE_DISABLE_AUTO_MEMORY', 'CLAUDE_CODE_ENTRYPOINT'];
const env = Object.fromEntries(keys.filter(key => Object.hasOwn(process.env, key)).map(key => [key, process.env[key]]));
const system = ['--system-prompt', '--append-system-prompt'].flatMap(name => {
  const file = flag(argv, name + '-file');
  return [flag(argv, name), file && readFileSync(file, 'utf8')].filter(Boolean);
}).join('\\n\\n');
appendFileSync(cli + '-launches.jsonl', JSON.stringify({ argv, env, system }) + '\\n');
if (cli === 'codex') await import(${JSON.stringify(codexNative)});
else createInterface({ input: process.stdin }).on('line', line => {
  const { type, request_id } = JSON.parse(line);
  if (type === 'control_request') console.log(JSON.stringify({ type: 'control_response', response: {
    request_id, subtype: 'success', response: { applied: { effort: flag(argv, '--effort') } },
  } }));
});
`, { mode: 0o700 });
  return path;
}

// Reopening the supervisor suspends this transport and launches a new native process.
// The supervisor still selects the role, session ID and profile for the production OAR launcher.
function nativeFixture(t) {
  assert.equal(process.env.HOME, fixtureHome);
  assert.equal(process.env.OAR_CODEX_BIN, join(fixtureHome, 'codex'));
  assert.equal(process.env.LOOM_CLAUDE_BIN, join(fixtureHome, 'claude'));
  return fixture(t, openOar);
}
function nativeLaunches(f, cli) {
  const launches = readFileSync(join(f.project, `${cli}-launches.jsonl`), 'utf8').trim().split('\n').map(JSON.parse);
  for (const { env } of launches) {
    assert.equal(env.HOME, process.env.HOME, 'native HOME must be the temporary test home');
    assert.equal(env.GIT_CONFIG_GLOBAL, process.env.GIT_CONFIG_GLOBAL, 'native Git config must be temporary');
  }
  return launches;
}

function assertCodexOverrides(argv) {
  const overrides = argv.flatMap((arg, index) => {
    if (arg === '-c' || arg === '--config') return [argv[index + 1]];
    return arg.startsWith('--config=') ? [arg.slice('--config='.length)] : [];
  });
  for (const key of codexKeys) {
    assert.equal(overrides.findLast(arg => arg?.startsWith(key + '=')), key + '=false');
  }
}

test('5d live spawn: Claude disables native memory in the child environment', async t => {
  const f = nativeFixture(t);
  const { session } = await f.spawn('leader', 'claude', 'Native launch probe');
  const [launch] = nativeLaunches(f, 'claude');
  assert.equal(flag(launch.argv, '--session-id'), session.sessionId);
  assert.equal(launch.env.CLAUDE_CODE_ENTRYPOINT, 'loom');
  assert.equal(launch.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
});

test('5d live resume: Codex reopens the same thread with native memory disabled', async t => {
  const f = nativeFixture(t);
  const { session } = await f.spawn('leader', 'codex', 'Native resume probe');
  await f.restart();
  const launches = nativeLaunches(f, 'codex');
  assert.equal(launches.length, 2, 'resume starts a fresh native process');
  const pids = readFileSync(join(f.project, 'runtime-pids.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(pids.map(entry => entry.session), [session.sessionId, session.sessionId]);
  assertCodexOverrides(launches[1].argv);
});

test('5d live switch: the successor Codex process disables native memory', async t => {
  const f = nativeFixture(t);
  const { session } = await f.spawn('leader', 'claude', 'Native switch probe');
  const successor = await f.switchTo('codex/fixture/high');
  assert.equal(successor.handoverFrom, session.addr);
  const [launch] = nativeLaunches(f, 'codex');
  assert.equal(launch.env.LOOM_ADDR, successor.session.addr);
  assertCodexOverrides(launch.argv);
});

function seedHidden(f) {
  f.publish(item('MEM-HIDDEN-PRIVATE', f.project, { layer: 'private', owner: 'super', importance: 99 }));
  f.publish(item('MEM-HIDDEN-FOREIGN', 'other-project', { importance: 99 }));
}

for (const [budget, count, title] of [['line', 203, 'Short title'], ['UTF-8 byte', 90, '界'.repeat(145)]]) {
  test(`5c live spawn: Claude system index filters by role and respects the ${budget} budget`, async t => {
    const f = nativeFixture(t);
    seedHidden(f);
    const visible = Array.from({ length: count }, (_, i) => `MEM-NATIVE-${i}`);
    for (const id of visible) f.publish(item(id, f.project, { title }));
    f.publish(item(ruling, null, { layer: 'user', kind: 'ruling', importance: 99 }));
    await f.spawn('leader', 'claude', 'Startup index probe');
    const [{ system }] = nativeLaunches(f, 'claude');
    assert.doesNotMatch(system, /MEM-HIDDEN-(?:PRIVATE|FOREIGN)/);
    const lines = system.trimEnd().split('\n');
    const start = lines.findIndex(line => line.includes('仅供参考') || line.includes(ruling));
    assert.ok(start >= 0, 'missing memory index in the native system prompt');
    const index = lines.slice(start).join('\n');
    const loaded = index.match(/MEM-NATIVE-\d+/g) ?? [];
    assert.match(index, /MEM-USER-RULING/);
    assert.ok(loaded.length > 0 && loaded.length < count);
    assert.equal(new Set(loaded).size, loaded.length);
    for (const id of loaded) assert.ok(index.split('\n').includes(`- ${id} — ${title}`));
    assert.ok(lines.length - start <= 200, 'memory index exceeds 200 lines');
    assert.ok(Buffer.byteLength(index, 'utf8') <= 25_000, 'memory index exceeds 25 KB');
    assert.equal(lines.at(-1), `另有 ${count - loaded.length} 条未加载`);
  });
}

test('5c live compact: the Claude SessionStart hook outputs the authorized index', async t => {
  const f = nativeFixture(t);
  seedHidden(f);
  f.publish(item(shared, f.project));
  f.publish(item(ruling, null, { layer: 'user', kind: 'ruling' }));
  const { session } = await f.spawn('leader', 'claude', 'Compact hook probe');
  const [{ argv, env }] = nativeLaunches(f, 'claude');
  const settings = JSON.parse(flag(argv, '--settings') ?? '{}');
  const hooks = (settings.hooks?.SessionStart ?? []).filter(rule => rule.matcher === 'compact')
    .flatMap(rule => rule.hooks ?? []).filter(hook => hook.type === 'command' && hook.command);
  assert.ok(hooks.length > 0, 'native Claude did not receive a compact hook command');
  const context = hooks.map(({ command, args }) => {
    const [program, parameters] = args ? [command, args] : ['/bin/sh', ['-c', command]];
    const result = spawnSync(program, parameters, {
      cwd: f.project, env, encoding: 'utf8', timeout: 5000,
      input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'compact',
        cwd: f.project, session_id: session.sessionId }),
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const output = result.stdout.trim();
    return output.startsWith('{') ? JSON.parse(output).hookSpecificOutput?.additionalContext ?? '' : output;
  }).join('\n');
  assert.match(context, /MEM-SHARED/);
  assert.match(context, /MEM-USER-RULING/);
  assert.doesNotMatch(context, /MEM-HIDDEN-(?:PRIVATE|FOREIGN)/);
});

for (const [provider, systemPrompt] of [
  ['claude', launch => launch.argv.includes('--append-system-prompt') && flag(launch.argv, '--append-system-prompt')],
  ['codex', launch => launch.threadConfig.developerInstructions ?? launch.threadConfig.developer_instructions ??
    launch.argv.find(arg => arg.startsWith('developer_instructions='))?.replaceAll('\\n', '\n')],
  ['opencode', launch => Object.values(JSON.parse(launch.env.OPENCODE_CONFIG_CONTENT ?? '{}').agent ?? {})
    .map(agent => agent.prompt).join('\n')],
]) {
  test(`5c ${provider}: startup index goes in the native system instructions`, async () => {
    const launch = await buildOarLaunch({ provider, binding: binding('leader', 'A'), indexText, argv: [] });
    assert.ok(systemPrompt(launch)?.includes?.(indexText), `${provider} did not receive the index at launch`);
  });
}

test('5c agy: the first existing briefing contains the authorized startup index', async t => {
  const f = fixture(t);
  f.publish(item(shared, f.project));
  f.publish(item(ruling, null, { layer: 'user', kind: 'ruling' }));
  f.publish(item('MEM-HIDDEN', 'other-project'));
  const { session, deliveryId: first } = await f.spawn('leader', 'agy', 'First briefing');
  await f.tick();
  const inputs = f.inputs(session);
  assert.equal(inputs.length, 1);
  assert.equal(deliveryId(inputs[0]), first);
  assert.match(inputs[0], /First briefing/);
  assert.match(inputs[0], /MEM-SHARED/);
  assert.match(inputs[0], /MEM-USER-RULING/);
  assert.doesNotMatch(inputs[0], /MEM-HIDDEN/);
});

test('5c R18 and R22: startup visibility and user-layer write authorization', async () => {
  const entries = [
    item(shared, 'A'), item(ruling, null, { layer: 'user', kind: 'ruling' }),
    item(preference, null, { layer: 'user', kind: 'preference' }),
    item('MEM-USER-LESSON', null, { layer: 'user' }),
    item('MEM-SUPER-PRIVATE', null, { layer: 'private', owner: 'super' }),
    item('MEM-AUDITOR-PRIVATE', 'A', { layer: 'private', owner: 'auditor' }),
    item('MEM-OTHER-PROJECT', 'B'),
  ];
  const access = createAccess({ entries, now });
  const query = createIndexQuery({ access });
  for (const role of ['super', 'auditor', 'leader', 'worker']) {
    const actor = binding(role, 'A', { attachments: [shared] });
    const expected = {
      super: entries.map(entry => entry.id), auditor: [ruling, preference, shared, 'MEM-AUDITOR-PRIVATE'],
      leader: [ruling, preference, shared], worker: [],
    }[role];
    assert.deepEqual(rows(await query.index(actor)).sort(), expected.sort(), role);
    if (role === 'auditor' || role === 'leader') {
      for (const entry of entries.slice(1, 3)) {
        assert.equal((await access.show(actor, entry.id)).item.id, entry.id);
        assert.equal(access.canWrite(actor, entry), false);
        assert.equal(access.canRevise(actor, entry), false);
      }
    }
  }
});

for (const [name, count, title] of [['line', 203, 'Short title'], ['UTF-8 byte', 90, '界'.repeat(145)]]) {
  test(`5c startup: ${name} budget counts the entire index and reports the exact omission count`, async () => {
    const visible = Array.from({ length: count }, (_, i) => item('MEM-' + i, 'A', { title }));
    const hidden = item('MEM-HIDDEN', 'B', { importance: 99 });
    // Isolate these hard ceilings from any pre-existing token estimator.
    const query = createIndexQuery({ access: createAccess({ entries: [...visible, hidden], now }), countTokens: () => 0 });
    const index = await query.index(binding('leader', 'A'));
    const lines = index.text.trimEnd().split('\n');
    assert.ok(lines.length <= 200, `got ${lines.length} lines`);
    assert.ok(Buffer.byteLength(index.text, 'utf8') <= 25_000, 'index exceeds 25 KB');
    assert.ok(index.rows.length > 0 && index.rows.length < count);
    assert.equal(lines.at(-1), `另有 ${count - index.rows.length} 条未加载`);
    assert.doesNotMatch(index.text, /MEM-HIDDEN/);
    for (const row of index.rows) assert.ok(lines.includes(row.line), 'truncation keeps a whole row');
  });
}

test('5c startup: reference-note guidance is scoped to non-rulings', async () => {
  const decision = item(ruling, null, { layer: 'user', kind: 'ruling' });
  const note = item(shared, 'A');
  const query = createIndexQuery({ access: createAccess({ entries: [decision, note], now }) });
  const { text, rows: [decisionRow, noteRow] } = await query.index(binding('leader', 'A'));
  const notice = text.indexOf('参考笔记') >= 0 ? text.indexOf('参考笔记') : text.indexOf('仅供参考');
  assert.ok(notice >= 0 && text.includes(decisionRow.line) && text.includes(noteRow.line));
  assert.ok((text.indexOf(decisionRow.line) < notice && notice < text.indexOf(noteRow.line)) ||
    /(?:裁决|rulings?).{0,30}(?:除外|例外|except)/iu.test(text), 'reference notice also qualifies the ruling');
});

for (const [budget, title] of [['30 entries', 'Fixture'], ['3,000 characters', '界'.repeat(145)]]) {
  test(`5c delta: ${budget} ceiling, ordered revisions and withdrawal on existing sends`, async t => {
    const f = fixture(t);
    const revise = item('MEM-REVISE', f.project, { title: 'Obsolete fixture title' });
    const withdraw = item('MEM-WITHDRAW', f.project, { title: 'Withdrawn fixture title' });
    f.publish(revise);
    f.publish(withdraw);
    const { session } = await f.spawn('leader', 'codex', 'Start delta probe');
    await f.tick();
    assert.equal(f.inputs(session).length, 1);
    f.publish(item('MEM-ADD', f.project, { title: 'New fixture title' }));
    f.publish({ ...revise, revision: 2, title: 'Revised fixture title' }, 'update');
    f.publish({ ...withdraw, revision: 2, status: 'forgotten' }, 'withdraw');
    const overflow = Array.from({ length: 32 }, (_, i) => 'MEM-BATCH-' + String(i).padStart(2, '0'));
    for (const id of overflow) f.publish(item(id, f.project, { title }));
    f.publish(item('MEM-HIDDEN', 'other-project'));
    await f.tick();
    assert.equal(f.inputs(session).length, 1, 'changes alone never open a turn');
    const first = await f.deliver(session, 'Please continue fixture A.');
    assert.match(first, /MEM-ADD[^\n]*New fixture title[\s\S]*MEM-REVISE[^\n]*Revised fixture title[\s\S]*MEM-WITHDRAW/);
    assert.ok(first.split('\n').some(line => line.includes('MEM-WITHDRAW') &&
      /withdraw|forget|撤回|作废|遗忘/iu.test(line.replace('MEM-WITHDRAW', ''))), 'withdrawal is explicit');
    assert.doesNotMatch(first, /Obsolete fixture title|Withdrawn fixture title|MEM-HIDDEN/);
    assert.match(first, /截断|省略|剩余|truncat|remaining/iu);
    const ids = text => text.match(/MEM-(?:ADD|REVISE|WITHDRAW|BATCH-\d{2})/g) ?? [];
    assert.ok(ids(first).length <= 30);
    assert.ok([...first].length <= 3000);
    const second = await f.deliver(session, 'Please continue fixture B.');
    assert.ok(ids(second).length > 0);
    const expected = ['MEM-ADD', 'MEM-REVISE', 'MEM-WITHDRAW', ...overflow];
    const seen = [...ids(first), ...ids(second)];
    assert.deepEqual(seen, expected.slice(0, seen.length), 'next delivery resumes at the confirmed cursor');
  });
}

test('5c Claude registers a SessionStart hook scoped to compact', async () => {
  const launch = await buildTuiLaunch({ provider: 'claude', binding: binding('leader', 'A'), indexText });
  const settings = JSON.parse(launch.argv.includes('--settings') ? flag(launch.argv, '--settings') : '{}');
  assert.ok(settings.hooks?.SessionStart?.some(rule => rule.matcher === 'compact' &&
    rule.hooks?.some(hook => hook.type === 'command' && hook.command)), 'missing Claude compact reinjection hook');
});

for (const cli of ['codex', 'opencode', 'agy']) {
  test(`5c ${cli}: a completed compaction restores the current index once on the next send`, async t => {
    const f = fixture(t);
    const before = item('MEM-BEFORE-COMPACT', f.project);
    f.publish(before);
    const { session } = await f.spawn('leader', cli, 'Start compaction probe');
    await f.tick();
    assert.doesNotMatch(await f.deliver(session, 'Before compaction.'), /MEM-BEFORE-COMPACT/);
    // Change the snapshot without publishing a delta. Only a refreshed index can carry this marker.
    f.publish({ ...before, title: 'Current snapshot marker' }, null);
    const emit = f.native.get(session.addr);
    emit('compaction_started', {});
    await f.tick();
    assert.equal(f.inputs(session).length, 2);
    emit('compaction_ended', { outcome: { kind: 'completed' } });
    await f.tick();
    assert.equal(f.inputs(session).length, 2, 'compaction never opens a turn');
    assert.match(await f.deliver(session, 'After compaction.'), /MEM-BEFORE-COMPACT[^\n]*Current snapshot marker/);
    assert.doesNotMatch(await f.deliver(session, 'One more ordinary delivery.'), /MEM-BEFORE-COMPACT/);
  });
}

test('5c R22: worker spawn attaches deterministic path, topic and keyword matches', async t => {
  const f = fixture(t);
  const matches = [
    item('MEM-CARD-PATH', f.project, { paths: ['src/relay/**'] }),
    item('MEM-CARD-TOPIC', f.project, { topics: ['dispatch'] }),
    item('MEM-CARD-KEYWORD', f.project, { keywords: ['takeover'] }),
  ];
  const excluded = [
    item('MEM-CARD-OTHER', f.project, { paths: ['src/relays/**'] }),
    item('MEM-CARD-PRIVATE', f.project, { layer: 'private', keywords: ['takeover'], owner: 'leader' }),
    item('MEM-CARD-USER', null, { layer: 'user', kind: 'ruling', keywords: ['takeover'] }),
    item('MEM-CARD-STALE', f.project, { status: 'stale', keywords: ['takeover'] }),
    item('MEM-CARD-FOREIGN', 'B', { keywords: ['takeover'] }),
  ];
  for (const entry of [...matches, ...excluded]) f.publish(entry);
  const { session: leader } = await f.spawn('leader', 'codex', 'Dispatch fixture cards');
  const card = 'Writable paths: src/relay/inbox.mjs\nTopic: dispatch\nKeywords: takeover';
  async function attachments(task) {
    const { session, deliveryId: first } = await f.spawn('worker', 'codex', card, leader.addr, task);
    await f.tick();
    const inputs = f.inputs(session);
    assert.equal(inputs.length, 1);
    assert.equal(deliveryId(inputs[0]), first);
    assert.ok(inputs[0].includes(card));
    return inputs[0].match(/MEM-CARD-[A-Z]+/g) ?? [];
  }
  const first = await attachments('CARD-A');
  assert.deepEqual([...new Set(first)].sort(), matches.map(entry => entry.id).sort());
  for (const entry of [...excluded, ...matches].reverse()) f.publish(entry);
  assert.deepEqual(await attachments('CARD-B'), first, 'storage order does not change attachment order');
});

test('5c R22: a worker can show an attachment and cannot search or directly maintain entries', async () => {
  const attached = item('MEM-ATTACHED', 'A', { keywords: ['takeover'] });
  const detached = item('MEM-DETACHED', 'A', { keywords: ['takeover'] });
  const worker = binding('worker', 'A', { cardId: 'CARD-A', attachments: [attached.id] });
  const access = createAccess({ now, entries: [attached, detached] });
  assert.deepEqual(rows(await access.search(worker, { query: 'takeover' })), []);
  assert.equal((await access.show(worker, attached.id)).item.id, attached.id);
  assert.deepEqual(await access.show(worker, detached.id), await access.show(worker, 'unknown'));
  assert.equal(access.canWrite(worker, attached), false);
  assert.equal(access.canRevise(worker, attached), false);
});

const codexKeys = ['features.memories', 'memories.generate_memories', 'memories.use_memories'];
test('5d MEM-ISO-1: daemon Codex launch carries all three overrides', t => {
  const { project } = fixture(t);
  const argv = codexConfiguration(project, { role: 'leader', cwd: project }, {}, {});
  assertCodexOverrides(argv);
});

for (const [mode, build] of [['TUI', buildTuiLaunch], ['OAR', buildOarLaunch],
  ['resume', buildResumeLaunch], ['switch', buildSwitchLaunch]]) {
  for (const provider of ['claude', 'codex', 'opencode', 'agy']) {
    test(`5d MEM-ISO-1 ${mode}/${provider}: launch-only isolation preserves user and repo files`, async t => {
      const root = mkdtempSync(join(realpathSync(tmpdir()), 'loom-memory-iso-'));
      t.after(() => rmSync(root, { recursive: true, force: true }));
      const cwd = join(root, 'repo');
      const home = join(root, 'home');
      mkdirSync(cwd);
      mkdirSync(join(home, '.claude'), { recursive: true });
      mkdirSync(join(home, '.codex'));
      const originals = new Map([
        [join(cwd, 'AGENTS.md'), 'Normal project instructions\n'],
        [join(cwd, 'CLAUDE.md'), 'Normal Claude instructions\n'],
        [join(home, '.claude/settings.json'), '{"autoMemoryEnabled":true}\n'],
        [join(home, '.codex/config.toml'), '[features]\nmemories=true\n[memories]\ngenerate_memories=true\nuse_memories=true\n'],
      ]);
      for (const [file, contents] of originals) writeFileSync(file, contents);
      const options = {
        provider, cwd, home, binding: binding('auditor', 'A'),
        previousProvider: provider === 'codex' ? 'claude' : 'codex',
        env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0', OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: '0' },
        argv: provider === 'codex' ? codexKeys.flatMap(key => ['-c', key + '=true']) : [],
        threadConfig: provider === 'codex' ? Object.fromEntries(codexKeys.map(key => [key, true])) : {},
      };
      const originalOptions = structuredClone(options);
      const launch = await build(options, { readFile: path => readFileSync(path, 'utf8'), readDir: () => [] });
      assert.deepEqual(options, originalOptions);
      for (const [file, contents] of originals) assert.equal(readFileSync(file, 'utf8'), contents);
      const instruction = { claude: 'CLAUDE.md', codex: 'AGENTS.md', opencode: 'AGENTS.md' }[provider];
      if (instruction) assert.ok(launch.instructionFiles.includes(join(cwd, instruction)));
      if (provider === 'claude') {
        assert.equal(launch.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
        assert.equal(launch.env.CLAUDE_CODE_ENTRYPOINT, 'loom');
      } else if (provider === 'codex') {
        for (const key of codexKeys) {
          assert.equal(launch.argv.filter(arg => arg.startsWith(key + '=')).at(-1), key + '=false');
          if (mode !== 'TUI') assert.equal(launch.threadConfig[key], false);
        }
      } else if (provider === 'opencode') {
        assert.equal(launch.env.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS, '1');
        assert.equal(launch.coverage, 'not needed');
      } else {
        assert.equal(launch.coverage, 'not covered');
      }
    });
  }
}
