import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { deliveryId } from '../inbox/message.mjs';
import { createAccess } from '../memory/access.mjs';
import { createIndexQuery } from '../memory/index-query.mjs';
import { buildOarLaunch, buildResumeLaunch, buildSwitchLaunch, buildTuiLaunch } from '../memory/launch-config.mjs';
import { codexConfiguration } from './codex-launch.mjs';
import { createSupervisor } from './supervisor.mjs';

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

function fixture(t) {
  const project = mkdtempSync(join(realpathSync(tmpdir()), 'loom-memory-injection-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  mkdirSync(join(project, '.project'));
  writeFileSync(join(project, '.project/policy.json'), JSON.stringify({ preferred: [], deny: [] }));
  const state = { entries: [], changes: [], seq: 0 };
  const access = createAccess({ now, readState: () => state });
  const prompts = [];
  const native = new Map();
  const d = createSupervisor(project, {
    now, report: () => {}, externalNotification: async () => {},
    // The home store seam keeps seeding separate from the loomd behavior under test.
    sessionOptions: { memoryStore: { access }, open },
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
  return { project, spawn, inputs, deliver, publish, native, tick: () => d.tick() };
}

const shared = 'MEM-SHARED';
const ruling = 'MEM-USER-RULING';
const preference = 'MEM-USER-PREFERENCE';
const indexText = '背景笔记，仅供参考，使用前核验\n- ' + shared;
const flag = (argv, name) => argv[argv.indexOf(name) + 1];

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
  assert.deepEqual(argv.filter(arg => codexKeys.some(key => arg.startsWith(key + '='))),
    codexKeys.map(key => key + '=false'));
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
